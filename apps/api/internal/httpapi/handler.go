package httpapi

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/aio-converter/api/internal/jobs"
	"github.com/aio-converter/api/internal/tools"
	"github.com/aio-converter/api/internal/validation"
)

const maxOptionsBytes = 64 * 1024

type Config struct {
	AllowedOrigins  []string
	MetricsToken    string
	MaxUploadBytes  int64
	DownloadTimeout time.Duration
	SSEHeartbeat    time.Duration
	ReadinessCheck  func(context.Context) error
}

type Handler struct {
	jobs            *jobs.Manager
	allowedOrigins  map[string]struct{}
	metricsToken    string
	maxUploadBytes  int64
	downloadTimeout time.Duration
	sseHeartbeat    time.Duration
	readinessCheck  func(context.Context) error
	router          http.Handler
}

func New(cfg Config, manager *jobs.Manager) (*Handler, error) {
	if manager == nil || cfg.MaxUploadBytes <= 0 || cfg.DownloadTimeout <= 0 {
		return nil, fmt.Errorf("invalid HTTP API configuration")
	}
	if cfg.SSEHeartbeat <= 0 {
		cfg.SSEHeartbeat = 15 * time.Second
	}
	h := &Handler{
		jobs:            manager,
		allowedOrigins:  make(map[string]struct{}, len(cfg.AllowedOrigins)),
		metricsToken:    cfg.MetricsToken,
		maxUploadBytes:  cfg.MaxUploadBytes,
		downloadTimeout: cfg.DownloadTimeout,
		sseHeartbeat:    cfg.SSEHeartbeat,
		readinessCheck:  cfg.ReadinessCheck,
	}
	for _, origin := range cfg.AllowedOrigins {
		h.allowedOrigins[origin] = struct{}{}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", h.health)
	mux.HandleFunc("GET /metrics", h.metrics)
	mux.HandleFunc("POST /v1/jobs/{toolId}", h.createJob)
	mux.HandleFunc("GET /v1/jobs/{jobId}", h.getJob)
	mux.HandleFunc("GET /v1/jobs/{jobId}/events", h.events)
	mux.HandleFunc("GET /v1/jobs/{jobId}/output", h.output)
	mux.HandleFunc("DELETE /v1/jobs/{jobId}", h.deleteJob)
	h.router = h.middleware(mux)
	return h, nil
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.router.ServeHTTP(w, r)
}

type createResponse struct {
	JobID     string      `json:"jobId"`
	ToolID    string      `json:"toolId"`
	Status    jobs.Status `json:"status"`
	StatusURL string      `json:"statusUrl"`
	EventsURL string      `json:"eventsUrl"`
	OutputURL string      `json:"outputUrl"`
}

func (h *Handler) health(w http.ResponseWriter, r *http.Request) {
	if h.readinessCheck != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := h.readinessCheck(ctx); err != nil {
			writeError(w, http.StatusServiceUnavailable, "processor_unavailable", "The document processor is unavailable.")
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) metrics(w http.ResponseWriter, r *http.Request) {
	if !h.metricsAuthorized(r) {
		writeError(w, http.StatusNotFound, "not_found", "This endpoint does not exist.")
		return
	}
	metrics := h.jobs.Metrics()
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = fmt.Fprintf(w,
		"aio_jobs_tracked %d\naio_jobs_queue_depth %d\naio_jobs_admitted %d\naio_processor_runs_total %d\naio_processor_seconds_total %.6f\naio_jobs_succeeded_total %d\naio_jobs_failed_total %d\naio_jobs_timed_out_total %d\naio_jobs_canceled_total %d\naio_process_memory_bytes %d\n",
		metrics.TrackedJobs,
		metrics.QueueDepth,
		metrics.AdmittedJobs,
		metrics.ProcessorRuns,
		metrics.ProcessorSeconds,
		metrics.SucceededJobs,
		metrics.FailedJobs,
		metrics.TimedOutJobs,
		metrics.CanceledJobs,
		memory.Alloc,
	)
}

func (h *Handler) metricsAuthorized(r *http.Request) bool {
	if h.metricsToken == "" {
		return false
	}
	provided := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	return subtle.ConstantTimeCompare([]byte(provided), []byte(h.metricsToken)) == 1
}

func (h *Handler) createJob(w http.ResponseWriter, r *http.Request) {
	tool, ok := tools.Lookup(r.PathValue("toolId"))
	if !ok {
		writeError(w, http.StatusNotFound, "unknown_tool", "This server tool does not exist.")
		return
	}
	if r.ContentLength > h.maxUploadBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "file_too_large", "The document exceeds the upload limit.")
		return
	}

	jobID, inputPath, err := h.jobs.Create(tool)
	if err != nil {
		if errors.Is(err, jobs.ErrQueueFull) {
			w.Header().Set("Retry-After", "5")
			writeError(w, http.StatusTooManyRequests, "queue_full", "The converter is busy. Try again shortly.")
			return
		}
		writeError(w, http.StatusServiceUnavailable, "service_unavailable", "The converter is temporarily unavailable.")
		return
	}
	committed := false
	defer func() {
		if !committed {
			h.jobs.Discard(jobID)
		}
	}()

	r.Body = http.MaxBytesReader(w, r.Body, h.maxUploadBytes)
	reader, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_multipart", "Upload the document as multipart/form-data.")
		return
	}
	filename, declaredMIME, err := receiveMultipart(reader, inputPath, tool.MaxInputBytes)
	if err != nil {
		var maxBytesError *http.MaxBytesError
		switch {
		case errors.As(err, &maxBytesError), errors.Is(err, errFileTooLarge):
			writeError(w, http.StatusRequestEntityTooLarge, "file_too_large", "The document exceeds the upload limit.")
		case errors.Is(err, errInvalidOptions):
			writeError(w, http.StatusUnprocessableEntity, "invalid_options", "DOCX to PDF does not accept these options.")
		default:
			writeError(w, http.StatusBadRequest, "invalid_upload", "Upload exactly one DOCX file.")
		}
		return
	}
	if err := validation.DOCX(filename, declaredMIME, inputPath, tool.MaxInputBytes, tool.AcceptsMIME); err != nil {
		writeError(w, http.StatusUnsupportedMediaType, "invalid_docx", "The selected file is not a supported, valid DOCX document.")
		return
	}
	if err := h.jobs.Enqueue(jobID); err != nil {
		writeError(w, http.StatusServiceUnavailable, "service_unavailable", "The conversion could not be queued.")
		return
	}
	committed = true
	base := "/v1/jobs/" + jobID
	w.Header().Set("Location", base)
	writeJSON(w, http.StatusAccepted, createResponse{
		JobID:     jobID,
		ToolID:    tool.ID,
		Status:    jobs.StatusQueued,
		StatusURL: base,
		EventsURL: base + "/events",
		OutputURL: base + "/output",
	})
}

