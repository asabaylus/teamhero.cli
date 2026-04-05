package main

import (
	"testing"
)

func TestFmtBoolYN_True(t *testing.T) {
	if got := fmtBoolYN(true); got != "Yes" {
		t.Errorf("fmtBoolYN(true) = %q, want %q", got, "Yes")
	}
}

func TestFmtBoolYN_False(t *testing.T) {
	if got := fmtBoolYN(false); got != "No" {
		t.Errorf("fmtBoolYN(false) = %q, want %q", got, "No")
	}
}

func TestFmtRepos_UseAllRepos(t *testing.T) {
	cfg := &ReportConfig{UseAllRepos: true}
	if got := fmtRepos(cfg); got != "All" {
		t.Errorf("fmtRepos(UseAllRepos=true) = %q, want %q", got, "All")
	}
}

func TestFmtRepos_SpecificRepos(t *testing.T) {
	cfg := &ReportConfig{
		UseAllRepos: false,
		Repos:       []string{"repo-a", "repo-b", "repo-c"},
	}
	got := fmtRepos(cfg)
	want := "repo-a +2"
	if got != want {
		t.Errorf("fmtRepos(3 repos) = %q, want %q", got, want)
	}
}

func TestFmtRepos_SingleRepo(t *testing.T) {
	cfg := &ReportConfig{
		UseAllRepos: false,
		Repos:       []string{"my-repo"},
	}
	got := fmtRepos(cfg)
	want := "my-repo"
	if got != want {
		t.Errorf("fmtRepos(1 repo) = %q, want %q", got, want)
	}
}

func TestFmtRepos_EmptyRepos(t *testing.T) {
	cfg := &ReportConfig{
		UseAllRepos: false,
		Repos:       []string{},
	}
	got := fmtRepos(cfg)
	if got != "" {
		t.Errorf("fmtRepos(empty repos) = %q, want empty string", got)
	}
}

func TestFmtRepos_NilRepos(t *testing.T) {
	cfg := &ReportConfig{
		UseAllRepos: false,
		Repos:       nil,
	}
	got := fmtRepos(cfg)
	if got != "" {
		t.Errorf("fmtRepos(nil repos) = %q, want empty string", got)
	}
}

func TestFmtMembers_WithTeam(t *testing.T) {
	cfg := &ReportConfig{Team: "engineering"}
	got := fmtMembers(cfg)
	want := "Team: engineering"
	if got != want {
		t.Errorf("fmtMembers(team=engineering) = %q, want %q", got, want)
	}
}

func TestFmtMembers_WithMembers(t *testing.T) {
	cfg := &ReportConfig{
		Members: []string{"alice", "bob", "charlie"},
	}
	got := fmtMembers(cfg)
	want := "alice +2"
	if got != want {
		t.Errorf("fmtMembers(3 members) = %q, want %q", got, want)
	}
}

func TestFmtMembers_SingleMember(t *testing.T) {
	cfg := &ReportConfig{
		Members: []string{"alice"},
	}
	got := fmtMembers(cfg)
	want := "alice"
	if got != want {
		t.Errorf("fmtMembers(1 member) = %q, want %q", got, want)
	}
}

func TestFmtMembers_BothEmpty(t *testing.T) {
	cfg := &ReportConfig{}
	got := fmtMembers(cfg)
	if got != "All" {
		t.Errorf("fmtMembers(empty) = %q, want %q", got, "All")
	}
}

func TestFmtMembers_TeamTakesPrecedence(t *testing.T) {
	cfg := &ReportConfig{
		Team:    "backend",
		Members: []string{"alice"},
	}
	got := fmtMembers(cfg)
	want := "Team: backend"
	if got != want {
		t.Errorf("fmtMembers(team+members) = %q, want %q (team should take precedence)", got, want)
	}
}

func TestFmtDataSources_GitOnly(t *testing.T) {
	cfg := &ReportConfig{
		Sections: ReportSections{
			DataSources: DataSources{Git: true, Asana: false},
		},
	}
	got := fmtDataSources(cfg)
	if got != "Git" {
		t.Errorf("fmtDataSources(git only) = %q, want %q", got, "Git")
	}
}

func TestFmtDataSources_AsanaOnly(t *testing.T) {
	cfg := &ReportConfig{
		Sections: ReportSections{
			DataSources: DataSources{Git: false, Asana: true},
		},
	}
	got := fmtDataSources(cfg)
	if got != "Asana" {
		t.Errorf("fmtDataSources(asana only) = %q, want %q", got, "Asana")
	}
}

func TestFmtDataSources_Both(t *testing.T) {
	cfg := &ReportConfig{
		Sections: ReportSections{
			DataSources: DataSources{Git: true, Asana: true},
		},
	}
	got := fmtDataSources(cfg)
	want := "Git, Asana"
	if got != want {
		t.Errorf("fmtDataSources(both) = %q, want %q", got, want)
	}
}

