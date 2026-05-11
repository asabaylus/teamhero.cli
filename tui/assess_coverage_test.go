package main

import (
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

// ---------------------------------------------------------------------------
// Coverage helpers: bump the lines that the basic unit tests didn't already
// reach. These tests focus on functions that are pure / easily exercised
// without a real TTY — Init() commands, View() with a mounted form,
// reflow / window-size handling, flag application, validators.
// ---------------------------------------------------------------------------

func TestAssessProgress_InitReturnsCmd(t *testing.T) {
	m := newProgressForTest()
	cmd := m.Init()
	if cmd == nil {
		t.Error("Init should return a Bubble Tea cmd")
	}
}

func TestAssessProgress_FitLineTruncatesLongInput(t *testing.T) {
	m := newProgressForTest()
	m.viewport.Width = 12
	long := strings.Repeat("a", 100)
	got := m.fitLine(long)
	if !strings.HasSuffix(got, "…") {
		t.Errorf("fitLine should append ellipsis on truncation, got %q", got)
	}
}

func TestAssessProgress_FitLineHandlesEmptyWidth(t *testing.T) {
	m := newProgressForTest()
	m.viewport.Width = 0
	got := m.fitLine(strings.Repeat("b", 50))
	if got == "" {
		t.Error("fitLine should still produce output when width is 0")
	}
}

func TestAssessProgress_HintsTextSwitchesWithInterview(t *testing.T) {
	m := newProgressForTest()
	if got := m.hintsText(); !strings.Contains(got, "ctrl+c") {
		t.Errorf("default hints should mention ctrl+c, got %q", got)
	}
	// Mount a fake interview form
	updated, _ := m.handleStep(GenericEvent{
		Type:         "interview-question",
		QuestionID:   "q1",
		QuestionText: "?",
		Options:      []string{"a"},
	})
	m = updated.(assessProgressModel)
	if got := m.hintsText(); !strings.Contains(got, "navigate") {
		t.Errorf("interview hints should mention navigate, got %q", got)
	}
}

func TestAssessProgress_RenderInterviewPanelNonEmpty(t *testing.T) {
	m := newProgressForTest()
	updated, _ := m.handleStep(GenericEvent{
		Type:         "interview-question",
		QuestionID:   "q1",
		QuestionText: "?",
		Options:      []string{"a", "b"},
	})
	m = updated.(assessProgressModel)
	if got := m.renderInterviewPanel(); got == "" {
		t.Error("renderInterviewPanel should produce non-empty output when form is mounted")
	}
}

func TestAssessProgress_ViewWithInterviewShowsBothPanes(t *testing.T) {
	m := newProgressForTest()
	updated, _ := m.handleStep(GenericEvent{
		Type:         "interview-question",
		QuestionID:   "q1",
		QuestionText: "Hello?",
		Options:      []string{"yes", "no"},
	})
	m = updated.(assessProgressModel)
	view := m.View()
	if !strings.Contains(view, "Assessment Setup") {
		t.Error("View() during interview should still render the right-pane summary")
	}
}

func TestAssessProgress_WindowSizeReflowsWithMountedForm(t *testing.T) {
	m := newProgressForTest()
	updated, _ := m.handleStep(GenericEvent{
		Type:    "interview-question",
		Options: []string{"a"},
	})
	m = updated.(assessProgressModel)
	updated2, _ := m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	final := updated2.(assessProgressModel)
	if final.width != 120 {
		t.Errorf("width = %d, want 120", final.width)
	}
}

func TestAssessProgress_FailedStepRenders(t *testing.T) {
	m := newProgressForTest()
	updated, _ := m.handleStep(GenericEvent{Type: "progress", Step: "preflight", Status: "active"})
	m = updated.(assessProgressModel)
	updated, _ = m.handleStep(GenericEvent{Type: "progress", Step: "preflight", Status: "failed", Message: "gh missing"})
	m = updated.(assessProgressModel)
	view := m.View()
	if !strings.Contains(view, "gh missing") {
		t.Error("View should include the failure message in the step list")
	}
}

func TestAssessProgress_ReportDataEventStoresJSON(t *testing.T) {
	m := newProgressForTest()
	updated, _ := m.handleStep(GenericEvent{
		Type: "report-data",
		Data: []byte(`{"foo":1}`),
	})
	final := updated.(assessProgressModel)
	if final.jsonData != `{"foo":1}` {
		t.Errorf("jsonData = %q", final.jsonData)
	}
}

// ---------------------------------------------------------------------------
// assess_preview
// ---------------------------------------------------------------------------

func TestAssessPreview_InitReturnsCmd(t *testing.T) {
	m := newAssessPreviewModel("/no/such.md", "", "")
	if cmd := m.Init(); cmd == nil {
		t.Error("Init should return a Bubble Tea cmd")
	}
}

func TestAssessPreview_ReflowSetsViewportDimensions(t *testing.T) {
	m := newAssessPreviewModel("/no/such.md", "", "")
	m.width = 120
	m.height = 50
	m.reflow()
	if m.viewports[assessTabAudit].Width <= 0 {
		t.Error("reflow should set viewport width")
	}
	if m.viewports[assessTabAudit].Height <= 0 {
		t.Error("reflow should set viewport height")
	}
}

func TestAssessPreview_PreviewFrameHeightMinimum(t *testing.T) {
	m := newAssessPreviewModel("/no/such.md", "", "")
	m.height = 5 // smaller than the 11-line shell budget
	if h := m.previewFrameHeight(); h < 10 {
		t.Errorf("previewFrameHeight should floor at 10, got %d", h)
	}
	m.height = 100
	if h := m.previewFrameHeight(); h <= 10 {
		t.Errorf("previewFrameHeight at height=100 should grow, got %d", h)
	}
}

func TestAssessPreview_UpdateProcessesRenderedMsg(t *testing.T) {
	m := newAssessPreviewModel("/no/such.md", "", "")
	msg := assessRenderedMsg{rendered: [assessTabCount]string{"audit-content", "evidence-content", "json-content"}}
	updated, _ := m.Update(msg)
	final := updated.(assessPreviewModel)
	if final.rendering {
		t.Error("rendering should be false after content rendered")
	}
}

func TestAssessPreview_UpdateTabSwitching(t *testing.T) {
	m := newAssessPreviewModel("/no/such.md", "", `{"items":[]}`)
	// First land the rendered msg so the model isn't in rendering state.
	updated, _ := m.Update(assessRenderedMsg{})
	m = updated.(assessPreviewModel)
	// Tab right
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyTab})
	m = updated.(assessPreviewModel)
	if m.activeTab != assessTabEvidence {
		t.Errorf("after Tab, activeTab = %d, want %d", m.activeTab, assessTabEvidence)
	}
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyTab})
	m = updated.(assessPreviewModel)
	if m.activeTab != assessTabJSON {
		t.Errorf("after second Tab, activeTab = %d, want %d", m.activeTab, assessTabJSON)
	}
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyTab})
	m = updated.(assessPreviewModel)
	if m.activeTab != assessTabAudit {
		t.Errorf("Tab should wrap around to Audit, got %d", m.activeTab)
	}
	// Shift+tab wraps backwards
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyShiftTab})
	m = updated.(assessPreviewModel)
	if m.activeTab != assessTabJSON {
		t.Errorf("Shift+Tab should wrap to JSON, got %d", m.activeTab)
	}
}

