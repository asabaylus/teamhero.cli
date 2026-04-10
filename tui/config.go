package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

// ExpressConfig returns a minimal config for first-time users.
// Asana and LOC are disabled so the user only needs GitHub + OpenAI credentials.
func ExpressConfig() ReportConfig {
	return ReportConfig{
		Members:     []string{},
		Repos:       []string{},
		UseAllRepos: true,
		Sections: ReportSections{
			DataSources:    DataSources{Git: true, Asana: false},
			ReportSections: ReportSectionsInner{IndividualContributions: true, VisibleWins: false},
		},
		ConfirmBeforeRun: true,
		DiscrepancyThreshold:    30,
	}
}

// HasCredentials checks whether the .env file contains both required
// credentials (GitHub token + OpenAI key) for a minimal report run.
func HasCredentials() bool {
	envPath := filepath.Join(configDir(), ".env")
	creds := loadExistingCredentials(envPath)
	return creds["GITHUB_PERSONAL_ACCESS_TOKEN"] != "" && creds["OPENAI_API_KEY"] != ""
}

// hasAsanaToken returns true if an Asana API token is available,
// either from environment variables, the .env file, or OAuth tokens.
func hasAsanaToken() bool {
	if os.Getenv("ASANA_API_TOKEN") != "" {
		return true
	}
	envPath := filepath.Join(configDir(), ".env")
	creds := loadExistingCredentials(envPath)
	if creds["ASANA_API_TOKEN"] != "" {
		return true
	}
	// Check for OAuth tokens
	tokenPath := filepath.Join(configDir(), "asana-tokens.json")
	data, err := os.ReadFile(tokenPath)
	if err != nil {
		return false
	}
	return strings.Contains(string(data), "refresh_token")
}

// ReportConfig mirrors the TypeScript ReportCommandInput shape.
type ReportConfig struct {
	Org              string          `json:"org"`
	Team             string          `json:"team,omitempty"`
	Members          []string        `json:"members"`
	Repos            []string        `json:"repos"`
	UseAllRepos      bool            `json:"useAllRepos"`
	Since            string          `json:"since,omitempty"`
	Until            string          `json:"until,omitempty"`
	IncludeBots      bool            `json:"includeBots"`
	ExcludePrivate   bool            `json:"excludePrivate"`
	IncludeArchived  bool            `json:"includeArchived"`
	Detailed         bool            `json:"detailed"`
	MaxCommitPages   *int            `json:"maxCommitPages,omitempty"`
	MaxPrPages       *int            `json:"maxPrPages,omitempty"`
	Sections         ReportSections  `json:"sections"`
	Sequential       bool            `json:"sequential"`
	ConfirmBeforeRun bool            `json:"confirmBeforeRun"`
	DiscrepancyThreshold    int             `json:"discrepancyThreshold"`
	Template                string          `json:"template,omitempty"`

	// Transient fields — not persisted to config.json
	FlushCache  string `json:"-"` // wizard cache flush choice (e.g. "all", "all:since=2026-02-20")
	AIProvider  string `json:"-"` // e.g. "OpenAI"
	AIModel     string `json:"-"` // e.g. "gpt-5-mini"
	ServiceTier string `json:"-"` // e.g. "flex" or ""
}

// ReportSections maps to the nested sections structure.
type ReportSections struct {
	DataSources    DataSources    `json:"dataSources"`
	ReportSections ReportSectionsInner `json:"reportSections"`
}

// DataSources toggles for data collection.
type DataSources struct {
	Git   bool `json:"git"`
	Asana bool `json:"asana"`
}

// ReportSectionsInner toggles for report output sections.
type ReportSectionsInner struct {
	VisibleWins             bool `json:"visibleWins"`
	IndividualContributions bool `json:"individualContributions"`
	DiscrepancyLog          bool `json:"discrepancyLog,omitempty"`
	Loc                     bool `json:"loc,omitempty"`
	WeeklyWins              bool `json:"weeklyWins,omitempty"`
}

// ReportCommandInput is the JSON payload sent to the TypeScript service runner via stdin.
type ReportCommandInput struct {
	Org             string         `json:"org"`
	Team            string         `json:"team,omitempty"`
	Members         []string       `json:"members,omitempty"`
	Repos           []string       `json:"repos,omitempty"`
	Since           string         `json:"since,omitempty"`
	Until           string         `json:"until,omitempty"`
	IncludeBots     bool           `json:"includeBots"`
	ExcludePrivate  bool           `json:"excludePrivate"`
	IncludeArchived bool           `json:"includeArchived"`
	Detailed        bool           `json:"detailed"`
	MaxCommitPages  *int           `json:"maxCommitPages,omitempty"`
	MaxPrPages      *int           `json:"maxPrPages,omitempty"`
	Sections        ReportSections `json:"sections"`
	Sequential      *bool          `json:"sequential,omitempty"`
	DiscrepancyThreshold   *int           `json:"discrepancyThreshold,omitempty"`
	FlushCache      string         `json:"flushCache,omitempty"`
	Mode            string         `json:"mode,omitempty"`
	OutputPath      string         `json:"outputPath,omitempty"`
	OutputFormat    string         `json:"outputFormat,omitempty"`
	Template        string         `json:"template,omitempty"`
}

