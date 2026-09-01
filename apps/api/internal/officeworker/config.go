package officeworker

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Transport      string
	Addr           string
	SocketPath     string
	JobRoot        string
	LibreOfficeBin string
	Token          string
	MaxInputBytes  int64
	MaxOutputBytes int64
	ProcessTimeout time.Duration
	MaxConcurrent  int
	ShutdownWait   time.Duration
}

func LoadConfig() (Config, error) {
	cfg := Config{
		Transport:      officeEnv("OFFICE_TRANSPORT", "unix"),
		Addr:           officeEnv("OFFICE_ADDR", ":8081"),
		SocketPath:     officeEnv("OFFICE_SOCKET_PATH", "/run/aio-office/office.sock"),
		JobRoot:        officeEnv("OFFICE_JOB_ROOT", "/work/office-jobs"),
		LibreOfficeBin: officeEnv("LIBREOFFICE_BIN", "soffice"),
		Token:          os.Getenv("OFFICE_PROCESSOR_TOKEN"),
		MaxInputBytes:  officeInt64Env("OFFICE_MAX_INPUT_BYTES", 50*1024*1024),
		MaxOutputBytes: officeInt64Env("OFFICE_MAX_OUTPUT_BYTES", 256*1024*1024),
		ProcessTimeout: officeDurationEnv("OFFICE_PROCESS_TIMEOUT", 10*time.Minute),
		MaxConcurrent:  officeIntEnv("OFFICE_MAX_CONCURRENT_JOBS", 1),
		ShutdownWait:   officeDurationEnv("OFFICE_SHUTDOWN_TIMEOUT", 15*time.Second),
	}
	return cfg, cfg.Validate()
}

func (c Config) Validate() error {
	transport := c.Transport
	if transport == "" {
		transport = "unix"
	}
	switch transport {
	case "unix":
		if !filepath.IsAbs(c.SocketPath) || filepath.Ext(c.SocketPath) != ".sock" {
			return fmt.Errorf("OFFICE_SOCKET_PATH must be an absolute .sock path")
		}
	case "tcp":
		if strings.TrimSpace(c.Addr) == "" {
			return fmt.Errorf("OFFICE_ADDR must not be empty")
		}
		if strings.TrimSpace(c.Token) == "" {
			return fmt.Errorf("OFFICE_PROCESSOR_TOKEN is required for tcp transport")
		}
	default:
		return fmt.Errorf("OFFICE_TRANSPORT must be unix or tcp")
	}
	if !filepath.IsAbs(c.JobRoot) || filepath.Dir(filepath.Clean(c.JobRoot)) == filepath.Clean(c.JobRoot) {
		return fmt.Errorf("OFFICE_JOB_ROOT must be an absolute non-root path")
	}
	if strings.TrimSpace(c.LibreOfficeBin) == "" {
		return fmt.Errorf("LIBREOFFICE_BIN must not be empty")
	}
	if c.MaxInputBytes <= 0 || c.MaxOutputBytes <= 0 {
		return fmt.Errorf("office input and output limits must be positive")
	}
	if c.ProcessTimeout <= 0 || c.ProcessTimeout > 15*time.Minute {
		return fmt.Errorf("OFFICE_PROCESS_TIMEOUT must be greater than zero and at most 15m")
	}
	if c.MaxConcurrent < 1 || c.MaxConcurrent > 32 {
		return fmt.Errorf("OFFICE_MAX_CONCURRENT_JOBS must be between 1 and 32")
	}
	if c.ShutdownWait <= 0 || c.ShutdownWait > time.Minute {
		return fmt.Errorf("OFFICE_SHUTDOWN_TIMEOUT must be greater than zero and at most 1m")
	}
	return nil
}

func officeEnv(name, fallback string) string {
	if value, ok := os.LookupEnv(name); ok {
		return value
	}
	return fallback
}

func officeIntEnv(name string, fallback int) int {
	value, ok := os.LookupEnv(name)
	if !ok {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0
	}
	return parsed
}

func officeInt64Env(name string, fallback int64) int64 {
	value, ok := os.LookupEnv(name)
	if !ok {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}

func officeDurationEnv(name string, fallback time.Duration) time.Duration {
	value, ok := os.LookupEnv(name)
	if !ok {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return 0
	}
	return parsed
}
