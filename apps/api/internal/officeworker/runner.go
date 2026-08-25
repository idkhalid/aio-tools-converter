package officeworker

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type Converter interface {
	Convert(ctx context.Context, jobDir, inputPath string) (string, error)
}

type LibreOfficeRunner struct {
	Binary         string
	MaxOutputBytes int64
}

func (r LibreOfficeRunner) Convert(ctx context.Context, jobDir, inputPath string) (string, error) {
	outputDir := filepath.Join(jobDir, "out")
	profileDir := filepath.Join(jobDir, "profile")
	homeDir := filepath.Join(jobDir, "home")
	tmpDir := filepath.Join(jobDir, "tmp")
	for _, dir := range []string{outputDir, profileDir, homeDir, tmpDir} {
		if err := os.Mkdir(dir, 0o700); err != nil {
			return "", fmt.Errorf("prepare conversion directory: %w", err)
		}
	}
	profileURL := (&url.URL{Scheme: "file", Path: filepath.ToSlash(profileDir)}).String()
	args := []string{
		"--headless",
		"--nologo",
		"--nodefault",
		"--nofirststartwizard",
		"--nolockcheck",
		"--norestore",
		"--invisible",
		"-env:UserInstallation=" + profileURL,
		"--convert-to", "pdf:writer_pdf_Export",
		"--outdir", outputDir,
		inputPath,
	}
	cmd := exec.Command(r.Binary, args...)
	configureProcess(cmd)
	cmd.Dir = jobDir
	cmd.Env = minimalEnvironment(homeDir, tmpDir)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("start LibreOffice: %w", err)
	}
	waitResult := make(chan error, 1)
	go func() { waitResult <- cmd.Wait() }()
	select {
	case err := <-waitResult:
		if err != nil {
			return "", fmt.Errorf("LibreOffice exited unsuccessfully: %w", err)
		}
	case <-ctx.Done():
		_ = killProcessGroup(cmd)
		<-waitResult
		return "", ctx.Err()
	}

	outputPath := filepath.Join(outputDir, "input.pdf")
	info, err := os.Lstat(outputPath)
	if err != nil || !info.Mode().IsRegular() || info.Size() < 16 {
		return "", errors.New("LibreOffice did not produce a regular PDF")
	}
	if info.Size() > r.MaxOutputBytes {
		return "", errors.New("LibreOffice output exceeds the configured limit")
	}
	if err := validateWorkerPDF(outputPath); err != nil {
		return "", err
	}
	return outputPath, nil
}

func minimalEnvironment(homeDir, tmpDir string) []string {
	pathValue := os.Getenv("PATH")
	if pathValue == "" {
		pathValue = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
	}
	return []string{
		"PATH=" + pathValue,
		"HOME=" + homeDir,
		"TMPDIR=" + tmpDir,
		"LANG=C.UTF-8",
		"LC_ALL=C.UTF-8",
		"SAL_USE_VCLPLUGIN=svp",
	}
}

func validateWorkerPDF(filePath string) error {
	f, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.Size() < 16 {
		return errors.New("PDF output is too small")
	}
	var header [5]byte
	if _, err := io.ReadFull(f, header[:]); err != nil || string(header[:]) != "%PDF-" {
		return errors.New("PDF output signature is invalid")
	}
	tailSize := int64(2048)
	if info.Size() < tailSize {
		tailSize = info.Size()
	}
	tail := make([]byte, tailSize)
	if _, err := f.ReadAt(tail, info.Size()-tailSize); err != nil || !strings.Contains(string(tail), "%%EOF") {
		return errors.New("PDF output trailer is invalid")
	}
	return nil
}
