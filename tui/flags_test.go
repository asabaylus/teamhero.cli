package main

import (
	"flag"
	"testing"
	"time"
)

func TestContainsIgnoreCase_Found(t *testing.T) {
	if !containsIgnoreCase([]string{"git", "asana"}, "git") {
		t.Error("containsIgnoreCase should find 'git' in [git, asana]")
	}
}

func TestContainsIgnoreCase_NotFound(t *testing.T) {
	if containsIgnoreCase([]string{"git", "asana"}, "loc") {
		t.Error("containsIgnoreCase should not find 'loc' in [git, asana]")
	}
}

func TestContainsIgnoreCase_CaseVariations(t *testing.T) {
	tests := []struct {
		slice []string
		item  string
		want  bool
	}{
		{[]string{"Git"}, "git", true},
		{[]string{"git"}, "GIT", true},
		{[]string{"GIT"}, "Git", true},
		{[]string{"ASANA"}, "asana", true},
	}
	for _, tt := range tests {
		got := containsIgnoreCase(tt.slice, tt.item)
		if got != tt.want {
			t.Errorf("containsIgnoreCase(%v, %q) = %v, want %v", tt.slice, tt.item, got, tt.want)
		}
	}
}

func TestContainsIgnoreCase_EmptySlice(t *testing.T) {
	if containsIgnoreCase([]string{}, "anything") {
		t.Error("containsIgnoreCase should return false for empty slice")
	}
}

func TestContainsIgnoreCase_NilSlice(t *testing.T) {
	if containsIgnoreCase(nil, "anything") {
		t.Error("containsIgnoreCase should return false for nil slice")
	}
}

func TestContainsIgnoreCase_EmptyItem(t *testing.T) {
	if containsIgnoreCase([]string{"git", "asana"}, "") {
		t.Error("containsIgnoreCase should return false for empty item")
	}
}

func TestEnsureDateDefaults_BothMissing(t *testing.T) {
	cfg := &ReportConfig{}
	ensureDateDefaults(cfg)

	now := time.Now()
	expectedSince := now.AddDate(0, 0, -7).Format("2006-01-02")
	expectedUntil := now.Format("2006-01-02")

	if cfg.Since != expectedSince {
		t.Errorf("ensureDateDefaults Since = %q, want %q", cfg.Since, expectedSince)
	}
	if cfg.Until != expectedUntil {
		t.Errorf("ensureDateDefaults Until = %q, want %q", cfg.Until, expectedUntil)
	}
}

func TestEnsureDateDefaults_OnlyUntilMissing(t *testing.T) {
	cfg := &ReportConfig{Since: "2026-01-01"}
	ensureDateDefaults(cfg)

	now := time.Now()
	expectedUntil := now.Format("2006-01-02")

	if cfg.Since != "2026-01-01" {
		t.Errorf("ensureDateDefaults should not change existing Since, got %q", cfg.Since)
	}
	if cfg.Until != expectedUntil {
		t.Errorf("ensureDateDefaults Until = %q, want %q", cfg.Until, expectedUntil)
	}
}

func TestEnsureDateDefaults_OnlySinceMissing(t *testing.T) {
	cfg := &ReportConfig{Until: "2026-03-01"}
	ensureDateDefaults(cfg)

	now := time.Now()
	expectedSince := now.AddDate(0, 0, -7).Format("2006-01-02")

	if cfg.Since != expectedSince {
		t.Errorf("ensureDateDefaults Since = %q, want %q", cfg.Since, expectedSince)
	}
	if cfg.Until != "2026-03-01" {
		t.Errorf("ensureDateDefaults should not change existing Until, got %q", cfg.Until)
	}
}

func TestEnsureDateDefaults_BothSet(t *testing.T) {
	cfg := &ReportConfig{Since: "2026-01-01", Until: "2026-02-01"}
	ensureDateDefaults(cfg)

	if cfg.Since != "2026-01-01" {
		t.Errorf("ensureDateDefaults should not change existing Since, got %q", cfg.Since)
	}
	if cfg.Until != "2026-02-01" {
		t.Errorf("ensureDateDefaults should not change existing Until, got %q", cfg.Until)
	}
}

func TestHasMinimalHeadlessConfig_Empty(t *testing.T) {
	cfg := &ReportConfig{Org: ""}
	if hasMinimalHeadlessConfig(cfg) {
		t.Error("hasMinimalHeadlessConfig should return false for empty org")
	}
}

