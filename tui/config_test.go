package main

import (
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"
)

func TestExpressConfig(t *testing.T) {
	cfg := ExpressConfig()
	if cfg.Org != "" {
		t.Errorf("expected empty org, got %q", cfg.Org)
	}
	if !cfg.UseAllRepos {
		t.Error("expected UseAllRepos to be true")
	}
	if !cfg.Sections.DataSources.Git {
		t.Error("expected Git data source to be true")
	}
	if cfg.Sections.DataSources.Asana {
		t.Error("expected Asana data source to be false in express config")
	}
	if !cfg.Sections.ReportSections.IndividualContributions {
		t.Error("expected IndividualContributions to be true")
	}
	if cfg.Sections.ReportSections.VisibleWins {
		t.Error("expected VisibleWins to be false in express config")
	}
}

func TestExpressConfigToCommandInput(t *testing.T) {
	cfg := ExpressConfig()
	cfg.Org = "acme"
	cfg.Since = "2025-01-01"
	cfg.Until = "2025-01-07"

	input := cfg.ToCommandInput("interactive")

	if input.Sections.DataSources.Asana {
		t.Error("express config command input should have Asana=false")
	}
	if !input.Sections.DataSources.Git {
		t.Error("express config command input should have Git=true")
	}
	if !input.Sections.ReportSections.IndividualContributions {
		t.Error("express config command input should have IndividualContributions=true")
	}
	if input.Sections.ReportSections.VisibleWins {
		t.Error("express config command input should have VisibleWins=false")
	}
}

func TestHasCredentials_NoFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	if HasCredentials() {
		t.Error("expected HasCredentials to return false with no .env file")
	}
}

