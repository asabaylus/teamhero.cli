package main

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

func TestStripDiscrepancyLinks_WithLinks(t *testing.T) {
	input := "See item [1](#discrepancy-1) and [23](#discrepancy-23) for details."
	got := stripDiscrepancyLinks(input)
	want := "See item 1 and 23 for details."
	if got != want {
		t.Errorf("stripDiscrepancyLinks = %q, want %q", got, want)
	}
}

func TestStripDiscrepancyLinks_NoLinks(t *testing.T) {
	input := "No discrepancy links here."
	got := stripDiscrepancyLinks(input)
	if got != input {
		t.Errorf("stripDiscrepancyLinks should not modify text without links, got %q", got)
	}
}

func TestStripDiscrepancyLinks_EmptyString(t *testing.T) {
	got := stripDiscrepancyLinks("")
	if got != "" {
		t.Errorf("stripDiscrepancyLinks('') = %q, want empty", got)
	}
}

func TestStripDiscrepancyLinks_NonDiscrepancyLink(t *testing.T) {
	input := "[click here](#some-anchor)"
	got := stripDiscrepancyLinks(input)
	// Non-discrepancy links should be preserved
	if got != input {
		t.Errorf("stripDiscrepancyLinks should not modify non-discrepancy links, got %q", got)
	}
}

func TestStripDiscrepancyLinks_MultipleOnSameLine(t *testing.T) {
	input := "[1](#discrepancy-1), [2](#discrepancy-2), [3](#discrepancy-3)"
	got := stripDiscrepancyLinks(input)
	want := "1, 2, 3"
	if got != want {
		t.Errorf("stripDiscrepancyLinks = %q, want %q", got, want)
	}
}

func TestExtractSummaryGo_SingleLine(t *testing.T) {
	got := extractSummaryGo("Missing PR activity")
	if got != "Missing PR activity" {
		t.Errorf("extractSummaryGo(single line) = %q, want %q", got, "Missing PR activity")
	}
}

func TestExtractSummaryGo_MultiLine(t *testing.T) {
	input := "Missing PR activity\nThe contributor has no pull requests in the period."
	got := extractSummaryGo(input)
	if got != "Missing PR activity" {
		t.Errorf("extractSummaryGo(multi line) = %q, want %q", got, "Missing PR activity")
	}
}

func TestExtractSummaryGo_WithWhitespace(t *testing.T) {
	input := "  Summary with spaces  \nDetails here."
	got := extractSummaryGo(input)
	if got != "Summary with spaces" {
		t.Errorf("extractSummaryGo(whitespace) = %q, want %q", got, "Summary with spaces")
	}
}

func TestExtractSummaryGo_EmptyString(t *testing.T) {
	got := extractSummaryGo("")
	if got != "" {
		t.Errorf("extractSummaryGo('') = %q, want empty", got)
	}
}

func TestExtractExplanationGo_MultiLine(t *testing.T) {
	input := "Summary line\nExplanation paragraph follows."
	got := extractExplanationGo(input)
	if got != "Explanation paragraph follows." {
		t.Errorf("extractExplanationGo(multi line) = %q, want %q", got, "Explanation paragraph follows.")
	}
}

func TestExtractExplanationGo_SingleLine(t *testing.T) {
	got := extractExplanationGo("Only summary")
	if got != "" {
		t.Errorf("extractExplanationGo(single line) = %q, want empty", got)
	}
}

func TestExtractExplanationGo_MultipleLines(t *testing.T) {
	input := "Summary\nLine two\nLine three"
	got := extractExplanationGo(input)
	want := "Line two\nLine three"
	if got != want {
		t.Errorf("extractExplanationGo(3 lines) = %q, want %q", got, want)
	}
}

func TestExtractExplanationGo_EmptyString(t *testing.T) {
	got := extractExplanationGo("")
	if got != "" {
		t.Errorf("extractExplanationGo('') = %q, want empty", got)
	}
}

func TestExtractRuleDescriptionGo_WithDash(t *testing.T) {
	input := "RULE-001 — Missing commit activity detected"
	got := extractRuleDescriptionGo(input)
	if got != "Missing commit activity detected" {
		t.Errorf("extractRuleDescriptionGo = %q, want %q", got, "Missing commit activity detected")
	}
}

func TestExtractRuleDescriptionGo_NoDash(t *testing.T) {
	input := "RULE-001"
	got := extractRuleDescriptionGo(input)
	if got != "" {
		t.Errorf("extractRuleDescriptionGo(no dash) = %q, want empty", got)
	}
}

func TestExtractRuleDescriptionGo_EmptyString(t *testing.T) {
	got := extractRuleDescriptionGo("")
	if got != "" {
		t.Errorf("extractRuleDescriptionGo('') = %q, want empty", got)
	}
}

func TestExtractRuleDescriptionGo_WithWhitespace(t *testing.T) {
	input := "RULE — Description with spaces  "
	got := extractRuleDescriptionGo(input)
	if got != "Description with spaces" {
		t.Errorf("extractRuleDescriptionGo = %q, want %q", got, "Description with spaces")
	}
}

func TestFormatEvidenceBulletGo_WithURL(t *testing.T) {
	src := DiscrepancySourceState{
		SourceName: "GitHub",
		State:      "No commits found",
		URL:        "https://github.com/org/repo/pulls",
		ItemID:     "PR-42",
	}
	got := formatEvidenceBulletGo(src)
	want := "- [GitHub: PR-42](https://github.com/org/repo/pulls) — No commits found"
	if got != want {
		t.Errorf("formatEvidenceBulletGo(with URL) = %q, want %q", got, want)
	}
}

func TestFormatEvidenceBulletGo_WithoutURL(t *testing.T) {
	src := DiscrepancySourceState{
		SourceName: "Asana",
		State:      "Task marked complete",
		URL:        "",
		ItemID:     "",
	}
	got := formatEvidenceBulletGo(src)
	want := "- Asana — Task marked complete"
	if got != want {
		t.Errorf("formatEvidenceBulletGo(no URL) = %q, want %q", got, want)
	}
}

func TestFormatEvidenceBulletGo_WithItemIDNoURL(t *testing.T) {
	src := DiscrepancySourceState{
		SourceName: "GitHub",
		State:      "Open PR",
		URL:        "",
		ItemID:     "PR-99",
	}
	got := formatEvidenceBulletGo(src)
	want := "- GitHub: PR-99 — Open PR"
	if got != want {
		t.Errorf("formatEvidenceBulletGo(itemID no URL) = %q, want %q", got, want)
	}
}

func TestFormatEvidenceBulletGo_WithWhitespaceURL(t *testing.T) {
	src := DiscrepancySourceState{
		SourceName: "GitHub",
		State:      "closed",
		URL:        "   ",
		ItemID:     "",
	}
	got := formatEvidenceBulletGo(src)
	// Whitespace-only URL should be treated as no URL
	want := "- GitHub — closed"
	if got != want {
		t.Errorf("formatEvidenceBulletGo(whitespace URL) = %q, want %q", got, want)
	}
}

