package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
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
	listener, err := listenUnix(cfg.SocketPath)
	if err != nil {
		logger.Fatalf("listen on processor socket: %v", err)
	}
	defer func() {
		listener.Close()
		_ = os.Remove(cfg.SocketPath)
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

func listenUnix(socketPath string) (net.Listener, error) {
	if err := os.MkdirAll(filepath.Dir(socketPath), 0o750); err != nil {
		return nil, err
	}
	if info, err := os.Lstat(socketPath); err == nil {
		if info.Mode()&os.ModeSocket == 0 {
			return nil, errors.New("processor socket path contains a non-socket file")
		}
		if err := os.Remove(socketPath); err != nil {
			return nil, err
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return nil, err
	}
	if err := os.Chmod(socketPath, 0o660); err != nil {
		listener.Close()
		return nil, err
	}
	return listener, nil
}
