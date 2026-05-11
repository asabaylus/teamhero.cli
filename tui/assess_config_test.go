package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultAssessConfig(t *testing.T) {
	cfg := DefaultAssessConfig()
	if cfg.Scope.Mode != "local-repo" {
		t.Errorf("Mode = %q, want local-repo", cfg.Scope.Mode)
	}
	if cfg.OutputFormat != "both" {
		t.Errorf("OutputFormat = %q, want both", cfg.OutputFormat)
	}
	if cfg.EvidenceTier != "auto" {
		t.Errorf("EvidenceTier = %q, want auto", cfg.EvidenceTier)
	}
	if cfg.Scope.LocalPath == "" {
		t.Error("LocalPath should be set to cwd")
	}
}

func TestSaveAndLoadAssessConfig(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", dir)

	cfg := AssessConfig{
		Scope: AssessScope{
			Mode:        "org",
			Org:         "acme",
			DisplayName: "acme",
		},
		EvidenceTier: "gh",
		OutputFormat: "markdown",
		DryRun:       true,
	}
	if err := SaveAssessConfig(&cfg); err != nil {
		t.Fatalf("SaveAssessConfig: %v", err)
	}
	loaded, err := LoadAssessConfig()
	if err != nil {
		t.Fatalf("LoadAssessConfig: %v", err)
	}
	if loaded == nil {
		t.Fatal("loaded is nil")
	}
	if loaded.Scope.Org != "acme" || loaded.EvidenceTier != "gh" || !loaded.DryRun {
		t.Errorf("round-trip mismatch: %+v", loaded)
	}

	// Verify file is JSON-parseable on disk
	data, err := os.ReadFile(filepath.Join(dir, "teamhero", "assess-config.json"))
	if err != nil {
		t.Fatalf("read disk file: %v", err)
	}
	var probe AssessConfig
	if err := json.Unmarshal(data, &probe); err != nil {
		t.Errorf("on-disk JSON invalid: %v", err)
	}
}

func TestLoadAssessConfig_MissingFile(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", dir)
	cfg, err := LoadAssessConfig()
	if err != nil {
		t.Fatalf("expected nil error for missing file, got: %v", err)
	}
	if cfg != nil {
		t.Errorf("expected nil config for missing file, got: %+v", cfg)
	}
}

func TestFillAssessDefaults(t *testing.T) {
	t.Run("empty -> local-repo", func(t *testing.T) {
		cfg := AssessConfig{}
		fillAssessDefaults(&cfg)
		if cfg.Scope.Mode != "local-repo" {
			t.Errorf("mode = %q, want local-repo", cfg.Scope.Mode)
		}
		if cfg.OutputFormat != "both" {
			t.Errorf("format = %q, want both", cfg.OutputFormat)
		}
	})
	t.Run("org-only sets mode=org", func(t *testing.T) {
		cfg := AssessConfig{Scope: AssessScope{Org: "acme"}}
		fillAssessDefaults(&cfg)
		if cfg.Scope.Mode != "org" {
			t.Errorf("mode = %q, want org", cfg.Scope.Mode)
		}
		if cfg.Scope.DisplayName != "acme" {
			t.Errorf("displayName = %q, want acme", cfg.Scope.DisplayName)
		}
	})
	t.Run("path-only sets mode=local-repo with basename", func(t *testing.T) {
		cfg := AssessConfig{Scope: AssessScope{LocalPath: "/foo/bar/baz"}}
		fillAssessDefaults(&cfg)
		if cfg.Scope.Mode != "local-repo" {
			t.Errorf("mode = %q, want local-repo", cfg.Scope.Mode)
		}
		if cfg.Scope.DisplayName != "baz" {
			t.Errorf("displayName = %q, want baz", cfg.Scope.DisplayName)
		}
	})
	t.Run("org+path sets mode=both", func(t *testing.T) {
		cfg := AssessConfig{Scope: AssessScope{Org: "acme", LocalPath: "/foo"}}
		fillAssessDefaults(&cfg)
		if cfg.Scope.Mode != "both" {
			t.Errorf("mode = %q, want both", cfg.Scope.Mode)
		}
	})
}

func TestHasMinimalAssessConfig(t *testing.T) {
	if hasMinimalAssessConfig(nil) {
		t.Error("nil should be invalid")
	}
	if hasMinimalAssessConfig(&AssessConfig{}) {
		t.Error("empty should be invalid")
	}
	if hasMinimalAssessConfig(&AssessConfig{Scope: AssessScope{Mode: "org"}}) {
		t.Error("org without name should be invalid")
	}
	if !hasMinimalAssessConfig(&AssessConfig{
		Scope: AssessScope{Mode: "org", Org: "acme", DisplayName: "acme"},
	}) {
		t.Error("org+name should be valid")
	}
	if !hasMinimalAssessConfig(&AssessConfig{
		Scope: AssessScope{Mode: "local-repo", LocalPath: "/foo", DisplayName: "foo"},
	}) {
		t.Error("local-repo+path should be valid")
	}
}
