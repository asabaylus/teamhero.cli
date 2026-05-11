package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
)

// GradeOptions are the headless flags accepted by `teamhero interview grade`.
type GradeOptions struct {
	Repo                string
	Candidate           string
	Transcript          string
	InterviewerNotes    string
	SessionRecordingURL string
	SessionPlatform     string
	SessionDate         string
	OutputDir           string
	LocalRepoPath       string
}

// ParseGradeFlags parses headless flags from the args following `grade`.
// The candidate URL/path can be a positional first arg (just like git clone).
func ParseGradeFlags(args []string) (*GradeOptions, string) {
	opts := &GradeOptions{}
	i := 0
	for i < len(args) {
		a := args[i]
		switch a {
		case "--repo", "--candidate", "--transcript", "--interviewer-notes",
			"--session-recording-url", "--session-platform",
			"--session-date", "--output-dir", "--local-repo-path":
			if i+1 >= len(args) {
				return nil, fmt.Sprintf("flag %s requires a value", a)
			}
			val := args[i+1]
			switch a {
			case "--repo":
				opts.Repo = val
			case "--candidate":
				opts.Candidate = val
			case "--transcript":
				opts.Transcript = val
			case "--interviewer-notes":
				opts.InterviewerNotes = val
			case "--session-recording-url":
				opts.SessionRecordingURL = val
			case "--session-platform":
				opts.SessionPlatform = val
			case "--session-date":
				opts.SessionDate = val
			case "--output-dir":
				opts.OutputDir = val
			case "--local-repo-path":
				opts.LocalRepoPath = val
			}
			i++
		default:
			// Positional: treat as repo URL if --repo not yet set.
			if !strings.HasPrefix(a, "--") && opts.Repo == "" && opts.LocalRepoPath == "" {
				opts.Repo = a
			} else {
				return nil, fmt.Sprintf("unknown flag: %s", a)
			}
		}
		i++
	}
	return opts, ""
}

// ValidateGradeOptions returns "" on success.
func ValidateGradeOptions(opts *GradeOptions) string {
	if strings.TrimSpace(opts.Candidate) == "" {
		return "missing required flag: --candidate"
	}
	if strings.TrimSpace(opts.Repo) == "" && strings.TrimSpace(opts.LocalRepoPath) == "" {
		return "need either --repo <url> or --local-repo-path <dir>"
	}
	if opts.SessionPlatform != "" {
		switch opts.SessionPlatform {
		case "zoom", "teams", "meet", "other":
		default:
			return "--session-platform must be one of zoom, teams, meet, other"
		}
	}
	return ""
}

// GradeRunner is the interface that abstracts the TS subprocess for tests.
type GradeRunner interface {
	Run(opts *GradeOptions, stdout, stderr io.Writer) int
}

type bunGradeRunner struct{}

func (bunGradeRunner) Run(opts *GradeOptions, stdout, stderr io.Writer) int {
	script := findGradeScript()
	args := []string{"run", script, "--candidate", opts.Candidate}
	if opts.Repo != "" {
		args = append(args, "--repo", opts.Repo)
	}
	if opts.LocalRepoPath != "" {
		args = append(args, "--local-repo-path", opts.LocalRepoPath)
	}
	for _, kv := range []struct{ flag, val string }{
		{"--transcript", opts.Transcript},
		{"--interviewer-notes", opts.InterviewerNotes},
		{"--session-recording-url", opts.SessionRecordingURL},
		{"--session-platform", opts.SessionPlatform},
		{"--session-date", opts.SessionDate},
		{"--output-dir", opts.OutputDir},
	} {
		if kv.val != "" {
			args = append(args, kv.flag, kv.val)
		}
	}
	cmd := exec.Command(resolveBunBinary(), args...)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	cmd.Env = os.Environ()
	if err := cmd.Run(); err != nil {
		if exit, ok := err.(*exec.ExitError); ok {
			return exit.ExitCode()
		}
		fmt.Fprintf(stderr, "Failed to run grade subprocess: %v\n", err)
		return 1
	}
	return 0
}

func findGradeScript() string {
	candidates := []string{
		"scripts/run-interview-grade.ts",
		"../scripts/run-interview-grade.ts",
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return "scripts/run-interview-grade.ts"
}

func runInterviewGrade(args []string, runner GradeRunner, stdout, stderr io.Writer) int {
	opts, parseErr := ParseGradeFlags(args)
	if parseErr != "" {
		fmt.Fprintln(stderr, parseErr)
		return 1
	}
	if msg := ValidateGradeOptions(opts); msg != "" {
		fmt.Fprintln(stderr, msg)
		return 1
	}

	// Warning banner — mandatory at the start of every grade flow.
	fmt.Fprintln(stderr, "⚠ THIS RUN PRODUCES AN ADVISORY AUDIT. Hiring decisions are made by humans.")
	fmt.Fprintln(stderr, "  The candidate is a person, not a score. The audit is one factor among many.")
	fmt.Fprintln(stderr)

	return runner.Run(opts, stdout, stderr)
}