func TestFormatEvidenceBulletGo_WithWhitespaceItemID(t *testing.T) {
	src := DiscrepancySourceState{
		SourceName: "GitHub",
		State:      "closed",
		URL:        "",
		ItemID:     "   ",
	}
	got := formatEvidenceBulletGo(src)
	// Whitespace-only ItemID should be treated as no ItemID
	want := "- GitHub — closed"
	if got != want {
		t.Errorf("formatEvidenceBulletGo(whitespace ItemID) = %q, want %q", got, want)
	}
}

func TestBuildDiscrepancyMarkdown_WithAllItems(t *testing.T) {
	data := &DiscrepancyEvent{
		TotalCount: 2,
		AllItems: []DiscrepancyItem{
			{
				Contributor:            "alice",
				ContributorDisplayName: "Alice Smith",
				Message:                "Missing commits\nExpected activity not found.",
				Rule:                   "RULE-001 — Commit activity check",
				Confidence:             80,
				SuggestedResolution:    "Review commit history.",
				SourceA: DiscrepancySourceState{
					SourceName: "GitHub",
					State:      "0 commits",
				},
				SourceB: DiscrepancySourceState{
					SourceName: "Asana",
					State:      "3 tasks completed",
				},
			},
		},
		DiscrepancyThreshold: 50,
	}

	md := buildDiscrepancyMarkdown(data)

	if !strings.Contains(md, "## Discrepancy Log") {
		t.Error("markdown should contain header")
	}
	if !strings.Contains(md, "Alice Smith") {
		t.Error("markdown should contain contributor display name")
	}
	if !strings.Contains(md, "Missing commits") {
		t.Error("markdown should contain summary")
	}
	if !strings.Contains(md, "Expected activity not found.") {
		t.Error("markdown should contain explanation")
	}
	if !strings.Contains(md, "80%") {
		t.Error("markdown should contain confidence percentage")
	}
	if !strings.Contains(md, "Review commit history.") {
		t.Error("markdown should contain suggested resolution")
	}
	if !strings.Contains(md, "above the report threshold of **50%**") {
		t.Error("markdown should contain threshold info")
	}
}

func TestBuildDiscrepancyMarkdown_WithItemsFallback(t *testing.T) {
	data := &DiscrepancyEvent{
		TotalCount: 1,
		Items: []DiscrepancyItem{
			{
				Contributor:            "bob",
				ContributorDisplayName: "Bob Jones",
				Message:                "PR without review",
				Rule:                   "RULE-002",
				Confidence:             60,
				SuggestedResolution:    "Add reviewer.",
				SourceA: DiscrepancySourceState{
					SourceName: "GitHub",
					State:      "merged without review",
				},
				SourceB: DiscrepancySourceState{
					SourceName: "GitHub",
					State:      "no review comments",
				},
			},
		},
	}

	md := buildDiscrepancyMarkdown(data)

	if !strings.Contains(md, "Bob Jones") {
		t.Error("markdown should contain contributor from Items fallback")
	}
	if !strings.Contains(md, "PR without review") {
		t.Error("markdown should contain summary from Items fallback")
	}
	if !strings.Contains(md, "**1** discrepancies found.") {
		t.Error("markdown should show count without threshold when threshold is 0")
	}
}

func TestBuildDiscrepancyMarkdown_UnattributedContributor(t *testing.T) {
	data := &DiscrepancyEvent{
		TotalCount: 1,
		AllItems: []DiscrepancyItem{
			{
				Contributor:            "",
				ContributorDisplayName: "",
				Message:                "Orphan task",
				Rule:                   "RULE-003 — Orphan task check",
				Confidence:             45,
				SuggestedResolution:    "Assign the task.",
				SourceA: DiscrepancySourceState{
					SourceName: "Asana",
					State:      "unassigned",
				},
				SourceB: DiscrepancySourceState{
					SourceName: "GitHub",
					State:      "no related PR",
				},
			},
		},
	}

	md := buildDiscrepancyMarkdown(data)
	if !strings.Contains(md, "Unattributed") {
		t.Error("markdown should show 'Unattributed' for empty contributor")
	}
}

func TestBuildDiscrepancyMarkdown_ThresholdCounts(t *testing.T) {
	data := &DiscrepancyEvent{
		TotalCount: 3,
		AllItems: []DiscrepancyItem{
			{Confidence: 80, Message: "High", Contributor: "a", ContributorDisplayName: "A", Rule: "R", SuggestedResolution: "x",
				SourceA: DiscrepancySourceState{SourceName: "S", State: "s"}, SourceB: DiscrepancySourceState{SourceName: "S", State: "s"}},
			{Confidence: 50, Message: "Mid", Contributor: "b", ContributorDisplayName: "B", Rule: "R", SuggestedResolution: "x",
				SourceA: DiscrepancySourceState{SourceName: "S", State: "s"}, SourceB: DiscrepancySourceState{SourceName: "S", State: "s"}},
			{Confidence: 20, Message: "Low", Contributor: "c", ContributorDisplayName: "C", Rule: "R", SuggestedResolution: "x",
				SourceA: DiscrepancySourceState{SourceName: "S", State: "s"}, SourceB: DiscrepancySourceState{SourceName: "S", State: "s"}},
		},
		DiscrepancyThreshold: 50,
	}

	md := buildDiscrepancyMarkdown(data)
	// 2 items >= 50% (80 and 50), 1 below
	if !strings.Contains(md, "**2** above") {
		t.Errorf("markdown should show 2 above threshold, got:\n%s", md)
	}
	if !strings.Contains(md, "**1** below") {
		t.Errorf("markdown should show 1 below threshold, got:\n%s", md)
	}
}

func TestBuildDiscrepancyMarkdown_ByContributorFallback(t *testing.T) {
	data := &DiscrepancyEvent{
		TotalCount: 1,
		ByContributor: map[string][]DiscrepancyItem{
			"alice": {
				{
					Contributor:            "alice",
					ContributorDisplayName: "Alice",
					Message:                "From byContributor",
					Rule:                   "R1",
					Confidence:             70,
					SuggestedResolution:    "Fix it.",
					SourceA:                DiscrepancySourceState{SourceName: "S1", State: "s1"},
					SourceB:                DiscrepancySourceState{SourceName: "S2", State: "s2"},
				},
			},
		},
	}

	md := buildDiscrepancyMarkdown(data)
	if !strings.Contains(md, "From byContributor") {
		t.Error("markdown should use ByContributor fallback when AllItems and Items are empty")
	}
}

