package jobs

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/aio-converter/api/internal/processing"
	"github.com/aio-converter/api/internal/tools"
)

var testPDF = []byte("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n")

type fakeProcessor struct {
	process func(context.Context, string, string, processing.ReportFunc) error
}

func (f fakeProcessor) ID() string { return tools.OfficeToPDFProcessor }

func (f fakeProcessor) Process(ctx context.Context, input, output string, report processing.ReportFunc) error {
	return f.process(ctx, input, output, report)
}

func successProcessor() fakeProcessor {
	return fakeProcessor{process: func(_ context.Context, _, output string, report processing.ReportFunc) error {
		report(processing.Progress{Stage: "finalizing", Progress: nil})
		return os.WriteFile(output, testPDF, 0o600)
	}}
}

func managerForTest(t *testing.T, cfg Config, processor processing.Processor) *Manager {
	t.Helper()
	m, err := NewManager(cfg, processor)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := m.Close(); err != nil {
			t.Errorf("manager cleanup: %v", err)
		}
	})
	return m
}

func defaultManagerConfig(t *testing.T) Config {
	t.Helper()
	return Config{
		Root:           filepath.Join(t.TempDir(), "jobs"),
		TTL:            time.Minute,
		ProcessTimeout: time.Second,
		Concurrency:    1,
		QueueSize:      1,
	}
}