// configDir returns the XDG-compatible config directory for teamhero.
func configDir() string {
	if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
		return filepath.Join(xdg, "teamhero")
	}
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "darwin" {
		return filepath.Join(home, "Library", "Preferences", "teamhero")
	}
	return filepath.Join(home, ".config", "teamhero")
}

func configFilePath() string {
	return filepath.Join(configDir(), "config.json")
}

// LoadSavedConfig reads the saved configuration file.
func LoadSavedConfig() (*ReportConfig, error) {
	data, err := os.ReadFile(configFilePath())
	if err != nil {
		return nil, err
	}
	var cfg ReportConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	if cfg.Org == "" {
		return nil, nil
	}
	return &cfg, nil
}

// SaveConfig writes the configuration to disk.
func SaveConfig(cfg *ReportConfig) error {
	dir := configDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configFilePath(), data, 0o644)
}

// DefaultConfig returns a config with sensible defaults.
// Checks both environment variables and the .env file for overrides
// (env vars take precedence over .env values).
func DefaultConfig() ReportConfig {
	cfg := ReportConfig{
		Members:     []string{},
		Repos:       []string{},
		UseAllRepos: true,
		Sections: ReportSections{
			DataSources:    DataSources{Git: true, Asana: true},
			ReportSections: ReportSectionsInner{IndividualContributions: true},
		},
		ConfirmBeforeRun: true,
		DiscrepancyThreshold:    30,
	}

	applyEnvTuningOverrides(&cfg)
	return cfg
}

// applyEnvTuningOverrides applies .env tuning parameters on top of any config.
// These are "knob" settings managed via `teamhero setup` and stored in .env,
// not in config.json. Must be called after loading saved config to ensure
// .env values always take precedence over stale config.json values.
func applyEnvTuningOverrides(cfg *ReportConfig) {
	dotenv := loadExistingCredentials(filepath.Join(configDir(), ".env"))

	// TEAMHERO_SEQUENTIAL: env var > .env > default (false)
	if seq := firstNonEmptyStr(os.Getenv("TEAMHERO_SEQUENTIAL"), dotenv["TEAMHERO_SEQUENTIAL"]); seq != "" {
		lower := strings.ToLower(seq)
		if lower == "1" || lower == "true" || lower == "yes" || lower == "on" {
			cfg.Sequential = true
		}
	}
	// TEAMHERO_DISCREPANCY_CONFIDENCE_THRESHOLD: env var > .env > default (30)
	if dt := firstNonEmptyStr(
		os.Getenv("TEAMHERO_DISCREPANCY_CONFIDENCE_THRESHOLD"),
		dotenv["TEAMHERO_DISCREPANCY_CONFIDENCE_THRESHOLD"],
	); dt != "" {
		if v, err := strconv.Atoi(dt); err == nil {
			cfg.DiscrepancyThreshold = v
		}
	}
}

// firstNonEmptyStr returns the first non-empty string argument.
func firstNonEmptyStr(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// ToCommandInput converts a ReportConfig to the service runner input shape.
func (c *ReportConfig) ToCommandInput(mode string) ReportCommandInput {
	input := ReportCommandInput{
		Org:             c.Org,
		Team:            c.Team,
		Since:           c.Since,
		Until:           c.Until,
		IncludeBots:     c.IncludeBots,
		ExcludePrivate:  c.ExcludePrivate,
		IncludeArchived: c.IncludeArchived,
		Detailed:        c.Detailed,
		MaxCommitPages:  c.MaxCommitPages,
		MaxPrPages:      c.MaxPrPages,
		Sections:        c.Sections,
		Mode:            mode,
	}
	input.Sequential = &c.Sequential
	v := c.DiscrepancyThreshold
	input.DiscrepancyThreshold = &v
	// Pass through flush-cache: CLI flag takes precedence over wizard choice
	if flagWasSet("flush-cache") && *flagFlushCache != "" {
		input.FlushCache = *flagFlushCache
	} else if c.FlushCache != "" {
		input.FlushCache = c.FlushCache
	}
	// Pass through --output if set
	if flagWasSet("output") && *flagOutput != "" {
		input.OutputPath = *flagOutput
	}
	// Pass through --output-format if set
	if flagWasSet("output-format") && *flagOutputFormat != "" {
		input.OutputFormat = *flagOutputFormat
	}
	// Pass through --template if set
	if flagWasSet("template") && *flagTemplate != "" {
		input.Template = *flagTemplate
	} else if c.Template != "" {
		input.Template = c.Template
	}
	if !c.UseAllRepos && len(c.Repos) > 0 {
		input.Repos = c.Repos
	}
	if len(c.Members) > 0 {
		input.Members = c.Members
	}
	return input
}