func TestHasCredentials_WithBothKeys(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	envDir := filepath.Join(tmpDir, "teamhero")
	if err := os.MkdirAll(envDir, 0o755); err != nil {
		t.Fatal(err)
	}
	content := "GITHUB_PERSONAL_ACCESS_TOKEN=ghp_test123\nOPENAI_API_KEY=sk-test456\n"
	if err := os.WriteFile(filepath.Join(envDir, ".env"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}

	if !HasCredentials() {
		t.Error("expected HasCredentials to return true with both keys present")
	}
}

func TestHasCredentials_MissingOpenAI(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	envDir := filepath.Join(tmpDir, "teamhero")
	if err := os.MkdirAll(envDir, 0o755); err != nil {
		t.Fatal(err)
	}
	content := "GITHUB_PERSONAL_ACCESS_TOKEN=ghp_test123\n"
	if err := os.WriteFile(filepath.Join(envDir, ".env"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}

	if HasCredentials() {
		t.Error("expected HasCredentials to return false with missing OpenAI key")
	}
}

func TestHasAsanaToken_FromEnvFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	t.Setenv("ASANA_API_TOKEN", "") // ensure env var is not set

	envDir := filepath.Join(tmpDir, "teamhero")
	if err := os.MkdirAll(envDir, 0o755); err != nil {
		t.Fatal(err)
	}
	content := "ASANA_API_TOKEN=test_asana_token\n"
	if err := os.WriteFile(filepath.Join(envDir, ".env"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}

	if !hasAsanaToken() {
		t.Error("expected hasAsanaToken to return true when token is in .env file")
	}
}

func TestHasAsanaToken_NotPresent(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	t.Setenv("ASANA_API_TOKEN", "")

	if hasAsanaToken() {
		t.Error("expected hasAsanaToken to return false with no token anywhere")
	}
}

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()
	if cfg.Org != "" {
		t.Errorf("expected empty org, got %q", cfg.Org)
	}
	if !cfg.UseAllRepos {
		t.Error("expected UseAllRepos to be true")
	}
	if !cfg.Sections.DataSources.Git {
		t.Error("expected Git data source to be true")
	}
	if !cfg.Sections.ReportSections.IndividualContributions {
		t.Error("expected IndividualContributions to be true")
	}
	if cfg.Sections.ReportSections.VisibleWins {
		t.Error("expected VisibleWins to be false")
	}
}

func TestToCommandInput(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	cfg.Since = "2025-01-01"
	cfg.Until = "2025-01-07"
	cfg.Members = []string{"alice", "bob"}
	cfg.Repos = []string{"api", "web"}
	cfg.UseAllRepos = false

	input := cfg.ToCommandInput("interactive")

	if input.Org != "acme" {
		t.Errorf("expected org acme, got %q", input.Org)
	}
	if input.Mode != "interactive" {
		t.Errorf("expected mode interactive, got %q", input.Mode)
	}
	if len(input.Members) != 2 {
		t.Errorf("expected 2 members, got %d", len(input.Members))
	}
	if len(input.Repos) != 2 {
		t.Errorf("expected 2 repos, got %d", len(input.Repos))
	}
}

func TestToCommandInputAllRepos(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	cfg.UseAllRepos = true
	cfg.Repos = []string{"should-be-ignored"}

	input := cfg.ToCommandInput("headless")

	if input.Repos != nil {
		t.Errorf("expected nil repos when UseAllRepos is true, got %v", input.Repos)
	}
}

func TestSaveAndLoadConfig(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	cfg := DefaultConfig()
	cfg.Org = "test-org"
	cfg.Since = "2025-06-01"
	cfg.Until = "2025-06-07"

	if err := SaveConfig(&cfg); err != nil {
		t.Fatalf("SaveConfig failed: %v", err)
	}

	// Verify file exists
	path := filepath.Join(tmpDir, "teamhero", "config.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("config file not found: %v", err)
	}

	var saved ReportConfig
	if err := json.Unmarshal(data, &saved); err != nil {
		t.Fatalf("failed to unmarshal saved config: %v", err)
	}
	if saved.Org != "test-org" {
		t.Errorf("expected org test-org, got %q", saved.Org)
	}

	// Load it back
	loaded, err := LoadSavedConfig()
	if err != nil {
		t.Fatalf("LoadSavedConfig failed: %v", err)
	}
	if loaded == nil {
		t.Fatal("LoadSavedConfig returned nil")
	}
	if loaded.Org != "test-org" {
		t.Errorf("expected loaded org test-org, got %q", loaded.Org)
	}
	if loaded.Since != "2025-06-01" {
		t.Errorf("expected since 2025-06-01, got %q", loaded.Since)
	}
}

func TestOutputFormatInCommandInput(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"

	// Without --output-format flag, OutputFormat should be empty
	input := cfg.ToCommandInput("headless")
	if input.OutputFormat != "" {
		t.Errorf("expected empty outputFormat, got %q", input.OutputFormat)
	}

	// Verify it serializes correctly when set
	input.OutputFormat = "json"
	data, err := json.Marshal(input)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	var decoded ReportCommandInput
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if decoded.OutputFormat != "json" {
		t.Errorf("expected outputFormat json, got %q", decoded.OutputFormat)
	}
}

func TestOutputFormatBothRoundtrip(t *testing.T) {
	input := ReportCommandInput{
		Org:          "acme",
		OutputFormat: "both",
		Sections:     ReportSections{DataSources: DataSources{Git: true}},
	}

	data, err := json.Marshal(input)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	var decoded ReportCommandInput
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if decoded.OutputFormat != "both" {
		t.Errorf("expected outputFormat both, got %q", decoded.OutputFormat)
	}
}

func TestReportDataEventSerialization(t *testing.T) {
	evt := GenericEvent{
		Type: "report-data",
		Data: json.RawMessage(`{"orgSlug":"acme","totals":{"prs":10}}`),
	}

	data, err := json.Marshal(evt)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	var decoded GenericEvent
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if decoded.Type != "report-data" {
		t.Errorf("expected type report-data, got %q", decoded.Type)
	}
	if string(decoded.Data) != `{"orgSlug":"acme","totals":{"prs":10}}` {
		t.Errorf("unexpected data: %s", string(decoded.Data))
	}
}

func TestResultEventWithJsonOutputPath(t *testing.T) {
	evt := GenericEvent{
		Type:           "result",
		OutputPath:     "/tmp/report.md",
		JsonOutputPath: "/tmp/report.json",
	}

	data, err := json.Marshal(evt)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	var decoded GenericEvent
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if decoded.OutputPath != "/tmp/report.md" {
		t.Errorf("expected outputPath, got %q", decoded.OutputPath)
	}
	if decoded.JsonOutputPath != "/tmp/report.json" {
		t.Errorf("expected jsonOutputPath, got %q", decoded.JsonOutputPath)
	}
}

func TestApplyEnvTuningOverrides_DiscrepancyThreshold(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	t.Setenv("TEAMHERO_DISCREPANCY_CONFIDENCE_THRESHOLD", "")
	t.Setenv("TEAMHERO_SEQUENTIAL", "")

	envDir := filepath.Join(tmpDir, "teamhero")
	if err := os.MkdirAll(envDir, 0o755); err != nil {
		t.Fatal(err)
	}
	envContent := "TEAMHERO_DISCREPANCY_CONFIDENCE_THRESHOLD=70\n"
	if err := os.WriteFile(filepath.Join(envDir, ".env"), []byte(envContent), 0o600); err != nil {
		t.Fatal(err)
	}

	// Simulate a saved config with stale zero-value threshold
	cfg := ReportConfig{
		DiscrepancyThreshold: 0, // stale config.json value
	}

	applyEnvTuningOverrides(&cfg)

	if cfg.DiscrepancyThreshold != 70 {
		t.Errorf("expected DiscrepancyThreshold=70 from .env, got %d", cfg.DiscrepancyThreshold)
	}
}

func TestApplyEnvTuningOverrides_Sequential(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	t.Setenv("TEAMHERO_DISCREPANCY_CONFIDENCE_THRESHOLD", "")
	t.Setenv("TEAMHERO_SEQUENTIAL", "")

	envDir := filepath.Join(tmpDir, "teamhero")
	if err := os.MkdirAll(envDir, 0o755); err != nil {
		t.Fatal(err)
	}
	envContent := "TEAMHERO_SEQUENTIAL=true\n"
	if err := os.WriteFile(filepath.Join(envDir, ".env"), []byte(envContent), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg := ReportConfig{
		Sequential: false,
	}

	applyEnvTuningOverrides(&cfg)

	if !cfg.Sequential {
		t.Error("expected Sequential=true from .env override")
	}
}

func TestApplyEnvTuningOverrides_EnvVarTakesPrecedence(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	t.Setenv("TEAMHERO_DISCREPANCY_CONFIDENCE_THRESHOLD", "90")

	envDir := filepath.Join(tmpDir, "teamhero")
	if err := os.MkdirAll(envDir, 0o755); err != nil {
		t.Fatal(err)
	}
	envContent := "TEAMHERO_DISCREPANCY_CONFIDENCE_THRESHOLD=50\n"
	if err := os.WriteFile(filepath.Join(envDir, ".env"), []byte(envContent), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg := ReportConfig{
		DiscrepancyThreshold: 0,
	}

	applyEnvTuningOverrides(&cfg)

	// Environment variable (90) should take precedence over .env file (50)
	if cfg.DiscrepancyThreshold != 90 {
		t.Errorf("expected DiscrepancyThreshold=90 from env var, got %d", cfg.DiscrepancyThreshold)
	}
}

func TestSavedConfigWithEnvOverride(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	t.Setenv("TEAMHERO_DISCREPANCY_CONFIDENCE_THRESHOLD", "")
	t.Setenv("TEAMHERO_SEQUENTIAL", "")

	envDir := filepath.Join(tmpDir, "teamhero")
	if err := os.MkdirAll(envDir, 0o755); err != nil {
		t.Fatal(err)
	}

	// Saved config.json with threshold=0 (stale zero-value)
	cfgJSON := `{"org":"acme","discrepancyThreshold":0,"sections":{"dataSources":{"git":true},"reportSections":{"individualContributions":true}}}`
	if err := os.WriteFile(filepath.Join(envDir, "config.json"), []byte(cfgJSON), 0o644); err != nil {
		t.Fatal(err)
	}

	// .env with threshold=70
	envContent := "TEAMHERO_DISCREPANCY_CONFIDENCE_THRESHOLD=70\n"
	if err := os.WriteFile(filepath.Join(envDir, ".env"), []byte(envContent), 0o600); err != nil {
		t.Fatal(err)
	}

	// Simulate the runHeadless/runInteractive flow
	cfg := DefaultConfig()
	prev, err := LoadSavedConfig()
	if err != nil {
		t.Fatalf("LoadSavedConfig failed: %v", err)
	}
	if prev != nil {
		cfg = *prev
		applyEnvTuningOverrides(&cfg)
	}

	if cfg.DiscrepancyThreshold != 70 {
		t.Errorf("expected DiscrepancyThreshold=70 after .env override, got %d", cfg.DiscrepancyThreshold)
	}
	if cfg.Org != "acme" {
		t.Errorf("expected org=acme from saved config, got %q", cfg.Org)
	}
}

func TestFlushCacheInCommandInput(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	cfg.FlushCache = "all:since=2026-02-20"

	input := cfg.ToCommandInput("interactive")

	if input.FlushCache != "all:since=2026-02-20" {
		t.Errorf("expected FlushCache to pass through, got %q", input.FlushCache)
	}
}

func TestProtocolEventSerialization(t *testing.T) {
	progress := 0.5
	evt := GenericEvent{
		Type:     "progress",
		Step:     "Fetching repos",
		Status:   "update",
		Message:  "Repo 5/10",
		Progress: &progress,
	}

	data, err := json.Marshal(evt)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	var decoded GenericEvent
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}

	if decoded.Type != "progress" {
		t.Errorf("expected type progress, got %q", decoded.Type)
	}
	if decoded.Step != "Fetching repos" {
		t.Errorf("expected step, got %q", decoded.Step)
	}
	if decoded.Progress == nil || *decoded.Progress != 0.5 {
		t.Error("expected progress 0.5")
	}
}

// ---------------------------------------------------------------------------
// LoadSavedConfig additional tests
// ---------------------------------------------------------------------------

func TestLoadSavedConfig_MissingFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	cfg, err := LoadSavedConfig()
	if err == nil {
		t.Error("expected error for missing config file")
	}
	if cfg != nil {
		t.Error("expected nil config for missing file")
	}
}

func TestLoadSavedConfig_InvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "config.json"), []byte("not valid json{{{"), 0o644)

	cfg, err := LoadSavedConfig()
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
	if cfg != nil {
		t.Error("expected nil config for invalid JSON")
	}
}

