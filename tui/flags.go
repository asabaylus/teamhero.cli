package main

import (
	"flag"
	"strings"
	"time"
)

// CLI flags — every ReportConfig field has a corresponding flag so the TUI
// can be driven entirely from the command line (useful for CI, AI agents,
// and scripting).
//
// Subtractive flag model: omitting a list flag means "include everything".
// Specifying a flag narrows scope to exactly what was listed.
var (
	flagOrg                  = flag.String("org", "", "GitHub organization")
	flagTeam                 = flag.String("team", "", "Comma-separated contributor identifiers to filter by team")
	flagMembers              = flag.String("members", "", "Comma-separated member logins")
	flagRepos                = flag.String("repos", "", "Comma-separated repository names")
	flagSources              = flag.String("sources", "", "Comma-separated data sources to fetch: git,asana (omit for all)")
	flagSections             = flag.String("sections", "", "Comma-separated report sections to render: loc,individual,visible-wins,technical-wins,discrepancy-log (omit for all)")
	flagSince                = flag.String("since", "", "Start date (YYYY-MM-DD)")
	flagUntil                = flag.String("until", "", "End date (YYYY-MM-DD)")
	flagOutput               = flag.String("output", "", "Output file path (default: timestamped in current directory)")
	flagIncludeBots          = flag.Bool("include-bots", false, "Include bot accounts")
	flagExcludePrivate       = flag.Bool("exclude-private", false, "Exclude private repositories")
	flagIncludeArchived      = flag.Bool("include-archived", false, "Include archived repositories")
	flagDetailed             = flag.Bool("detailed", false, "Include detailed PR/commit listings")
	flagMaxCommitPages       = flag.Int("max-commit-pages", 0, "Maximum pages of commits to fetch (0 = no limit)")
	flagMaxPrPages           = flag.Int("max-pr-pages", 0, "Maximum pages of PRs to fetch (0 = no limit)")
	flagNoConfirm            = flag.Bool("no-confirm", false, "Skip confirmation before running")
	flagHeadless             = flag.Bool("headless", false, "Run non-interactively")
	flagFormat               = flag.String("format", "", "Output format: json (for doctor command)")
	flagOutputFormat         = flag.String("output-format", "", "Report output format: markdown (default), json, both")
	flagFlushCache           = flag.String("flush-cache", "", "Flush cached data: 'all', sources (metrics,loc,...), or with date 'all:since=2026-02-20'")
	flagForeground           = flag.Bool("foreground", false, "Run subprocess with direct I/O (bypass event piping)")
	flagAdvanced             = flag.Bool("advanced", false, "Use full configuration wizard (skip express mode)")
	flagSequential           = flag.Bool("sequential", false, "Run API requests sequentially instead of in parallel")
	flagDiscrepancyThreshold = flag.Int("discrepancy-threshold", 0, "Discrepancy report threshold: only items with confidence >= N appear in the report (0-100)")
	flagTemplate             = flag.String("template", "", "Report template: detailed (default), executive, individual")
	flagShowConfig           = flag.Bool("show-config", false, "Print saved configuration as JSON and exit")
	flagVersion              = flag.Bool("version", false, "Print version and exit")
)

// flagWasSet returns true if the user explicitly provided the named flag.
func flagWasSet(name string) bool {
	found := false
	flag.Visit(func(f *flag.Flag) {
		if f.Name == name {
			found = true
		}
	})
	return found
}

// applyFlags merges explicitly-set CLI flags into cfg.
// Only flags the user actually provided on the command line are applied;
// unset flags leave cfg untouched (preserving saved-config defaults).
func applyFlags(cfg *ReportConfig) {
	applyFlagsTo(cfg, flagWasSet)
}

