package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAutoDetectJiraField(t *testing.T) {
	team := autoDetectJiraField("PT", true)
	if team.FieldID != "customfield_10617" || team.JqlName != "Story point estimate" {
		t.Errorf("team-managed: got %+v", team)
	}
	company := autoDetectJiraField("SPVR", false)
	if company.FieldID != "customfield_10005" || company.JqlName != "Story Points[Number]" {
		t.Errorf("company-managed: got %+v", company)
	}
}

func TestBuildJiraConfigFromProjects(t *testing.T) {
	cfg := buildJiraConfigFromProjects([]JiraProject{
		{Key: "PT", Simplified: true},
		{Key: "SPVR", Simplified: false},
	})
	if len(cfg.Projects) != 2 {
		t.Fatalf("expected 2 projects, got %d", len(cfg.Projects))
	}
	if cfg.Projects[0].FieldID != "customfield_10617" {
		t.Errorf("PT should auto-detect team-managed field, got %s", cfg.Projects[0].FieldID)
	}
	if cfg.Projects[1].FieldID != "customfield_10005" {
		t.Errorf("SPVR should auto-detect company-managed field, got %s", cfg.Projects[1].FieldID)
	}
}

func TestWriteAndLoadJiraConfig(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", dir)

	if err := WriteJiraConfig(JiraConfig{
		Projects: []JiraProjectField{
			{Key: "PT", FieldID: "customfield_10617", JqlName: "Story point estimate"},
		},
		IssueTypes: []string{"Story", "Task"},
	}); err != nil {
		t.Fatalf("WriteJiraConfig: %v", err)
	}

	// File lands under <configDir>/jira-config.json
	if _, err := os.Stat(filepath.Join(configDir(), "jira-config.json")); err != nil {
		t.Fatalf("jira-config.json not written: %v", err)
	}

	cfg, err := LoadJiraConfig()
	if err != nil {
		t.Fatalf("LoadJiraConfig: %v", err)
	}
	if cfg == nil || len(cfg.Projects) != 1 || cfg.Projects[0].Key != "PT" {
		t.Fatalf("round-trip mismatch: %+v", cfg)
	}
}

func TestLoadJiraConfig_AbsentReturnsNil(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", dir)
	cfg, err := LoadJiraConfig()
	if err != nil || cfg != nil {
		t.Fatalf("absent config should be (nil, nil), got cfg=%+v err=%v", cfg, err)
	}
}

func TestLoadJiraConfig_EmptyProjectsErrors(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", dir)
	_ = os.MkdirAll(configDir(), 0o755)
	_ = os.WriteFile(filepath.Join(configDir(), "jira-config.json"), []byte(`{"projects":[]}`), 0o644)
	if _, err := LoadJiraConfig(); err == nil {
		t.Fatal("expected error for empty projects array")
	}
}

func TestCheckJiraConfig(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", dir)

	// Absent → passing warning
	c := checkJiraConfig()
	if !c.Passed || !c.Warning {
		t.Errorf("absent config: expected passing warning, got %+v", c)
	}

	// Valid → passing, no warning
	_ = WriteJiraConfig(JiraConfig{Projects: []JiraProjectField{
		{Key: "PT", FieldID: "customfield_10617", JqlName: "Story point estimate"},
	}})
	c = checkJiraConfig()
	if !c.Passed || c.Warning {
		t.Errorf("valid config: expected clean pass, got %+v", c)
	}

	// Malformed → fail
	_ = os.WriteFile(filepath.Join(configDir(), "jira-config.json"), []byte("{ bad"), 0o644)
	c = checkJiraConfig()
	if c.Passed {
		t.Errorf("malformed config: expected failure, got %+v", c)
	}
}

func TestBuildJiraConfigFromSpec(t *testing.T) {
	cfg, err := buildJiraConfigFromSpec([]string{"PT:team", "SPVR:company", "FOZ"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(cfg.Projects) != 3 {
		t.Fatalf("expected 3 projects, got %d", len(cfg.Projects))
	}
	if cfg.Projects[0].FieldID != "customfield_10617" {
		t.Errorf("PT:team should be team-managed, got %s", cfg.Projects[0].FieldID)
	}
	if cfg.Projects[1].FieldID != "customfield_10005" || cfg.Projects[2].FieldID != "customfield_10005" {
		t.Errorf("company/default should be company-managed: %+v", cfg.Projects)
	}
}

func TestBuildJiraConfigFromSpec_Errors(t *testing.T) {
	if _, err := buildJiraConfigFromSpec([]string{"PT:bogus"}); err == nil {
		t.Error("expected error for unknown project type")
	}
	if _, err := buildJiraConfigFromSpec([]string{"", "  "}); err == nil {
		t.Error("expected error when no valid projects")
	}
}