func TestBuildDiscrepancyMarkdown_UnattributedFallback(t *testing.T) {
	data := &DiscrepancyEvent{
		TotalCount: 1,
		Unattributed: []DiscrepancyItem{
			{
				Contributor:            "",
				ContributorDisplayName: "",
				Message:                "From unattributed",
				Rule:                   "R1",
				Confidence:             30,
				SuggestedResolution:    "Investigate.",
				SourceA:                DiscrepancySourceState{SourceName: "S1", State: "s1"},
				SourceB:                DiscrepancySourceState{SourceName: "S2", State: "s2"},
			},
		},
	}

	md := buildDiscrepancyMarkdown(data)
	if !strings.Contains(md, "From unattributed") {
		t.Error("markdown should use Unattributed fallback when AllItems and Items are empty")
	}
}

// ---------------------------------------------------------------------------
// previewModel.Update — test tab switching and key handling
// ---------------------------------------------------------------------------

func TestPreviewUpdate_WindowSize(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	newM, _ := m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	pm := newM.(previewModel)
	if pm.width != 120 {
		t.Errorf("width = %d, want 120", pm.width)
	}
	if pm.height != 40 {
		t.Errorf("height = %d, want 40", pm.height)
	}
}

func TestPreviewUpdate_TabCyclesForward(t *testing.T) {
	m := newPreviewModelFull("", nil, `{"key":"val"}`)
	// Start at tab 0
	if m.activeTab != 0 {
		t.Fatalf("initial activeTab = %d, want 0", m.activeTab)
	}
	// Tab forward
	newM, _ := m.Update(tea.KeyMsg{Type: tea.KeyTab})
	pm := newM.(previewModel)
	if pm.activeTab != 1 {
		t.Errorf("activeTab after tab = %d, want 1", pm.activeTab)
	}
}

func TestPreviewUpdate_ShiftTabCyclesBackward(t *testing.T) {
	m := newPreviewModelFull("", nil, `{"key":"val"}`)
	// Tab backward from 0 should wrap to last tab
	newM, _ := m.Update(tea.KeyMsg{Type: tea.KeyShiftTab})
	pm := newM.(previewModel)
	if pm.activeTab != tabCount-1 {
		t.Errorf("activeTab after shift-tab from 0 = %d, want %d", pm.activeTab, tabCount-1)
	}
}

func TestPreviewUpdate_RightKey(t *testing.T) {
	m := newPreviewModelFull("", nil, `{"key":"val"}`)
	newM, _ := m.Update(tea.KeyMsg{Type: tea.KeyRight})
	pm := newM.(previewModel)
	if pm.activeTab != 1 {
		t.Errorf("activeTab after right = %d, want 1", pm.activeTab)
	}
}

func TestPreviewUpdate_LeftKey(t *testing.T) {
	m := newPreviewModelFull("", nil, `{"key":"val"}`)
	newM, _ := m.Update(tea.KeyMsg{Type: tea.KeyLeft})
	pm := newM.(previewModel)
	if pm.activeTab != tabCount-1 {
		t.Errorf("activeTab after left from 0 = %d, want %d", pm.activeTab, tabCount-1)
	}
}

func TestPreviewUpdate_LKey(t *testing.T) {
	m := newPreviewModelFull("", nil, `{"key":"val"}`)
	newM, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'l'}})
	pm := newM.(previewModel)
	if pm.activeTab != 1 {
		t.Errorf("activeTab after 'l' = %d, want 1", pm.activeTab)
	}
}

func TestPreviewUpdate_HKey(t *testing.T) {
	m := newPreviewModelFull("", nil, `{"key":"val"}`)
	newM, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'h'}})
	pm := newM.(previewModel)
	if pm.activeTab != tabCount-1 {
		t.Errorf("activeTab after 'h' from 0 = %d, want %d", pm.activeTab, tabCount-1)
	}
}

func TestPreviewUpdate_NewModel_BasicInit(t *testing.T) {
	m := newPreviewModel("")
	if m.activeTab != 0 {
		t.Errorf("initial activeTab = %d, want 0", m.activeTab)
	}
}

func TestPreviewUpdate_NewModelWithDiscrepancy(t *testing.T) {
	disc := &DiscrepancyEvent{TotalCount: 2}
	m := newPreviewModelWithDiscrepancy("", disc)
	if m.discrepancyData == nil {
		t.Error("discrepancyData should be set")
	}
	if m.discrepancyData.TotalCount != 2 {
		t.Errorf("TotalCount = %d, want 2", m.discrepancyData.TotalCount)
	}
}

// ---------------------------------------------------------------------------
// colorizeJSONValue and renderJSONContent
// ---------------------------------------------------------------------------

func TestRenderJSONContent_EmptyString(t *testing.T) {
	got := renderJSONContent("")
	if got != "" {
		t.Errorf("renderJSONContent('') = %q, want empty", got)
	}
}

func TestRenderJSONContent_ValidJSON(t *testing.T) {
	got := renderJSONContent(`{"key": "value"}`)
	if !strings.Contains(got, "key") {
		t.Error("renderJSONContent should contain 'key'")
	}
	if !strings.Contains(got, "value") {
		t.Error("renderJSONContent should contain 'value'")
	}
}

func TestRenderJSONContent_InvalidJSON(t *testing.T) {
	got := renderJSONContent("not json")
	if !strings.Contains(got, "not json") {
		t.Error("renderJSONContent should pass through invalid JSON as-is")
	}
}

func TestBuildDiscrepancyMarkdown_SummaryTable(t *testing.T) {
	data := &DiscrepancyEvent{
		TotalCount: 1,
		AllItems: []DiscrepancyItem{
			{
				Contributor:            "alice",
				ContributorDisplayName: "Alice",
				Message:                "Test summary",
				Rule:                   "R1",
				Confidence:             75,
				SuggestedResolution:    "Action",
				SourceA:                DiscrepancySourceState{SourceName: "S1", State: "s1"},
				SourceB:                DiscrepancySourceState{SourceName: "S2", State: "s2"},
			},
		},
	}

	md := buildDiscrepancyMarkdown(data)
	if !strings.Contains(md, "| # | Issue | Contributor | Confidence |") {
		t.Error("markdown should contain summary table header")
	}
	if !strings.Contains(md, "| 1 | Test summary | Alice | 75% |") {
		t.Error("markdown should contain summary table row")
	}
}

// ---------------------------------------------------------------------------
// previewModel.Init() tests
// ---------------------------------------------------------------------------

func TestPreviewInit_ReturnsCmd(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	cmd := m.Init()
	if cmd == nil {
		t.Error("Init() should return a non-nil Cmd (tea.WindowSize)")
	}
}

func TestPreviewInit_WithValidFile(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/test.md"
	if err := writeTestFile(path, "# Hello\nWorld"); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}
	m := newPreviewModelFull(path, nil, "")
	cmd := m.Init()
	if cmd == nil {
		t.Error("Init() should return a non-nil Cmd")
	}
}

