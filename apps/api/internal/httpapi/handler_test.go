package httpapi

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aio-converter/api/internal/jobs"
	"github.com/aio-converter/api/internal/processing"
	"github.com/aio-converter/api/internal/tools"
)

var apiTestPDF = []byte("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n")

type apiFakeProcessor struct {
	process func(context.Context, string, string, processing.ReportFunc) error
}

type interruptedResponseWriter struct {
	header http.Header
	status int
}

func (w *interruptedResponseWriter) Header() http.Header {
	if w.header == nil {
		w.header = make(http.Header)
	}
	return w.header
}

func (w *interruptedResponseWriter) WriteHeader(status int) { w.status = status }

func (w *interruptedResponseWriter) Write([]byte) (int, error) {
	return 0, io.ErrClosedPipe
}

func (f apiFakeProcessor) ID() string { return tools.OfficeToPDFProcessor }
func (f apiFakeProcessor) Process(ctx context.Context, input, output string, report processing.ReportFunc) error {
	return f.process(ctx, input, output, report)
}

func newAPIForTest(t *testing.T, processor processing.Processor, maxUpload int64) (*Handler, *jobs.Manager, string) {
	t.Helper()
	root := filepath.Join(t.TempDir(), "jobs")
	manager, err := jobs.NewManager(jobs.Config{
		Root:           root,
		TTL:            time.Minute,
		ProcessTimeout: time.Second,
		Concurrency:    1,
		QueueSize:      2,
	}, processor)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = manager.Close() })
	handler, err := New(Config{
		AllowedOrigins:  []string{"http://localhost:4321"},
		MaxUploadBytes:  maxUpload,
		DownloadTimeout: time.Second,
		SSEHeartbeat:    10 * time.Millisecond,
	}, manager)
	if err != nil {
		t.Fatal(err)
	}
	return handler, manager, root
}

func successfulAPIFake() apiFakeProcessor {
	return apiFakeProcessor{process: func(_ context.Context, _, output string, report processing.ReportFunc) error {
		report(processing.Progress{Stage: "finalizing", Progress: nil})
		return os.WriteFile(output, apiTestPDF, 0o600)
	}}
}

func TestJobAPIEndToEndAndOneTimeOutputCleanup(t *testing.T) {
	handler, manager, root := newAPIForTest(t, successfulAPIFake(), 2*1024*1024)
	jobID := postValidDOCX(t, handler)
	waitAPIStatus(t, manager, jobID, jobs.StatusSucceeded)

	statusRequest := httptest.NewRequest(http.MethodGet, "/v1/jobs/"+jobID, nil)
	statusResponse := httptest.NewRecorder()
	handler.ServeHTTP(statusResponse, statusRequest)
	if statusResponse.Code != http.StatusOK || statusResponse.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("unexpected status response: %d %v", statusResponse.Code, statusResponse.Header())
	}

	eventsRequest := httptest.NewRequest(http.MethodGet, "/v1/jobs/"+jobID+"/events", nil)
	eventsResponse := httptest.NewRecorder()
	handler.ServeHTTP(eventsResponse, eventsRequest)
	if eventsResponse.Code != http.StatusOK || !strings.Contains(eventsResponse.Body.String(), "event: job") || !strings.Contains(eventsResponse.Body.String(), `"status":"succeeded"`) {
		t.Fatalf("unexpected SSE response: %d %q", eventsResponse.Code, eventsResponse.Body.String())
	}

	outputRequest := httptest.NewRequest(http.MethodGet, "/v1/jobs/"+jobID+"/output", nil)
	outputResponse := httptest.NewRecorder()
	handler.ServeHTTP(outputResponse, outputRequest)
	if outputResponse.Code != http.StatusOK || !bytes.Equal(outputResponse.Body.Bytes(), apiTestPDF) {
		t.Fatalf("unexpected output: %d %q", outputResponse.Code, outputResponse.Body.Bytes())
	}
	if got := outputResponse.Header().Get("Content-Disposition"); got != `attachment; filename="converted.pdf"` {
		t.Fatalf("unsafe content disposition: %q", got)
	}
	if got := outputResponse.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("missing nosniff: %q", got)
	}
	second := httptest.NewRecorder()
	handler.ServeHTTP(second, httptest.NewRequest(http.MethodGet, "/v1/jobs/"+jobID+"/output", nil))
	if second.Code != http.StatusNotFound {
		t.Fatalf("one-time output remained available: %d", second.Code)
	}
	entries, err := os.ReadDir(root)
	if err != nil || len(entries) != 0 {
		t.Fatalf("job artifacts remain: entries=%v err=%v", entries, err)
	}
}

