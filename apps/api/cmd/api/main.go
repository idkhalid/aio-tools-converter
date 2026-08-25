package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/aio-converter/api/internal/config"
	"github.com/aio-converter/api/internal/httpapi"
	"github.com/aio-converter/api/internal/jobs"
	"github.com/aio-converter/api/internal/processors/officeclient"
)

func main() {
	logger := log.New(os.Stderr, "aio-api: ", log.Ldate|log.Ltime|log.LUTC)
	cfg, err := config.Load()
	if err != nil {
		logger.Fatalf("invalid configuration: %v", err)
	}

	office, err := officeclient.New(officeclient.Config{
		SocketPath:     cfg.ProcessorSocket,
		Token:          cfg.ProcessorToken,
		MaxOutputBytes: cfg.MaxUploadBytes,
	})
	if err != nil {
		logger.Fatalf("configure office processor: %v", err)
	}
	defer office.Close()

	manager, err := jobs.NewManager(jobs.Config{
		Root:           cfg.JobRoot,
		TTL:            cfg.JobTTL,
		ProcessTimeout: cfg.ProcessTimeout,
		Concurrency:    cfg.MaxConcurrentJobs,
		QueueSize:      cfg.MaxQueuedJobs,
	}, office)
	if err != nil {
		logger.Fatalf("start job manager: %v", err)
	}

	handler, err := httpapi.New(httpapi.Config{
		AllowedOrigins:  cfg.AllowedOrigins,
		MaxUploadBytes:  cfg.MaxUploadBytes,
		DownloadTimeout: cfg.DownloadTimeout,
		SSEHeartbeat:    15 * time.Second,
		ReadinessCheck:  office.Ready,
	}, manager)
	if err != nil {
		logger.Fatalf("configure HTTP API: %v", err)
	}
	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       2 * time.Minute,
		IdleTimeout:       75 * time.Second,
		MaxHeaderBytes:    1 << 20,
		ErrorLog:          logger,
	}

	stopCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	serveResult := make(chan error, 1)
	go func() {
		logger.Printf("listening on %s", cfg.Addr)
		serveResult <- server.ListenAndServe()
	}()

	select {
	case err := <-serveResult:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Printf("server stopped unexpectedly")
		}
	case <-stopCtx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Printf("HTTP shutdown exceeded its deadline")
	}
	if err := manager.Close(); err != nil {
		logger.Printf("job cleanup did not complete")
	}
}