// applyFlagsTo is the testable core of applyFlags.
// wasSet is injected so tests can simulate specific flags being set
// without manipulating the global flag.CommandLine state.
func applyFlagsTo(cfg *ReportConfig, wasSet func(string) bool) {
	if wasSet("org") {
		cfg.Org = *flagOrg
	}
	if wasSet("team") {
		cfg.Team = *flagTeam
		cfg.Members = []string{}
	}
	if wasSet("members") {
		cfg.Members = splitCSV(*flagMembers)
		cfg.Team = ""
	}
	if wasSet("repos") {
		repos := splitCSV(*flagRepos)
		if len(repos) > 0 {
			cfg.Repos = repos
			cfg.UseAllRepos = false
		}
	}
	if wasSet("since") {
		cfg.Since = *flagSince
	}
	if wasSet("until") {
		cfg.Until = *flagUntil
	}
	if wasSet("include-bots") {
		cfg.IncludeBots = *flagIncludeBots
	}
	if wasSet("exclude-private") {
		cfg.ExcludePrivate = *flagExcludePrivate
	}
	if wasSet("include-archived") {
		cfg.IncludeArchived = *flagIncludeArchived
	}
	if wasSet("detailed") {
		cfg.Detailed = *flagDetailed
	}
	if wasSet("no-confirm") {
		cfg.ConfirmBeforeRun = !*flagNoConfirm
	}
	if wasSet("max-commit-pages") && *flagMaxCommitPages > 0 {
		v := *flagMaxCommitPages
		cfg.MaxCommitPages = &v
	}
	if wasSet("max-pr-pages") && *flagMaxPrPages > 0 {
		v := *flagMaxPrPages
		cfg.MaxPrPages = &v
	}

	if wasSet("sequential") {
		cfg.Sequential = *flagSequential
	}

	if wasSet("discrepancy-threshold") {
		cfg.DiscrepancyThreshold = *flagDiscrepancyThreshold
	}

	if wasSet("template") {
		cfg.Template = *flagTemplate
	}

	// Subtractive flag model: --sources narrows data sources
	if wasSet("sources") {
		sources := splitCSV(*flagSources)
		cfg.Sections.DataSources.Git = containsIgnoreCase(sources, "git")
		cfg.Sections.DataSources.Asana = containsIgnoreCase(sources, "asana")
	}

	// Subtractive flag model: --sections narrows report sections
	if wasSet("sections") {
		sections := splitCSV(*flagSections)
		cfg.Sections.ReportSections.IndividualContributions = containsIgnoreCase(sections, "individual")
		cfg.Sections.ReportSections.VisibleWins = containsIgnoreCase(sections, "visible-wins") || containsIgnoreCase(sections, "visibleWins")
		cfg.Sections.ReportSections.TechnicalFoundationalWins = containsIgnoreCase(sections, "technical-wins") || containsIgnoreCase(sections, "technicalWins")
		cfg.Sections.ReportSections.DiscrepancyLog = containsIgnoreCase(sections, "discrepancy-log") || containsIgnoreCase(sections, "discrepancyLog") || containsIgnoreCase(sections, "discrepancy")
		cfg.Sections.ReportSections.Loc = containsIgnoreCase(sections, "loc")
	}
}

// containsIgnoreCase checks if a slice contains a string (case-insensitive).
func containsIgnoreCase(slice []string, item string) bool {
	for _, s := range slice {
		if strings.EqualFold(s, item) {
			return true
		}
	}
	return false
}

// ensureDateDefaults fills in missing date fields with sensible defaults.
func ensureDateDefaults(cfg *ReportConfig) {
	now := time.Now()
	if cfg.Since == "" {
		cfg.Since = now.AddDate(0, 0, -7).Format("2006-01-02")
	}
	if cfg.Until == "" {
		cfg.Until = now.Format("2006-01-02")
	}
}

// hasMinimalHeadlessConfig returns true if enough config is present to run
// headless without interactive input (org is the only hard requirement).
func hasMinimalHeadlessConfig(cfg *ReportConfig) bool {
	return strings.TrimSpace(cfg.Org) != ""
}