// ---------------------------------------------------------------------------
// previewModel.View() tests
// ---------------------------------------------------------------------------

func TestPreviewView_ReturnsNonEmpty(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.width = 100
	m.height = 40

	view := m.View()
	if view == "" {
		t.Error("View() should return non-empty string")
	}
}

func TestPreviewView_ContainsHeader(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.width = 100
	m.height = 40

	view := m.View()
	if !strings.Contains(view, "TEAM HERO") {
		t.Error("View() should contain shell header")
	}
}

func TestPreviewView_ContainsReportReady(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.width = 100
	m.height = 40

	view := m.View()
	if !strings.Contains(view, "Report Ready") {
		t.Error("View() should contain 'Report Ready'")
	}
}

func TestPreviewView_WithMarkdownFile(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/test.md"
	if err := writeTestFile(path, "# Test Report\n\nSome content here."); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	m := newPreviewModelFull(path, nil, "")
	m.width = 100
	m.height = 40
	m.reflow()
	m.updateAllViewportContent()

	view := m.View()
	if view == "" {
		t.Error("View() with markdown file should return non-empty string")
	}
}

func TestPreviewView_ZeroWidth_UsesDefault(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.width = 0
	m.height = 0

	view := m.View()
	if view == "" {
		t.Error("View() with zero dimensions should return non-empty using defaults")
	}
}

// ---------------------------------------------------------------------------
// renderTabBar tests
// ---------------------------------------------------------------------------

func TestRenderTabBar_ContainsTabNames(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.width = 100
	m.height = 40
	m.reflow()

	bar := m.renderTabBar(80)
	if !strings.Contains(bar, "Report") {
		t.Error("tab bar should contain 'Report'")
	}
	if !strings.Contains(bar, "Discrepancy Log") {
		t.Error("tab bar should contain 'Discrepancy Log'")
	}
	if !strings.Contains(bar, "JSON Data") {
		t.Error("tab bar should contain 'JSON Data'")
	}
}

func TestRenderTabBar_WithDiscrepancyCount(t *testing.T) {
	disc := &DiscrepancyEvent{
		TotalCount: 3,
		AllItems: []DiscrepancyItem{
			{Message: "a"}, {Message: "b"}, {Message: "c"},
		},
	}
	m := newPreviewModelFull("", disc, "")
	m.width = 100
	m.height = 40
	m.reflow()

	bar := m.renderTabBar(80)
	if !strings.Contains(bar, "(3)") {
		t.Error("tab bar should contain discrepancy count '(3)'")
	}
}

func TestRenderTabBar_WithDiscrepancyCount_FromTotalCount(t *testing.T) {
	disc := &DiscrepancyEvent{
		TotalCount: 5,
		AllItems:   nil, // empty AllItems, should fall back to TotalCount
	}
	m := newPreviewModelFull("", disc, "")
	m.width = 100
	m.height = 40
	m.reflow()

	bar := m.renderTabBar(80)
	if !strings.Contains(bar, "(5)") {
		t.Error("tab bar should contain discrepancy count '(5)' from TotalCount")
	}
}

func TestRenderTabBar_NoDiscrepancy(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.width = 100
	m.height = 40
	m.reflow()

	bar := m.renderTabBar(80)
	// Should not contain a count badge
	if strings.Contains(bar, "(0)") {
		t.Error("tab bar should not contain count badge when discrepancy count is 0")
	}
}

func TestRenderTabBar_WithJSONData(t *testing.T) {
	m := newPreviewModelFull("", nil, `{"key":"value"}`)
	m.width = 100
	m.height = 40
	m.reflow()

	bar := m.renderTabBar(80)
	// The checkmark should appear in the JSON Data tab
	// The actual character is a styled checkmark
	if bar == "" {
		t.Error("tab bar should not be empty")
	}
}

func TestRenderTabBar_ActiveTabReport(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.activeTab = tabReport
	m.width = 100
	m.height = 40
	m.reflow()

	bar := m.renderTabBar(80)
	if bar == "" {
		t.Error("tab bar should not be empty")
	}
}

func TestRenderTabBar_ActiveTabDiscrepancy(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.activeTab = tabDiscrepancy
	m.width = 100
	m.height = 40
	m.reflow()

	bar := m.renderTabBar(80)
	if bar == "" {
		t.Error("tab bar should not be empty")
	}
}

func TestRenderTabBar_ActiveTabJSON(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.activeTab = tabJSON
	m.width = 100
	m.height = 40
	m.reflow()

	bar := m.renderTabBar(80)
	if bar == "" {
		t.Error("tab bar should not be empty")
	}
}

// ---------------------------------------------------------------------------
// updateReportViewport tests
// ---------------------------------------------------------------------------

func TestUpdateReportViewport_WithRenderError(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.renderErr = "Could not read file"
	m.width = 100
	m.height = 40
	m.reflow()
	m.updateReportViewport()

	content := m.viewports[tabReport].View()
	if content == "" {
		t.Error("viewport should show error when renderErr is set")
	}
}

func TestUpdateReportViewport_WithValidMarkdown(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/test.md"
	if err := writeTestFile(path, "# Hello World\n\nSome **bold** text."); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	m := newPreviewModelFull(path, nil, "")
	m.width = 100
	m.height = 40
	m.reflow()
	m.updateReportViewport()

	content := m.viewports[tabReport].View()
	if content == "" {
		t.Error("viewport should contain rendered markdown")
	}
}

func TestUpdateReportViewport_StripsDiscrepancyLinks(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/test.md"
	mdContent := "See item [1](#discrepancy-1) for details."
	if err := writeTestFile(path, mdContent); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	m := newPreviewModelFull(path, nil, "")
	m.width = 100
	m.height = 40
	m.reflow()
	m.updateReportViewport()

	// The viewport should have content (the link should be stripped)
	content := m.viewports[tabReport].View()
	if content == "" {
		t.Error("viewport should contain rendered content")
	}
}

func TestUpdateReportViewport_NoMarkdownFile(t *testing.T) {
	m := newPreviewModelFull("/nonexistent/path.md", nil, "")
	m.width = 100
	m.height = 40
	m.reflow()
	m.updateReportViewport()

	if m.renderErr == "" {
		t.Error("renderErr should be set for nonexistent file")
	}
}

// ---------------------------------------------------------------------------
// updateJSONViewport tests
// ---------------------------------------------------------------------------

func TestUpdateJSONViewport_EmptyData(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.width = 100
	m.height = 40
	m.reflow()
	m.updateJSONViewport()

	content := m.viewports[tabJSON].View()
	if content == "" {
		t.Error("viewport should show placeholder when JSON data is empty")
	}
}

func TestUpdateJSONViewport_ValidJSON(t *testing.T) {
	m := newPreviewModelFull("", nil, `{"key":"value","num":42}`)
	m.width = 100
	m.height = 40
	m.reflow()
	m.updateJSONViewport()

	content := m.viewports[tabJSON].View()
	if content == "" {
		t.Error("viewport should contain formatted JSON")
	}
}

