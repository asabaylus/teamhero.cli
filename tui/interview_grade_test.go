package main

import (
	"bytes"
	"io"
	"strings"
	"testing"
)

func TestParseGradeFlags_Positional(t *testing.T) {
	opts, parseErr := ParseGradeFlags([]string{"https://github.com/x/y", "--candidate", "Jane"})
	if parseErr != "" {
		t.Fatalf("unexpected parse error: %s", parseErr)
	}
	if opts.Repo != "https://github.com/x/y" {
		t.Errorf("repo: got %q", opts.Repo)
	}
}

func TestParseGradeFlags_AllFlags(t *testing.T) {
	opts, parseErr := ParseGradeFlags([]string{
		"--candidate", "Jane",
		"--repo", "https://x.com/y",
		"--transcript", "/tmp/t.txt",
		"--interviewer-notes", "/tmp/n.md",
		"--session-recording-url", "https://zoom.us/rec/x",
		"--session-platform", "zoom",
		"--session-date", "2026-05-10",
		"--output-dir", "/tmp/out",
	})
	if parseErr != "" {
		t.Fatalf("parse error: %s", parseErr)
	}
	if opts.Candidate != "Jane" {
		t.Errorf("candidate: %q", opts.Candidate)
	}
	if opts.SessionPlatform != "zoom" {
		t.Errorf("session-platform: %q", opts.SessionPlatform)
	}
}

func TestValidateGradeOptions_RequiresCandidate(t *testing.T) {
	opts := &GradeOptions{Repo: "https://x"}
	if msg := ValidateGradeOptions(opts); msg == "" {
		t.Fatal("expected error on missing candidate")
	}
}

func TestValidateGradeOptions_RequiresRepoOrLocal(t *testing.T) {
	opts := &GradeOptions{Candidate: "Jane"}
	if msg := ValidateGradeOptions(opts); msg == "" {
		t.Fatal("expected error on missing repo and local")
	}
}

func TestValidateGradeOptions_RejectsBadPlatform(t *testing.T) {
	opts := &GradeOptions{Candidate: "Jane", Repo: "x", SessionPlatform: "nope"}
	if msg := ValidateGradeOptions(opts); msg == "" {
		t.Fatal("expected error on bad platform")
	}
}

type stubGradeRunner struct {
	gotOpts *GradeOptions
	code    int
}

func (s *stubGradeRunner) Run(opts *GradeOptions, _, _ io.Writer) int {
	s.gotOpts = opts
	return s.code
}

func TestRunInterviewGrade_PrintsWarningBanner(t *testing.T) {
	var out, errBuf bytes.Buffer
	stub := &stubGradeRunner{code: 0}
	code := runInterviewGrade(
		[]string{"--candidate", "Jane", "--repo", "x"},
		stub, &out, &errBuf,
	)
	if code != 0 {
		t.Errorf("expected exit 0 from stub, got %d", code)
	}
	if !strings.Contains(errBuf.String(), "ADVISORY") {
		t.Errorf("expected warning banner, got: %s", errBuf.String())
	}
	if !strings.Contains(errBuf.String(), "not a score") {
		t.Errorf("warning should remind that candidate is not a score")
	}
}

func TestRunInterviewGrade_ForwardsExitCode(t *testing.T) {
	var out, errBuf bytes.Buffer
	stub := &stubGradeRunner{code: 7}
	code := runInterviewGrade(
		[]string{"--candidate", "Jane", "--repo", "x"},
		stub, &out, &errBuf,
	)
	if code != 7 {
		t.Errorf("expected exit 7, got %d", code)
	}
}