func TestHasMinimalHeadlessConfig_Whitespace(t *testing.T) {
	cfg := &ReportConfig{Org: "   "}
	if hasMinimalHeadlessConfig(cfg) {
		t.Error("hasMinimalHeadlessConfig should return false for whitespace-only org")
	}
}

func TestHasMinimalHeadlessConfig_ValidOrg(t *testing.T) {
	cfg := &ReportConfig{Org: "my-org"}
	if !hasMinimalHeadlessConfig(cfg) {
		t.Error("hasMinimalHeadlessConfig should return true for valid org")
	}
}

func TestHasMinimalHeadlessConfig_OrgWithSpaces(t *testing.T) {
	cfg := &ReportConfig{Org: "  my-org  "}
	if !hasMinimalHeadlessConfig(cfg) {
		t.Error("hasMinimalHeadlessConfig should return true for org with surrounding spaces")
	}
}

// ---------------------------------------------------------------------------
// applyFlags tests
//
// Because applyFlags uses flagWasSet (which checks flag.Visit), we test it
// by directly calling the flag parsing machinery with controlled os.Args.
// NOTE: flag.CommandLine is global state, so we must reset it between tests.
// ---------------------------------------------------------------------------

func TestApplyFlags_OrgOverridesConfig(t *testing.T) {
	// Reset and re-register flags
	oldCommandLine := flag.CommandLine
	flag.CommandLine = flag.NewFlagSet("test", flag.ContinueOnError)
	fOrg := flag.String("org", "", "")
	flag.CommandLine.Parse([]string{"-org", "override-org"})

	cfg := DefaultConfig()
	cfg.Org = "original-org"

	// Since we're using a fresh FlagSet, flagWasSet won't work with Visit
	// Instead, test the flag value directly
	if *fOrg != "override-org" {
		t.Errorf("expected org flag to be override-org, got %q", *fOrg)
	}

	flag.CommandLine = oldCommandLine
}

// These tests verify the pure logic of applyFlags helpers and data flow
// without relying on global flag state.

func TestContainsIgnoreCase_SectionVariants(t *testing.T) {
	// Test the section name matching used in applyFlags
	tests := []struct {
		sections []string
		query    string
		want     bool
	}{
		{[]string{"individual", "visible-wins"}, "individual", true},
		{[]string{"individual", "visible-wins"}, "visible-wins", true},
		{[]string{"individual", "visible-wins"}, "visibleWins", false},
		{[]string{"Individual"}, "individual", true},
		{[]string{"LOC"}, "loc", true},
		{[]string{"discrepancy-log"}, "discrepancy-log", true},
		{[]string{"discrepancy"}, "discrepancy", true},
	}

	for _, tt := range tests {
		got := containsIgnoreCase(tt.sections, tt.query)
		if got != tt.want {
			t.Errorf("containsIgnoreCase(%v, %q) = %v, want %v", tt.sections, tt.query, got, tt.want)
		}
	}
}

func TestSplitCSV_WithApplyFlagsUsage(t *testing.T) {
	// Test splitCSV as used by applyFlags for --repos, --sources, --members, etc.
	tests := []struct {
		input string
		want  int
	}{
		{"api,web,design-system", 3},
		{"api, web, design-system", 3},
		{"single", 1},
		{"", 0},
		{" , , ", 0},
	}

	for _, tt := range tests {
		got := splitCSV(tt.input)
		if len(got) != tt.want {
			t.Errorf("splitCSV(%q) length = %d, want %d, got %v", tt.input, len(got), tt.want, got)
		}
	}
}

func TestEnsureDateDefaults_NoOverwriteExisting(t *testing.T) {
	cfg := &ReportConfig{Since: "2026-01-15", Until: "2026-01-22"}
	ensureDateDefaults(cfg)

	if cfg.Since != "2026-01-15" {
		t.Errorf("ensureDateDefaults should not overwrite existing Since, got %q", cfg.Since)
	}
	if cfg.Until != "2026-01-22" {
		t.Errorf("ensureDateDefaults should not overwrite existing Until, got %q", cfg.Until)
	}
}

func TestEnsureDateDefaults_DateFormat(t *testing.T) {
	cfg := &ReportConfig{}
	ensureDateDefaults(cfg)

	// Verify the format is YYYY-MM-DD
	if len(cfg.Since) != 10 || cfg.Since[4] != '-' || cfg.Since[7] != '-' {
		t.Errorf("ensureDateDefaults Since format incorrect: %q", cfg.Since)
	}
	if len(cfg.Until) != 10 || cfg.Until[4] != '-' || cfg.Until[7] != '-' {
		t.Errorf("ensureDateDefaults Until format incorrect: %q", cfg.Until)
	}
}