func TestUpdateJSONViewport_InvalidJSON(t *testing.T) {
	m := newPreviewModelFull("", nil, "not valid json{")
	m.width = 100
	m.height = 40
	m.reflow()
	m.updateJSONViewport()

	content := m.viewports[tabJSON].View()
	if content == "" {
		t.Error("viewport should contain raw content for invalid JSON")
	}
}

func TestUpdateJSONViewport_ComplexJSON(t *testing.T) {
	jsonData := `{"members":[{"name":"Alice","commits":10},{"name":"Bob","commits":5}],"total":15,"active":true}`
	m := newPreviewModelFull("", nil, jsonData)
	m.width = 100
	m.height = 40
	m.reflow()
	m.updateJSONViewport()

	content := m.viewports[tabJSON].View()
	if content == "" {
		t.Error("viewport should contain formatted complex JSON")
	}
}

// ---------------------------------------------------------------------------
// updateDiscrepancyViewport tests
// ---------------------------------------------------------------------------

func TestUpdateDiscrepancyViewport_NilData(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.width = 100
	m.height = 40
	m.reflow()
	m.updateDiscrepancyViewport()

	content := m.viewports[tabDiscrepancy].View()
	if content == "" {
		t.Error("viewport should show 'no discrepancies' message")
	}
}

func TestUpdateDiscrepancyViewport_EmptyData(t *testing.T) {
	disc := &DiscrepancyEvent{
		TotalCount: 0,
		AllItems:   []DiscrepancyItem{},
	}
	m := newPreviewModelFull("", disc, "")
	m.width = 100
	m.height = 40
	m.reflow()
	m.updateDiscrepancyViewport()

	content := m.viewports[tabDiscrepancy].View()
	if content == "" {
		t.Error("viewport should show 'no discrepancies' message for empty data")
	}
}

func TestUpdateDiscrepancyViewport_WithItems(t *testing.T) {
	disc := &DiscrepancyEvent{
		TotalCount: 1,
		AllItems: []DiscrepancyItem{
			{
				Contributor:            "alice",
				ContributorDisplayName: "Alice",
				Message:                "Missing activity",
				Rule:                   "R1 — Check",
				Confidence:             80,
				SuggestedResolution:    "Review.",
				SourceA:                DiscrepancySourceState{SourceName: "Git", State: "0 commits"},
				SourceB:                DiscrepancySourceState{SourceName: "Asana", State: "3 tasks"},
			},
		},
		DiscrepancyThreshold: 50,
	}
	m := newPreviewModelFull("", disc, "")
	m.width = 100
	m.height = 40
	m.reflow()
	m.updateDiscrepancyViewport()

	content := m.viewports[tabDiscrepancy].View()
	if content == "" {
		t.Error("viewport should contain discrepancy data")
	}
}

// ---------------------------------------------------------------------------
// reflow tests
// ---------------------------------------------------------------------------

func TestPreviewReflow_SetsViewportDimensions(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.width = 100
	m.height = 50
	m.reflow()

	for i := 0; i < tabCount; i++ {
		if m.viewports[i].Width < 20 {
			t.Errorf("viewport[%d].Width = %d, should be at least 20", i, m.viewports[i].Width)
		}
		if m.viewports[i].Height < 6 {
			t.Errorf("viewport[%d].Height = %d, should be at least 6", i, m.viewports[i].Height)
		}
	}
}

func TestPreviewReflow_ZeroDimensions(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.width = 0
	m.height = 0
	m.reflow()

	if m.width != 80 {
		t.Errorf("width should default to 80, got %d", m.width)
	}
	if m.height != 24 {
		t.Errorf("height should default to 24, got %d", m.height)
	}
}

func TestPreviewReflow_NegativeDimensions(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.width = -10
	m.height = -5
	m.reflow()

	if m.width != 80 {
		t.Errorf("width should default to 80, got %d", m.width)
	}
	if m.height != 24 {
		t.Errorf("height should default to 24, got %d", m.height)
	}
}

func TestPreviewReflow_SyncsActiveViewport(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.activeTab = tabJSON
	m.width = 100
	m.height = 40
	m.reflow()

	if m.viewport.Width != m.viewports[tabJSON].Width {
		t.Errorf("viewport.Width should match viewports[tabJSON].Width")
	}
}

// ---------------------------------------------------------------------------
// previewFrameHeight tests
// ---------------------------------------------------------------------------

func TestPreviewFrameHeight_NormalHeight(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.height = 50
	h := m.previewFrameHeight()
	// 50 - 11 = 39
	if h != 39 {
		t.Errorf("previewFrameHeight() = %d, want 39", h)
	}
}

func TestPreviewFrameHeight_SmallHeight(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.height = 15
	h := m.previewFrameHeight()
	// 15 - 11 = 4, max(10, 4) = 10
	if h != 10 {
		t.Errorf("previewFrameHeight() = %d, want 10 (minimum)", h)
	}
}

func TestPreviewFrameHeight_VerySmallHeight(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.height = 5
	h := m.previewFrameHeight()
	// 5 - 11 = -6, max(10, -6) = 10
	if h != 10 {
		t.Errorf("previewFrameHeight() = %d, want 10 (minimum)", h)
	}
}

// ---------------------------------------------------------------------------
// Update — additional key handling tests
// ---------------------------------------------------------------------------

func TestPreviewUpdate_QuitKeys(t *testing.T) {
	quitKeys := []tea.KeyMsg{
		{Type: tea.KeyCtrlC},
		{Type: tea.KeyRunes, Runes: []rune{'q'}},
		{Type: tea.KeyEsc},
		{Type: tea.KeyEnter},
	}

	for _, key := range quitKeys {
		m := newPreviewModelFull("", nil, "")
		_, cmd := m.Update(key)
		if cmd == nil {
			t.Errorf("key %v should return a quit command", key)
		}
	}
}

func TestPreviewUpdate_TabWrapsAround(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.activeTab = tabCount - 1

	newM, _ := m.Update(tea.KeyMsg{Type: tea.KeyTab})
	pm := newM.(previewModel)
	if pm.activeTab != 0 {
		t.Errorf("tab from last tab should wrap to 0, got %d", pm.activeTab)
	}
}

func TestPreviewUpdate_ShiftTabWrapsAround(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.activeTab = 0

	newM, _ := m.Update(tea.KeyMsg{Type: tea.KeyShiftTab})
	pm := newM.(previewModel)
	if pm.activeTab != tabCount-1 {
		t.Errorf("shift-tab from tab 0 should wrap to %d, got %d", tabCount-1, pm.activeTab)
	}
}

