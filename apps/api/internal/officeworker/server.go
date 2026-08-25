package officeworker

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/aio-converter/api/internal/tools"
	"github.com/aio-converter/api/internal/validation"
)

var workerJobIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{24}$`)

type Server struct {
	cfg       Config
	converter Converter
	slots     chan struct{}
	router    http.Handler
}

func NewServer(cfg Config, converter Converter) (*Server, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	if converter == nil {
		return nil, errors.New("office converter must not be nil")
	}
	if err := prepareWorkerRoot(cfg.JobRoot); err != nil {
		return nil, err
	}
	s := &Server{cfg: cfg, converter: converter, slots: make(chan struct{}, cfg.MaxConcurrent)}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("POST /convert", s.convert)
	s.router = s.securityHeaders(mux)
	return s, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.router.ServeHTTP(w, r) }

func (s *Server) Cleanup() error {
	entries, err := os.ReadDir(s.cfg.JobRoot)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if workerJobIDPattern.MatchString(entry.Name()) {
			if err := os.RemoveAll(filepath.Join(s.cfg.JobRoot, entry.Name())); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	workerJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) convert(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		workerError(w, http.StatusUnauthorized, "unauthorized", "Processor authentication failed.")
		return
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.SplitN(r.Header.Get("Content-Type"), ";", 2)[0]))
	if contentType != "application/vnd.openxmlformats-officedocument.wordprocessingml.document" && contentType != "application/octet-stream" {
		workerError(w, http.StatusUnsupportedMediaType, "unsupported_media", "Only DOCX input is supported.")
		return
	}
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	default:
		w.Header().Set("Retry-After", "3")
		workerError(w, http.StatusTooManyRequests, "processor_busy", "The processor is busy.")
		return
	}

	jobID, err := workerRandomID()
	if err != nil {
		workerError(w, http.StatusInternalServerError, "processor_failed", "The processor could not start.")
		return
	}
	jobDir := filepath.Join(s.cfg.JobRoot, jobID)
	if err := os.Mkdir(jobDir, 0o700); err != nil {
		workerError(w, http.StatusInternalServerError, "processor_failed", "The processor could not start.")
		return
	}
	defer os.RemoveAll(jobDir)
	inputPath := filepath.Join(jobDir, "input.docx")
	input, err := os.OpenFile(inputPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		workerError(w, http.StatusInternalServerError, "processor_failed", "The processor could not prepare the input.")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.MaxInputBytes)
	written, copyErr := io.Copy(input, r.Body)
	closeErr := input.Close()
	if copyErr != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(copyErr, &maxBytesError) {
			workerError(w, http.StatusRequestEntityTooLarge, "file_too_large", "The document exceeds the processor limit.")
			return
		}
		workerError(w, http.StatusBadRequest, "invalid_body", "The document body could not be read.")
		return
	}
	if closeErr != nil || written == 0 || written > s.cfg.MaxInputBytes {
		workerError(w, http.StatusRequestEntityTooLarge, "file_too_large", "The document exceeds the processor limit.")
		return
	}
	tool, _ := tools.Lookup(tools.DocxToPDFToolID)
	if err := validation.DOCX("input.docx", contentType, inputPath, s.cfg.MaxInputBytes, tool.AcceptsMIME); err != nil {
		workerError(w, http.StatusUnprocessableEntity, "invalid_docx", "The DOCX container is invalid.")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.ProcessTimeout)
	defer cancel()
	outputPath, err := s.converter.Convert(ctx, jobDir, inputPath)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			workerError(w, http.StatusGatewayTimeout, "process_timeout", "The conversion timed out.")
			return
		}
		if errors.Is(ctx.Err(), context.Canceled) {
			return
		}
		workerError(w, http.StatusInternalServerError, "processor_crashed", "The conversion process failed.")
		return
	}
	relativeOutput, err := filepath.Rel(jobDir, outputPath)
	if err != nil || relativeOutput == ".." || strings.HasPrefix(relativeOutput, ".."+string(filepath.Separator)) {
		workerError(w, http.StatusInternalServerError, "invalid_output", "The conversion output is invalid.")
		return
	}
	output, err := os.Open(outputPath)
	if err != nil {
		workerError(w, http.StatusInternalServerError, "invalid_output", "The conversion output is unavailable.")
		return
	}
	defer output.Close()
	info, err := output.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > s.cfg.MaxOutputBytes {
		workerError(w, http.StatusInternalServerError, "invalid_output", "The conversion output is invalid.")
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, output)
}

func (s *Server) authorized(r *http.Request) bool {
	if s.cfg.Token == "" {
		return true
	}
	provided := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	return subtle.ConstantTimeCompare([]byte(provided), []byte(s.cfg.Token)) == 1
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

func prepareWorkerRoot(root string) error {
	if err := os.MkdirAll(root, 0o700); err != nil {
		return err
	}
	info, err := os.Lstat(root)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("office job root must be a real directory")
	}
	if err := os.Chmod(root, 0o700); err != nil {
		return err
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if workerJobIDPattern.MatchString(entry.Name()) {
			if err := os.RemoveAll(filepath.Join(root, entry.Name())); err != nil {
				return err
			}
		}
	}
	return nil
}

func workerRandomID() (string, error) {
	var value [18]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value[:]), nil
}

func workerError(w http.ResponseWriter, status int, code, message string) {
	workerJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func workerJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