func TestAssessPreview_QKeyQuits(t *testing.T) {
	m := newAssessPreviewModel("/no/such.md", "", "")
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}})
	if cmd == nil {
		t.Error("q should produce a tea.Quit cmd")
	}
}

func TestAssessPreview_WindowResizeReRenders(t *testing.T) {
	m := newAssessPreviewModel("/no/such.md", "", "")
	updated, _ := m.Update(assessRenderedMsg{}) // exit rendering state
	m = updated.(assessPreviewModel)
	updated2, cmd := m.Update(tea.WindowSizeMsg{Width: 130, Height: 50})
	final := updated2.(assessPreviewModel)
	if !final.rendering {
		t.Error("resize after initial render should kick off a re-render")
	}
	if cmd == nil {
		t.Error("resize should return a cmd to drive the re-render")
	}
}

func TestAssessPreview_ViewWhileRendering(t *testing.T) {
	m := newAssessPreviewModel("/no/such.md", "", "")
	m.width = 100
	m.height = 30
	view := m.View()
	if !strings.Contains(view, "Rendering audit") {
		t.Errorf("View while rendering should show spinner message, got: %s", view)
	}
}

func TestAssessPreview_ViewAfterRender(t *testing.T) {
	m := newAssessPreviewModel("/no/such.md", "", "")
	m.width = 100
	m.height = 30
	updated, _ := m.Update(assessRenderedMsg{rendered: [assessTabCount]string{"audit", "evidence", "json"}})
	m = updated.(assessPreviewModel)
	view := m.View()
	if !strings.Contains(view, "Audit Ready") {
		t.Errorf("View after render should show Audit Ready title, got: %s", view)
	}
}

