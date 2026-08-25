package processing

import (
	"context"
	"errors"
)

type Progress struct {
	Stage    string   `json:"stage"`
	Progress *float64 `json:"progress"`
	Message  string   `json:"message,omitempty"`
}

type ReportFunc func(Progress)

type Processor interface {
	ID() string
	Process(ctx context.Context, inputPath, outputPath string, report ReportFunc) error
}

type Failure struct {
	Code    string
	Message string
	Err     error
}

func (e *Failure) Error() string {
	if e.Err != nil {
		return e.Code + ": " + e.Err.Error()
	}
	return e.Code
}

func (e *Failure) Unwrap() error { return e.Err }

func NewFailure(code, message string, err error) error {
	return &Failure{Code: code, Message: message, Err: err}
}

func PublicError(err error) (code, message string) {
	var failure *Failure
	if errors.As(err, &failure) {
		return failure.Code, failure.Message
	}
	return "processing_failed", "The document could not be converted. Try another file."
}