func TestLoadSavedConfig_EmptyOrg(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	cfgJSON := `{"org":"","members":[],"repos":[],"useAllRepos":true,"sections":{"dataSources":{"git":true},"reportSections":{}}}`
	os.WriteFile(filepath.Join(configPath, "config.json"), []byte(cfgJSON), 0o644)

	cfg, err := LoadSavedConfig()
	if err != nil {
		t.Fatalf("LoadSavedConfig failed: %v", err)
	}
	// Empty org should return nil, nil
	if cfg != nil {
		t.Error("expected nil config when org is empty")
	}
}

func TestLoadSavedConfig_EmptyFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "config.json"), []byte(""), 0o644)

	cfg, err := LoadSavedConfig()
	if err == nil {
		t.Error("expected error for empty file")
	}
	if cfg != nil {
		t.Error("expected nil config for empty file")
	}
}

func TestLoadSavedConfig_ValidConfig(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	cfgJSON := `{"org":"my-org","members":["alice"],"repos":["api"],"useAllRepos":false,"includeBots":true,"excludePrivate":true,"sections":{"dataSources":{"git":true,"asana":false},"reportSections":{"individualContributions":true}}}`
	os.WriteFile(filepath.Join(configPath, "config.json"), []byte(cfgJSON), 0o644)

	cfg, err := LoadSavedConfig()
	if err != nil {
		t.Fatalf("LoadSavedConfig failed: %v", err)
	}
	if cfg == nil {
		t.Fatal("expected non-nil config")
	}
	if cfg.Org != "my-org" {
		t.Errorf("expected org=my-org, got %q", cfg.Org)
	}
	if !cfg.IncludeBots {
		t.Error("expected IncludeBots=true")
	}
	if !cfg.ExcludePrivate {
		t.Error("expected ExcludePrivate=true")
	}
	if len(cfg.Members) != 1 || cfg.Members[0] != "alice" {
		t.Errorf("expected members=[alice], got %v", cfg.Members)
	}
	if len(cfg.Repos) != 1 || cfg.Repos[0] != "api" {
		t.Errorf("expected repos=[api], got %v", cfg.Repos)
	}
}