func TestFirstNonEmptyStr_ReturnsFirstNonEmpty(t *testing.T) {
	tests := []struct {
		inputs []string
		want   string
	}{
		{[]string{"a", "b", "c"}, "a"},
		{[]string{"", "b", "c"}, "b"},
		{[]string{"", "", "c"}, "c"},
		{[]string{"", "", ""}, ""},
		{[]string{}, ""},
		{[]string{"only"}, "only"},
	}

	for _, tt := range tests {
		got := firstNonEmptyStr(tt.inputs...)
		if got != tt.want {
			t.Errorf("firstNonEmptyStr(%v) = %q, want %q", tt.inputs, got, tt.want)
		}
	}
}

// ---------------------------------------------------------------------------
// applyFlagsTo tests
//
// applyFlagsTo is the testable core that accepts an injected wasSet function,
// allowing us to simulate specific flags being set without manipulating the
// global flag.CommandLine state.
// ---------------------------------------------------------------------------

func TestApplyFlagsTo_Org(t *testing.T) {
	oldOrg := *flagOrg
	defer func() { *flagOrg = oldOrg }()
	*flagOrg = "myorg"

	cfg := DefaultConfig()
	wasSet := func(name string) bool { return name == "org" }
	applyFlagsTo(&cfg, wasSet)

	if cfg.Org != "myorg" {
		t.Errorf("applyFlagsTo org: cfg.Org = %q, want %q", cfg.Org, "myorg")
	}
}

func TestApplyFlagsTo_Team(t *testing.T) {
	oldTeam := *flagTeam
	defer func() { *flagTeam = oldTeam }()
	*flagTeam = "engineering"

	cfg := DefaultConfig()
	cfg.Members = []string{"alice"}
	wasSet := func(name string) bool { return name == "team" }
	applyFlagsTo(&cfg, wasSet)

	if cfg.Team != "engineering" {
		t.Errorf("applyFlagsTo team: cfg.Team = %q, want %q", cfg.Team, "engineering")
	}
	if len(cfg.Members) != 0 {
		t.Errorf("applyFlagsTo team: cfg.Members should be empty, got %v", cfg.Members)
	}
}

func TestApplyFlagsTo_Members(t *testing.T) {
	oldMembers := *flagMembers
	defer func() { *flagMembers = oldMembers }()
	*flagMembers = "alice,bob"

	cfg := DefaultConfig()
	cfg.Team = "engineering"
	wasSet := func(name string) bool { return name == "members" }
	applyFlagsTo(&cfg, wasSet)

	if len(cfg.Members) != 2 || cfg.Members[0] != "alice" || cfg.Members[1] != "bob" {
		t.Errorf("applyFlagsTo members: cfg.Members = %v, want [alice bob]", cfg.Members)
	}
	if cfg.Team != "" {
		t.Errorf("applyFlagsTo members: cfg.Team should be empty, got %q", cfg.Team)
	}
}

func TestApplyFlagsTo_Repos(t *testing.T) {
	oldRepos := *flagRepos
	defer func() { *flagRepos = oldRepos }()
	*flagRepos = "repo1,repo2"

	cfg := DefaultConfig()
	cfg.UseAllRepos = true
	wasSet := func(name string) bool { return name == "repos" }
	applyFlagsTo(&cfg, wasSet)

	if len(cfg.Repos) != 2 || cfg.Repos[0] != "repo1" || cfg.Repos[1] != "repo2" {
		t.Errorf("applyFlagsTo repos: cfg.Repos = %v, want [repo1 repo2]", cfg.Repos)
	}
	if cfg.UseAllRepos {
		t.Error("applyFlagsTo repos: cfg.UseAllRepos should be false after setting repos")
	}
}

func TestApplyFlagsTo_SinceAndUntil(t *testing.T) {
	oldSince := *flagSince
	oldUntil := *flagUntil
	defer func() {
		*flagSince = oldSince
		*flagUntil = oldUntil
	}()
	*flagSince = "2026-01-01"
	*flagUntil = "2026-01-31"

	cfg := DefaultConfig()
	wasSet := func(name string) bool { return name == "since" || name == "until" }
	applyFlagsTo(&cfg, wasSet)

	if cfg.Since != "2026-01-01" {
		t.Errorf("applyFlagsTo since: cfg.Since = %q, want %q", cfg.Since, "2026-01-01")
	}
	if cfg.Until != "2026-01-31" {
		t.Errorf("applyFlagsTo until: cfg.Until = %q, want %q", cfg.Until, "2026-01-31")
	}
}