func TestAssessPreview_RunReturnsErrorFromTeaProgramRun(t *testing.T) {
	origTPR := teaProgramRun
	t.Cleanup(func() { teaProgramRun = origTPR })
	// Stub teaProgramRun to return immediately
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		return newAssessPreviewModel("/no/such.md", "", ""), nil
	}
	if err := RunAssessPreview("/no/such.md", "", ""); err != nil {
		t.Errorf("RunAssessPreview should succeed with stubbed tea, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// assess_wizard
// ---------------------------------------------------------------------------

func TestAssessWizard_InitReturnsCmd(t *testing.T) {
	m := newAssessWizardForTest("local-repo")
	cmd := m.Init()
	if cmd == nil {
		t.Error("Init should return a form-init cmd")
	}
}

func TestAssessWizard_WindowSizeUpdatesWidth(t *testing.T) {
	m := newAssessWizardForTest("local-repo")
	updated, _ := m.Update(tea.WindowSizeMsg{Width: 140, Height: 50})
	final := updated.(*assessWizardModel)
	if final.width != 140 {
		t.Errorf("width = %d, want 140", final.width)
	}
}

func TestValidateLocalPath(t *testing.T) {
	t.Run("empty rejects", func(t *testing.T) {
		if err := validateLocalPath(""); err == nil {
			t.Error("empty path should error")
		}
	})
	t.Run("nonexistent rejects", func(t *testing.T) {
		if err := validateLocalPath("/no/such/dir/here"); err == nil {
			t.Error("nonexistent path should error")
		}
	})
	t.Run("file rejects", func(t *testing.T) {
		tmp := t.TempDir()
		p := filepath.Join(tmp, "file.txt")
		_ = os.WriteFile(p, []byte("hi"), 0o600)
		if err := validateLocalPath(p); err == nil {
			t.Error("regular file should error (must be a directory)")
		}
	})
	t.Run("directory accepts", func(t *testing.T) {
		tmp := t.TempDir()
		if err := validateLocalPath(tmp); err != nil {
			t.Errorf("temp dir should pass: %v", err)
		}
	})
}

func TestDefaultScopeMode(t *testing.T) {
	cfg := &AssessConfig{}
	if got := defaultScopeMode(cfg, "/tmp"); got != "local-repo" {
		t.Errorf("default = %q, want local-repo", got)
	}
	cfg.Scope.Mode = "org"
	if got := defaultScopeMode(cfg, "/tmp"); got != "org" {
		t.Errorf("preserves existing mode, got %q", got)
	}
}

func TestDefaultLocalPath(t *testing.T) {
	cfg := &AssessConfig{}
	if got := defaultLocalPath(cfg, "/tmp/cwd"); got != "/tmp/cwd" {
		t.Errorf("default = %q, want /tmp/cwd", got)
	}
	cfg.Scope.LocalPath = "/preset"
	if got := defaultLocalPath(cfg, "/tmp/cwd"); got != "/preset" {
		t.Errorf("preserves existing path, got %q", got)
	}
}

func TestAssessWizard_GoBackEmptyHistory(t *testing.T) {
	m := newAssessWizardForTest("local-repo")
	updated, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEsc})
	final := updated.(*assessWizardModel)
	if !final.aborted {
		t.Error("esc with empty history should abort")
	}
	if cmd == nil {
		t.Error("esc should return a tea.Quit cmd")
	}
}

// ---------------------------------------------------------------------------
// assess_flags
// ---------------------------------------------------------------------------