func submitTestJob(t *testing.T, m *Manager) (string, string) {
	t.Helper()
	tool, _ := tools.Lookup(tools.DocxToPDFToolID)
	id, inputPath, err := m.Create(tool)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(inputPath, []byte("input"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := m.Enqueue(id); err != nil {
		t.Fatal(err)
	}
	return id, inputPath
}

func waitForStatus(t *testing.T, m *Manager, id string, wanted ...Status) Snapshot {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		snapshot, err := m.Get(id)
		if err == nil {
			for _, status := range wanted {
				if snapshot.Status == status {
					return snapshot
				}
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("job %s did not reach status %v", id, wanted)
	return Snapshot{}
}

func TestManagerSuccessDownloadPurgesArtifacts(t *testing.T) {
	cfg := defaultManagerConfig(t)
	m := managerForTest(t, cfg, successProcessor())
	id, inputPath := submitTestJob(t, m)
	snapshot := waitForStatus(t, m, id, StatusSucceeded)
	if snapshot.Output == nil || !snapshot.Output.Available || snapshot.Output.Size != int64(len(testPDF)) {
		t.Fatalf("unexpected output snapshot: %+v", snapshot.Output)
	}
	if _, err := os.Stat(inputPath); !os.IsNotExist(err) {
		t.Fatalf("input remains after processing: %v", err)
	}
	lease, err := m.OpenOutput(id)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-lease.Context.Done():
		t.Fatal("successful job context was canceled before download")
	default:
	}
	got, err := io.ReadAll(lease.File)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(testPDF) {
		t.Fatal("downloaded PDF differs")
	}
	if err := lease.Finish(); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Get(id); !errors.Is(err, ErrNotFound) {
		t.Fatalf("downloaded one-time job remains: %v", err)
	}
	assertEmptyDir(t, cfg.Root)
}

func TestManagerCancelKillsProcessingAndPurges(t *testing.T) {
	started := make(chan struct{})
	var once sync.Once
	processor := fakeProcessor{process: func(ctx context.Context, _, _ string, _ processing.ReportFunc) error {
		once.Do(func() { close(started) })
		<-ctx.Done()
		return ctx.Err()
	}}
	cfg := defaultManagerConfig(t)
	m := managerForTest(t, cfg, processor)
	id, _ := submitTestJob(t, m)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("processor did not start")
	}
	pending, err := m.Delete(context.Background(), id)
	if err != nil || pending {
		t.Fatalf("delete result pending=%v err=%v", pending, err)
	}
	if _, err := m.Get(id); !errors.Is(err, ErrNotFound) {
		t.Fatalf("canceled job remains: %v", err)
	}
	assertEmptyDir(t, cfg.Root)
}

func TestManagerTimeoutAndInvalidOutputAreSafeFailures(t *testing.T) {
	t.Run("timeout", func(t *testing.T) {
		processor := fakeProcessor{process: func(ctx context.Context, _, _ string, _ processing.ReportFunc) error {
			<-ctx.Done()
			return ctx.Err()
		}}
		cfg := defaultManagerConfig(t)
		cfg.ProcessTimeout = 20 * time.Millisecond
		m := managerForTest(t, cfg, processor)
		id, _ := submitTestJob(t, m)
		snapshot := waitForStatus(t, m, id, StatusTimedOut)
		if snapshot.Error == nil || snapshot.Error.Code != "process_timeout" {
			t.Fatalf("unexpected timeout error: %+v", snapshot.Error)
		}
		assertEmptyDir(t, cfg.Root)
	})

	t.Run("invalid PDF", func(t *testing.T) {
		processor := fakeProcessor{process: func(_ context.Context, _, output string, _ processing.ReportFunc) error {
			return os.WriteFile(output, []byte("not a PDF"), 0o600)
		}}
		cfg := defaultManagerConfig(t)
		m := managerForTest(t, cfg, processor)
		id, _ := submitTestJob(t, m)
		snapshot := waitForStatus(t, m, id, StatusFailed)
		if snapshot.Error == nil || snapshot.Error.Code != "invalid_output" {
			t.Fatalf("unexpected invalid-output error: %+v", snapshot.Error)
		}
		assertEmptyDir(t, cfg.Root)
	})
}

func TestManagerBoundsAdmissionAndExpiresOutput(t *testing.T) {
	t.Run("queue full", func(t *testing.T) {
		cfg := defaultManagerConfig(t)
		cfg.QueueSize = 0
		m := managerForTest(t, cfg, successProcessor())
		tool, _ := tools.Lookup(tools.DocxToPDFToolID)
		firstID, _, err := m.Create(tool)
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err := m.Create(tool); !errors.Is(err, ErrQueueFull) {
			t.Fatalf("expected queue full, got %v", err)
		}
		m.Discard(firstID)
	})

	t.Run("TTL", func(t *testing.T) {
		cfg := defaultManagerConfig(t)
		cfg.TTL = 25 * time.Millisecond
		m := managerForTest(t, cfg, successProcessor())
		id, _ := submitTestJob(t, m)
		waitForStatus(t, m, id, StatusSucceeded)
		deadline := time.Now().Add(time.Second)
		for time.Now().Before(deadline) {
			if _, err := m.Get(id); errors.Is(err, ErrNotFound) {
				assertEmptyDir(t, cfg.Root)
				return
			}
			time.Sleep(5 * time.Millisecond)
		}
		t.Fatal("job output did not expire")
	})

	t.Run("absolute queue deadline", func(t *testing.T) {
		cfg := defaultManagerConfig(t)
		cfg.ProcessTimeout = 20 * time.Millisecond
		cfg.QueueSize = 0
		m := managerForTest(t, cfg, successProcessor())
		tool, _ := tools.Lookup(tools.DocxToPDFToolID)
		id, _, err := m.Create(tool)
		if err != nil {
			t.Fatal(err)
		}

		m.SweepExpired(time.Now().Add(time.Second))
		snapshot, err := m.Get(id)
		if err != nil {
			t.Fatal(err)
		}
		if snapshot.Status != StatusTimedOut || snapshot.Error == nil || snapshot.Error.Code != "queue_timeout" {
			t.Fatalf("unexpected queue timeout snapshot: %+v", snapshot)
		}
		assertEmptyDir(t, cfg.Root)
		if nextID, _, err := m.Create(tool); err != nil {
			t.Fatalf("queue admission was not released: %v", err)
		} else {
			m.Discard(nextID)
		}
	})
}

func TestManagerStartupScavengerOnlyRemovesOpaqueJobDirectories(t *testing.T) {
	root := filepath.Join(t.TempDir(), "jobs")
	if err := os.MkdirAll(filepath.Join(root, "AAAAAAAAAAAAAAAAAAAAAAAA"), 0o700); err != nil {
		t.Fatal(err)
	}
	operatorFile := filepath.Join(root, "keep-me")
	if err := os.WriteFile(operatorFile, []byte("operator-owned"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := Config{Root: root, TTL: time.Minute, ProcessTimeout: time.Second, Concurrency: 1, QueueSize: 1}
	m := managerForTest(t, cfg, successProcessor())
	if _, err := os.Stat(filepath.Join(root, "AAAAAAAAAAAAAAAAAAAAAAAA")); !os.IsNotExist(err) {
		t.Fatalf("orphan job was not scavenged: %v", err)
	}
	if _, err := os.Stat(operatorFile); err != nil {
		t.Fatalf("unexpected child was touched: %v", err)
	}
	_ = m
}

func TestManagerSubscriptionReceivesTerminalSnapshot(t *testing.T) {
	m := managerForTest(t, defaultManagerConfig(t), successProcessor())
	id, _ := submitTestJob(t, m)
	updates, unsubscribe, err := m.Subscribe(id)
	if err != nil {
		t.Fatal(err)
	}
	defer unsubscribe()
	deadline := time.After(time.Second)
	for {
		select {
		case snapshot := <-updates:
			if snapshot.Status == StatusSucceeded {
				return
			}
		case <-deadline:
			t.Fatal("terminal snapshot was not published")
		}
	}
}

func TestManagerCapsProgressSubscribers(t *testing.T) {
	m := managerForTest(t, defaultManagerConfig(t), successProcessor())
	tool, _ := tools.Lookup(tools.DocxToPDFToolID)
	id, _, err := m.Create(tool)
	if err != nil {
		t.Fatal(err)
	}

	unsubscribes := make([]func(), 0, maxSubscribersPerJob)
	for range maxSubscribersPerJob {
		_, unsubscribe, err := m.Subscribe(id)
		if err != nil {
			t.Fatal(err)
		}
		unsubscribes = append(unsubscribes, unsubscribe)
	}
	if _, _, err := m.Subscribe(id); !errors.Is(err, ErrTooManySubscribers) {
		t.Fatalf("expected subscriber cap, got %v", err)
	}
	unsubscribes[0]()
	if _, unsubscribe, err := m.Subscribe(id); err != nil {
		t.Fatalf("subscriber slot was not released: %v", err)
	} else {
		unsubscribe()
	}
	for _, unsubscribe := range unsubscribes[1:] {
		unsubscribe()
	}
	m.Discard(id)
}

func assertEmptyDir(t *testing.T, root string) {
	t.Helper()
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("job artifacts remain: %v", entries)
	}
}
