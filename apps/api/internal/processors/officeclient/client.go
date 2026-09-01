package officeclient

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/aio-converter/api/internal/processing"
	"github.com/aio-converter/api/internal/tools"
)

type Config struct {
	Transport      string
	SocketPath     string
	BaseURL        string
	Token          string
	MaxOutputBytes int64
}

type Client struct {
	httpClient     *http.Client
	transport      *http.Transport
	baseURL        *url.URL
	token          string
	maxOutputBytes int64
}

func New(cfg Config) (*Client, error) {
	if cfg.MaxOutputBytes <= 0 {
		return nil, fmt.Errorf("office processor output limit must be positive")
	}
	mode := cfg.Transport
	if mode == "" {
		mode = "unix"
	}
	var transport *http.Transport
	var baseURL *url.URL
	switch mode {
	case "unix":
		if !filepath.IsAbs(cfg.SocketPath) || filepath.Ext(cfg.SocketPath) != ".sock" {
			return nil, fmt.Errorf("office processor socket must be an absolute .sock path")
		}
		dialer := &net.Dialer{}
		transport = &http.Transport{
			DisableCompression: true,
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return dialer.DialContext(ctx, "unix", cfg.SocketPath)
			},
		}
		baseURL, _ = url.Parse("http://office")
	case "tcp":
		if strings.TrimSpace(cfg.Token) == "" {
			return nil, fmt.Errorf("office processor token is required for tcp transport")
		}
		parsed, err := url.Parse(cfg.BaseURL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
			return nil, fmt.Errorf("office processor URL must be an absolute http(s) URL without credentials, path, query, or fragment")
		}
		parsed.Path = ""
		baseURL = parsed
		transport = &http.Transport{DisableCompression: true}
	default:
		return nil, fmt.Errorf("office processor transport must be unix or tcp")
	}
	return &Client{
		httpClient:     &http.Client{Transport: transport},
		transport:      transport,
		baseURL:        baseURL,
		token:          cfg.Token,
		maxOutputBytes: cfg.MaxOutputBytes,
	}, nil
}

func (c *Client) ID() string { return tools.OfficeToPDFProcessor }

func (c *Client) Close() { c.transport.CloseIdleConnections() }

func (c *Client) Ready(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.endpoint("/healthz"), nil)
	if err != nil {
		return err
	}
	response, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("office processor health returned %s", response.Status)
	}
	return nil
}

func (c *Client) Process(ctx context.Context, inputPath, outputPath string, report processing.ReportFunc) error {
	input, err := os.Open(inputPath)
	if err != nil {
		return processing.NewFailure("input_unavailable", "The uploaded document is no longer available.", err)
	}
	defer input.Close()
	info, err := input.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return processing.NewFailure("input_unavailable", "The uploaded document is no longer available.", err)
	}

	report(processing.Progress{Stage: "converting", Progress: nil, Message: "Converting the document in an isolated worker."})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint("/convert"), input)
	if err != nil {
		return processing.NewFailure("processor_unavailable", "The document processor is unavailable.", err)
	}
	req.ContentLength = info.Size()
	req.Header.Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	response, err := c.httpClient.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return processing.NewFailure("processor_unavailable", "The document processor is temporarily unavailable.", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return workerFailure(response)
	}
	if response.ContentLength > c.maxOutputBytes {
		return processing.NewFailure("output_too_large", "The converted PDF exceeds the output limit.", nil)
	}

	report(processing.Progress{Stage: "finalizing", Progress: nil, Message: "Validating the converted PDF."})
	partialPath := outputPath + ".partial"
	_ = os.Remove(partialPath)
	output, err := os.OpenFile(partialPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return processing.NewFailure("output_unavailable", "The converted PDF could not be prepared.", err)
	}
	keep := false
	defer func() {
		_ = output.Close()
		if !keep {
			_ = os.Remove(partialPath)
		}
	}()
	written, copyErr := io.Copy(output, io.LimitReader(response.Body, c.maxOutputBytes+1))
	if closeErr := output.Close(); copyErr == nil {
		copyErr = closeErr
	}
	if copyErr != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return processing.NewFailure("processor_crashed", "The document processor stopped unexpectedly.", copyErr)
	}
	if written > c.maxOutputBytes {
		return processing.NewFailure("output_too_large", "The converted PDF exceeds the output limit.", nil)
	}
	if err := validatePDFSignature(partialPath); err != nil {
		return processing.NewFailure("invalid_output", "The converter produced an invalid PDF.", err)
	}
	if err := os.Rename(partialPath, outputPath); err != nil {
		return processing.NewFailure("output_unavailable", "The converted PDF could not be prepared.", err)
	}
	keep = true
	return nil
}

func (c *Client) endpoint(path string) string {
	if c.baseURL == nil {
		return "http://office" + path
	}
	base := *c.baseURL
	base.Path = path
	base.RawQuery = ""
	base.Fragment = ""
	return base.String()
}

func workerFailure(response *http.Response) error {
	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&payload)
	switch {
	case response.StatusCode == http.StatusTooManyRequests:
		return processing.NewFailure("processor_busy", "The document processor is busy. Try again shortly.", nil)
	case response.StatusCode == http.StatusRequestEntityTooLarge:
		return processing.NewFailure("file_too_large", "The document exceeds the processor limit.", nil)
	case response.StatusCode == http.StatusUnprocessableEntity:
		return processing.NewFailure("invalid_docx", "The document could not be read as DOCX.", nil)
	case response.StatusCode == http.StatusGatewayTimeout || payload.Error.Code == "process_timeout":
		return context.DeadlineExceeded
	default:
		return processing.NewFailure("processor_crashed", "The document processor stopped unexpectedly.", errors.New("worker returned "+response.Status))
	}
}

func validatePDFSignature(filePath string) error {
	f, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.Size() < 16 {
		return errors.New("PDF is too small")
	}
	var header [5]byte
	if _, err := io.ReadFull(f, header[:]); err != nil || string(header[:]) != "%PDF-" {
		return errors.New("invalid PDF signature")
	}
	tailSize := int64(2048)
	if info.Size() < tailSize {
		tailSize = info.Size()
	}
	tail := make([]byte, tailSize)
	if _, err := f.ReadAt(tail, info.Size()-tailSize); err != nil || !strings.Contains(string(tail), "%%EOF") {
		return errors.New("invalid PDF trailer")
	}
	return nil
}
