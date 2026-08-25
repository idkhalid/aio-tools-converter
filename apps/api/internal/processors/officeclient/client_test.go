package officeclient

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/aio-converter/api/internal/processing"
)

var clientTestPDF = []byte("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n")

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return f(request) }

func TestClientProcessSuccessAndFailures(t *testing.T) {
	tests := []struct {
		name      string
		response  func(*http.Request) (*http.Response, error)
		wantError string
	}{
		{
			name: "success",
			response: func(request *http.Request) (*http.Response, error) {
				_, _ = io.Copy(io.Discard, request.Body)
				return testResponse(http.StatusOK, clientTestPDF), nil
			},
		},
		{
			name: "invalid output",
			response: func(request *http.Request) (*http.Response, error) {
				_, _ = io.Copy(io.Discard, request.Body)
				return testResponse(http.StatusOK, []byte("not pdf")), nil
			},
			wantError: "invalid_output",
		},
		{
			name: "worker timeout",
			response: func(request *http.Request) (*http.Response, error) {
				_, _ = io.Copy(io.Discard, request.Body)
				return testResponse(http.StatusGatewayTimeout, []byte(`{"error":{"code":"process_timeout"}}`)), nil
			},
			wantError: context.DeadlineExceeded.Error(),
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			dir := t.TempDir()
			inputPath := filepath.Join(dir, "input.docx")
			outputPath := filepath.Join(dir, "output.pdf")
			if err := os.WriteFile(inputPath, []byte("input"), 0o600); err != nil {
				t.Fatal(err)
			}
			client := &Client{
				httpClient:     &http.Client{Transport: roundTripFunc(test.response)},
				maxOutputBytes: 1024,
			}
			err := client.Process(context.Background(), inputPath, outputPath, func(_ processing.Progress) {})
			if test.wantError == "" {
				if err != nil {
					t.Fatal(err)
				}
				got, readErr := os.ReadFile(outputPath)
				if readErr != nil || string(got) != string(clientTestPDF) {
					t.Fatalf("output mismatch: %v", readErr)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), test.wantError) {
				t.Fatalf("error %v does not contain %q", err, test.wantError)
			}
			if _, statErr := os.Stat(outputPath + ".partial"); !os.IsNotExist(statErr) {
				t.Fatalf("partial output remains: %v", statErr)
			}
		})
	}
}

func TestClientHonorsCancellation(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "input.docx")
	if err := os.WriteFile(inputPath, []byte("input"), 0o600); err != nil {
		t.Fatal(err)
	}
	client := &Client{
		httpClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			<-request.Context().Done()
			return nil, request.Context().Err()
		})},
		maxOutputBytes: 1024,
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	err := client.Process(ctx, inputPath, filepath.Join(dir, "output.pdf"), func(_ processing.Progress) {})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected cancellation, got %v", err)
	}
}

func TestClientReadinessUsesWorkerHealthEndpoint(t *testing.T) {
	called := false
	client := &Client{httpClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		called = request.Method == http.MethodGet && request.URL.Path == "/healthz"
		return testResponse(http.StatusOK, []byte(`{"status":"ok"}`)), nil
	})}}
	if err := client.Ready(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !called {
		t.Fatal("worker health endpoint was not called")
	}
}

func testResponse(status int, body []byte) *http.Response {
	return &http.Response{
		StatusCode:    status,
		Status:        http.StatusText(status),
		ContentLength: int64(len(body)),
		Body:          io.NopCloser(strings.NewReader(string(body))),
		Header:        make(http.Header),
	}
}
