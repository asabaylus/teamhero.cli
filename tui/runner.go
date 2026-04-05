package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// resolveBunBinary finds the bun executable.
func resolveBunBinary() string {
	if p := os.Getenv("TEAMHERO_BUN_PATH"); p != "" {
		return p
	}
	if p, err := exec.LookPath("bun"); err == nil {
		return p
	}
	return "bun"
}

// resolveScriptPath finds the run-report.ts script relative to the TUI binary.
func resolveScriptPath() string {
	// First try relative to the binary itself (installed layout)
	exePath, err := os.Executable()
	if err == nil {
		dir := filepath.Dir(exePath)
		candidate := filepath.Join(dir, "..", "scripts", "run-report.ts")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}

	// Try relative to CWD (development layout)
	candidate := filepath.Join("scripts", "run-report.ts")
	if _, err := os.Stat(candidate); err == nil {
		return candidate
	}

	// Absolute fallback: look in common locations
	home, _ := os.UserHomeDir()
	locations := []string{
		filepath.Join(home, "teamhero.cli", "scripts", "run-report.ts"),
	}
	for _, loc := range locations {
		if _, err := os.Stat(loc); err == nil {
			return loc
		}
	}

	return "scripts/run-report.ts"
}

// resolveServiceBinary looks for a compiled teamhero-service binary next to
// the running TUI executable. Returns the path if found, or empty string.
func resolveServiceBinary() string {
	exePath, err := os.Executable()
	if err != nil {
		return ""
	}
	dir := filepath.Dir(exePath)

	// The compiled service binary sits alongside the TUI binary in release archives
	name := "teamhero-service"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	candidate := filepath.Join(dir, name)
	if _, err := os.Stat(candidate); err == nil {
		return candidate
	}
	return ""
}

// RunServiceRunner spawns the TypeScript service runner as a subprocess.
// It sends the config JSON on stdin and streams JSON-lines events back
// through the returned channel. The channel is closed when the subprocess exits.
// Subprocess stderr is captured to prevent corruption of the progress display;
// the captured output is returned so callers can print it after progress completes.
//
// Resolution order:
//  1. Compiled teamhero-service binary next to this executable (release layout)
//  2. bun run scripts/run-report.ts (development fallback)
func RunServiceRunner(input ReportCommandInput) (<-chan GenericEvent, <-chan error, *bytes.Buffer) {
	eventCh := make(chan GenericEvent, 64)
	errCh := make(chan error, 1)
	stderrBuf := &bytes.Buffer{}

	go func() {
		defer close(eventCh)
		defer close(errCh)

		configJSON, err := json.Marshal(input)
		if err != nil {
			errCh <- fmt.Errorf("failed to marshal config: %w", err)
			return
		}

		// Try compiled sibling binary first (release layout)
		var cmd *exec.Cmd
		if serviceBin := resolveServiceBinary(); serviceBin != "" {
			cmd = exec.Command(serviceBin)
		} else {
			// Fallback to bun + script (development layout)
			bunPath := resolveBunBinary()
			scriptPath := resolveScriptPath()
			cmd = exec.Command(bunPath, "run", scriptPath)
		}

		cmd.Stdin = strings.NewReader(string(configJSON))
		cmd.Stderr = stderrBuf // Capture stderr to avoid corrupting the progress frame

		stdout, err := cmd.StdoutPipe()
		if err != nil {
			errCh <- fmt.Errorf("failed to create stdout pipe: %w", err)
			return
		}

		if err := cmd.Start(); err != nil {
			errCh <- fmt.Errorf("failed to start service runner: %w", err)
			return
		}

		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 256*1024), 1024*1024) // 1MB max line

		for scanner.Scan() {
			line := scanner.Text()
			if line == "" {
				continue
			}

			var evt GenericEvent
			if err := json.Unmarshal([]byte(line), &evt); err != nil {
				// Non-JSON line — skip (might be raw log output)
				continue
			}
			eventCh <- evt
		}

		if err := cmd.Wait(); err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				errCh <- fmt.Errorf("service runner exited with code %d", exitErr.ExitCode())
			} else {
				errCh <- fmt.Errorf("service runner error: %w", err)
			}
		}
	}()

	return eventCh, errCh, stderrBuf
}

// RunServiceForeground spawns the service runner with stdout/stderr connected
// directly to the parent process. This bypasses JSON-lines event parsing and
// avoids pipe-related hangs in non-TTY environments (CI, background agents).
func RunServiceForeground(input ReportCommandInput) error {
	configJSON, err := json.Marshal(input)
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	var cmd *exec.Cmd
	if serviceBin := resolveServiceBinary(); serviceBin != "" {
		cmd = exec.Command(serviceBin)
	} else {
		bunPath := resolveBunBinary()
		scriptPath := resolveScriptPath()
		cmd = exec.Command(bunPath, "run", scriptPath)
	}

	cmd.Stdin = strings.NewReader(string(configJSON))
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return fmt.Errorf("service runner exited with code %d", exitErr.ExitCode())
		}
		return fmt.Errorf("service runner error: %w", err)
	}
	return nil
}

// platformKey returns the platform identifier used for binary resolution.
func platformKey() string {
	os := runtime.GOOS
	arch := runtime.GOARCH
	switch arch {
	case "amd64":
		arch = "x64"
	}
	return os + "-" + arch
}