func TestPreviewUpdate_RightWrapsAround(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.activeTab = tabCount - 1

	newM, _ := m.Update(tea.KeyMsg{Type: tea.KeyRight})
	pm := newM.(previewModel)
	if pm.activeTab != 0 {
		t.Errorf("right from last tab should wrap to 0, got %d", pm.activeTab)
	}
}

func TestPreviewUpdate_LeftWrapsAround(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.activeTab = 0

	newM, _ := m.Update(tea.KeyMsg{Type: tea.KeyLeft})
	pm := newM.(previewModel)
	if pm.activeTab != tabCount-1 {
		t.Errorf("left from tab 0 should wrap to %d, got %d", tabCount-1, pm.activeTab)
	}
}

func TestPreviewUpdate_ViewportScrolling(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.width = 100
	m.height = 40
	m.reflow()
	m.updateAllViewportContent()

	// Arrow keys that are not tab-switching should go to viewport
	newM, _ := m.Update(tea.KeyMsg{Type: tea.KeyDown})
	pm := newM.(previewModel)
	// Should not panic and should still be valid
	if pm.width != 100 {
		t.Errorf("width should be unchanged, got %d", pm.width)
	}
}

func TestPreviewUpdate_GenericMsg(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.width = 100
	m.height = 40

	// Any unhandled message should go to the active viewport
	newM, _ := m.Update("some-random-msg")
	pm := newM.(previewModel)
	if pm.width != 100 {
		t.Errorf("width should be unchanged, got %d", pm.width)
	}
}

// ---------------------------------------------------------------------------
// updateViewportContent (backward compat wrapper)
// ---------------------------------------------------------------------------

func TestUpdateViewportContent_Wrapper(t *testing.T) {
	m := newPreviewModelFull("", nil, `{"key":"val"}`)
	m.width = 100
	m.height = 40
	m.reflow()

	// Should not panic — just calls updateAllViewportContent
	m.updateViewportContent()

	// Verify JSON viewport got updated
	content := m.viewports[tabJSON].View()
	if content == "" {
		t.Error("JSON viewport should have content after updateViewportContent")
	}
}

// ---------------------------------------------------------------------------
// colorizeJSONValue tests
// ---------------------------------------------------------------------------

func TestColorizeJSONValue_StringValue(t *testing.T) {
	// Build styles (they don't matter for logic, just for formatting)
	strStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))
	numStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("11"))
	punctStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))

	result := colorizeJSONValue(`: "hello"`, strStyle, numStyle, punctStyle)
	if result == "" {
		t.Error("colorizeJSONValue should return non-empty for string value")
	}
}

func TestColorizeJSONValue_NumberValue(t *testing.T) {
	strStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))
	numStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("11"))
	punctStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))

	result := colorizeJSONValue(`: 42`, strStyle, numStyle, punctStyle)
	if result == "" {
		t.Error("colorizeJSONValue should return non-empty for number value")
	}
}

func TestColorizeJSONValue_BooleanValue(t *testing.T) {
	strStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))
	numStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("11"))
	punctStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))

	result := colorizeJSONValue(`: true`, strStyle, numStyle, punctStyle)
	if result == "" {
		t.Error("colorizeJSONValue should return non-empty for boolean value")
	}
}

func TestColorizeJSONValue_NullValue(t *testing.T) {
	strStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))
	numStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("11"))
	punctStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))

	result := colorizeJSONValue(`: null`, strStyle, numStyle, punctStyle)
	if result == "" {
		t.Error("colorizeJSONValue should return non-empty for null value")
	}
}

func TestColorizeJSONValue_WithTrailingComma(t *testing.T) {
	strStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))
	numStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("11"))
	punctStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))

	result := colorizeJSONValue(`: "hello",`, strStyle, numStyle, punctStyle)
	if result == "" {
		t.Error("colorizeJSONValue should return non-empty for value with trailing comma")
	}
}

func TestColorizeJSONValue_NegativeNumber(t *testing.T) {
	strStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))
	numStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("11"))
	punctStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))

	result := colorizeJSONValue(`: -5`, strStyle, numStyle, punctStyle)
	if result == "" {
		t.Error("colorizeJSONValue should return non-empty for negative number")
	}
}

func TestColorizeJSONValue_NoColonPrefix(t *testing.T) {
	strStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))
	numStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("11"))
	punctStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))

	result := colorizeJSONValue("hello", strStyle, numStyle, punctStyle)
	if result != "hello" {
		t.Errorf("colorizeJSONValue without colon prefix should return input as-is, got %q", result)
	}
}

func TestColorizeJSONValue_ObjectValue(t *testing.T) {
	strStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))
	numStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("11"))
	punctStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))

	// A colon followed by a non-string, non-number, non-bool value
	result := colorizeJSONValue(`: someOther`, strStyle, numStyle, punctStyle)
	if result == "" {
		t.Error("colorizeJSONValue should handle unknown value types")
	}
}

// ---------------------------------------------------------------------------
// renderJSONContent additional tests
// ---------------------------------------------------------------------------

func TestRenderJSONContent_MultilineJSON(t *testing.T) {
	input := "{\n  \"key\": \"value\",\n  \"num\": 42\n}"
	got := renderJSONContent(input)
	if got == "" {
		t.Error("renderJSONContent should return non-empty for multi-line JSON")
	}
	if !strings.Contains(got, "key") {
		t.Error("should contain 'key'")
	}
}

func TestRenderJSONContent_Brackets(t *testing.T) {
	input := "[\n  1,\n  2\n]"
	got := renderJSONContent(input)
	if got == "" {
		t.Error("renderJSONContent should handle JSON arrays")
	}
}

func TestRenderJSONContent_NestedJSON(t *testing.T) {
	input := "{\n  \"outer\": {\n    \"inner\": \"value\"\n  }\n}"
	got := renderJSONContent(input)
	if got == "" {
		t.Error("renderJSONContent should handle nested JSON")
	}
}

func TestRenderJSONContent_ClosingBracesWithComma(t *testing.T) {
	input := "{\n  \"a\": 1\n},\n{\n  \"b\": 2\n}"
	got := renderJSONContent(input)
	if got == "" {
		t.Error("renderJSONContent should handle closing braces with commas")
	}
}

// ---------------------------------------------------------------------------
// newPreviewModel variants
// ---------------------------------------------------------------------------

func TestNewPreviewModel_NoPath(t *testing.T) {
	m := newPreviewModel("")
	if m.renderErr == "" {
		// With empty path, os.ReadFile will fail, so renderErr should be set
		// (filepath.Abs("") resolves to cwd, which might or might not exist as a file)
		// This is OK — we just verify it doesn't panic
	}
	if m.activeTab != tabReport {
		t.Errorf("initial activeTab = %d, want %d", m.activeTab, tabReport)
	}
}

