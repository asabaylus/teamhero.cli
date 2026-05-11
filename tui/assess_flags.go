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

// applyAssessFlagsTo updates cfg with values from assess CLI flags that were explicitly set.
// For each supported flag, if wasSet reports it was provided, the corresponding cfg field is overwritten with the flag's value.
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
// fillAssessDefaults populates missing fields on an AssessConfig with sensible defaults.
// 
// If Scope.Mode is empty it is derived from the presence of Scope.Org and Scope.LocalPath:
// - only LocalPath present -> "local-repo"
// - only Org present -> "org"
// - both present -> "both"
// - neither present -> "local-repo"
//
// If Scope.DisplayName is empty it is set based on Scope.Mode:
// - "org" -> Scope.Org
// - "local-repo" -> base name of Scope.LocalPath (if set)
// - "both" -> Scope.Org if present, otherwise base name of Scope.LocalPath (if set)
//
// OutputFormat defaults to "both" and EvidenceTier defaults to "auto" when unset.
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
// hasMinimalAssessConfig determines whether cfg contains the minimal fields required to run an assess operation without interactive input.
// It returns true when cfg is non-nil, the scope mode is one of "org", "local-repo", or "both" with the corresponding required scope value present (org for "org"/"both", local path for "local-repo"), and Scope.DisplayName is non-empty after trimming whitespace.
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