// ---------------------------------------------------------------------------
// SaveConfig additional tests
// ---------------------------------------------------------------------------

func TestSaveConfig_CreatesDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	// config dir should not exist yet
	configPath := filepath.Join(tmpDir, "teamhero")
	if _, err := os.Stat(configPath); !os.IsNotExist(err) {
		t.Skip("config dir already exists, cannot test creation")
	}

	cfg := DefaultConfig()
	cfg.Org = "test"
	if err := SaveConfig(&cfg); err != nil {
		t.Fatalf("SaveConfig failed: %v", err)
	}

	if _, err := os.Stat(filepath.Join(configPath, "config.json")); err != nil {
		t.Errorf("expected config.json to exist after save, got %v", err)
	}
}

func TestSaveConfig_OverwritesExisting(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	cfg1 := DefaultConfig()
	cfg1.Org = "first-org"
	SaveConfig(&cfg1)

	cfg2 := DefaultConfig()
	cfg2.Org = "second-org"
	SaveConfig(&cfg2)

	loaded, err := LoadSavedConfig()
	if err != nil {
		t.Fatalf("LoadSavedConfig failed: %v", err)
	}
	if loaded.Org != "second-org" {
		t.Errorf("expected org=second-org after overwrite, got %q", loaded.Org)
	}
}