func TestJobAPIRejectsMalformedAndOversizedUploads(t *testing.T) {
	handler, _, _ := newAPIForTest(t, successfulAPIFake(), 2*1024*1024)

	t.Run("unknown tool", func(t *testing.T) {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/v1/jobs/unknown", nil))
		if response.Code != http.StatusNotFound {
			t.Fatalf("got %d", response.Code)
		}
	})

	t.Run("wrong extension", func(t *testing.T) {
		body, contentType := multipartBody(t, []uploadFile{{name: "private-name.txt", data: validDOCXBytes(t)}})
		request := httptest.NewRequest(http.MethodPost, "/v1/jobs/"+tools.DocxToPDFToolID, body)
		request.Header.Set("Content-Type", contentType)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusUnsupportedMediaType {
			t.Fatalf("got %d: %s", response.Code, response.Body.String())
		}
		if strings.Contains(response.Body.String(), "private-name") {
			t.Fatal("original filename leaked in error response")
		}
	})

	t.Run("multiple files", func(t *testing.T) {
		fixture := validDOCXBytes(t)
		body, contentType := multipartBody(t, []uploadFile{{name: "one.docx", data: fixture}, {name: "two.docx", data: fixture}})
		request := httptest.NewRequest(http.MethodPost, "/v1/jobs/"+tools.DocxToPDFToolID, body)
		request.Header.Set("Content-Type", contentType)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("got %d: %s", response.Code, response.Body.String())
		}
	})

	t.Run("invalid options", func(t *testing.T) {
		body, contentType := multipartBodyWithOptions(t, []uploadFile{{name: "one.docx", data: validDOCXBytes(t)}}, `{"quality":100}`)
		request := httptest.NewRequest(http.MethodPost, "/v1/jobs/"+tools.DocxToPDFToolID, body)
		request.Header.Set("Content-Type", contentType)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusUnprocessableEntity {
			t.Fatalf("got %d: %s", response.Code, response.Body.String())
		}
	})

	t.Run("body limit", func(t *testing.T) {
		smallHandler, _, _ := newAPIForTest(t, successfulAPIFake(), 128)
		body, contentType := multipartBody(t, []uploadFile{{name: "one.docx", data: validDOCXBytes(t)}})
		request := httptest.NewRequest(http.MethodPost, "/v1/jobs/"+tools.DocxToPDFToolID, body)
		request.Header.Set("Content-Type", contentType)
		response := httptest.NewRecorder()
		smallHandler.ServeHTTP(response, request)
		if response.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("got %d: %s", response.Code, response.Body.String())
		}
	})

	t.Run("known content length is rejected before job allocation", func(t *testing.T) {
		root := filepath.Join(t.TempDir(), "jobs")
		manager, err := jobs.NewManager(jobs.Config{
			Root:           root,
			TTL:            time.Minute,
			ProcessTimeout: time.Second,
			Concurrency:    1,
			QueueSize:      1,
		}, successfulAPIFake())
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = manager.Close() })
		smallHandler, err := New(Config{
			AllowedOrigins:  []string{"http://localhost:4321"},
			MaxUploadBytes:  128,
			DownloadTimeout: time.Second,
		}, manager)
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(http.MethodPost, "/v1/jobs/"+tools.DocxToPDFToolID, strings.NewReader("x"))
		request.ContentLength = 129
		response := httptest.NewRecorder()
		smallHandler.ServeHTTP(response, request)
		if response.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("got %d: %s", response.Code, response.Body.String())
		}
		if metrics := manager.Metrics(); metrics.TrackedJobs != 0 || metrics.AdmittedJobs != 0 {
			t.Fatalf("oversized request allocated a job: %+v", metrics)
		}
		assertEventuallyAPIJobRootEmpty(t, root)
	})
}