func (h *Handler) getJob(w http.ResponseWriter, r *http.Request) {
	snapshot, err := h.jobs.Get(r.PathValue("jobId"))
	if err != nil {
		writeError(w, http.StatusNotFound, "job_not_found", "This job does not exist or has expired.")
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}

func (h *Handler) events(w http.ResponseWriter, r *http.Request) {
	updates, unsubscribe, err := h.jobs.Subscribe(r.PathValue("jobId"))
	if err != nil {
		if errors.Is(err, jobs.ErrTooManySubscribers) {
			writeError(w, http.StatusTooManyRequests, "too_many_streams", "Too many progress streams are open for this job.")
			return
		}
		writeError(w, http.StatusNotFound, "job_not_found", "This job does not exist or has expired.")
		return
	}
	defer unsubscribe()
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming_unavailable", "Progress streaming is unavailable.")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	heartbeat := time.NewTicker(h.sseHeartbeat)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case snapshot := <-updates:
			payload, err := json.Marshal(snapshot)
			if err != nil {
				return
			}
			if _, err := fmt.Fprintf(w, "id: %d\nevent: job\ndata: %s\n\n", snapshot.Version, payload); err != nil {
				return
			}
			flusher.Flush()
			if snapshot.Status.Terminal() {
				return
			}
		case <-heartbeat.C:
			if _, err := io.WriteString(w, ": keep-alive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (h *Handler) output(w http.ResponseWriter, r *http.Request) {
	lease, err := h.jobs.OpenOutput(r.PathValue("jobId"))
	if err != nil {
		switch {
		case errors.Is(err, jobs.ErrNotFound):
			writeError(w, http.StatusNotFound, "job_not_found", "This job does not exist or has expired.")
		case errors.Is(err, jobs.ErrOutputUnavailable):
			writeError(w, http.StatusGone, "output_unavailable", "This one-time output is no longer available.")
		default:
			writeError(w, http.StatusConflict, "output_not_ready", "The output is not ready yet.")
		}
		return
	}
	defer lease.Finish()

	deadline := time.Now().Add(h.downloadTimeout)
	_ = http.NewResponseController(w).SetWriteDeadline(deadline)
	w.Header().Set("Content-Type", lease.MIMEType)
	w.Header().Set("Content-Length", strconv.FormatInt(lease.Size, 10))
	w.Header().Set("Content-Disposition", `attachment; filename="converted.pdf"`)
	w.Header().Set("Accept-Ranges", "none")
	w.WriteHeader(http.StatusOK)
	_ = copyWithContexts(r.Context(), lease.Context, w, lease.File)
}

func (h *Handler) deleteJob(w http.ResponseWriter, r *http.Request) {
	pending, err := h.jobs.Delete(r.Context(), r.PathValue("jobId"))
	if errors.Is(err, jobs.ErrNotFound) {
		writeError(w, http.StatusNotFound, "job_not_found", "This job does not exist or has expired.")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "cleanup_failed", "The job was canceled but cleanup is still in progress.")
		return
	}
	if pending {
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "canceling"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Add("Vary", "Origin")

		origin := r.Header.Get("Origin")
		if origin != "" {
			if _, allowed := h.allowedOrigins[origin]; !allowed {
				writeError(w, http.StatusForbidden, "origin_not_allowed", "This origin is not allowed to use the API.")
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Accept, Last-Event-ID")
			w.Header().Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

var (
	errFileTooLarge   = errors.New("uploaded file is too large")
	errInvalidOptions = errors.New("invalid options")
)

func receiveMultipart(reader *multipart.Reader, inputPath string, maxFileBytes int64) (filename, declaredMIME string, resultErr error) {
	var fileSeen, optionsSeen bool
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", "", err
		}
		field := part.FormName()
		switch field {
		case "file", "files":
			if fileSeen || part.FileName() == "" {
				part.Close()
				return "", "", errors.New("exactly one file is required")
			}
			fileSeen = true
			filename = part.FileName()
			declaredMIME = part.Header.Get("Content-Type")
			out, err := os.OpenFile(inputPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
			if err != nil {
				part.Close()
				return "", "", err
			}
			written, copyErr := io.Copy(out, io.LimitReader(part, maxFileBytes+1))
			closeErr := out.Close()
			part.Close()
			if copyErr != nil {
				return "", "", copyErr
			}
			if closeErr != nil {
				return "", "", closeErr
			}
			if written > maxFileBytes {
				return "", "", errFileTooLarge
			}
		case "options":
			if optionsSeen || part.FileName() != "" {
				part.Close()
				return "", "", errInvalidOptions
			}
			optionsSeen = true
			payload, err := io.ReadAll(io.LimitReader(part, maxOptionsBytes+1))
			part.Close()
			if err != nil || len(payload) > maxOptionsBytes || validateEmptyOptions(payload) != nil {
				return "", "", errInvalidOptions
			}
		default:
			part.Close()
			return "", "", errors.New("unexpected multipart field")
		}
	}
	if !fileSeen {
		return "", "", errors.New("file is missing")
	}
	return filename, declaredMIME, nil
}

func validateEmptyOptions(payload []byte) error {
	payload = bytes.TrimSpace(payload)
	if len(payload) == 0 {
		return nil
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var options map[string]json.RawMessage
	if err := decoder.Decode(&options); err != nil || options == nil || len(options) != 0 {
		return errInvalidOptions
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return errInvalidOptions
	}
	return nil
}

func copyWithContexts(requestCtx, jobCtx context.Context, dst io.Writer, src io.Reader) error {
	buffer := make([]byte, 64*1024)
	for {
		select {
		case <-requestCtx.Done():
			return requestCtx.Err()
		case <-jobCtx.Done():
			return jobCtx.Err()
		default:
		}
		n, readErr := src.Read(buffer)
		if n > 0 {
			if _, writeErr := dst.Write(buffer[:n]); writeErr != nil {
				return writeErr
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				return nil
			}
			return readErr
		}
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