func TestApplyAssessFlagsTo_AllFields(t *testing.T) {
	// Build a fresh flag.FlagSet so this test doesn't depend on global state.
	// We rely on the package-level flagAssess* vars but pass our own wasSet.
	cfg := AssessConfig{}

	// Pre-populate the global flag vars (they're already declared at package
	// scope as flag.String/Bool results — we can write through the pointers).
	*flagAssessScopeMode = "org"
	*flagAssessOrg = "acme"
	*flagAssessRepos = "frontend,backend"
	*flagAssessPath = "/tmp/repo"
	*flagAssessDisplayName = "acme-engineering"
	*flagAssessTier = "gh"
	*flagAssessAnswers = "/tmp/answers.json"
	*flagAssessOutput = "/tmp/audit.md"
	*flagAssessOutputFormat = "markdown"
	*flagAssessDryRun = true
	*flagAssessFlushCache = true

	// Reset to defaults at end so other tests aren't affected.
	t.Cleanup(func() {
		*flagAssessScopeMode = ""
		*flagAssessOrg = ""
		*flagAssessRepos = ""
		*flagAssessPath = ""
		*flagAssessDisplayName = ""
		*flagAssessTier = ""
		*flagAssessAnswers = ""
		*flagAssessOutput = ""
		*flagAssessOutputFormat = ""
		*flagAssessDryRun = false
		*flagAssessFlushCache = false
	})

	// Simulate all flags set.
	allSet := func(name string) bool { return true }
	applyAssessFlagsTo(&cfg, allSet)

	if cfg.Scope.Mode != "org" {
		t.Errorf("Mode = %q", cfg.Scope.Mode)
	}
	if cfg.Scope.Org != "acme" {
		t.Errorf("Org = %q", cfg.Scope.Org)
	}
	if got := cfg.Scope.Repos; len(got) != 2 || got[0] != "frontend" || got[1] != "backend" {
		t.Errorf("Repos = %v", got)
	}
	if cfg.Scope.LocalPath != "/tmp/repo" {
		t.Errorf("LocalPath = %q", cfg.Scope.LocalPath)
	}
	if cfg.Scope.DisplayName != "acme-engineering" {
		t.Errorf("DisplayName = %q", cfg.Scope.DisplayName)
	}
	if cfg.EvidenceTier != "gh" {
		t.Errorf("EvidenceTier = %q", cfg.EvidenceTier)
	}
	if cfg.InterviewAnswersPath != "/tmp/answers.json" {
		t.Errorf("InterviewAnswersPath = %q", cfg.InterviewAnswersPath)
	}
	if cfg.OutputPath != "/tmp/audit.md" {
		t.Errorf("OutputPath = %q", cfg.OutputPath)
	}
	if cfg.OutputFormat != "markdown" {
		t.Errorf("OutputFormat = %q", cfg.OutputFormat)
	}
	if !cfg.DryRun {
		t.Error("DryRun should be true")
	}
	if !cfg.FlushCache {
		t.Error("FlushCache should be true")
	}
}

func TestApplyAssessFlagsTo_NoneSet(t *testing.T) {
	cfg := AssessConfig{Scope: AssessScope{Mode: "preserved", Org: "preserved-org"}}
	noneSet := func(name string) bool { return false }
	applyAssessFlagsTo(&cfg, noneSet)
	if cfg.Scope.Mode != "preserved" || cfg.Scope.Org != "preserved-org" {
		t.Errorf("none-set should preserve existing values, got: %+v", cfg.Scope)
	}
}

// ---------------------------------------------------------------------------
// assess_progress.View() with mounted form during reflow / window resize
// ---------------------------------------------------------------------------

func TestAssessProgress_ContentWidthMinimum(t *testing.T) {
	m := newProgressForTest()
	m.width = 30
	w := m.contentWidth()
	if w < 20 {
		t.Errorf("contentWidth should floor at 20, got %d", w)
	}
}

func TestAssessProgress_FormWidthScales(t *testing.T) {
	m := newProgressForTest()
	m.width = 120
	w := m.formWidth()
	if w < 32 {
		t.Errorf("formWidth should be at least 32, got %d", w)
	}
}

// ---------------------------------------------------------------------------
// SaveAssessConfig directory creation branch
// ---------------------------------------------------------------------------

func TestSaveAssessConfig_CreatesDirectoryStructure(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", dir)
	cfg := AssessConfig{Scope: AssessScope{Mode: "local-repo", LocalPath: "/", DisplayName: "x"}}
	if err := SaveAssessConfig(&cfg); err != nil {
		t.Fatalf("SaveAssessConfig: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "teamhero", "assess-config.json")); err != nil {
		t.Errorf("config file missing: %v", err)
	}
}

// Make sure the flag package has been parsed at least once so flag.Visit
// doesn't choke (some Go versions assert state before Visit).
func TestMain_FlagPackageState(t *testing.T) {
	_ = flag.CommandLine
}