func TestJobAPICleansIncompleteUploadsAndRecoversFromRunnerFailure(t *testing.T) {
	t.Run("incomplete upload", func(t *testing.T) {
		handler, manager, root := newAPIForTest(t, successfulAPIFake(), 2*1024*1024)
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, err := writer.CreateFormFile("file", "partial.docx")
		if err != nil {
			t.Fatal(err)
		}
		fixture := validDOCXBytes(t)
		if _, err := part.Write(fixture[:len(fixture)/2]); err != nil {
			t.Fatal(err)
		}
		// Deliberately omit writer.Close() to simulate a client disconnect.
		request := httptest.NewRequest(http.MethodPost, "/v1/jobs/"+tools.DocxToPDFToolID, &body)
		request.Header.Set("Content-Type", writer.FormDataContentType())
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("got %d: %s", response.Code, response.Body.String())
		}
		if metrics := manager.Metrics(); metrics.TrackedJobs != 0 || metrics.AdmittedJobs != 0 {
			t.Fatalf("incomplete upload left a job behind: %+v", metrics)
		}
		assertAPIJobRootEmpty(t, root)
		postValidDOCX(t, handler)
	})

	t.Run("runner recovers for later jobs", func(t *testing.T) {
		var calls int
		processor := apiFakeProcessor{process: func(_ context.Context, _, output string, _ processing.ReportFunc) error {
			calls++
			if calls == 1 {
				return processing.NewFailure(
					"processor_unavailable",
					"The document processor is temporarily unavailable.",
					errors.New("runner reset at /run/aio-office/office.sock"),
				)
			}
			return os.WriteFile(output, apiTestPDF, 0o600)
		}}
		handler, manager, root := newAPIForTest(t, processor, 2*1024*1024)
		firstID := postValidDOCX(t, handler)
		waitAPIStatus(t, manager, firstID, jobs.StatusFailed)
		snapshot, err := manager.Get(firstID)
		if err != nil || snapshot.Error == nil || snapshot.Error.Code != "processor_unavailable" {
			t.Fatalf("unexpected failed snapshot: %+v %v", snapshot, err)
		}
		if strings.Contains(snapshot.Error.Message, "/run/") {
			t.Fatalf("runner path leaked in public error: %q", snapshot.Error.Message)
		}
		assertEventuallyAPIJobRootEmpty(t, root)

		secondID := postValidDOCX(t, handler)
		waitAPIStatus(t, manager, secondID, jobs.StatusSucceeded)
		lease, err := manager.OpenOutput(secondID)
		if err != nil {
			t.Fatal(err)
		}
		if err := lease.Finish(); err != nil {
			t.Fatal(err)
		}
		assertAPIJobRootEmpty(t, root)
	})
}

func TestJobAPICancelAndCORS(t *testing.T) {
	started := make(chan struct{})
	var once sync.Once
	blocking := apiFakeProcessor{process: func(ctx context.Context, _, _ string, _ processing.ReportFunc) error {
		once.Do(func() { close(started) })
		<-ctx.Done()
		return ctx.Err()
	}}
	handler, _, root := newAPIForTest(t, blocking, 2*1024*1024)
	jobID := postValidDOCX(t, handler)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("processor did not start")
	}
	request := httptest.NewRequest(http.MethodDelete, "/v1/jobs/"+jobID, nil)
	request.Header.Set("Origin", "http://localhost:4321")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent || response.Header().Get("Access-Control-Allow-Origin") != "http://localhost:4321" {
		t.Fatalf("unexpected cancel response: %d %v", response.Code, response.Header())
	}
	entries, err := os.ReadDir(root)
	if err != nil || len(entries) != 0 {
		t.Fatalf("canceled job artifacts remain: %v %v", entries, err)
	}

	forbidden := httptest.NewRecorder()
	badOrigin := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	badOrigin.Header.Set("Origin", "https://evil.example")
	handler.ServeHTTP(forbidden, badOrigin)
	if forbidden.Code != http.StatusForbidden {
		t.Fatalf("unapproved origin got %d", forbidden.Code)
	}

	preflight := httptest.NewRequest(http.MethodOptions, "/v1/jobs/"+tools.DocxToPDFToolID, nil)
	preflight.Header.Set("Origin", "http://localhost:4321")
	preflight.Header.Set("Access-Control-Request-Method", http.MethodPost)
	preflightResponse := httptest.NewRecorder()
	handler.ServeHTTP(preflightResponse, preflight)
	if preflightResponse.Code != http.StatusNoContent ||
		preflightResponse.Header().Get("Access-Control-Allow-Origin") != "http://localhost:4321" ||
		preflightResponse.Header().Get("Access-Control-Allow-Origin") == "*" {
		t.Fatalf("unexpected preflight response: %d %v", preflightResponse.Code, preflightResponse.Header())
	}
}

func TestHealthReportsProcessorReadiness(t *testing.T) {
	handler, _, _ := newAPIForTest(t, successfulAPIFake(), 2*1024*1024)
	handler.readinessCheck = func(context.Context) error { return errors.New("worker unavailable") }
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("unready processor health returned %d", response.Code)
	}
}