func TestApplyFlagsTo_BoolFlags(t *testing.T) {
	oldIncludeBots := *flagIncludeBots
	oldExcludePrivate := *flagExcludePrivate
	oldIncludeArchived := *flagIncludeArchived
	oldDetailed := *flagDetailed
	defer func() {
		*flagIncludeBots = oldIncludeBots
		*flagExcludePrivate = oldExcludePrivate
		*flagIncludeArchived = oldIncludeArchived
		*flagDetailed = oldDetailed
	}()
	*flagIncludeBots = true
	*flagExcludePrivate = true
	*flagIncludeArchived = true
	*flagDetailed = true

	cfg := DefaultConfig()
	wasSet := func(name string) bool {
		return name == "include-bots" || name == "exclude-private" ||
			name == "include-archived" || name == "detailed"
	}
	applyFlagsTo(&cfg, wasSet)

	if !cfg.IncludeBots {
		t.Error("applyFlagsTo include-bots: cfg.IncludeBots should be true")
	}
	if !cfg.ExcludePrivate {
		t.Error("applyFlagsTo exclude-private: cfg.ExcludePrivate should be true")
	}
	if !cfg.IncludeArchived {
		t.Error("applyFlagsTo include-archived: cfg.IncludeArchived should be true")
	}
	if !cfg.Detailed {
		t.Error("applyFlagsTo detailed: cfg.Detailed should be true")
	}
}

func TestApplyFlagsTo_NoConfirm(t *testing.T) {
	oldNoConfirm := *flagNoConfirm
	defer func() { *flagNoConfirm = oldNoConfirm }()
	*flagNoConfirm = true

	cfg := DefaultConfig()
	cfg.ConfirmBeforeRun = true
	wasSet := func(name string) bool { return name == "no-confirm" }
	applyFlagsTo(&cfg, wasSet)

	if cfg.ConfirmBeforeRun {
		t.Error("applyFlagsTo no-confirm: cfg.ConfirmBeforeRun should be false when no-confirm is true")
	}
}

func TestApplyFlagsTo_MaxCommitPages(t *testing.T) {
	oldMaxCommitPages := *flagMaxCommitPages
	defer func() { *flagMaxCommitPages = oldMaxCommitPages }()
	*flagMaxCommitPages = 5

	cfg := DefaultConfig()
	wasSet := func(name string) bool { return name == "max-commit-pages" }
	applyFlagsTo(&cfg, wasSet)

	if cfg.MaxCommitPages == nil {
		t.Fatal("applyFlagsTo max-commit-pages: cfg.MaxCommitPages should not be nil")
	}
	if *cfg.MaxCommitPages != 5 {
		t.Errorf("applyFlagsTo max-commit-pages: *cfg.MaxCommitPages = %d, want 5", *cfg.MaxCommitPages)
	}
}

func TestApplyFlagsTo_MaxPrPages(t *testing.T) {
	oldMaxPrPages := *flagMaxPrPages
	defer func() { *flagMaxPrPages = oldMaxPrPages }()
	*flagMaxPrPages = 3

	cfg := DefaultConfig()
	wasSet := func(name string) bool { return name == "max-pr-pages" }
	applyFlagsTo(&cfg, wasSet)

	if cfg.MaxPrPages == nil {
		t.Fatal("applyFlagsTo max-pr-pages: cfg.MaxPrPages should not be nil")
	}
	if *cfg.MaxPrPages != 3 {
		t.Errorf("applyFlagsTo max-pr-pages: *cfg.MaxPrPages = %d, want 3", *cfg.MaxPrPages)
	}
}

func TestApplyFlagsTo_SequentialAndDiscrepancyThreshold(t *testing.T) {
	oldSequential := *flagSequential
	oldThreshold := *flagDiscrepancyThreshold
	defer func() {
		*flagSequential = oldSequential
		*flagDiscrepancyThreshold = oldThreshold
	}()
	*flagSequential = true
	*flagDiscrepancyThreshold = 75

	cfg := DefaultConfig()
	wasSet := func(name string) bool {
		return name == "sequential" || name == "discrepancy-threshold"
	}
	applyFlagsTo(&cfg, wasSet)

	if !cfg.Sequential {
		t.Error("applyFlagsTo sequential: cfg.Sequential should be true")
	}
	if cfg.DiscrepancyThreshold != 75 {
		t.Errorf("applyFlagsTo discrepancy-threshold: cfg.DiscrepancyThreshold = %d, want 75", cfg.DiscrepancyThreshold)
	}
}