func TestSaveConfig_RoundtripPreservesFields(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	maxCommit := 10
	maxPr := 5
	cfg := ReportConfig{
		Org:              "test-org",
		Team:             "engineering",
		Members:          []string{"alice", "bob"},
		Repos:            []string{"api", "web"},
		UseAllRepos:      false,
		Since:            "2026-01-01",
		Until:            "2026-01-07",
		IncludeBots:      true,
		ExcludePrivate:   true,
		IncludeArchived:  true,
		Detailed:         true,
		MaxCommitPages:   &maxCommit,
		MaxPrPages:       &maxPr,
		Sequential:       true,
		ConfirmBeforeRun: false,
		DiscrepancyThreshold:    50,
		Sections: ReportSections{
			DataSources:    DataSources{Git: true, Asana: true},
			ReportSections: ReportSectionsInner{IndividualContributions: true, VisibleWins: true, DiscrepancyLog: true, Loc: true},
		},
	}

	if err := SaveConfig(&cfg); err != nil {
		t.Fatalf("SaveConfig failed: %v", err)
	}

	loaded, err := LoadSavedConfig()
	if err != nil {
		t.Fatalf("LoadSavedConfig failed: %v", err)
	}

	if loaded.Org != cfg.Org {
		t.Errorf("Org: got %q, want %q", loaded.Org, cfg.Org)
	}
	if loaded.Team != cfg.Team {
		t.Errorf("Team: got %q, want %q", loaded.Team, cfg.Team)
	}
	if len(loaded.Members) != 2 {
		t.Errorf("Members: got %d, want 2", len(loaded.Members))
	}
	if loaded.IncludeBots != cfg.IncludeBots {
		t.Errorf("IncludeBots: got %v, want %v", loaded.IncludeBots, cfg.IncludeBots)
	}
	if loaded.ExcludePrivate != cfg.ExcludePrivate {
		t.Errorf("ExcludePrivate: got %v, want %v", loaded.ExcludePrivate, cfg.ExcludePrivate)
	}
	if loaded.IncludeArchived != cfg.IncludeArchived {
		t.Errorf("IncludeArchived: got %v, want %v", loaded.IncludeArchived, cfg.IncludeArchived)
	}
	if loaded.Detailed != cfg.Detailed {
		t.Errorf("Detailed: got %v, want %v", loaded.Detailed, cfg.Detailed)
	}
	if loaded.Sequential != cfg.Sequential {
		t.Errorf("Sequential: got %v, want %v", loaded.Sequential, cfg.Sequential)
	}
	if loaded.DiscrepancyThreshold != cfg.DiscrepancyThreshold {
		t.Errorf("DiscrepancyThreshold: got %d, want %d", loaded.DiscrepancyThreshold, cfg.DiscrepancyThreshold)
	}
	if loaded.MaxCommitPages == nil || *loaded.MaxCommitPages != 10 {
		t.Errorf("MaxCommitPages: got %v, want 10", loaded.MaxCommitPages)
	}
	if loaded.MaxPrPages == nil || *loaded.MaxPrPages != 5 {
		t.Errorf("MaxPrPages: got %v, want 5", loaded.MaxPrPages)
	}
	if !loaded.Sections.DataSources.Asana {
		t.Error("expected Asana=true after roundtrip")
	}
	if !loaded.Sections.ReportSections.Loc {
		t.Error("expected Loc=true after roundtrip")
	}
	if !loaded.Sections.ReportSections.DiscrepancyLog {
		t.Error("expected DiscrepancyLog=true after roundtrip")
	}
}