func TestMetricsExposeOnlyAggregateOperationalData(t *testing.T) {
	handler, _, _ := newAPIForTest(t, successfulAPIFake(), 2*1024*1024)
	disabled := httptest.NewRecorder()
	handler.ServeHTTP(disabled, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if disabled.Code != http.StatusNotFound {
		t.Fatalf("disabled metrics returned %d", disabled.Code)
	}
	handler.metricsToken = "metrics-test-token"
	request := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	request.Header.Set("Authorization", "Bearer metrics-test-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "aio_jobs_queue_depth") {
		t.Fatalf("unexpected metrics response: %d %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "filename") {
		t.Fatal("metrics leaked file-level metadata")
	}
	forbidden := httptest.NewRecorder()
	wrongToken := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	wrongToken.Header.Set("Authorization", "Bearer wrong-token")
	handler.ServeHTTP(forbidden, wrongToken)
	if forbidden.Code != http.StatusNotFound {
		t.Fatalf("invalid metrics token returned %d", forbidden.Code)
	}
}

func TestJobAPIOutputDisconnectStillPurgesOneTimeOutput(t *testing.T) {
	handler, manager, root := newAPIForTest(t, successfulAPIFake(), 2*1024*1024)
	jobID := postValidDOCX(t, handler)
	waitAPIStatus(t, manager, jobID, jobs.StatusSucceeded)
	writer := &interruptedResponseWriter{}
	handler.ServeHTTP(writer, httptest.NewRequest(http.MethodGet, "/v1/jobs/"+jobID+"/output", nil))
	if writer.status != http.StatusOK {
		t.Fatalf("download disconnect returned status %d", writer.status)
	}
	if _, err := manager.Get(jobID); !errors.Is(err, jobs.ErrNotFound) {
		t.Fatalf("interrupted download retained its one-time output: %v", err)
	}
	assertAPIJobRootEmpty(t, root)
}

func TestJobAPIMapsBoundedAdmissionToTooManyRequests(t *testing.T) {
	handler, manager, _ := newAPIForTest(t, successfulAPIFake(), 2*1024*1024)
	tool, _ := tools.Lookup(tools.DocxToPDFToolID)
	ids := make([]string, 0, 3)
	for range 3 { // concurrency (1) + queue (2)
		id, _, err := manager.Create(tool)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	t.Cleanup(func() {
		for _, id := range ids {
			manager.Discard(id)
		}
	})
	body, contentType := multipartBody(t, []uploadFile{{name: "one.docx", data: validDOCXBytes(t)}})
	request := httptest.NewRequest(http.MethodPost, "/v1/jobs/"+tools.DocxToPDFToolID, body)
	request.Header.Set("Content-Type", contentType)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusTooManyRequests || response.Header().Get("Retry-After") != "5" {
		t.Fatalf("bounded admission returned %d with headers %v", response.Code, response.Header())
	}
}

type uploadFile struct {
	name string
	data []byte
}

func assertAPIJobRootEmpty(t *testing.T, root string) {
	t.Helper()
	entries, err := os.ReadDir(root)
	if err != nil || len(entries) != 0 {
		t.Fatalf("job artifacts remain: entries=%v err=%v", entries, err)
	}
}

func assertEventuallyAPIJobRootEmpty(t *testing.T, root string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		entries, err := os.ReadDir(root)
		if err == nil && len(entries) == 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	assertAPIJobRootEmpty(t, root)
}

func postValidDOCX(t *testing.T, handler http.Handler) string {
	t.Helper()
	body, contentType := multipartBodyWithOptions(t, []uploadFile{{name: "sensitive-name.docx", data: validDOCXBytes(t)}}, `{}`)
	request := httptest.NewRequest(http.MethodPost, "/v1/jobs/"+tools.DocxToPDFToolID, body)
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("Origin", "http://localhost:4321")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusAccepted {
		t.Fatalf("POST got %d: %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "sensitive-name") {
		t.Fatal("original filename leaked")
	}
	var payload createResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.JobID == "" || response.Header().Get("Location") == "" {
		t.Fatalf("invalid create response: %+v", payload)
	}
	return payload.JobID
}

func waitAPIStatus(t *testing.T, manager *jobs.Manager, id string, wanted jobs.Status) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		snapshot, err := manager.Get(id)
		if err == nil && snapshot.Status == wanted {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("job did not reach %s", wanted)
}

func multipartBody(t *testing.T, files []uploadFile) (*bytes.Buffer, string) {
	t.Helper()
	return multipartBodyWithOptions(t, files, "")
}

func multipartBodyWithOptions(t *testing.T, files []uploadFile, options string) (*bytes.Buffer, string) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, file := range files {
		header := make(textproto.MIMEHeader)
		header.Set("Content-Disposition", `form-data; name="files"; filename="`+file.name+`"`)
		header.Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
		part, err := writer.CreatePart(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(file.data); err != nil {
			t.Fatal(err)
		}
	}
	if options != "" {
		part, err := writer.CreateFormField("options")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(part, options); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return &body, writer.FormDataContentType()
}

func validDOCXBytes(t *testing.T) []byte {
	t.Helper()
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	parts := map[string]string{
		"[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
		"_rels/.rels":         `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
		"word/document.xml":   `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>`,
	}
	for name, content := range parts {
		part, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(part, content); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}
