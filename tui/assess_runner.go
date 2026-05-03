package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// assessScriptPath returns the path to scripts/run-assess.ts. Mirrors
// resolveScriptPath but for the assess service runner.
func assessScriptPath() string {
	exePath, err := os.Executable()
	if err == nil {
		dir := filepath.Dir(exePath)
		candidate := filepath.Join(dir, "..", "scripts", "run-assess.ts")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	candidates := []string{
		"scripts/run-assess.ts",
		"./scripts/run-assess.ts",
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	home, _ := os.UserHomeDir()
	if home != "" {
		fallback := filepath.Join(home, "teamhero.cli", "scripts", "run-assess.ts")
		if _, err := os.Stat(fallback); err == nil {
			return fallback
		}
	}
	return "scripts/run-assess.ts"
}

// AssessRunResult bundles the channels for stream consumption + a stdin
// writer the TUI uses to send interview-answer events back.
type AssessRunResult struct {
	Events   <-chan GenericEvent
	Errors   <-chan error
	Stderr   *bytes.Buffer
	StdinW   io.WriteCloser
	closeFns []func()
}

// Close cleans up the stdin writer if not already closed.
func (r *AssessRunResult) Close() {
	for _, fn := range r.closeFns {
		fn()
	}
}

// RunAssessServiceRunner spawns the TS service runner for the maturity
// assessment. The first stdin write is the AssessConfig JSON; the stream is
// kept open so the TUI can send subsequent interview-answer JSON lines.
func RunAssessServiceRunner(input AssessConfig) (*AssessRunResult, error) {
	configJSON, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal assess config: %w", err)
	}

	var cmd *exec.Cmd
	if serviceBin := resolveServiceBinary(); serviceBin != "" {
		// In future the bundled service could route to assess via env var.
		// For now, prefer the bun script if available.
		bunPath := resolveBunBinary()
		scriptPath := assessScriptPath()
		if _, statErr := os.Stat(scriptPath); statErr == nil {
			cmd = exec.Command(bunPath, "run", scriptPath)
		} else {
			cmd = exec.Command(serviceBin, "--mode=assess")
		}
	} else {
		bunPath := resolveBunBinary()
		scriptPath := assessScriptPath()
		cmd = exec.Command(bunPath, "run", scriptPath)
	}

	stderrBuf := &bytes.Buffer{}
	cmd.Stderr = stderrBuf

	stdinPipe, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdin pipe: %w", err)
	}
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start assess runner: %w", err)
	}

	// Send the config as the first JSON line; keep stdin open afterward.
	if _, err := stdinPipe.Write(append(configJSON, '\n')); err != nil {
		stdinPipe.Close()
		return nil, fmt.Errorf("failed to write config: %w", err)
	}

	eventCh := make(chan GenericEvent, 64)
	errCh := make(chan error, 1)

	go func() {
		defer close(eventCh)
		defer close(errCh)

		scanner := bufio.NewScanner(stdoutPipe)
		scanner.Buffer(make([]byte, 0, 256*1024), 4*1024*1024) // 4MB max line for full audit JSON

		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			var evt GenericEvent
			if err := json.Unmarshal([]byte(line), &evt); err != nil {
				continue
			}
			eventCh <- evt
		}

		if err := cmd.Wait(); err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				errCh <- fmt.Errorf("assess runner exited with code %d", exitErr.ExitCode())
			} else {
				errCh <- fmt.Errorf("assess runner error: %w", err)
			}
		}
	}()

	return &AssessRunResult{
		Events:   eventCh,
		Errors:   errCh,
		Stderr:   stderrBuf,
		StdinW:   stdinPipe,
		closeFns: []func(){func() { _ = stdinPipe.Close() }},
	}, nil
}

// SendInterviewAnswer writes a JSON-line answer event to the runner's stdin.
func SendInterviewAnswer(r *AssessRunResult, questionID, value string, isOption bool) error {
	evt := InterviewAnswerEvent{
		Type:       "interview-answer",
		QuestionID: questionID,
		Value:      value,
		IsOption:   isOption,
	}
	data, err := json.Marshal(evt)
	if err != nil {
		return err
	}
	if _, err := r.StdinW.Write(append(data, '\n')); err != nil {
		return err
	}
	return nil
}