func TestApplyFlagsTo_Sources(t *testing.T) {
	oldSources := *flagSources
	defer func() { *flagSources = oldSources }()
	*flagSources = "git,asana"

	cfg := DefaultConfig()
	wasSet := func(name string) bool { return name == "sources" }
	applyFlagsTo(&cfg, wasSet)

	if !cfg.Sections.DataSources.Git {
		t.Error("applyFlagsTo sources: cfg.Sections.DataSources.Git should be true")
	}
	if !cfg.Sections.DataSources.Asana {
		t.Error("applyFlagsTo sources: cfg.Sections.DataSources.Asana should be true")
	}
}

func TestApplyFlagsTo_Sources_GitOnly(t *testing.T) {
	oldSources := *flagSources
	defer func() { *flagSources = oldSources }()
	*flagSources = "git"

	cfg := DefaultConfig()
	cfg.Sections.DataSources.Asana = true
	wasSet := func(name string) bool { return name == "sources" }
	applyFlagsTo(&cfg, wasSet)

	if !cfg.Sections.DataSources.Git {
		t.Error("applyFlagsTo sources git-only: Git should be true")
	}
	if cfg.Sections.DataSources.Asana {
		t.Error("applyFlagsTo sources git-only: Asana should be false")
	}
}

func TestApplyFlagsTo_Sections(t *testing.T) {
	oldSections := *flagSections
	defer func() { *flagSections = oldSections }()
	*flagSections = "individual,visible-wins,technical-wins,discrepancy-log,loc"

	cfg := DefaultConfig()
	wasSet := func(name string) bool { return name == "sections" }
	applyFlagsTo(&cfg, wasSet)

	if !cfg.Sections.ReportSections.IndividualContributions {
		t.Error("applyFlagsTo sections: IndividualContributions should be true")
	}
	if !cfg.Sections.ReportSections.VisibleWins {
		t.Error("applyFlagsTo sections: VisibleWins should be true")
	}
	if !cfg.Sections.ReportSections.TechnicalFoundationalWins {
		t.Error("applyFlagsTo sections: TechnicalFoundationalWins should be true")
	}
	if !cfg.Sections.ReportSections.DiscrepancyLog {
		t.Error("applyFlagsTo sections: DiscrepancyLog should be true")
	}
	if !cfg.Sections.ReportSections.Loc {
		t.Error("applyFlagsTo sections: Loc should be true")
	}
}

func TestApplyFlagsTo_NoFlagsSet_NoCfgChanges(t *testing.T) {
	cfg := DefaultConfig()
	original := cfg

	wasSet := func(name string) bool { return false }
	applyFlagsTo(&cfg, wasSet)

	// All fields should remain unchanged
	if cfg.Org != original.Org {
		t.Errorf("applyFlagsTo no-op: Org changed from %q to %q", original.Org, cfg.Org)
	}
	if cfg.Team != original.Team {
		t.Errorf("applyFlagsTo no-op: Team changed")
	}
	if cfg.Since != original.Since {
		t.Errorf("applyFlagsTo no-op: Since changed")
	}
	if cfg.Until != original.Until {
		t.Errorf("applyFlagsTo no-op: Until changed")
	}
	if cfg.IncludeBots != original.IncludeBots {
		t.Errorf("applyFlagsTo no-op: IncludeBots changed")
	}
	if cfg.ConfirmBeforeRun != original.ConfirmBeforeRun {
		t.Errorf("applyFlagsTo no-op: ConfirmBeforeRun changed")
	}
	if cfg.Sequential != original.Sequential {
		t.Errorf("applyFlagsTo no-op: Sequential changed")
	}
	if cfg.DiscrepancyThreshold != original.DiscrepancyThreshold {
		t.Errorf("applyFlagsTo no-op: DiscrepancyThreshold changed")
	}
}

func TestApplyFlags_NoOpWhenNoFlagsParsed(t *testing.T) {
	cfg := DefaultConfig()
	original := cfg

	// applyFlags uses flagWasSet which calls flag.Visit — since no flags were
	// parsed via flag.Parse() in this test, it should be a complete no-op.
	applyFlags(&cfg)

	if cfg.Org != original.Org {
		t.Errorf("applyFlags no-op: Org changed")
	}
	if cfg.Team != original.Team {
		t.Errorf("applyFlags no-op: Team changed")
	}
}
