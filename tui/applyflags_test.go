package main

import (
	"testing"
)

// Additional applyFlagsTo tests covering edge cases not in flags_test.go.

func TestApplyFlagsTo_ReposFlag_EmptyValue_NoChange(t *testing.T) {
	oldRepos := *flagRepos
	defer func() { *flagRepos = oldRepos }()
	*flagRepos = "" // empty → splitCSV returns empty slice, len == 0, so no assignment

	cfg := DefaultConfig()
	cfg.UseAllRepos = true

	applyFlagsTo(&cfg, func(name string) bool { return name == "repos" })

	// Empty repos should NOT flip UseAllRepos since no repos were parsed
	if !cfg.UseAllRepos {
		t.Error("expected UseAllRepos=true when repos flag is empty string")
	}
}

func TestApplyFlagsTo_MaxCommitPages_Zero_NilPointer(t *testing.T) {
	oldMax := *flagMaxCommitPages
	defer func() { *flagMaxCommitPages = oldMax }()
	*flagMaxCommitPages = 0

	cfg := DefaultConfig()
	applyFlagsTo(&cfg, func(name string) bool { return name == "max-commit-pages" })

	// 0 means no limit — should not set the pointer
	if cfg.MaxCommitPages != nil {
		t.Errorf("expected MaxCommitPages=nil for 0, got %v", *cfg.MaxCommitPages)
	}
}

func TestApplyFlagsTo_SectionsFlag_IndividualOnly(t *testing.T) {
	oldSections := *flagSections
	defer func() { *flagSections = oldSections }()
	*flagSections = "individual"

	cfg := DefaultConfig()
	applyFlagsTo(&cfg, func(name string) bool { return name == "sections" })

	if !cfg.Sections.ReportSections.IndividualContributions {
		t.Error("expected IndividualContributions=true")
	}
	if cfg.Sections.ReportSections.VisibleWins {
		t.Error("expected VisibleWins=false when not in sections flag")
	}
	if cfg.Sections.ReportSections.TechnicalFoundationalWins {
		t.Error("expected TechnicalFoundationalWins=false when not in sections flag")
	}
	if cfg.Sections.ReportSections.DiscrepancyLog {
		t.Error("expected DiscrepancyLog=false when not in sections flag")
	}
}

func TestApplyFlagsTo_SectionsFlag_DiscrepancyAlias(t *testing.T) {
	oldSections := *flagSections
	defer func() { *flagSections = oldSections }()
	*flagSections = "discrepancy"

	cfg := DefaultConfig()
	applyFlagsTo(&cfg, func(name string) bool { return name == "sections" })

	if !cfg.Sections.ReportSections.DiscrepancyLog {
		t.Error("expected DiscrepancyLog=true for 'discrepancy' alias")
	}
}

func TestApplyFlagsTo_SectionsFlag_VisibleWinsAlias(t *testing.T) {
	oldSections := *flagSections
	defer func() { *flagSections = oldSections }()
	*flagSections = "visibleWins"

	cfg := DefaultConfig()
	applyFlagsTo(&cfg, func(name string) bool { return name == "sections" })

	if !cfg.Sections.ReportSections.VisibleWins {
		t.Error("expected VisibleWins=true for 'visibleWins' alias")
	}
}

func TestApplyFlagsTo_SectionsFlag_TechnicalWinsAlias(t *testing.T) {
	oldSections := *flagSections
	defer func() { *flagSections = oldSections }()
	*flagSections = "technicalWins"

	cfg := DefaultConfig()
	applyFlagsTo(&cfg, func(name string) bool { return name == "sections" })

	if !cfg.Sections.ReportSections.TechnicalFoundationalWins {
		t.Error("expected TechnicalFoundationalWins=true for 'technicalWins' alias")
	}
}

func TestApplyFlags_Wrapper_Noop(t *testing.T) {
	// Test the real applyFlags wrapper — in test environment, no flags are parsed,
	// so it should be a no-op. This covers the wrapper function code path.
	cfg := DefaultConfig()
	origOrg := cfg.Org

	applyFlags(&cfg)

	if cfg.Org != origOrg {
		t.Errorf("applyFlags wrapper changed Org unexpectedly: got %q", cfg.Org)
	}
}