// ---------------------------------------------------------------------------
// ToCommandInput additional tests
// ---------------------------------------------------------------------------

func TestToCommandInput_WithTeamAndMembers(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	cfg.Team = "engineering"
	cfg.Members = []string{} // no members (using team)

	input := cfg.ToCommandInput("headless")

	if input.Team != "engineering" {
		t.Errorf("expected team=engineering, got %q", input.Team)
	}
	if input.Members != nil {
		t.Errorf("expected nil members when empty, got %v", input.Members)
	}
}

func TestToCommandInput_SequentialPointer(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	cfg.Sequential = true

	input := cfg.ToCommandInput("headless")

	if input.Sequential == nil {
		t.Fatal("expected Sequential to be non-nil")
	}
	if !*input.Sequential {
		t.Error("expected Sequential=true")
	}
}

func TestToCommandInput_DiscrepancyThresholdPointer(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	cfg.DiscrepancyThreshold = 70

	input := cfg.ToCommandInput("headless")

	if input.DiscrepancyThreshold == nil {
		t.Fatal("expected DiscrepancyThreshold to be non-nil")
	}
	if *input.DiscrepancyThreshold != 70 {
		t.Errorf("expected DiscrepancyThreshold=70, got %d", *input.DiscrepancyThreshold)
	}
}

func TestToCommandInput_MaxPages(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	maxCommit := 15
	maxPr := 8
	cfg.MaxCommitPages = &maxCommit
	cfg.MaxPrPages = &maxPr

	input := cfg.ToCommandInput("headless")

	if input.MaxCommitPages == nil || *input.MaxCommitPages != 15 {
		t.Errorf("expected MaxCommitPages=15, got %v", input.MaxCommitPages)
	}
	if input.MaxPrPages == nil || *input.MaxPrPages != 8 {
		t.Errorf("expected MaxPrPages=8, got %v", input.MaxPrPages)
	}
}

