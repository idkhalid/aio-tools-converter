package jobs

import (
	"context"
	"os"
	"sync"
	"time"

	"github.com/aio-converter/api/internal/processing"
	"github.com/aio-converter/api/internal/tools"
)

type Status string

const (
	statusAccepting Status = "accepting"
	StatusQueued    Status = "queued"
	StatusRunning   Status = "running"
	StatusCanceling Status = "canceling"
	StatusSucceeded Status = "succeeded"
	StatusFailed    Status = "failed"
	StatusCanceled  Status = "canceled"
	StatusTimedOut  Status = "timed_out"
)

func (s Status) Terminal() bool {
	switch s {
	case StatusSucceeded, StatusFailed, StatusCanceled, StatusTimedOut:
		return true
	default:
		return false
	}
}

type PublicError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type OutputInfo struct {
	Available bool   `json:"available"`
	Name      string `json:"name,omitempty"`
	MIMEType  string `json:"mimeType,omitempty"`
	Size      int64  `json:"size,omitempty"`
}

type Snapshot struct {
	JobID     string              `json:"jobId"`
	ToolID    string              `json:"toolId"`
	Status    Status              `json:"status"`
	Progress  processing.Progress `json:"progress"`
	Output    *OutputInfo         `json:"output,omitempty"`
	Error     *PublicError        `json:"error,omitempty"`
	CreatedAt time.Time           `json:"createdAt"`
	UpdatedAt time.Time           `json:"updatedAt"`
	ExpiresAt *time.Time          `json:"expiresAt,omitempty"`
	Version   uint64              `json:"version"`
}

type job struct {
	mu sync.Mutex

	id         string
	tool       tools.Definition
	processor  processing.Processor
	dir        string
	inputPath  string
	outputPath string

	status     Status
	progress   processing.Progress
	publicErr  *PublicError
	createdAt  time.Time
	updatedAt  time.Time
	deadlineAt time.Time
	expiresAt  *time.Time
	version    uint64

	outputSize    int64
	outputClaimed bool
	deleted       bool

	ctx    context.Context
	cancel context.CancelFunc
	done   chan struct{}

	finishOnce  sync.Once
	releaseOnce sync.Once
	metricsOnce sync.Once

	nextSubscriber uint64
	subscribers    map[uint64]chan Snapshot
}

func (j *job) snapshotLocked() Snapshot {
	snapshot := Snapshot{
		JobID:     j.id,
		ToolID:    j.tool.ID,
		Status:    j.status,
		Progress:  j.progress,
		Error:     j.publicErr,
		CreatedAt: j.createdAt,
		UpdatedAt: j.updatedAt,
		ExpiresAt: j.expiresAt,
		Version:   j.version,
	}
	if j.status == StatusSucceeded {
		snapshot.Output = &OutputInfo{
			Available: !j.outputClaimed,
			Name:      "converted.pdf",
			MIMEType:  "application/pdf",
			Size:      j.outputSize,
		}
	}
	return snapshot
}

func (j *job) publishLocked() {
	j.version++
	j.updatedAt = time.Now().UTC()
	snapshot := j.snapshotLocked()
	for _, subscriber := range j.subscribers {
		select {
		case subscriber <- snapshot:
		default:
			select {
			case <-subscriber:
			default:
			}
			select {
			case subscriber <- snapshot:
			default:
			}
		}
	}
}

type OutputLease struct {
	File     *os.File
	Name     string
	MIMEType string
	Size     int64
	Context  context.Context

	finishOnce sync.Once
	finish     func() error
}

func (l *OutputLease) Finish() error {
	var err error
	l.finishOnce.Do(func() { err = l.finish() })
	return err
}
