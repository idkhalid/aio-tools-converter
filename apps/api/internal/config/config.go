package config

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const maxJobTTL = 15 * time.Minute

// Config contains all runtime settings for the public API. Every value is
// validated before the server creates a listener or writes a job artifact.
type Config struct {
	Addr               string
	AllowedOrigins     []string
	MetricsToken       string
	JobRoot            string
	JobTTL             time.Duration
	MaxConcurrentJobs  int
	MaxQueuedJobs      int
	MaxUploadBytes     int64
	ProcessTimeout     time.Duration
	DownloadTimeout    time.Duration
	ShutdownTimeout    time.Duration
	ProcessorTransport string
	ProcessorSocket    string
	ProcessorURL       string
	ProcessorToken     string
}

func Load() (Config, error) {
	cfg := Config{
		Addr:               env("API_ADDR", ":8080"),
		AllowedOrigins:     splitCSV(env("API_ALLOWED_ORIGINS", "http://localhost:4321")),
		MetricsToken:       os.Getenv("API_METRICS_TOKEN"),
		JobRoot:            env("API_JOB_ROOT", "/work/jobs"),
		JobTTL:             durationEnv("API_JOB_TTL", 15*time.Minute),
		MaxConcurrentJobs:  intEnv("API_MAX_CONCURRENT_JOBS", 1),
		MaxQueuedJobs:      intEnv("API_MAX_QUEUED_JOBS", 8),
		MaxUploadBytes:     int64Env("API_MAX_UPLOAD_BYTES", 262_144_000),
		ProcessTimeout:     durationEnv("API_PROCESS_TIMEOUT", 10*time.Minute),
		DownloadTimeout:    durationEnv("API_DOWNLOAD_TIMEOUT", 10*time.Minute),
		ShutdownTimeout:    durationEnv("API_SHUTDOWN_TIMEOUT", 15*time.Second),
		ProcessorTransport: env("API_PROCESSOR_TRANSPORT", "unix"),
		ProcessorSocket:    env("API_PROCESSOR_SOCKET", "/run/aio-office/office.sock"),
		ProcessorURL:       env("API_PROCESSOR_URL", ""),
		ProcessorToken:     os.Getenv("API_PROCESSOR_TOKEN"),
	}
	return cfg, cfg.Validate()
}

func (c Config) Validate() error {
	if strings.TrimSpace(c.Addr) == "" {
		return fmt.Errorf("API_ADDR must not be empty")
	}
	if len(c.AllowedOrigins) == 0 {
		return fmt.Errorf("API_ALLOWED_ORIGINS must contain at least one origin")
	}
	seenOrigins := make(map[string]struct{}, len(c.AllowedOrigins))
	for _, origin := range c.AllowedOrigins {
		if err := validateOrigin(origin); err != nil {
			return fmt.Errorf("API_ALLOWED_ORIGINS: %w", err)
		}
		if _, exists := seenOrigins[origin]; exists {
			return fmt.Errorf("API_ALLOWED_ORIGINS contains duplicate origin %q", origin)
		}
		seenOrigins[origin] = struct{}{}
	}
	if err := validateSafeAbsolutePath("API_JOB_ROOT", c.JobRoot); err != nil {
		return err
	}
	if c.JobTTL <= 0 || c.JobTTL > maxJobTTL {
		return fmt.Errorf("API_JOB_TTL must be greater than zero and at most %s", maxJobTTL)
	}
	if c.MaxConcurrentJobs < 1 || c.MaxConcurrentJobs > 128 {
		return fmt.Errorf("API_MAX_CONCURRENT_JOBS must be between 1 and 128")
	}
	if c.MaxQueuedJobs < 0 || c.MaxQueuedJobs > 10_000 {
		return fmt.Errorf("API_MAX_QUEUED_JOBS must be between 0 and 10000")
	}
	if c.MaxUploadBytes < 1 {
		return fmt.Errorf("API_MAX_UPLOAD_BYTES must be greater than zero")
	}
	if c.ProcessTimeout <= 0 || c.ProcessTimeout > maxJobTTL {
		return fmt.Errorf("API_PROCESS_TIMEOUT must be greater than zero and at most %s", maxJobTTL)
	}
	if c.DownloadTimeout <= 0 || c.DownloadTimeout > maxJobTTL {
		return fmt.Errorf("API_DOWNLOAD_TIMEOUT must be greater than zero and at most %s", maxJobTTL)
	}
	if c.ShutdownTimeout <= 0 || c.ShutdownTimeout > time.Minute {
		return fmt.Errorf("API_SHUTDOWN_TIMEOUT must be greater than zero and at most 1m")
	}
	transport := c.ProcessorTransport
	if transport == "" {
		transport = "unix"
	}
	switch transport {
	case "unix":
		if err := validateSafeAbsolutePath("API_PROCESSOR_SOCKET", c.ProcessorSocket); err != nil {
			return err
		}
		if filepath.Ext(c.ProcessorSocket) != ".sock" {
			return fmt.Errorf("API_PROCESSOR_SOCKET must end in .sock")
		}
	case "tcp":
		if err := validateProcessorURL(c.ProcessorURL); err != nil {
			return err
		}
		if strings.TrimSpace(c.ProcessorToken) == "" {
			return fmt.Errorf("API_PROCESSOR_TOKEN is required for tcp transport")
		}
	default:
		return fmt.Errorf("API_PROCESSOR_TRANSPORT must be unix or tcp")
	}
	return nil
}

func validateProcessorURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return fmt.Errorf("API_PROCESSOR_URL must be an absolute http(s) URL without credentials, path, query, or fragment")
	}
	return nil
}

func validateOrigin(raw string) error {
	if raw == "*" || strings.ContainsAny(raw, "* \t\r\n") {
		return fmt.Errorf("origin %q is not an exact origin", raw)
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return fmt.Errorf("origin %q must be an absolute http(s) origin", raw)
	}
	if u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("origin %q must not contain credentials, path, query, or fragment", raw)
	}
	return nil
}

func validateSafeAbsolutePath(name, value string) error {
	if strings.TrimSpace(value) == "" || !filepath.IsAbs(value) {
		return fmt.Errorf("%s must be an absolute path", name)
	}
	clean := filepath.Clean(value)
	if filepath.Dir(clean) == clean {
		return fmt.Errorf("%s must not be a filesystem root", name)
	}
	if runtime.GOOS == "windows" {
		volume := filepath.VolumeName(clean)
		if strings.EqualFold(clean, volume+string(filepath.Separator)) {
			return fmt.Errorf("%s must not be a volume root", name)
		}
	}
	return nil
}

func env(name, fallback string) string {
	if value, ok := os.LookupEnv(name); ok {
		return value
	}
	return fallback
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			result = append(result, strings.TrimSuffix(part, "/"))
		}
	}
	return result
}

func intEnv(name string, fallback int) int {
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

func int64Env(name string, fallback int64) int64 {
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

func durationEnv(name string, fallback time.Duration) time.Duration {
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