func TestToCommandInput_NilMaxPages(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"

	input := cfg.ToCommandInput("headless")

	if input.MaxCommitPages != nil {
		t.Errorf("expected nil MaxCommitPages, got %v", input.MaxCommitPages)
	}
	if input.MaxPrPages != nil {
		t.Errorf("expected nil MaxPrPages, got %v", input.MaxPrPages)
	}
}

func TestToCommandInput_FlushCacheFromConfig(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	cfg.FlushCache = "metrics,loc"

	input := cfg.ToCommandInput("headless")

	if input.FlushCache != "metrics,loc" {
		t.Errorf("expected FlushCache=metrics,loc, got %q", input.FlushCache)
	}
}

func TestToCommandInput_AllBooleanFlags(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	cfg.IncludeBots = true
	cfg.ExcludePrivate = true
	cfg.IncludeArchived = true
	cfg.Detailed = true

	input := cfg.ToCommandInput("headless")

	if !input.IncludeBots {
		t.Error("expected IncludeBots=true")
	}
	if !input.ExcludePrivate {
		t.Error("expected ExcludePrivate=true")
	}
	if !input.IncludeArchived {
		t.Error("expected IncludeArchived=true")
	}
	if !input.Detailed {
		t.Error("expected Detailed=true")
	}
}

func TestToCommandInput_Sections(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	cfg.Sections = ReportSections{
		DataSources:    DataSources{Git: true, Asana: true},
		ReportSections: ReportSectionsInner{IndividualContributions: true, VisibleWins: true, Loc: true, DiscrepancyLog: true},
	}

	input := cfg.ToCommandInput("interactive")

	if !input.Sections.DataSources.Git {
		t.Error("expected Git=true in input")
	}
	if !input.Sections.DataSources.Asana {
		t.Error("expected Asana=true in input")
	}
	if !input.Sections.ReportSections.IndividualContributions {
		t.Error("expected IndividualContributions=true in input")
	}
	if !input.Sections.ReportSections.VisibleWins {
		t.Error("expected VisibleWins=true in input")
	}
	if !input.Sections.ReportSections.Loc {
		t.Error("expected Loc=true in input")
	}
	if !input.Sections.ReportSections.DiscrepancyLog {
		t.Error("expected DiscrepancyLog=true in input")
	}
}

func TestToCommandInput_NoReposWhenUseAll(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	cfg.UseAllRepos = true
	cfg.Repos = []string{"api", "web"}

	input := cfg.ToCommandInput("headless")

	if input.Repos != nil {
		t.Errorf("expected nil Repos when UseAllRepos=true, got %v", input.Repos)
	}
}

func TestToCommandInput_ReposWhenNotUseAll(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	cfg.UseAllRepos = false
	cfg.Repos = []string{"api", "web"}

	input := cfg.ToCommandInput("headless")

	if len(input.Repos) != 2 {
		t.Errorf("expected 2 Repos, got %d", len(input.Repos))
	}
}

func TestToCommandInput_EmptyReposWhenNotUseAll(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	cfg.UseAllRepos = false
	cfg.Repos = []string{}

	input := cfg.ToCommandInput("headless")

	// Empty repos + not UseAll = repos should be nil (condition: len > 0)
	if input.Repos != nil {
		t.Errorf("expected nil Repos for empty slice, got %v", input.Repos)
	}
}

// ---------------------------------------------------------------------------
// configDir tests
// ---------------------------------------------------------------------------

func TestConfigDir_XDGOverride(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	got := configDir()
	expected := filepath.Join(tmpDir, "teamhero")
	if got != expected {
		t.Errorf("configDir() = %q, want %q", got, expected)
	}
}

func TestConfigDir_DefaultPath(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", "")

	got := configDir()
	// Should contain "teamhero" in the path
	if !filepath.IsAbs(got) {
		t.Errorf("configDir() = %q, expected absolute path", got)
	}
	if filepath.Base(got) != "teamhero" {
		t.Errorf("configDir() base = %q, want teamhero", filepath.Base(got))
	}
}

