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

	"github.com/aio-converter/api/internal/officeworker"
)

func main() {
	logger := log.New(os.Stderr, "aio-office-worker: ", log.Ldate|log.Ltime|log.LUTC)
	cfg, err := officeworker.LoadConfig()
	if err != nil {
		logger.Fatalf("invalid configuration: %v", err)
	}
	handler, err := officeworker.NewServer(cfg, officeworker.LibreOfficeRunner{
		Binary:         cfg.LibreOfficeBin,
		MaxOutputBytes: cfg.MaxOutputBytes,
	})
	if err != nil {
		logger.Fatalf("start office worker: %v", err)
	}
	listener, err := officeworker.Listen(cfg)
	if err != nil {
		logger.Fatalf("listen on processor endpoint: %v", err)
	}
	defer func() {
		listener.Close()
		if cfg.Transport == "" || cfg.Transport == "unix" {
			_ = os.Remove(cfg.SocketPath)
		}
	}()

	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       cfg.ProcessTimeout + time.Minute,
		IdleTimeout:       30 * time.Second,
		MaxHeaderBytes:    64 * 1024,
		ErrorLog:          logger,
	}
	stopCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	serveResult := make(chan error, 1)
	go func() { serveResult <- server.Serve(listener) }()

	select {
	case err := <-serveResult:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Printf("worker stopped unexpectedly")
		}
	case <-stopCtx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownWait)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Printf("worker shutdown exceeded its deadline")
	}
	if err := handler.Cleanup(); err != nil {
		logger.Printf("worker cleanup did not complete")
	}
}
