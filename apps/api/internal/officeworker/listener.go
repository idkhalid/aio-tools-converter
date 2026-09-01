package officeworker

import (
	"errors"
	"net"
	"os"
	"path/filepath"
)

// Listen creates the configured worker listener. Unix is the default; TCP is
// explicit so the existing network-disabled Compose service is unchanged.
func Listen(cfg Config) (net.Listener, error) {
	mode := cfg.Transport
	if mode == "" {
		mode = "unix"
	}
	switch mode {
	case "tcp":
		return net.Listen("tcp", cfg.Addr)
	case "unix":
		return listenUnix(cfg.SocketPath)
	default:
		return nil, errors.New("office processor transport must be unix or tcp")
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
		_ = listener.Close()
		return nil, err
	}
	return listener, nil
}