func TestConfigFilePath(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	got := configFilePath()
	expected := filepath.Join(tmpDir, "teamhero", "config.json")
	if got != expected {
		t.Errorf("configFilePath() = %q, want %q", got, expected)
	}
}

// ===========================================================================
// hasAsanaToken edge case: env var set (line 39-41)
// ===========================================================================

func TestHasAsanaToken_FromEnv(t *testing.T) {
	t.Setenv("ASANA_API_TOKEN", "test_asana_token")
	if !hasAsanaToken() {
		t.Error("expected hasAsanaToken=true when ASANA_API_TOKEN env var is set")
	}
}

// ===========================================================================
// SaveConfig: error path when dir creation fails (lines 152-154)
// ===========================================================================

func TestSaveConfig_Succeeds(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	cfg := DefaultConfig()
	cfg.Org = "test-org"
	if err := SaveConfig(&cfg); err != nil {
		t.Fatalf("SaveConfig failed: %v", err)
	}
	// Verify file was written
	path := filepath.Join(tmpDir, "teamhero", "config.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("expected config.json to exist: %v", err)
	}
	var read json.RawMessage
	if err := json.Unmarshal(data, &read); err != nil {
		t.Errorf("expected valid JSON, got %v", err)
	}
}

// ===========================================================================
// ToCommandInput: covers flagFlushCache, flagOutput, non-allRepos, members paths
// ===========================================================================

func TestToCommandInput_NonAllRepos(t *testing.T) {
	cfg := DefaultConfig()
	cfg.UseAllRepos = false
	cfg.Repos = []string{"repo1", "repo2"}
	cfg.Org = "myorg"

	input := cfg.ToCommandInput("test")
	if len(input.Repos) != 2 {
		t.Errorf("expected 2 repos in input, got %d", len(input.Repos))
	}
}

func TestToCommandInput_WithMembers(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Members = []string{"alice", "bob"}

	input := cfg.ToCommandInput("test")
	if len(input.Members) != 2 {
		t.Errorf("expected 2 members in input, got %d", len(input.Members))
	}
}

// ===========================================================================
// ToCommandInput: flag-set branches (covers flagWasSet true paths)
// ===========================================================================

func TestToCommandInput_FlushCacheFlagSet(t *testing.T) {
	// flag.Set marks the flag as visited, so flagWasSet returns true
	if err := flag.Set("flush-cache", "all"); err != nil {
		t.Skip("could not set flush-cache flag:", err)
	}
	t.Cleanup(func() { flag.Set("flush-cache", "") })

	c := DefaultConfig()
	c.FlushCache = "" // ensure c.FlushCache branch not taken
	input := c.ToCommandInput("full")
	if input.FlushCache != "all" {
		t.Errorf("expected FlushCache=all, got %q", input.FlushCache)
	}
}

func TestToCommandInput_OutputFlagSet(t *testing.T) {
	if err := flag.Set("output", "/tmp/test-report.md"); err != nil {
		t.Skip("could not set output flag:", err)
	}
	t.Cleanup(func() { flag.Set("output", "") })

	c := DefaultConfig()
	input := c.ToCommandInput("full")
	if input.OutputPath != "/tmp/test-report.md" {
		t.Errorf("expected OutputPath=/tmp/test-report.md, got %q", input.OutputPath)
	}
}

func TestToCommandInput_OutputFormatFlagSet(t *testing.T) {
	if err := flag.Set("output-format", "json"); err != nil {
		t.Skip("could not set output-format flag:", err)
	}
	t.Cleanup(func() { flag.Set("output-format", "") })

	c := DefaultConfig()
	input := c.ToCommandInput("full")
	if input.OutputFormat != "json" {
		t.Errorf("expected OutputFormat=json, got %q", input.OutputFormat)
	}
}
