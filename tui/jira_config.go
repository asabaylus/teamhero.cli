package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// JiraProjectField is the persisted per-project story-point field selection.
// Mirrors the TS JiraProjectFieldConfig consumed by jira-config-loader.ts.
type JiraProjectField struct {
	Key     string `json:"key"`
	FieldID string `json:"fieldId"`
	JqlName string `json:"jqlName"`
}

// JiraConfig is the on-disk shape of jira-config.json.
type JiraConfig struct {
	Projects   []JiraProjectField `json:"projects"`
	IssueTypes []string           `json:"issueTypes,omitempty"`
	CreditBy   string             `json:"creditBy,omitempty"`
}

// JiraProject is a project as discovered from the Jira API during setup.
type JiraProject struct {
	Key        string
	Name       string
	Simplified bool // team-managed when true
}

const (
	companyManagedFieldID = "customfield_10005"
	companyManagedJQLName = "Story Points[Number]"
	teamManagedFieldID    = "customfield_10617"
	teamManagedJQLName    = "Story point estimate"
)

// autoDetectJiraField pre-selects the likely story-point field for a project
// from its `simplified` flag: team-managed projects use the team-managed field,
// company-managed projects use the company-managed default. The user can
// override the result during setup.
func autoDetectJiraField(key string, simplified bool) JiraProjectField {
	if simplified {
		return JiraProjectField{Key: key, FieldID: teamManagedFieldID, JqlName: teamManagedJQLName}
	}
	return JiraProjectField{Key: key, FieldID: companyManagedFieldID, JqlName: companyManagedJQLName}
}

// buildJiraConfigFromProjects assembles a JiraConfig from the selected projects,
// auto-detecting each field. Pure and testable; the interactive picker calls it
// after the user selects projects (and may override individual fields).
func buildJiraConfigFromProjects(projects []JiraProject) JiraConfig {
	fields := make([]JiraProjectField, 0, len(projects))
	for _, p := range projects {
		fields = append(fields, autoDetectJiraField(p.Key, p.Simplified))
	}
	return JiraConfig{Projects: fields}
}

// buildJiraConfigFromSpec parses a headless project spec into a JiraConfig.
// Each entry is "KEY" or "KEY:team" / "KEY:company" (default company-managed),
// auto-detecting the story-point field. Lets users configure story points
// without the interactive picker (e.g. `teamhero setup --jira-projects PT:team,SPVR`).
func buildJiraConfigFromSpec(specs []string) (JiraConfig, error) {
	projects := make([]JiraProject, 0, len(specs))
	for _, s := range specs {
		parts := strings.SplitN(s, ":", 2)
		key := strings.TrimSpace(parts[0])
		if key == "" {
			continue
		}
		simplified := false
		if len(parts) == 2 {
			switch strings.ToLower(strings.TrimSpace(parts[1])) {
			case "team", "team-managed", "simplified":
				simplified = true
			case "company", "company-managed", "":
				simplified = false
			default:
				return JiraConfig{}, fmt.Errorf("unknown project type %q for %s (use team|company)", parts[1], key)
			}
		}
		projects = append(projects, JiraProject{Key: key, Simplified: simplified})
	}
	if len(projects) == 0 {
		return JiraConfig{}, fmt.Errorf("no Jira projects specified")
	}
	return buildJiraConfigFromProjects(projects), nil
}

func jiraConfigPath() string {
	return filepath.Join(configDir(), "jira-config.json")
}

// WriteJiraConfig persists the config to jira-config.json.
func WriteJiraConfig(cfg JiraConfig) error {
	if err := os.MkdirAll(configDir(), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(jiraConfigPath(), data, 0o644)
}

// LoadJiraConfig reads jira-config.json. Returns (nil, nil) when absent so a
// report run can apply the report-time guard. Returns an error when malformed.
func LoadJiraConfig() (*JiraConfig, error) {
	data, err := os.ReadFile(jiraConfigPath())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var cfg JiraConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("invalid jira-config.json: %w", err)
	}
	if len(cfg.Projects) == 0 {
		return nil, fmt.Errorf("invalid jira-config.json: \"projects\" is empty")
	}
	for i, p := range cfg.Projects {
		if p.Key == "" || p.FieldID == "" || p.JqlName == "" {
			return nil, fmt.Errorf("invalid jira-config.json: projects[%d] missing key/fieldId/jqlName", i)
		}
	}
	return &cfg, nil
}
