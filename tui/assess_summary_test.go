package main

import (
	"strings"
	"testing"
)

func TestRenderAssessSummary_NilConfig(t *testing.T) {
	out := renderAssessSummary(nil, 60)
	if !strings.Contains(out, "No configuration") {
		t.Errorf("expected 'No configuration', got: %s", out)
	}
}

func TestRenderAssessSummary_LocalRepoMode(t *testing.T) {
	cfg := &AssessConfig{
		Scope: AssessScope{
			Mode:        "local-repo",
			LocalPath:   "/tmp/foo",
			DisplayName: "foo",
		},
		EvidenceTier: "auto",
		OutputFormat: "both",
	}
	out := renderAssessSummary(cfg, 60)
	if !strings.Contains(out, "Local repository") {
		t.Errorf("expected 'Local repository' label, got: %s", out)
	}
	if !strings.Contains(out, "/tmp/foo") {
		t.Errorf("expected target path, got: %s", out)
	}
	if !strings.Contains(out, "auto-detect") {
		t.Errorf("expected tier auto-detect, got: %s", out)
	}
}

func TestRenderAssessSummary_OrgMode(t *testing.T) {
	cfg := &AssessConfig{
		Scope: AssessScope{
			Mode:        "org",
			Org:         "acme",
			DisplayName: "acme",
		},
		EvidenceTier: "gh",
		OutputFormat: "markdown",
	}
	out := renderAssessSummary(cfg, 60)
	if !strings.Contains(out, "GitHub org") {
		t.Errorf("expected 'GitHub org', got: %s", out)
	}
	if !strings.Contains(out, "acme") {
		t.Errorf("expected target 'acme', got: %s", out)
	}
	if !strings.Contains(out, "gh CLI") {
		t.Errorf("expected tier 'gh CLI', got: %s", out)
	}
}

func TestRenderAssessSummary_BothMode(t *testing.T) {
	cfg := &AssessConfig{
		Scope: AssessScope{
			Mode:        "both",
			Org:         "acme",
			LocalPath:   "/tmp/bar",
			DisplayName: "acme",
		},
	}
	out := renderAssessSummary(cfg, 60)
	if !strings.Contains(out, "acme") || !strings.Contains(out, "/tmp/bar") {
		t.Errorf("expected both 'acme' and '/tmp/bar': %s", out)
	}
}

func TestRenderAssessSummary_DryRunBadge(t *testing.T) {
	cfg := &AssessConfig{
		Scope:        AssessScope{Mode: "local-repo", LocalPath: ".", DisplayName: "."},
		EvidenceTier: "auto",
		DryRun:       true,
	}
	out := renderAssessSummary(cfg, 60)
	if !strings.Contains(out, "dry-run") {
		t.Errorf("expected 'dry-run' badge, got: %s", out)
	}
}

func TestFmtAssessTier(t *testing.T) {
	cases := map[string]string{
		"":           "auto-detect",
		"auto":       "auto-detect",
		"gh":         "1 — gh CLI",
		"github-mcp": "2 — GitHub MCP",
		"git-only":   "3 — git-only",
		"weird":      "weird",
	}
	for input, want := range cases {
		got := fmtAssessTier(input)
		if got != want {
			t.Errorf("fmtAssessTier(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestFmtAssessOutputFormat(t *testing.T) {
	cases := map[string]string{
		"":         "both",
		"both":     "both (md + json)",
		"markdown": "markdown",
		"json":     "json",
	}
	for input, want := range cases {
		got := fmtAssessOutputFormat(input)
		if got != want {
			t.Errorf("fmtAssessOutputFormat(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestFmtAssessAnswersFile(t *testing.T) {
	if fmtAssessAnswersFile("") != "interactive" {
		t.Error("empty path should render as interactive")
	}
	if fmtAssessAnswersFile("/tmp/answers.json") != "/tmp/answers.json" {
		t.Error("non-empty path should pass through")
	}
}

func TestFmtAssessRunMode(t *testing.T) {
	if got := fmtAssessRunMode(&AssessConfig{Mode: "headless"}); got != "headless" {
		t.Errorf("Mode=headless -> %q", got)
	}
	if got := fmtAssessRunMode(&AssessConfig{InteractiveInterview: true}); got != "interactive" {
		t.Errorf("InteractiveInterview=true -> %q", got)
	}
	if got := fmtAssessRunMode(&AssessConfig{}); got != "headless" {
		t.Errorf("default -> %q (want headless)", got)
	}
}
