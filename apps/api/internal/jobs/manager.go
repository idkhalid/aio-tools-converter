package jobs

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"sync/atomic"
	"time"

	"github.com/aio-converter/api/internal/processing"
	"github.com/aio-converter/api/internal/tools"
)

var (
	ErrNotFound           = errors.New("job not found")
	ErrQueueFull          = errors.New("job queue is full")
	ErrNotReady           = errors.New("job output is not ready")
	ErrOutputUnavailable  = errors.New("job output is no longer available")
	ErrTooManySubscribers = errors.New("too many job progress subscribers")
)

var jobIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{24}$`)

const maxSubscribersPerJob = 8

type Config struct {
	Root           string
	TTL            time.Duration
	ProcessTimeout time.Duration
	Concurrency    int
	QueueSize      int
}

type Manager struct {
	cfg Config

	mu         sync.RWMutex
	jobs       map[string]*job
	processors map[string]processing.Processor

	queue      chan *job
	admissions chan struct{}
	rootCtx    context.Context
	rootCancel context.CancelFunc
	wg         sync.WaitGroup
	closeOnce  sync.Once

	processorRuns  atomic.Uint64
	processorNanos atomic.Uint64
	succeededJobs  atomic.Uint64
	failedJobs     atomic.Uint64
	timedOutJobs   atomic.Uint64
	canceledJobs   atomic.Uint64
}

type Metrics struct {
	TrackedJobs      int
	QueueDepth       int
	AdmittedJobs     int
	ProcessorRuns    uint64
	ProcessorSeconds float64
	SucceededJobs    uint64
	FailedJobs       uint64
	TimedOutJobs     uint64
	CanceledJobs     uint64
}

func NewManager(cfg Config, processors ...processing.Processor) (*Manager, error) {
	if cfg.Root == "" || !filepath.IsAbs(cfg.Root) {
		return nil, fmt.Errorf("job root must be an absolute path")
	}
	if cfg.TTL <= 0 || cfg.ProcessTimeout <= 0 || cfg.Concurrency < 1 || cfg.QueueSize < 0 {
		return nil, fmt.Errorf("invalid job manager configuration")
	}
	if err := prepareRoot(cfg.Root); err != nil {
		return nil, err
	}

	processorMap := make(map[string]processing.Processor, len(processors))
	for _, processor := range processors {
		if processor == nil || processor.ID() == "" {
			return nil, fmt.Errorf("processor ID must not be empty")
		}
		if _, duplicate := processorMap[processor.ID()]; duplicate {
			return nil, fmt.Errorf("duplicate processor ID %q", processor.ID())
		}
		processorMap[processor.ID()] = processor
	}

	rootCtx, rootCancel := context.WithCancel(context.Background())
	capacity := cfg.Concurrency + cfg.QueueSize
	m := &Manager{
		cfg:        cfg,
		jobs:       make(map[string]*job),
		processors: processorMap,
		queue:      make(chan *job, capacity),
		admissions: make(chan struct{}, capacity),
		rootCtx:    rootCtx,
		rootCancel: rootCancel,
	}
	for range cfg.Concurrency {
		m.wg.Add(1)
		go m.worker()
	}
	m.wg.Add(1)
	go m.sweeper()
	return m, nil
}

func prepareRoot(root string) error {
	if err := os.MkdirAll(root, 0o700); err != nil {
		return fmt.Errorf("create job root: %w", err)
	}
	info, err := os.Lstat(root)
	if err != nil {
		return fmt.Errorf("inspect job root: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("job root must be a real directory")
	}
	if err := os.Chmod(root, 0o700); err != nil {
		return fmt.Errorf("secure job root: %w", err)
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return fmt.Errorf("scan job root: %w", err)
	}
	for _, entry := range entries {
		// The root may be a mounted directory. Never remove an unexpected
		// operator-owned file just because it shares that mount.
		if !jobIDPattern.MatchString(entry.Name()) {
			continue
		}
		if err := os.RemoveAll(filepath.Join(root, entry.Name())); err != nil {
			return fmt.Errorf("remove orphaned job: %w", err)
		}
	}
	return nil
}

func (m *Manager) Create(tool tools.Definition) (string, string, error) {
	processor, ok := m.processors[tool.ProcessorID]
	if !ok {
		return "", "", fmt.Errorf("processor %q is not configured", tool.ProcessorID)
	}
	select {
	case m.admissions <- struct{}{}:
	default:
		return "", "", ErrQueueFull
	}

	for range 8 {
		id, err := randomID()
		if err != nil {
			m.releaseAdmission(nil)
			return "", "", fmt.Errorf("create job ID: %w", err)
		}
		dir := filepath.Join(m.cfg.Root, id)
		if err := os.Mkdir(dir, 0o700); err != nil {
			if os.IsExist(err) {
				continue
			}
			m.releaseAdmission(nil)
			return "", "", fmt.Errorf("create job directory: %w", err)
		}
		now := time.Now().UTC()
		ctx, cancel := context.WithCancel(m.rootCtx)
		j := &job{
			id:          id,
			tool:        tool,
			processor:   processor,
			dir:         dir,
			inputPath:   filepath.Join(dir, "input.docx"),
			outputPath:  filepath.Join(dir, "output.pdf"),
			status:      statusAccepting,
			progress:    processing.Progress{Stage: "receiving", Progress: nil},
			createdAt:   now,
			updatedAt:   now,
			deadlineAt:  now.Add(m.cfg.ProcessTimeout),
			ctx:         ctx,
			cancel:      cancel,
			done:        make(chan struct{}),
			subscribers: make(map[uint64]chan Snapshot),
		}
		m.mu.Lock()
		m.jobs[id] = j
		m.mu.Unlock()
		return id, j.inputPath, nil
	}
	m.releaseAdmission(nil)
	return "", "", fmt.Errorf("could not allocate a unique job ID")
}

func (m *Manager) Enqueue(id string) error {
	j, ok := m.lookup(id)
	if !ok {
		return ErrNotFound
	}
	j.mu.Lock()
	if j.status != statusAccepting || j.deleted {
		j.mu.Unlock()
		return ErrNotFound
	}
	j.status = StatusQueued
	j.progress = processing.Progress{Stage: "queued", Progress: nil}
	j.publishLocked()
	j.mu.Unlock()

	select {
	case m.queue <- j:
		return nil
	case <-m.rootCtx.Done():
		m.Discard(id)
		return context.Canceled
	}
}

func (m *Manager) Discard(id string) {
	j, ok := m.lookup(id)
	if !ok {
		return
	}
	j.cancel()
	j.mu.Lock()
	j.deleted = true
	recordCanceled := false
	if j.status == statusAccepting || j.status == StatusQueued {
		j.status = StatusCanceled
		j.progress = processing.Progress{Stage: "canceled", Progress: nil}
		j.publishLocked()
		j.finishOnce.Do(func() { close(j.done) })
		recordCanceled = true
	}
	j.mu.Unlock()
	if recordCanceled {
		m.recordTerminal(j, StatusCanceled, 0)
	}
	_ = m.purge(j)
}

func (m *Manager) Get(id string) (Snapshot, error) {
	j, ok := m.lookup(id)
	if !ok {
		return Snapshot{}, ErrNotFound
	}
	j.mu.Lock()
	if j.deleted {
		j.mu.Unlock()
		return Snapshot{}, ErrNotFound
	}
	defer j.mu.Unlock()
	return j.snapshotLocked(), nil
}

func (m *Manager) Subscribe(id string) (<-chan Snapshot, func(), error) {
	j, ok := m.lookup(id)
	if !ok {
		return nil, nil, ErrNotFound
	}
	j.mu.Lock()
	if j.deleted {
		j.mu.Unlock()
		return nil, nil, ErrNotFound
	}
	if len(j.subscribers) >= maxSubscribersPerJob {
		j.mu.Unlock()
		return nil, nil, ErrTooManySubscribers
	}
	token := j.nextSubscriber
	j.nextSubscriber++
	updates := make(chan Snapshot, 1)
	j.subscribers[token] = updates
	updates <- j.snapshotLocked()
	j.mu.Unlock()

	unsubscribe := func() {
		j.mu.Lock()
		delete(j.subscribers, token)
		j.mu.Unlock()
	}
	return updates, unsubscribe, nil
}

func (m *Manager) Delete(ctx context.Context, id string) (bool, error) {
	j, ok := m.lookup(id)
	if !ok {
		return false, ErrNotFound
	}

	j.cancel()
	j.mu.Lock()
	j.deleted = true
	status := j.status
	recordCanceled := false
	if status == statusAccepting || status == StatusQueued {
		j.status = StatusCanceled
		j.progress = processing.Progress{Stage: "canceled", Progress: nil}
		j.publishLocked()
		j.finishOnce.Do(func() { close(j.done) })
		recordCanceled = true
	} else if status == StatusRunning {
		j.status = StatusCanceling
		j.progress = processing.Progress{Stage: "canceling", Progress: nil}
		j.publishLocked()
	}
	claimed := j.outputClaimed
	j.mu.Unlock()
	if recordCanceled {
		m.recordTerminal(j, StatusCanceled, 0)
	}

	if status == StatusRunning || status == StatusCanceling {
		select {
		case <-j.done:
		case <-ctx.Done():
			return true, nil
		case <-time.After(5 * time.Second):
			return true, nil
		}
	}
	if claimed {
		return true, nil
	}
	return false, m.purge(j)
}

func (m *Manager) OpenOutput(id string) (*OutputLease, error) {
	j, ok := m.lookup(id)
	if !ok {
		return nil, ErrNotFound
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.status != StatusSucceeded {
		return nil, ErrNotReady
	}
	if j.outputClaimed || j.deleted {
		return nil, ErrOutputUnavailable
	}
	f, err := os.Open(j.outputPath)
	if err != nil {
		return nil, ErrOutputUnavailable
	}
	j.outputClaimed = true
	j.publishLocked()
	lease := &OutputLease{
		File:     f,
		Name:     "converted.pdf",
		MIMEType: "application/pdf",
		Size:     j.outputSize,
		Context:  j.ctx,
	}
	lease.finish = func() error {
		closeErr := f.Close()
		j.cancel()
		j.mu.Lock()
		j.deleted = true
		j.mu.Unlock()
		return errors.Join(closeErr, m.purge(j))
	}
	return lease, nil
}

func (m *Manager) SweepExpired(now time.Time) {
	m.mu.RLock()
	all := make([]*job, 0, len(m.jobs))
	for _, j := range m.jobs {
		all = append(all, j)
	}
	m.mu.RUnlock()
	for _, j := range all {
		j.mu.Lock()
		recordQueueTimeout := false
		if !j.status.Terminal() && !now.Before(j.deadlineAt) &&
			(j.status == statusAccepting || j.status == StatusQueued) {
			j.status = StatusTimedOut
			j.progress = processing.Progress{Stage: "timed_out", Progress: nil}
			j.publicErr = &PublicError{
				Code:    "queue_timeout",
				Message: "The conversion waited too long in the queue. Try again.",
			}
			expires := now.Add(m.cfg.TTL)
			j.expiresAt = &expires
			j.cancel()
			j.publishLocked()
			j.finishOnce.Do(func() { close(j.done) })
			recordQueueTimeout = true
		}
		expired := j.expiresAt != nil && !now.Before(*j.expiresAt) && !j.outputClaimed
		purge := (j.deleted && !j.outputClaimed) || expired
		removeArtifacts := j.status.Terminal() && j.status != StatusSucceeded
		if purge {
			j.deleted = true
			j.cancel()
		}
		j.mu.Unlock()
		if recordQueueTimeout {
			m.recordTerminal(j, StatusTimedOut, 0)
		}
		if removeArtifacts {
			if err := os.RemoveAll(j.dir); err == nil {
				m.releaseAdmission(j)
			}
		}
		if purge {
			_ = m.purge(j)
		}
	}
}

func (m *Manager) purge(j *job) error {
	if err := os.RemoveAll(j.dir); err != nil {
		return err
	}
	m.remove(j)
	m.releaseAdmission(j)
	return nil
}

func (m *Manager) Close() error {
	var cleanupErr error
	m.closeOnce.Do(func() {
		m.rootCancel()
		m.mu.RLock()
		all := make([]*job, 0, len(m.jobs))
		for _, j := range m.jobs {
			all = append(all, j)
		}
		m.mu.RUnlock()
		for _, j := range all {
			j.cancel()
			j.mu.Lock()
			if j.status == statusAccepting || j.status == StatusQueued {
				j.status = StatusCanceled
				j.finishOnce.Do(func() { close(j.done) })
			}
			j.mu.Unlock()
		}
		m.wg.Wait()
		for _, j := range all {
			if err := m.purge(j); err != nil && cleanupErr == nil {
				cleanupErr = err
			}
		}
	})
	return cleanupErr
}

func (m *Manager) worker() {
	defer m.wg.Done()
	for {
		select {
		case <-m.rootCtx.Done():
			return
		case j := <-m.queue:
			m.run(j)
		}
	}
}

func (m *Manager) run(j *job) {
	startedAt := time.Now()
	j.mu.Lock()
	if j.status != StatusQueued || j.deleted {
		j.mu.Unlock()
		return
	}
	j.status = StatusRunning
	j.progress = processing.Progress{Stage: "converting", Progress: nil}
	j.publishLocked()
	j.mu.Unlock()

	ctx, cancel := context.WithDeadline(j.ctx, j.deadlineAt)
	err := j.processor.Process(ctx, j.inputPath, j.outputPath, func(progress processing.Progress) {
		if progress.Progress != nil && (math.IsNaN(*progress.Progress) || *progress.Progress < 0 || *progress.Progress > 1) {
			progress.Progress = nil
		}
		if len(progress.Stage) > 64 {
			progress.Stage = progress.Stage[:64]
		}
		if len(progress.Message) > 256 {
			progress.Message = progress.Message[:256]
		}
		j.mu.Lock()
		if j.status == StatusRunning {
			j.progress = progress
			j.publishLocked()
		}
		j.mu.Unlock()
	})
	cause := context.Cause(ctx)
	cancel()

	var outputSize int64
	if err == nil {
		var validationErr error
		outputSize, validationErr = validatePDF(j.outputPath)
		if validationErr != nil {
			err = processing.NewFailure("invalid_output", "The converter produced an invalid PDF.", validationErr)
		}
	}
	_ = os.Remove(j.inputPath)

	j.mu.Lock()
	deleted := j.deleted
	switch {
	case deleted || errors.Is(cause, context.Canceled) || errors.Is(err, context.Canceled):
		j.status = StatusCanceled
		j.progress = processing.Progress{Stage: "canceled", Progress: nil}
	case errors.Is(cause, context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded):
		j.status = StatusTimedOut
		j.progress = processing.Progress{Stage: "timed_out", Progress: nil}
		j.publicErr = &PublicError{Code: "process_timeout", Message: "The conversion took too long. Try a smaller document."}
	case err != nil:
		j.status = StatusFailed
		j.progress = processing.Progress{Stage: "failed", Progress: nil}
		code, message := processing.PublicError(err)
		j.publicErr = &PublicError{Code: code, Message: message}
	default:
		j.status = StatusSucceeded
		one := 1.0
		j.progress = processing.Progress{Stage: "complete", Progress: &one}
		j.outputSize = outputSize
	}
	now := time.Now().UTC()
	expires := now.Add(m.cfg.TTL)
	j.expiresAt = &expires
	j.publishLocked()
	j.finishOnce.Do(func() { close(j.done) })
	status := j.status
	j.mu.Unlock()
	m.recordTerminal(j, status, time.Since(startedAt))
	m.releaseAdmission(j)

	if status != StatusSucceeded || deleted {
		j.cancel()
		_ = os.RemoveAll(j.dir)
	}
	if deleted {
		_ = m.purge(j)
	}
}

func (m *Manager) sweeper() {
	defer m.wg.Done()
	interval := m.cfg.TTL / 4
	if interval < 10*time.Millisecond {
		interval = 10 * time.Millisecond
	}
	if interval > time.Minute {
		interval = time.Minute
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-m.rootCtx.Done():
			return
		case now := <-ticker.C:
			m.SweepExpired(now)
		}
	}
}

func (m *Manager) lookup(id string) (*job, bool) {
	m.mu.RLock()
	j, ok := m.jobs[id]
	m.mu.RUnlock()
	return j, ok
}

func (m *Manager) remove(j *job) {
	m.mu.Lock()
	if current, ok := m.jobs[j.id]; ok && current == j {
		delete(m.jobs, j.id)
	}
	m.mu.Unlock()
}

func (m *Manager) recordTerminal(j *job, status Status, duration time.Duration) {
	j.metricsOnce.Do(func() {
		if duration > 0 {
			m.processorRuns.Add(1)
			m.processorNanos.Add(uint64(duration))
		}
		switch status {
		case StatusSucceeded:
			m.succeededJobs.Add(1)
		case StatusFailed:
			m.failedJobs.Add(1)
		case StatusTimedOut:
			m.timedOutJobs.Add(1)
		case StatusCanceled:
			m.canceledJobs.Add(1)
		}
	})
}

func (m *Manager) Metrics() Metrics {
	m.mu.RLock()
	trackedJobs := len(m.jobs)
	m.mu.RUnlock()
	return Metrics{
		TrackedJobs:      trackedJobs,
		QueueDepth:       len(m.queue),
		AdmittedJobs:     len(m.admissions),
		ProcessorRuns:    m.processorRuns.Load(),
		ProcessorSeconds: float64(m.processorNanos.Load()) / float64(time.Second),
		SucceededJobs:    m.succeededJobs.Load(),
		FailedJobs:       m.failedJobs.Load(),
		TimedOutJobs:     m.timedOutJobs.Load(),
		CanceledJobs:     m.canceledJobs.Load(),
	}
}

func (m *Manager) releaseAdmission(j *job) {
	if j == nil {
		select {
		case <-m.admissions:
		default:
		}
		return
	}
	j.releaseOnce.Do(func() {
		select {
		case <-m.admissions:
		default:
		}
	})
}

func randomID() (string, error) {
	var raw [18]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw[:]), nil
}

func validatePDF(filePath string) (int64, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() < 16 {
		return 0, errors.New("PDF output is missing or too small")
	}
	var header [5]byte
	if _, err := f.ReadAt(header[:], 0); err != nil || string(header[:]) != "%PDF-" {
		return 0, errors.New("PDF output has an invalid signature")
	}
	tailSize := int64(2048)
	if info.Size() < tailSize {
		tailSize = info.Size()
	}
	tail := make([]byte, tailSize)
	if _, err := f.ReadAt(tail, info.Size()-tailSize); err != nil {
		return 0, errors.New("PDF output trailer cannot be read")
	}
	foundEOF := false
	for i := 0; i+5 <= len(tail); i++ {
		if string(tail[i:i+5]) == "%%EOF" {
			foundEOF = true
			break
		}
	}
	if !foundEOF {
		return 0, errors.New("PDF output has no EOF marker")
	}
	return info.Size(), nil
}