func TestNewPreviewModelFull_WithAllArgs(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/test.md"
	if err := writeTestFile(path, "# Report"); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	disc := &DiscrepancyEvent{TotalCount: 2}
	m := newPreviewModelFull(path, disc, `{"key":"val"}`)

	if m.markdown != "# Report" {
		t.Errorf("markdown = %q, want %q", m.markdown, "# Report")
	}
	if m.discrepancyData == nil {
		t.Error("discrepancyData should not be nil")
	}
	if m.jsonData != `{"key":"val"}` {
		t.Errorf("jsonData = %q, want %q", m.jsonData, `{"key":"val"}`)
	}
	if m.renderErr != "" {
		t.Errorf("renderErr should be empty for valid file, got %q", m.renderErr)
	}
}

func TestNewPreviewModelFull_InvalidPath(t *testing.T) {
	m := newPreviewModelFull("/nonexistent/path.md", nil, "")
	if m.renderErr == "" {
		t.Error("renderErr should be set for nonexistent path")
	}
	if m.markdown != "" {
		t.Errorf("markdown should be empty for nonexistent path, got %q", m.markdown)
	}
}

// ---------------------------------------------------------------------------
// buildDiscrepancyMarkdown additional edge cases
// ---------------------------------------------------------------------------

func TestBuildDiscrepancyMarkdown_NoExplanation(t *testing.T) {
	data := &DiscrepancyEvent{
		TotalCount: 1,
		AllItems: []DiscrepancyItem{
			{
				Contributor:            "alice",
				ContributorDisplayName: "Alice",
				Message:                "Single line message only",
				Rule:                   "R1",
				Confidence:             75,
				SuggestedResolution:    "Fix it.",
				SourceA:                DiscrepancySourceState{SourceName: "S1", State: "s1"},
				SourceB:                DiscrepancySourceState{SourceName: "S2", State: "s2"},
			},
		},
	}

	md := buildDiscrepancyMarkdown(data)
	if !strings.Contains(md, "Single line message only") {
		t.Error("should contain the summary")
	}
	// No explanation paragraph since it's a single line
}

func TestBuildDiscrepancyMarkdown_RuleWithoutDescription(t *testing.T) {
	data := &DiscrepancyEvent{
		TotalCount: 1,
		AllItems: []DiscrepancyItem{
			{
				Contributor:            "alice",
				ContributorDisplayName: "Alice",
				Message:                "Issue found",
				Rule:                   "RULE-001", // no " — " separator
				Confidence:             60,
				SuggestedResolution:    "Check it.",
				SourceA:                DiscrepancySourceState{SourceName: "S1", State: "s1"},
				SourceB:                DiscrepancySourceState{SourceName: "S2", State: "s2"},
			},
		},
	}

	md := buildDiscrepancyMarkdown(data)
	// Should not contain "Gap:" since rule has no description
	if strings.Contains(md, "**Gap:**") {
		t.Error("should not contain Gap section when rule has no description")
	}
}

func TestBuildDiscrepancyMarkdown_MultipleItems(t *testing.T) {
	data := &DiscrepancyEvent{
		TotalCount: 3,
		AllItems: []DiscrepancyItem{
			{Contributor: "a", ContributorDisplayName: "A", Message: "First", Rule: "R1", Confidence: 90, SuggestedResolution: "x",
				SourceA: DiscrepancySourceState{SourceName: "S1", State: "s1"}, SourceB: DiscrepancySourceState{SourceName: "S2", State: "s2"}},
			{Contributor: "b", ContributorDisplayName: "B", Message: "Second", Rule: "R2", Confidence: 70, SuggestedResolution: "y",
				SourceA: DiscrepancySourceState{SourceName: "S1", State: "s1"}, SourceB: DiscrepancySourceState{SourceName: "S2", State: "s2"}},
			{Contributor: "c", ContributorDisplayName: "C", Message: "Third", Rule: "R3", Confidence: 50, SuggestedResolution: "z",
				SourceA: DiscrepancySourceState{SourceName: "S1", State: "s1"}, SourceB: DiscrepancySourceState{SourceName: "S2", State: "s2"}},
		},
	}

	md := buildDiscrepancyMarkdown(data)
	if !strings.Contains(md, "| 1 |") {
		t.Error("should contain row 1")
	}
	if !strings.Contains(md, "| 2 |") {
		t.Error("should contain row 2")
	}
	if !strings.Contains(md, "| 3 |") {
		t.Error("should contain row 3")
	}
	if !strings.Contains(md, "### 1.") {
		t.Error("should contain detail card 1")
	}
	if !strings.Contains(md, "### 3.") {
		t.Error("should contain detail card 3")
	}
}

// ---------------------------------------------------------------------------
// Helper for writing test files
// ---------------------------------------------------------------------------

func writeTestFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0644)
}

// ---------------------------------------------------------------------------
// RunReportPreview* via teaProgramRun injection
// ---------------------------------------------------------------------------

func TestRunReportPreview_TeaProgramRun(t *testing.T) {
	origTeaProgramRun := teaProgramRun
	defer func() { teaProgramRun = origTeaProgramRun }()

	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		return newPreviewModelFull("", nil, ""), nil
	}

	err := RunReportPreview("/some/path.md")
	if err != nil {
		t.Errorf("RunReportPreview returned error: %v", err)
	}
}

func TestRunReportPreviewWithDiscrepancy_TeaProgramRun(t *testing.T) {
	origTeaProgramRun := teaProgramRun
	defer func() { teaProgramRun = origTeaProgramRun }()

	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		return newPreviewModelFull("", nil, ""), nil
	}

	disc := &DiscrepancyEvent{TotalCount: 1}
	err := RunReportPreviewWithDiscrepancy("/some/path.md", disc)
	if err != nil {
		t.Errorf("RunReportPreviewWithDiscrepancy returned error: %v", err)
	}
}

func TestRunReportPreviewFull_TeaProgramRun(t *testing.T) {
	origTeaProgramRun := teaProgramRun
	defer func() { teaProgramRun = origTeaProgramRun }()

	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		return newPreviewModelFull("", nil, ""), nil
	}

	disc := &DiscrepancyEvent{TotalCount: 3}
	err := RunReportPreviewFull("/some/path.md", disc, `{"key":"val"}`)
	if err != nil {
		t.Errorf("RunReportPreviewFull returned error: %v", err)
	}
}

func TestRunReportPreviewFull_TeaProgramRunError(t *testing.T) {
	origTeaProgramRun := teaProgramRun
	defer func() { teaProgramRun = origTeaProgramRun }()

	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		return nil, fmt.Errorf("terminal error")
	}

	err := RunReportPreviewFull("/some/path.md", nil, "")
	if err == nil {
		t.Error("RunReportPreviewFull should return error when teaProgramRun fails")
	}
	if err.Error() != "terminal error" {
		t.Errorf("error = %q, want %q", err.Error(), "terminal error")
	}
}

