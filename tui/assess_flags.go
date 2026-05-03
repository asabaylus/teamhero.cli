package main

import (
	"flag"
	"path/filepath"
	"strings"
)

// Assess-specific flag set, parsed independently from the report flag set so
// the two subcommands don't interfere.
var (
	flagAssessScopeMode      = flag.String("scope-mode", "", "Assess scope mode: org | local-repo | both")
	flagAssessOrg            = flag.String("target-org", "", "GitHub org to assess (when scope-mode=org or both)")
	flagAssessRepos          = flag.String("target-repos", "", "Comma-separated repo names to assess (optional)")
	flagAssessPath           = flag.String("path", "", "Local repo path to assess (when scope-mode=local-repo or both)")
	flagAssessDisplayName    = flag.String("display-name", "", "Override the audit's scope display name")
	flagAssessTier           = flag.String("evidence-tier", "", "Override evidence-tier detection: auto | gh | github-mcp | git-only")
	flagAssessAnswers        = flag.String("interview-answers", "", "Path to a JSON file with pre-supplied interview answers (headless)")
	flagAssessOutput         = flag.String("audit-output", "", "Output file path (default: timestamped in current directory)")
	flagAssessOutputFormat   = flag.String("audit-output-format", "", "Output format: markdown | json | both (default: both)")
	flagAssessDryRun         = flag.Bool("dry-run", false, "Skip the AI scorer (writes a placeholder audit)")
	flagAssessFlushCache     = flag.Bool("flush-assess-cache", false, "Flush the maturity-assessment cache before running")
	flagAssessShowConfig     = flag.Bool("show-assess-config", false, "Print saved assess configuration as JSON and exit")
)

// applyAssessFlagsTo merges explicitly-set CLI flags into cfg.
func applyAssessFlagsTo(cfg *AssessConfig, wasSet func(string) bool) {
	if wasSet("scope-mode") {
		cfg.Scope.Mode = strings.TrimSpace(*flagAssessScopeMode)
	}
	if wasSet("target-org") {
		cfg.Scope.Org = strings.TrimSpace(*flagAssessOrg)
	}
	if wasSet("target-repos") {
		cfg.Scope.Repos = splitCSV(*flagAssessRepos)
	}
	if wasSet("path") {
		cfg.Scope.LocalPath = strings.TrimSpace(*flagAssessPath)
	}
	if wasSet("display-name") {
		cfg.Scope.DisplayName = strings.TrimSpace(*flagAssessDisplayName)
	}
	if wasSet("evidence-tier") {
		cfg.EvidenceTier = strings.TrimSpace(*flagAssessTier)
	}
	if wasSet("interview-answers") {
		cfg.InterviewAnswersPath = strings.TrimSpace(*flagAssessAnswers)
	}
	if wasSet("audit-output") {
		cfg.OutputPath = strings.TrimSpace(*flagAssessOutput)
	}
	if wasSet("audit-output-format") {
		cfg.OutputFormat = strings.TrimSpace(*flagAssessOutputFormat)
	}
	if wasSet("dry-run") {
		cfg.DryRun = *flagAssessDryRun
	}
	if wasSet("flush-assess-cache") {
		cfg.FlushCache = *flagAssessFlushCache
	}
}

// fillAssessDefaults populates required fields if they're missing. Mirrors
// DefaultAssessConfig but applied to an already-loaded config.
func fillAssessDefaults(cfg *AssessConfig) {
	if cfg.Scope.Mode == "" {
		if cfg.Scope.LocalPath != "" && cfg.Scope.Org == "" {
			cfg.Scope.Mode = "local-repo"
		} else if cfg.Scope.Org != "" && cfg.Scope.LocalPath == "" {
			cfg.Scope.Mode = "org"
		} else if cfg.Scope.Org != "" && cfg.Scope.LocalPath != "" {
			cfg.Scope.Mode = "both"
		} else {
			cfg.Scope.Mode = "local-repo"
		}
	}
	if cfg.Scope.DisplayName == "" {
		switch cfg.Scope.Mode {
		case "org":
			cfg.Scope.DisplayName = cfg.Scope.Org
		case "local-repo":
			if cfg.Scope.LocalPath != "" {
				cfg.Scope.DisplayName = filepath.Base(cfg.Scope.LocalPath)
			}
		case "both":
			if cfg.Scope.Org != "" {
				cfg.Scope.DisplayName = cfg.Scope.Org
			} else if cfg.Scope.LocalPath != "" {
				cfg.Scope.DisplayName = filepath.Base(cfg.Scope.LocalPath)
			}
		}
	}
	if cfg.OutputFormat == "" {
		cfg.OutputFormat = "both"
	}
	if cfg.EvidenceTier == "" {
		cfg.EvidenceTier = "auto"
	}
}

// hasMinimalAssessConfig returns true if enough config is present to run
// headless without further interactive input.
func hasMinimalAssessConfig(cfg *AssessConfig) bool {
	if cfg == nil {
		return false
	}
	switch cfg.Scope.Mode {
	case "org", "both":
		if strings.TrimSpace(cfg.Scope.Org) == "" {
			return false
		}
	case "local-repo":
		if strings.TrimSpace(cfg.Scope.LocalPath) == "" {
			return false
		}
	default:
		return false
	}
	return strings.TrimSpace(cfg.Scope.DisplayName) != ""
}