func TestFmtDataSources_None(t *testing.T) {
	cfg := &ReportConfig{
		Sections: ReportSections{
			DataSources: DataSources{Git: false, Asana: false},
		},
	}
	got := fmtDataSources(cfg)
	if got != "none" {
		t.Errorf("fmtDataSources(none) = %q, want %q", got, "none")
	}
}

func TestFmtReportSections_AllEnabled(t *testing.T) {
	cfg := &ReportConfig{
		Sections: ReportSections{
			ReportSections: ReportSectionsInner{
				IndividualContributions: true,
				VisibleWins:            true,
				Loc:                    true,
				DiscrepancyLog:         true,
			},
		},
	}
	got := fmtReportSections(cfg)
	want := "Individual, Wins, LOC, Discrepancy Log"
	if got != want {
		t.Errorf("fmtReportSections(all) = %q, want %q", got, want)
	}
}

func TestFmtReportSections_IndividualOnly(t *testing.T) {
	cfg := &ReportConfig{
		Sections: ReportSections{
			ReportSections: ReportSectionsInner{
				IndividualContributions: true,
			},
		},
	}
	got := fmtReportSections(cfg)
	if got != "Individual" {
		t.Errorf("fmtReportSections(individual) = %q, want %q", got, "Individual")
	}
}

func TestFmtReportSections_NoneEnabled(t *testing.T) {
	cfg := &ReportConfig{}
	got := fmtReportSections(cfg)
	if got != "none" {
		t.Errorf("fmtReportSections(none) = %q, want %q", got, "none")
	}
}

func TestFmtReportSections_LocAndDiscrepancy(t *testing.T) {
	cfg := &ReportConfig{
		Sections: ReportSections{
			ReportSections: ReportSectionsInner{
				Loc:            true,
				DiscrepancyLog: true,
			},
		},
	}
	got := fmtReportSections(cfg)
	want := "LOC, Discrepancy Log"
	if got != want {
		t.Errorf("fmtReportSections(loc+discrepancy) = %q, want %q", got, want)
	}
}

func TestFmtCacheFlush_Empty(t *testing.T) {
	cfg := &ReportConfig{FlushCache: ""}
	got := fmtCacheFlush(cfg)
	if got != "Use cached" {
		t.Errorf("fmtCacheFlush(empty) = %q, want %q", got, "Use cached")
	}
}

func TestFmtCacheFlush_All(t *testing.T) {
	cfg := &ReportConfig{FlushCache: "all"}
	got := fmtCacheFlush(cfg)
	if got != "Flush all" {
		t.Errorf("fmtCacheFlush(all) = %q, want %q", got, "Flush all")
	}
}

func TestFmtCacheFlush_AllSince(t *testing.T) {
	cfg := &ReportConfig{FlushCache: "all:since=2026-02-20"}
	got := fmtCacheFlush(cfg)
	want := "Flush from 2026-02-20"
	if got != want {
		t.Errorf("fmtCacheFlush(all:since=2026-02-20) = %q, want %q", got, want)
	}
}

func TestFmtCacheFlush_SpecificSource(t *testing.T) {
	cfg := &ReportConfig{FlushCache: "metrics"}
	got := fmtCacheFlush(cfg)
	if got != "metrics" {
		t.Errorf("fmtCacheFlush(metrics) = %q, want %q", got, "metrics")
	}
}

// ===========================================================================
// renderSummary edge cases
// ===========================================================================

func TestRenderSummary_SmallWidth(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "myorg"
	// width < 20 → clamped to 20
	result := renderSummary(&cfg, wsOrg, wsOrg, 5)
	if result == "" {
		t.Error("expected non-empty renderSummary output for small width")
	}
}

func TestRenderSummary_WithAIModel(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "myorg"
	cfg.AIModel = "gpt-4o"
	result := renderSummary(&cfg, wsOrg, wsRepoScope, 80)
	if result == "" {
		t.Error("expected non-empty renderSummary output with AIModel set")
	}
}

func TestRenderSummary_WithAIModelFlex(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "myorg"
	cfg.AIModel = "gpt-4o"
	cfg.ServiceTier = "flex"
	result := renderSummary(&cfg, wsOrg, wsRepoScope, 80)
	if result == "" {
		t.Error("expected non-empty renderSummary output with AIModel+flex")
	}
}

func TestRenderSummary_NarrowWithAIModel(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "myorg"
	cfg.AIModel = "gpt-4o-mini"
	// Narrow width → gap < 2, header only path
	result := renderSummary(&cfg, wsOrg, wsRepoScope, 22)
	if result == "" {
		t.Error("expected non-empty renderSummary output for narrow width with AI model")
	}
}
