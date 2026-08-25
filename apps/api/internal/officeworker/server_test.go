package officeworker

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var workerTestPDF = []byte("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n")

type fakeConverter func(context.Context, string, string) (string, error)

func (f fakeConverter) Convert(ctx context.Context, jobDir, input string) (string, error) {
	return f(ctx, jobDir, input)
}

func workerConfigForTest(t *testing.T) Config {
	t.Helper()
	root := t.TempDir()
	return Config{
		SocketPath:     filepath.Join(root, "office.sock"),
		JobRoot:        filepath.Join(root, "jobs"),
		LibreOfficeBin: "soffice",
		MaxInputBytes:  1024 * 1024,
		MaxOutputBytes: 1024 * 1024,
		ProcessTimeout: time.Second,
		MaxConcurrent:  1,
		ShutdownWait:   time.Second,
	}
}

func successfulWorkerFake() fakeConverter {
	return func(_ context.Context, jobDir, _ string) (string, error) {
		outputPath := filepath.Join(jobDir, "converted.pdf")
		return outputPath, os.WriteFile(outputPath, workerTestPDF, 0o600)
	}
}

func TestWorkerConvertsAndCleansEveryArtifact(t *testing.T) {
	cfg := workerConfigForTest(t)
	server, err := NewServer(cfg, successfulWorkerFake())
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/convert", bytes.NewReader(workerDOCX(t)))
	request.Header.Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !bytes.Equal(response.Body.Bytes(), workerTestPDF) {
		t.Fatalf("unexpected worker response: %d %q", response.Code, response.Body.Bytes())
	}
	if response.Header().Get("Cache-Control") != "private, no-store" || response.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("missing response security headers: %v", response.Header())
	}
	assertWorkerRootEmpty(t, cfg.JobRoot)
}

func TestWorkerRejectsInvalidAuthInputAndEscapedOutput(t *testing.T) {
	t.Run("auth", func(t *testing.T) {
		cfg := workerConfigForTest(t)
		cfg.Token = "secret"
		server, err := NewServer(cfg, successfulWorkerFake())
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(http.MethodPost, "/convert", bytes.NewReader(workerDOCX(t)))
		request.Header.Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
		response := httptest.NewRecorder()
		server.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("got %d", response.Code)
		}
	})

	t.Run("invalid DOCX", func(t *testing.T) {
		cfg := workerConfigForTest(t)
		server, err := NewServer(cfg, successfulWorkerFake())
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(http.MethodPost, "/convert", strings.NewReader("not a docx"))
		request.Header.Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
		response := httptest.NewRecorder()
		server.ServeHTTP(response, request)
		if response.Code != http.StatusUnprocessableEntity {
			t.Fatalf("got %d: %s", response.Code, response.Body.String())
		}
		assertWorkerRootEmpty(t, cfg.JobRoot)
	})

	t.Run("output path escape", func(t *testing.T) {
		cfg := workerConfigForTest(t)
		outside := filepath.Join(filepath.Dir(cfg.JobRoot), "outside.pdf")
		converter := fakeConverter(func(_ context.Context, _, _ string) (string, error) {
			return outside, os.WriteFile(outside, workerTestPDF, 0o600)
		})
		server, err := NewServer(cfg, converter)
		if err != nil {
			t.Fatal(err)
		}
		response := callWorker(t, server, workerDOCX(t))
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("got %d", response.Code)
		}
		assertWorkerRootEmpty(t, cfg.JobRoot)
	})
}

func TestWorkerTimeoutCancelsConverterAndCleans(t *testing.T) {
	cfg := workerConfigForTest(t)
	cfg.ProcessTimeout = 15 * time.Millisecond
	converter := fakeConverter(func(ctx context.Context, _, _ string) (string, error) {
		<-ctx.Done()
		return "", ctx.Err()
	})
	server, err := NewServer(cfg, converter)
	if err != nil {
		t.Fatal(err)
	}
	response := callWorker(t, server, workerDOCX(t))
	if response.Code != http.StatusGatewayTimeout {
		t.Fatalf("got %d: %s", response.Code, response.Body.String())
	}
	assertWorkerRootEmpty(t, cfg.JobRoot)
}

func TestWorkerStartupScavengerPreservesUnexpectedChildren(t *testing.T) {
	cfg := workerConfigForTest(t)
	if err := os.MkdirAll(filepath.Join(cfg.JobRoot, "BBBBBBBBBBBBBBBBBBBBBBBB"), 0o700); err != nil {
		t.Fatal(err)
	}
	operatorFile := filepath.Join(cfg.JobRoot, "keep-me")
	if err := os.WriteFile(operatorFile, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewServer(cfg, successfulWorkerFake()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(cfg.JobRoot, "BBBBBBBBBBBBBBBBBBBBBBBB")); !os.IsNotExist(err) {
		t.Fatalf("orphan was not removed: %v", err)
	}
	if _, err := os.Stat(operatorFile); err != nil {
		t.Fatalf("unexpected file was removed: %v", err)
	}
}

func TestMinimalEnvironmentDoesNotPassArbitrarySecrets(t *testing.T) {
	t.Setenv("TOP_SECRET_VALUE", "must-not-reach-libreoffice")
	environment := strings.Join(minimalEnvironment("/job/home", "/job/tmp"), "\n")
	if strings.Contains(environment, "TOP_SECRET") || strings.Contains(environment, "must-not-reach") {
		t.Fatal("arbitrary parent environment leaked to LibreOffice")
	}
}

func callWorker(t *testing.T, server http.Handler, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/convert", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	return response
}

func workerDOCX(t *testing.T) []byte {
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

func assertWorkerRootEmpty(t *testing.T, root string) {
	t.Helper()
	entries, err := os.ReadDir(root)
	if err != nil || len(entries) != 0 {
		t.Fatalf("worker artifacts remain: %v %v", entries, err)
	}
}
