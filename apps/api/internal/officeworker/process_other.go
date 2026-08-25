//go:build !linux && !windows

package officeworker

import "os/exec"

func configureProcess(_ *exec.Cmd) {}

func killProcessGroup(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}
	return cmd.Process.Kill()
}
