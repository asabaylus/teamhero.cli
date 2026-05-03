package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// AssessConfig mirrors src/services/maturity/types.ts::AssessCommandInput.
// It is sent as the first JSON line on stdin to the run-assess.ts service runner.
type AssessConfig struct {
	Scope                 AssessScope `json:"scope"`
	EvidenceTier          string      `json:"evidenceTier,omitempty"`
	InterviewAnswersPath  string      `json:"interviewAnswersPath,omitempty"`
	OutputPath            string      `json:"outputPath,omitempty"`
	OutputFormat          string      `json:"outputFormat,omitempty"`
	FlushCache            bool        `json:"flushCache,omitempty"`
	DryRun                bool        `json:"dryRun,omitempty"`
	Mode                  string      `json:"mode,omitempty"`
	InteractiveInterview  bool        `json:"interactiveInterview,omitempty"`
}

// AssessScope mirrors ScopeDescriptor.
type AssessScope struct {
	Mode        string   `json:"mode"`
	Org         string   `json:"org,omitempty"`
	Repos       []string `json:"repos,omitempty"`
	LocalPath   string   `json:"localPath,omitempty"`
	DisplayName string   `json:"displayName"`
}

// assessConfigPath returns ~/.config/teamhero/assess-config.json (XDG-compliant).
func assessConfigPath() string {
	return filepath.Join(configDir(), "assess-config.json")
}

// LoadAssessConfig reads the saved assess configuration. Returns nil with no
// error if the file does not exist.
func LoadAssessConfig() (*AssessConfig, error) {
	data, err := os.ReadFile(assessConfigPath())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var cfg AssessConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// SaveAssessConfig persists the assess configuration to disk.
func SaveAssessConfig(cfg *AssessConfig) error {
	if err := os.MkdirAll(filepath.Dir(assessConfigPath()), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(assessConfigPath(), data, 0o600)
}

// DefaultAssessConfig returns a sensible starting config for a new user.
func DefaultAssessConfig() AssessConfig {
	cwd, _ := os.Getwd()
	return AssessConfig{
		Scope: AssessScope{
			Mode:        "local-repo",
			LocalPath:   cwd,
			DisplayName: filepath.Base(cwd),
		},
		EvidenceTier: "auto",
		OutputFormat: "both",
	}
}
