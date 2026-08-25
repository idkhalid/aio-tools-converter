package config

import (
	"path/filepath"
	"testing"
	"time"
)

func validConfig(t *testing.T) Config {
	t.Helper()
	root := t.TempDir()
	return Config{
		Addr:              ":8080",
		AllowedOrigins:    []string{"http://localhost:4321", "https://converter.example"},
		JobRoot:           filepath.Join(root, "jobs"),
		JobTTL:            15 * time.Minute,
		MaxConcurrentJobs: 2,
		MaxQueuedJobs:     4,
		MaxUploadBytes:    1024,
		ProcessTimeout:    10 * time.Minute,
		DownloadTimeout:   10 * time.Minute,
		ShutdownTimeout:   10 * time.Second,
		ProcessorSocket:   filepath.Join(root, "office.sock"),
	}
}

func TestConfigValidate(t *testing.T) {
	if err := validConfig(t).Validate(); err != nil {
		t.Fatalf("valid config rejected: %v", err)
	}
}

func TestConfigRejectsUnsafeValues(t *testing.T) {
	tests := map[string]func(*Config){
		"wildcard origin": func(c *Config) { c.AllowedOrigins = []string{"*"} },
		"origin path":     func(c *Config) { c.AllowedOrigins = []string{"https://example.com/path"} },
		"long TTL":        func(c *Config) { c.JobTTL = 16 * time.Minute },
		"zero workers":    func(c *Config) { c.MaxConcurrentJobs = 0 },
		"relative root":   func(c *Config) { c.JobRoot = "jobs" },
		"relative socket": func(c *Config) { c.ProcessorSocket = "office.sock" },
		"wrong socket ext": func(c *Config) {
			c.ProcessorSocket = filepath.Join(t.TempDir(), "office.pipe")
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			cfg := validConfig(t)
			mutate(&cfg)
			if err := cfg.Validate(); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}