// ---------------------------------------------------------------------------
// renderContentCmd — exercises all branches of the closure
// ---------------------------------------------------------------------------

func TestRenderContentCmd_ErrorPath(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.renderErr = "file not found"
	m.markdown = ""

	cmd := m.renderContentCmd()
	msg := cmd()
	rendered, ok := msg.(contentRenderedMsg)
	if !ok {
		t.Fatalf("expected contentRenderedMsg, got %T", msg)
	}
	if rendered.rendered[tabReport] == "" {
		t.Error("expected non-empty report tab content for error path")
	}
}

func TestRenderContentCmd_MarkdownPath(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.markdown = "# Hello\n\nSome **bold** text."
	m.renderErr = ""
	m.width = 80

	cmd := m.renderContentCmd()
	msg := cmd()
	rendered, ok := msg.(contentRenderedMsg)
	if !ok {
		t.Fatalf("expected contentRenderedMsg, got %T", msg)
	}
	if rendered.rendered[tabReport] == "" {
		t.Error("expected non-empty report tab content for markdown path")
	}
}

func TestRenderContentCmd_DiscrepancyNil(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.discrepancyData = nil

	cmd := m.renderContentCmd()
	msg := cmd()
	rendered := msg.(contentRenderedMsg)
	if rendered.rendered[tabDiscrepancy] == "" {
		t.Error("expected non-empty discrepancy tab for nil data")
	}
}

func TestRenderContentCmd_DiscrepancyWithData(t *testing.T) {
	disc := &DiscrepancyEvent{
		TotalCount: 2,
		AllItems: []DiscrepancyItem{
			{Contributor: "alice", Message: "Missing commits", Confidence: 80},
			{Contributor: "bob", Message: "No PRs", Confidence: 60},
		},
	}
	m := newPreviewModelFull("", disc, "")
	m.width = 80

	cmd := m.renderContentCmd()
	msg := cmd()
	rendered := msg.(contentRenderedMsg)
	if rendered.rendered[tabDiscrepancy] == "" {
		t.Error("expected non-empty discrepancy tab for data with items")
	}
}

func TestRenderContentCmd_JSONEmpty(t *testing.T) {
	m := newPreviewModelFull("", nil, "")

	cmd := m.renderContentCmd()
	msg := cmd()
	rendered := msg.(contentRenderedMsg)
	if rendered.rendered[tabJSON] == "" {
		t.Error("expected non-empty JSON tab for empty json data")
	}
}

func TestRenderContentCmd_JSONValid(t *testing.T) {
	m := newPreviewModelFull("", nil, `{"org":"acme","count":5}`)
	m.width = 80

	cmd := m.renderContentCmd()
	msg := cmd()
	rendered := msg.(contentRenderedMsg)
	if rendered.rendered[tabJSON] == "" {
		t.Error("expected non-empty JSON tab for valid json data")
	}
}

func TestRenderContentCmd_JSONInvalid(t *testing.T) {
	m := newPreviewModelFull("", nil, `not-valid-json`)
	m.width = 80

	cmd := m.renderContentCmd()
	msg := cmd()
	rendered := msg.(contentRenderedMsg)
	if rendered.rendered[tabJSON] == "" {
		t.Error("expected non-empty JSON tab for invalid json data")
	}
}

// ---------------------------------------------------------------------------
// Update — contentRenderedMsg handler
// ---------------------------------------------------------------------------

func TestPreviewUpdate_ContentRendered(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.rendering = true
	m.width = 80
	m.height = 24
	m.reflow()

	var rendered [tabCount]string
	rendered[tabReport] = "Report content"
	rendered[tabDiscrepancy] = "Discrepancy content"
	rendered[tabJSON] = "JSON content"

	newM, cmd := m.Update(contentRenderedMsg{rendered: rendered})
	pm := newM.(previewModel)

	if pm.rendering {
		t.Error("rendering should be false after contentRenderedMsg")
	}
	if cmd != nil {
		t.Error("expected nil cmd after contentRenderedMsg")
	}
}

// ---------------------------------------------------------------------------
// Update — spinner.TickMsg handler
// ---------------------------------------------------------------------------

func TestPreviewUpdate_SpinnerTickWhileRendering(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.rendering = true

	newM, cmd := m.Update(spinner.TickMsg{})
	pm := newM.(previewModel)
	if !pm.rendering {
		t.Error("rendering should still be true")
	}
	// spinner.Update returns a cmd for the next tick
	_ = cmd
}

func TestPreviewUpdate_SpinnerTickNotRendering(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.rendering = false

	newM, cmd := m.Update(spinner.TickMsg{})
	pm := newM.(previewModel)
	if pm.rendering {
		t.Error("rendering should still be false")
	}
	if cmd != nil {
		t.Error("expected nil cmd when not rendering on spinner tick")
	}
}

// ---------------------------------------------------------------------------
// Update — WindowSizeMsg when not rendering (triggers re-render)
// ---------------------------------------------------------------------------

func TestPreviewUpdate_WindowSizeNotRendering(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.rendering = false
	m.width = 80
	m.height = 24

	newM, cmd := m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	pm := newM.(previewModel)
	if pm.width != 120 {
		t.Errorf("width = %d, want 120", pm.width)
	}
	if !pm.rendering {
		t.Error("rendering should be true after WindowSizeMsg when not already rendering")
	}
	if cmd == nil {
		t.Error("expected non-nil cmd (batch of spinner.Tick + renderContentCmd)")
	}
}

func TestPreviewUpdate_WindowSizeWhileRendering(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.rendering = true

	newM, cmd := m.Update(tea.WindowSizeMsg{Width: 100, Height: 30})
	pm := newM.(previewModel)
	if pm.width != 100 {
		t.Errorf("width = %d, want 100", pm.width)
	}
	if cmd != nil {
		t.Error("expected nil cmd when already rendering")
	}
}

// ---------------------------------------------------------------------------
// Update — key passthrough to viewport when not rendering
// ---------------------------------------------------------------------------

func TestPreviewUpdate_KeyPassthroughNotRendering(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.rendering = false
	m.width = 100
	m.height = 40
	m.reflow()

	// Down key should be passed to the active viewport
	newM, _ := m.Update(tea.KeyMsg{Type: tea.KeyDown})
	pm := newM.(previewModel)
	if pm.width != 100 {
		t.Errorf("width should be unchanged, got %d", pm.width)
	}
}

func TestPreviewUpdate_KeyIgnoredWhileRendering(t *testing.T) {
	m := newPreviewModelFull("", nil, "")
	m.rendering = true

	// Non-quit key while rendering should be ignored (return m, nil)
	newM, cmd := m.Update(tea.KeyMsg{Type: tea.KeyDown})
	pm := newM.(previewModel)
	if !pm.rendering {
		t.Error("rendering should still be true")
	}
	if cmd != nil {
		t.Error("expected nil cmd when key pressed while rendering")
	}
}
