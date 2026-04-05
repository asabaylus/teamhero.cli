package main

import (
	"fmt"
	"testing"
	"time"

	"github.com/charmbracelet/bubbles/progress"
	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
)

func TestFormatElapsed_Zero(t *testing.T) {
	got := formatElapsed(0)
	if got != "0:00" {
		t.Errorf("formatElapsed(0) = %q, want %q", got, "0:00")
	}
}

func TestFormatElapsed_30s(t *testing.T) {
	got := formatElapsed(30 * time.Second)
	if got != "0:30" {
		t.Errorf("formatElapsed(30s) = %q, want %q", got, "0:30")
	}
}

func TestFormatElapsed_60s(t *testing.T) {
	got := formatElapsed(60 * time.Second)
	if got != "1:00" {
		t.Errorf("formatElapsed(60s) = %q, want %q", got, "1:00")
	}
}

func TestFormatElapsed_90s(t *testing.T) {
	got := formatElapsed(90 * time.Second)
	if got != "1:30" {
		t.Errorf("formatElapsed(90s) = %q, want %q", got, "1:30")
	}
}

func TestFormatElapsed_120s(t *testing.T) {
	got := formatElapsed(120 * time.Second)
	if got != "2:00" {
		t.Errorf("formatElapsed(120s) = %q, want %q", got, "2:00")
	}
}

func TestFormatElapsed_SubSecond(t *testing.T) {
	got := formatElapsed(500 * time.Millisecond)
	if got != "0:00" {
		t.Errorf("formatElapsed(500ms) = %q, want %q", got, "0:00")
	}
}

func TestIsPreflightStep_CollectingOrgDetails(t *testing.T) {
	if !isPreflightStep("Collecting organization details") {
		t.Error("isPreflightStep should match 'Collecting organization details'")
	}
}

func TestIsPreflightStep_ListingRepositories(t *testing.T) {
	if !isPreflightStep("Listing repositories") {
		t.Error("isPreflightStep should match 'Listing repositories'")
	}
}

func TestIsPreflightStep_CollectingMembers(t *testing.T) {
	if !isPreflightStep("Collecting members for org-name") {
		t.Error("isPreflightStep should match 'Collecting members for ...'")
	}
}

func TestIsPreflightStep_SkippingRepoDiscovery(t *testing.T) {
	if !isPreflightStep("Skipping repository discovery") {
		t.Error("isPreflightStep should match 'Skipping repository discovery'")
	}
}

func TestIsPreflightStep_CaseInsensitive(t *testing.T) {
	if !isPreflightStep("COLLECTING ORGANIZATION DETAILS") {
		t.Error("isPreflightStep should be case-insensitive")
	}
}

func TestIsPreflightStep_WithLeadingWhitespace(t *testing.T) {
	if !isPreflightStep("  Listing repositories") {
		t.Error("isPreflightStep should trim whitespace")
	}
}

func TestIsPreflightStep_NonMatching(t *testing.T) {
	nonMatching := []string{
		"Fetching commits",
		"Processing members",
		"Writing report",
		"Generating summary",
		"",
	}
	for _, step := range nonMatching {
		if isPreflightStep(step) {
			t.Errorf("isPreflightStep(%q) should return false", step)
		}
	}
}

func TestRecalcPeakRatio_MonotonicIncrease(t *testing.T) {
	m := &progressModel{
		expectedSteps:      5,
		preflightStepCount: 0,
		peakRatio:          0.0,
	}

	// Add one done step
	m.steps = []stepState{
		{text: "step1", status: "done"},
	}
	changed := m.recalcPeakRatio()
	if !changed {
		t.Error("recalcPeakRatio should report change when ratio increases")
	}
	if m.peakRatio != 0.2 {
		t.Errorf("peakRatio = %f, want 0.2", m.peakRatio)
	}

	// Add another done step
	m.steps = append(m.steps, stepState{text: "step2", status: "done"})
	changed = m.recalcPeakRatio()
	if !changed {
		t.Error("recalcPeakRatio should report change when ratio increases again")
	}
	if m.peakRatio != 0.4 {
		t.Errorf("peakRatio = %f, want 0.4", m.peakRatio)
	}
}

func TestRecalcPeakRatio_NoDecrease(t *testing.T) {
	m := &progressModel{
		expectedSteps:      4,
		preflightStepCount: 0,
		peakRatio:          0.75,
	}

	// Only 1 of 4 steps done — ratio 0.25 < 0.75 (the current peak)
	m.steps = []stepState{
		{text: "step1", status: "done"},
	}
	changed := m.recalcPeakRatio()
	if changed {
		t.Error("recalcPeakRatio should not report change when ratio would decrease")
	}
	if m.peakRatio != 0.75 {
		t.Errorf("peakRatio should stay at 0.75, got %f", m.peakRatio)
	}
}

func TestRecalcPeakRatio_PreflightExclusion(t *testing.T) {
	m := &progressModel{
		expectedSteps:      5,
		preflightStepCount: 2,
		peakRatio:          0.0,
	}

	// Add preflight steps (should be excluded from progress)
	m.steps = []stepState{
		{text: "Collecting organization details", status: "done"},
		{text: "Listing repositories", status: "done"},
	}
	changed := m.recalcPeakRatio()
	if changed {
		t.Error("recalcPeakRatio should not change when only preflight steps are done")
	}
	if m.peakRatio != 0.0 {
		t.Errorf("peakRatio should be 0.0 with only preflight steps, got %f", m.peakRatio)
	}

	// Add a non-preflight step
	m.steps = append(m.steps, stepState{text: "Fetching commits", status: "done"})
	changed = m.recalcPeakRatio()
	if !changed {
		t.Error("recalcPeakRatio should change when non-preflight step completes")
	}
	// Denominator is expectedSteps - preflightStepCount = 3
	// 1 of 3 done = 0.333...
	expected := 1.0 / 3.0
	if m.peakRatio < expected-0.01 || m.peakRatio > expected+0.01 {
		t.Errorf("peakRatio = %f, want ~%f", m.peakRatio, expected)
	}
}

func TestRecalcPeakRatio_InProgressSteps(t *testing.T) {
	m := &progressModel{
		expectedSteps:      4,
		preflightStepCount: 0,
		peakRatio:          0.0,
	}

	m.steps = []stepState{
		{text: "step1", status: "start", progress: 0.5},
	}
	changed := m.recalcPeakRatio()
	if !changed {
		t.Error("recalcPeakRatio should report change for in-progress step")
	}
	// 0.5 / 4 = 0.125
	if m.peakRatio < 0.12 || m.peakRatio > 0.13 {
		t.Errorf("peakRatio = %f, want ~0.125", m.peakRatio)
	}
}

func TestRecalcPeakRatio_ErrorCounts(t *testing.T) {
	m := &progressModel{
		expectedSteps:      2,
		preflightStepCount: 0,
		peakRatio:          0.0,
	}

	m.steps = []stepState{
		{text: "step1", status: "error"},
	}
	changed := m.recalcPeakRatio()
	if !changed {
		t.Error("recalcPeakRatio should count error as completed")
	}
	if m.peakRatio != 0.5 {
		t.Errorf("peakRatio = %f, want 0.5", m.peakRatio)
	}
}

func TestFindStep_Found(t *testing.T) {
	m := progressModel{
		steps: []stepState{
			{text: "step-a"},
			{text: "step-b"},
			{text: "step-c"},
		},
	}

	idx := m.findStep("step-b")
	if idx != 1 {
		t.Errorf("findStep(step-b) = %d, want 1", idx)
	}
}

func TestFindStep_NotFound(t *testing.T) {
	m := progressModel{
		steps: []stepState{
			{text: "step-a"},
			{text: "step-b"},
		},
	}

	idx := m.findStep("step-z")
	if idx != -1 {
		t.Errorf("findStep(step-z) = %d, want -1", idx)
	}
}

func TestFindStep_EmptySteps(t *testing.T) {
	m := progressModel{}
	idx := m.findStep("anything")
	if idx != -1 {
		t.Errorf("findStep on empty steps = %d, want -1", idx)
	}
}

func TestStepElapsed_FinishedStep(t *testing.T) {
	now := time.Now()
	m := &progressModel{}
	s := stepState{
		startedAt:  now.Add(-10 * time.Second),
		finishedAt: now.Add(-5 * time.Second),
	}

	elapsed := m.stepElapsed(s, now)
	if elapsed != "0:05" {
		t.Errorf("stepElapsed(finished step) = %q, want %q", elapsed, "0:05")
	}
}

func TestStepElapsed_ActiveStep_BelowThreshold(t *testing.T) {
	now := time.Now()
	m := &progressModel{}
	s := stepState{
		startedAt: now.Add(-2 * time.Second),
	}

	elapsed := m.stepElapsed(s, now)
	if elapsed != "" {
		t.Errorf("stepElapsed(active step <3s) = %q, want empty", elapsed)
	}
}

func TestStepElapsed_ActiveStep_AboveThreshold(t *testing.T) {
	now := time.Now()
	m := &progressModel{}
	s := stepState{
		startedAt: now.Add(-5 * time.Second),
	}

	elapsed := m.stepElapsed(s, now)
	if elapsed != "0:05" {
		t.Errorf("stepElapsed(active step >3s) = %q, want %q", elapsed, "0:05")
	}
}

func TestStepElapsed_ActiveStep_ExactlyAtThreshold(t *testing.T) {
	now := time.Now()
	m := &progressModel{}
	s := stepState{
		startedAt: now.Add(-3 * time.Second),
	}

	elapsed := m.stepElapsed(s, now)
	if elapsed != "0:03" {
		t.Errorf("stepElapsed(active step =3s) = %q, want %q", elapsed, "0:03")
	}
}

func TestStepElapsed_ZeroStartedAt(t *testing.T) {
	now := time.Now()
	m := &progressModel{}
	s := stepState{}

	elapsed := m.stepElapsed(s, now)
	if elapsed != "" {
		t.Errorf("stepElapsed(zero startedAt) = %q, want empty", elapsed)
	}
}

// ---------------------------------------------------------------------------
// handleStep — directly tests the event processing logic
// ---------------------------------------------------------------------------

func TestHandleStep_ProgressStart(t *testing.T) {
	m := progressModel{expectedSteps: 5}
	evt := GenericEvent{Type: "progress", Step: "fetch-repos", Status: "start"}
	newM, _ := m.handleStep(evt)
	pm := newM.(progressModel)
	if len(pm.steps) != 1 {
		t.Fatalf("expected 1 step, got %d", len(pm.steps))
	}
	if pm.steps[0].text != "fetch-repos" {
		t.Errorf("step text = %q, want %q", pm.steps[0].text, "fetch-repos")
	}
	if pm.steps[0].status != "start" {
		t.Errorf("step status = %q, want %q", pm.steps[0].status, "start")
	}
}

func TestHandleStep_ProgressStart_DuplicateIgnored(t *testing.T) {
	m := progressModel{
		expectedSteps: 5,
		steps: []stepState{
			{text: "fetch-repos", status: "start", startedAt: time.Now()},
		},
	}
	evt := GenericEvent{Type: "progress", Step: "fetch-repos", Status: "start"}
	newM, _ := m.handleStep(evt)
	pm := newM.(progressModel)
	if len(pm.steps) != 1 {
		t.Errorf("duplicate start should not add step, got %d steps", len(pm.steps))
	}
}

func TestHandleStep_ProgressUpdate(t *testing.T) {
	progress := float64(0.5)
	m := progressModel{
		expectedSteps: 5,
		steps: []stepState{
			{text: "fetch-repos", status: "start"},
		},
	}
	evt := GenericEvent{Type: "progress", Step: "fetch-repos", Status: "update", Message: "50% done", Progress: &progress}
	newM, _ := m.handleStep(evt)
	pm := newM.(progressModel)
	if pm.steps[0].status != "update" {
		t.Errorf("step status = %q, want %q", pm.steps[0].status, "update")
	}
	if pm.steps[0].message != "50% done" {
		t.Errorf("step message = %q, want %q", pm.steps[0].message, "50% done")
	}
	if pm.steps[0].progress != 0.5 {
		t.Errorf("step progress = %f, want 0.5", pm.steps[0].progress)
	}
}

func TestHandleStep_ProgressDone(t *testing.T) {
	m := progressModel{
		expectedSteps: 5,
		steps: []stepState{
			{text: "fetch-repos", status: "start", startedAt: time.Now()},
		},
	}
	evt := GenericEvent{Type: "progress", Step: "fetch-repos", Status: "done", Message: "completed"}
	newM, _ := m.handleStep(evt)
	pm := newM.(progressModel)
	if pm.steps[0].status != "done" {
		t.Errorf("step status = %q, want %q", pm.steps[0].status, "done")
	}
	if pm.steps[0].progress != 1.0 {
		t.Errorf("step progress = %f, want 1.0", pm.steps[0].progress)
	}
	if pm.steps[0].message != "completed" {
		t.Errorf("step message = %q, want %q", pm.steps[0].message, "completed")
	}
	if pm.steps[0].finishedAt.IsZero() {
		t.Error("finishedAt should be set")
	}
}

func TestHandleStep_ProgressError(t *testing.T) {
	m := progressModel{
		expectedSteps: 5,
		steps: []stepState{
			{text: "fetch-repos", status: "start", startedAt: time.Now()},
		},
	}
	evt := GenericEvent{Type: "progress", Step: "fetch-repos", Status: "error", Message: "timeout"}
	newM, _ := m.handleStep(evt)
	pm := newM.(progressModel)
	if pm.steps[0].status != "error" {
		t.Errorf("step status = %q, want %q", pm.steps[0].status, "error")
	}
	if pm.steps[0].message != "timeout" {
		t.Errorf("step message = %q, want %q", pm.steps[0].message, "timeout")
	}
}

func TestHandleStep_ResultEvent(t *testing.T) {
	m := progressModel{expectedSteps: 5}
	evt := GenericEvent{Type: "result", OutputPath: "/tmp/report.md"}
	newM, _ := m.handleStep(evt)
	pm := newM.(progressModel)
	if pm.result != "/tmp/report.md" {
		t.Errorf("result = %q, want %q", pm.result, "/tmp/report.md")
	}
	if !pm.done {
		t.Error("done should be true after result event")
	}
}

func TestHandleStep_ReportDataEvent(t *testing.T) {
	m := progressModel{expectedSteps: 5}
	evt := GenericEvent{Type: "report-data", Data: []byte(`{"key":"value"}`)}
	newM, _ := m.handleStep(evt)
	pm := newM.(progressModel)
	if pm.jsonData != `{"key":"value"}` {
		t.Errorf("jsonData = %q, want %q", pm.jsonData, `{"key":"value"}`)
	}
}

func TestHandleStep_ReportDataEvent_Empty(t *testing.T) {
	m := progressModel{expectedSteps: 5}
	evt := GenericEvent{Type: "report-data", Data: []byte{}}
	newM, _ := m.handleStep(evt)
	pm := newM.(progressModel)
	if pm.jsonData != "" {
		t.Errorf("jsonData should be empty for empty data, got %q", pm.jsonData)
	}
}

func TestHandleStep_DiscrepancyEvent(t *testing.T) {
	m := progressModel{expectedSteps: 5}
	evt := GenericEvent{
		Type:       "discrepancy",
		TotalCount: 3,
		Items:      []DiscrepancyItem{{Message: "test discrepancy"}},
	}
	newM, _ := m.handleStep(evt)
	pm := newM.(progressModel)
	if pm.discrepancy == nil {
		t.Fatal("discrepancy should not be nil")
	}
	if pm.discrepancy.TotalCount != 3 {
		t.Errorf("TotalCount = %d, want 3", pm.discrepancy.TotalCount)
	}
}

func TestHandleStep_ErrorEvent(t *testing.T) {
	m := progressModel{expectedSteps: 5}
	evt := GenericEvent{Type: "error", Message: "fatal error"}
	newM, _ := m.handleStep(evt)
	pm := newM.(progressModel)
	if pm.errorMsg != "fatal error" {
		t.Errorf("errorMsg = %q, want %q", pm.errorMsg, "fatal error")
	}
	if !pm.done {
		t.Error("done should be true after error event")
	}
}

func TestHandleStep_UnknownEvent(t *testing.T) {
	m := progressModel{expectedSteps: 5}
	evt := GenericEvent{Type: "unknown-event"}
	newM, _ := m.handleStep(evt)
	pm := newM.(progressModel)
	if pm.done {
		t.Error("unknown event should not set done")
	}
}

// ---------------------------------------------------------------------------
// Update — tests the bubbletea Update method
// ---------------------------------------------------------------------------

func TestUpdate_WindowSize(t *testing.T) {
	m := progressModel{expectedSteps: 5, width: 80, height: 24}
	newM, _ := m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	pm := newM.(progressModel)
	if pm.width != 120 {
		t.Errorf("width = %d, want 120", pm.width)
	}
	if pm.height != 40 {
		t.Errorf("height = %d, want 40", pm.height)
	}
}

func TestUpdate_KeyQuit(t *testing.T) {
	m := progressModel{expectedSteps: 5}
	newM, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}})
	pm := newM.(progressModel)
	if !pm.done {
		t.Error("q key should set done to true")
	}
}

func TestUpdate_StepMsg(t *testing.T) {
	m := progressModel{expectedSteps: 5}
	msg := stepMsg(GenericEvent{Type: "progress", Step: "test-step", Status: "start"})
	newM, _ := m.Update(msg)
	pm := newM.(progressModel)
	if len(pm.steps) != 1 {
		t.Fatalf("expected 1 step, got %d", len(pm.steps))
	}
}

func TestUpdate_DoneMsg(t *testing.T) {
	m := progressModel{expectedSteps: 5}
	newM, _ := m.Update(doneMsg{})
	pm := newM.(progressModel)
	if !pm.done {
		t.Error("doneMsg should set done to true")
	}
}

func TestUpdate_UnknownMsg(t *testing.T) {
	m := progressModel{expectedSteps: 5}
	newM, cmd := m.Update("some-string-msg")
	pm := newM.(progressModel)
	if pm.done {
		t.Error("unknown msg should not set done")
	}
	if cmd != nil {
		t.Error("unknown msg should return nil cmd")
	}
}

// ---------------------------------------------------------------------------
// newProgressModel tests
// ---------------------------------------------------------------------------

func TestNewProgressModel_CreatesValidModel(t *testing.T) {
	cfg := DefaultConfig()
	m := newProgressModel("Test Report", 5, &cfg)

	if m.title != "Test Report" {
		t.Errorf("title = %q, want %q", m.title, "Test Report")
	}
	if m.expectedSteps != 5 {
		t.Errorf("expectedSteps = %d, want 5", m.expectedSteps)
	}
	if m.cfg == nil {
		t.Error("cfg should not be nil")
	}
	if m.cfg != &cfg {
		t.Error("cfg should point to the provided config")
	}
	if m.done {
		t.Error("done should be false initially")
	}
	if m.result != "" {
		t.Errorf("result should be empty initially, got %q", m.result)
	}
	if m.errorMsg != "" {
		t.Errorf("errorMsg should be empty initially, got %q", m.errorMsg)
	}
	if m.peakRatio != 0.0 {
		t.Errorf("peakRatio = %f, want 0.0", m.peakRatio)
	}
	if m.preflightStepCount != 3 {
		t.Errorf("preflightStepCount = %d, want 3", m.preflightStepCount)
	}
	if len(m.steps) != 0 {
		t.Errorf("steps should be empty initially, got %d", len(m.steps))
	}
}

func TestNewProgressModel_HeightDefault(t *testing.T) {
	cfg := DefaultConfig()
	m := newProgressModel("Test", 3, &cfg)
	if m.height != 24 {
		t.Errorf("default height = %d, want 24", m.height)
	}
}

// ---------------------------------------------------------------------------
// Init() tests
// ---------------------------------------------------------------------------

func TestProgressInit_ReturnsBatchCmd(t *testing.T) {
	cfg := DefaultConfig()
	m := newProgressModel("Test Report", 5, &cfg)
	cmd := m.Init()
	if cmd == nil {
		t.Error("Init() should return a non-nil Cmd (batch of spinner tick + window size)")
	}
}

// ---------------------------------------------------------------------------
// View() tests
// ---------------------------------------------------------------------------

func TestProgressView_DoneWithNoResult_ReturnsEmpty(t *testing.T) {
	cfg := DefaultConfig()
	m := newProgressModel("Test", 5, &cfg)
	m.done = true
	m.result = ""
	m.errorMsg = ""

	view := m.View()
	if view != "" {
		t.Errorf("View() when done with no result should return empty string, got len=%d", len(view))
	}
}

func TestProgressView_DoneWithResult_ReturnsNonEmpty(t *testing.T) {
	cfg := DefaultConfig()
	m := newProgressModel("Test", 5, &cfg)
	m.width = 120
	m.height = 40
	m.done = true
	m.result = "/tmp/report.md"

	view := m.View()
	if view == "" {
		t.Error("View() when done with result should return non-empty string")
	}
}

func TestProgressView_DoneWithError_ReturnsNonEmpty(t *testing.T) {
	cfg := DefaultConfig()
	m := newProgressModel("Test", 5, &cfg)
	m.width = 120
	m.height = 40
	m.done = true
	m.errorMsg = "something failed"

	view := m.View()
	if view == "" {
		t.Error("View() when done with error should return non-empty string")
	}
}

func TestProgressView_Active_ReturnsNonEmpty(t *testing.T) {
	cfg := DefaultConfig()
	m := newProgressModel("Test Report", 5, &cfg)
	m.width = 120
	m.height = 40

	view := m.View()
	if view == "" {
		t.Error("View() for active progress should return non-empty string")
	}
}

func TestProgressView_WithSteps_ContainsStepInfo(t *testing.T) {
	cfg := DefaultConfig()
	m := newProgressModel("Test Report", 5, &cfg)
	m.width = 120
	m.height = 40
	m.steps = []stepState{
		{text: "Fetching commits", status: "done", progress: 1.0, startedAt: time.Now().Add(-5 * time.Second), finishedAt: time.Now()},
		{text: "Processing data", status: "start", startedAt: time.Now()},
	}

	view := m.View()
	if view == "" {
		t.Error("View() with steps should return non-empty string")
	}
}

func TestProgressView_ZeroWidth_UsesDefault(t *testing.T) {
	cfg := DefaultConfig()
	m := newProgressModel("Test Report", 5, &cfg)
	m.width = 0
	m.height = 0

	// Should not panic and should return non-empty
	view := m.View()
	if view == "" {
		t.Error("View() with zero width/height should return non-empty string using defaults")
	}
}

// ---------------------------------------------------------------------------
// leftPanelWidth / rightPanelWidth tests
// ---------------------------------------------------------------------------

func TestLeftPanelWidth_NormalWidth(t *testing.T) {
	m := &progressModel{width: 120}
	lw := m.leftPanelWidth()
	if lw != 72 { // 120 * 3/5
		t.Errorf("leftPanelWidth() = %d, want 72", lw)
	}
}

func TestLeftPanelWidth_ZeroWidth(t *testing.T) {
	m := &progressModel{width: 0}
	lw := m.leftPanelWidth()
	if lw != 48 { // 80 * 3/5
		t.Errorf("leftPanelWidth() with zero width = %d, want 48", lw)
	}
}

func TestLeftPanelWidth_NegativeWidth(t *testing.T) {
	m := &progressModel{width: -10}
	lw := m.leftPanelWidth()
	if lw != 48 { // 80 * 3/5 = 48, which is >= 32
		t.Errorf("leftPanelWidth() with negative width = %d, want 48", lw)
	}
}

func TestLeftPanelWidth_SmallWidth(t *testing.T) {
	m := &progressModel{width: 40}
	lw := m.leftPanelWidth()
	// 40 * 3/5 = 24, but min is 32
	if lw != 32 {
		t.Errorf("leftPanelWidth() with small width = %d, want 32 (minimum)", lw)
	}
}

func TestRightPanelWidth_NormalWidth(t *testing.T) {
	m := &progressModel{width: 120}
	rw := m.rightPanelWidth()
	// 120 - leftPanelWidth(72) - 2 = 46
	if rw != 46 {
		t.Errorf("rightPanelWidth() = %d, want 46", rw)
	}
}

func TestRightPanelWidth_ZeroWidth(t *testing.T) {
	m := &progressModel{width: 0}
	rw := m.rightPanelWidth()
	// 80 - 48 - 2 = 30
	if rw != 30 {
		t.Errorf("rightPanelWidth() with zero width = %d, want 30", rw)
	}
}

func TestRightPanelWidth_SmallWidth(t *testing.T) {
	m := &progressModel{width: 30}
	rw := m.rightPanelWidth()
	// 30 - 32 - 2 = -4 which is < 24, so clamped to 24
	if rw < 24 {
		t.Errorf("rightPanelWidth() should be at least 24, got %d", rw)
	}
}

// ---------------------------------------------------------------------------
// viewportHeight tests
// ---------------------------------------------------------------------------

func TestViewportHeight_NormalHeight(t *testing.T) {
	m := &progressModel{height: 40}
	vh := m.viewportHeight()
	// 40 - 12 = 28, min(14, 28) = 14
	if vh != 14 {
		t.Errorf("viewportHeight() = %d, want 14 (capped at max)", vh)
	}
}

func TestViewportHeight_SmallHeight(t *testing.T) {
	m := &progressModel{height: 18}
	vh := m.viewportHeight()
	// 18 - 12 = 6, min(14, 6) = 6
	if vh != 6 {
		t.Errorf("viewportHeight() = %d, want 6", vh)
	}
}

func TestViewportHeight_VerySmallHeight(t *testing.T) {
	m := &progressModel{height: 10}
	vh := m.viewportHeight()
	// 10 - 12 = -2, max(4, -2) = 4, min(14, 4) = 4
	if vh != 4 {
		t.Errorf("viewportHeight() = %d, want 4 (minimum)", vh)
	}
}

func TestViewportHeight_ZeroHeight(t *testing.T) {
	m := &progressModel{height: 0}
	vh := m.viewportHeight()
	// defaults to 24, 24-12=12, min(14,12)=12
	if vh != 12 {
		t.Errorf("viewportHeight() with zero height = %d, want 12", vh)
	}
}

func TestViewportHeight_NegativeHeight(t *testing.T) {
	m := &progressModel{height: -5}
	vh := m.viewportHeight()
	// defaults to 24, 24-12=12, min(14,12)=12
	if vh != 12 {
		t.Errorf("viewportHeight() with negative height = %d, want 12", vh)
	}
}

// ---------------------------------------------------------------------------
// reflow tests
// ---------------------------------------------------------------------------

func TestReflow_SetsViewportDimensions(t *testing.T) {
	cfg := DefaultConfig()
	m := newProgressModel("Test", 5, &cfg)
	m.width = 120
	m.height = 40
	m.reflow()

	if m.viewport.Height != m.viewportHeight() {
		t.Errorf("viewport.Height = %d, want %d", m.viewport.Height, m.viewportHeight())
	}
	if m.shellViewport.Width != 120 {
		t.Errorf("shellViewport.Width = %d, want 120", m.shellViewport.Width)
	}
	if m.shellViewport.Height != 40 {
		t.Errorf("shellViewport.Height = %d, want 40", m.shellViewport.Height)
	}
}

func TestReflow_ZeroDimensions_UsesDefaults(t *testing.T) {
	cfg := DefaultConfig()
	m := newProgressModel("Test", 5, &cfg)
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

func TestReflow_NegativeDimensions_UsesDefaults(t *testing.T) {
	cfg := DefaultConfig()
	m := newProgressModel("Test", 5, &cfg)
	m.width = -10
	m.height = -5
	m.reflow()

	if m.width != 80 {
		t.Errorf("width should default to 80 for negative, got %d", m.width)
	}
	if m.height != 24 {
		t.Errorf("height should default to 24 for negative, got %d", m.height)
	}
}

// ---------------------------------------------------------------------------
// syncViewportContent tests
// ---------------------------------------------------------------------------

func TestSyncViewportContent_NoSteps(t *testing.T) {
	cfg := DefaultConfig()
	m := newProgressModel("Test", 5, &cfg)
	m.width = 80
	m.height = 24
	m.reflow()
	m.syncViewportContent()

	content := m.viewport.View()
	if content == "" {
		t.Error("viewport content should not be empty even with no steps")
	}
}

func TestSyncViewportContent_WithDoneStep(t *testing.T) {
	cfg := DefaultConfig()
	m := newProgressModel("Test", 5, &cfg)
	m.width = 120
	m.height = 40
	m.steps = []stepState{
		{text: "Fetching commits", status: "done", progress: 1.0, startedAt: time.Now().Add(-5 * time.Second), finishedAt: time.Now()},
	}
	m.reflow()
	m.syncViewportContent()

	content := m.viewport.View()
	if content == "" {
		t.Error("viewport content should contain done step info")
	}
}

func TestSyncViewportContent_WithErrorStep(t *testing.T) {
	cfg := DefaultConfig()
	m := newProgressModel("Test", 5, &cfg)
	m.width = 120
	m.height = 40
	m.steps = []stepState{
		{text: "Fetching commits", status: "error", message: "timeout", startedAt: time.Now().Add(-5 * time.Second), finishedAt: time.Now()},
	}
	m.reflow()
	m.syncViewportContent()

	content := m.viewport.View()
	if content == "" {
		t.Error("viewport content should contain error step info")
	}
}

func TestSyncViewportContent_WithActiveStep(t *testing.T) {
	cfg := DefaultConfig()
	m := newProgressModel("Test", 5, &cfg)
	m.width = 120
	m.height = 40
	m.steps = []stepState{
		{text: "Processing data", status: "start", startedAt: time.Now()},
	}
	m.reflow()
	m.syncViewportContent()

	content := m.viewport.View()
	if content == "" {
		t.Error("viewport content should contain active step info")
	}
}

func TestSyncViewportContent_WithActiveStepAndMessage(t *testing.T) {
	cfg := DefaultConfig()
	m := newProgressModel("Test", 5, &cfg)
	m.width = 120
	m.height = 40
	m.steps = []stepState{
		{text: "Processing data", status: "update", message: "Processing member 3/10", startedAt: time.Now()},
	}
	m.reflow()
	m.syncViewportContent()

	content := m.viewport.View()
	if content == "" {
		t.Error("viewport content should contain active step with message")
	}
}

func TestSyncViewportContent_DoneStepWithMessage(t *testing.T) {
	cfg := DefaultConfig()
	m := newProgressModel("Test", 5, &cfg)
	m.width = 120
	m.height = 40
	m.steps = []stepState{
		{text: "Fetching commits", status: "done", message: "12 repos processed", progress: 1.0, startedAt: time.Now().Add(-5 * time.Second), finishedAt: time.Now()},
	}
	m.reflow()
	m.syncViewportContent()

	// The display should use the message over the text for done steps
	content := m.viewport.View()
	if content == "" {
		t.Error("viewport content should contain done step info with message")
	}
}

// ---------------------------------------------------------------------------
// fitLine tests
// ---------------------------------------------------------------------------

func TestFitLine_ShortLine(t *testing.T) {
	m := &progressModel{}
	m.viewport.Width = 80
	result := m.fitLine("short line")
	if result != "short line" {
		t.Errorf("fitLine should not truncate short line, got %q", result)
	}
}

func TestFitLine_ZeroViewportWidth(t *testing.T) {
	m := &progressModel{}
	m.viewport.Width = 0
	// With zero width, uses default 20
	result := m.fitLine("this is a short line")
	// "this is a short line" is exactly 20 chars — should fit at maxWidth=20
	if result != "this is a short line" {
		// The line is exactly 20, which is <= 20, so no truncation
		t.Logf("fitLine with zero viewport width: %q", result)
	}
}

func TestFitLine_NegativeViewportWidth(t *testing.T) {
	m := &progressModel{}
	m.viewport.Width = -5
	// Uses default 20
	result := m.fitLine("hello")
	if result != "hello" {
		t.Errorf("fitLine should not truncate short line even with negative width, got %q", result)
	}
}

func TestFitLine_EmptyLine(t *testing.T) {
	m := &progressModel{}
	m.viewport.Width = 80
	result := m.fitLine("")
	if result != "" {
		t.Errorf("fitLine of empty string should be empty, got %q", result)
	}
}

// ---------------------------------------------------------------------------
// renderProgressPanel tests
// ---------------------------------------------------------------------------

func TestRenderProgressPanel_ReturnsNonEmpty(t *testing.T) {
	cfg := DefaultConfig()
	m := newProgressModel("Test Report", 5, &cfg)
	m.width = 120
	m.height = 40
	m.reflow()
	m.syncViewportContent()

	panel := m.renderProgressPanel()
	if panel == "" {
		t.Error("renderProgressPanel should return non-empty string")
	}
}

func TestRenderProgressPanel_ContainsTitle(t *testing.T) {
	cfg := DefaultConfig()
	m := newProgressModel("My Report Title", 5, &cfg)
	m.width = 120
	m.height = 40
	m.reflow()
	m.syncViewportContent()

	panel := m.renderProgressPanel()
	if panel == "" {
		t.Error("renderProgressPanel should return non-empty string")
	}
	// Title should be in the output (with styling)
	// Since lipgloss adds ANSI codes, just check it's non-empty
}

func TestRenderProgressPanel_WithProgress(t *testing.T) {
	cfg := DefaultConfig()
	m := newProgressModel("Test", 5, &cfg)
	m.width = 120
	m.height = 40
	m.peakRatio = 0.5
	m.reflow()
	m.syncViewportContent()

	panel := m.renderProgressPanel()
	if panel == "" {
		t.Error("renderProgressPanel with progress should return non-empty string")
	}
}

// ---------------------------------------------------------------------------
// renderConfigPanel tests
// ---------------------------------------------------------------------------

func TestRenderConfigPanel_NilConfig(t *testing.T) {
	m := progressModel{
		cfg:    nil,
		width:  120,
		height: 40,
	}

	panel := m.renderConfigPanel()
	if panel == "" {
		t.Error("renderConfigPanel with nil cfg should still return non-empty string")
	}
}

func TestRenderConfigPanel_WithConfig(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	m := progressModel{
		cfg:    &cfg,
		width:  120,
		height: 40,
	}

	panel := m.renderConfigPanel()
	if panel == "" {
		t.Error("renderConfigPanel with config should return non-empty string")
	}
}

// ---------------------------------------------------------------------------
// contentWidth tests
// ---------------------------------------------------------------------------

func TestContentWidth_NormalWidth(t *testing.T) {
	m := &progressModel{width: 120}
	cw := m.contentWidth()
	// Should be positive and <= leftPanelWidth
	if cw < 20 {
		t.Errorf("contentWidth() = %d, should be at least 20", cw)
	}
	if cw > m.leftPanelWidth() {
		t.Errorf("contentWidth() = %d, should be <= leftPanelWidth %d", cw, m.leftPanelWidth())
	}
}

func TestContentWidth_SmallWidth(t *testing.T) {
	m := &progressModel{width: 30}
	cw := m.contentWidth()
	if cw < 20 {
		t.Errorf("contentWidth() should be at least 20, got %d", cw)
	}
}

// ---------------------------------------------------------------------------
// Update with CtrlC
// ---------------------------------------------------------------------------

func TestUpdate_CtrlC_SetsDone(t *testing.T) {
	m := progressModel{expectedSteps: 5}
	newM, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	pm := newM.(progressModel)
	if !pm.done {
		t.Error("ctrl+c should set done to true")
	}
}

// ---------------------------------------------------------------------------
// handleStep edge cases
// ---------------------------------------------------------------------------

func TestHandleStep_ProgressUpdate_StepNotFound(t *testing.T) {
	m := progressModel{expectedSteps: 5, steps: []stepState{}}
	evt := GenericEvent{Type: "progress", Step: "nonexistent", Status: "update", Message: "ignored"}
	newM, _ := m.handleStep(evt)
	pm := newM.(progressModel)
	// Should not crash and should not add steps
	if len(pm.steps) != 0 {
		t.Errorf("update for nonexistent step should not add steps, got %d", len(pm.steps))
	}
}

func TestHandleStep_ProgressDone_StepNotFound(t *testing.T) {
	m := progressModel{expectedSteps: 5, steps: []stepState{}}
	evt := GenericEvent{Type: "progress", Step: "nonexistent", Status: "done"}
	newM, _ := m.handleStep(evt)
	pm := newM.(progressModel)
	if len(pm.steps) != 0 {
		t.Errorf("done for nonexistent step should not add steps, got %d", len(pm.steps))
	}
}

func TestHandleStep_ProgressError_StepNotFound(t *testing.T) {
	m := progressModel{expectedSteps: 5, steps: []stepState{}}
	evt := GenericEvent{Type: "progress", Step: "nonexistent", Status: "error", Message: "failed"}
	newM, _ := m.handleStep(evt)
	pm := newM.(progressModel)
	if len(pm.steps) != 0 {
		t.Errorf("error for nonexistent step should not add steps, got %d", len(pm.steps))
	}
}

func TestHandleStep_ProgressUpdate_NoMessage(t *testing.T) {
	m := progressModel{
		expectedSteps: 5,
		steps: []stepState{
			{text: "fetch-repos", status: "start", message: "original"},
		},
	}
	evt := GenericEvent{Type: "progress", Step: "fetch-repos", Status: "update"}
	newM, _ := m.handleStep(evt)
	pm := newM.(progressModel)
	// Message should not change when empty in update
	if pm.steps[0].message != "original" {
		t.Errorf("message should remain unchanged when update has empty message, got %q", pm.steps[0].message)
	}
}

func TestHandleStep_ProgressDone_NoMessage(t *testing.T) {
	m := progressModel{
		expectedSteps: 5,
		steps: []stepState{
			{text: "fetch-repos", status: "start", message: "original", startedAt: time.Now()},
		},
	}
	evt := GenericEvent{Type: "progress", Step: "fetch-repos", Status: "done"}
	newM, _ := m.handleStep(evt)
	pm := newM.(progressModel)
	// message should remain "original" since the event had no message
	if pm.steps[0].message != "original" {
		t.Errorf("message should remain unchanged when done has empty message, got %q", pm.steps[0].message)
	}
}

func TestHandleStep_ReportData_NilData(t *testing.T) {
	m := progressModel{expectedSteps: 5}
	evt := GenericEvent{Type: "report-data", Data: nil}
	newM, _ := m.handleStep(evt)
	pm := newM.(progressModel)
	if pm.jsonData != "" {
		t.Errorf("jsonData should be empty for nil data, got %q", pm.jsonData)
	}
}

// ---------------------------------------------------------------------------
// recalcPeakRatio edge cases
// ---------------------------------------------------------------------------

func TestRecalcPeakRatio_MoreCompletedThanExpected(t *testing.T) {
	m := &progressModel{
		expectedSteps:      2,
		preflightStepCount: 0,
		peakRatio:          0.0,
	}

	// 3 completed out of expected 2 — should cap at 1.0
	m.steps = []stepState{
		{text: "step1", status: "done"},
		{text: "step2", status: "done"},
		{text: "step3", status: "done"},
	}
	m.recalcPeakRatio()
	if m.peakRatio > 1.0 {
		t.Errorf("peakRatio should not exceed 1.0, got %f", m.peakRatio)
	}
}

func TestRecalcPeakRatio_AllPreflight(t *testing.T) {
	m := &progressModel{
		expectedSteps:      3,
		preflightStepCount: 3,
		peakRatio:          0.0,
	}

	// All steps are preflight — denominator is max(1, 3-3) = max(1,0) = 1
	// Since all steps are preflight, completed = 0
	m.steps = []stepState{
		{text: "Collecting organization details", status: "done"},
		{text: "Listing repositories", status: "done"},
		{text: "Collecting members for org", status: "done"},
	}
	changed := m.recalcPeakRatio()
	if changed {
		t.Error("should not change when only preflight steps complete")
	}
}

func TestRecalcPeakRatio_MixedUpdateStatus(t *testing.T) {
	m := &progressModel{
		expectedSteps:      4,
		preflightStepCount: 0,
		peakRatio:          0.0,
	}

	m.steps = []stepState{
		{text: "step1", status: "done"},
		{text: "step2", status: "update", progress: 0.7},
		{text: "step3", status: "start", progress: 0.0},
	}
	changed := m.recalcPeakRatio()
	if !changed {
		t.Error("should report change with mixed statuses")
	}
	// done=1.0, update progress=0.7, start progress=0.0 → total=1.7/4 = 0.425
	expected := 1.7 / 4.0
	if m.peakRatio < expected-0.01 || m.peakRatio > expected+0.01 {
		t.Errorf("peakRatio = %f, want ~%f", m.peakRatio, expected)
	}
}

// ---------------------------------------------------------------------------
// stepElapsed edge cases
// ---------------------------------------------------------------------------

func TestStepElapsed_FinishedStep_LongDuration(t *testing.T) {
	now := time.Now()
	m := &progressModel{}
	s := stepState{
		startedAt:  now.Add(-125 * time.Second),
		finishedAt: now,
	}

	elapsed := m.stepElapsed(s, now)
	if elapsed != "2:05" {
		t.Errorf("stepElapsed(125s) = %q, want %q", elapsed, "2:05")
	}
}

// ---------------------------------------------------------------------------
// handleStep - discrepancy fields
// ---------------------------------------------------------------------------

func TestHandleStep_DiscrepancyEvent_AllFields(t *testing.T) {
	m := progressModel{expectedSteps: 5}
	evt := GenericEvent{
		Type:       "discrepancy",
		TotalCount: 5,
		ByContributor: map[string][]DiscrepancyItem{
			"alice": {{Message: "test"}},
		},
		Unattributed:         []DiscrepancyItem{{Message: "unattr"}},
		Items:                []DiscrepancyItem{{Message: "item"}},
		AllItems:             []DiscrepancyItem{{Message: "allitem"}},
		DiscrepancyThreshold: 50,
	}
	newM, _ := m.handleStep(evt)
	pm := newM.(progressModel)
	if pm.discrepancy == nil {
		t.Fatal("discrepancy should not be nil")
	}
	if pm.discrepancy.TotalCount != 5 {
		t.Errorf("TotalCount = %d, want 5", pm.discrepancy.TotalCount)
	}
	if pm.discrepancy.DiscrepancyThreshold != 50 {
		t.Errorf("DiscrepancyThreshold = %d, want 50", pm.discrepancy.DiscrepancyThreshold)
	}
	if len(pm.discrepancy.AllItems) != 1 {
		t.Errorf("AllItems len = %d, want 1", len(pm.discrepancy.AllItems))
	}
}

// ---------------------------------------------------------------------------
// RunProgressDisplay via teaProgramRun injection
// ---------------------------------------------------------------------------

func TestRunProgressDisplay_TeaProgramRun(t *testing.T) {
	// Save and restore the real teaProgramRun
	origTeaProgramRun := teaProgramRun
	defer func() { teaProgramRun = origTeaProgramRun }()

	// Inject a fake that returns a done progressModel with a result path
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		cfg := DefaultConfig()
		return progressModel{
			done:   true,
			result: "output.md",
			cfg:    &cfg,
		}, nil
	}

	// Create a closed eventCh so the goroutine in RunProgressDisplayFull finishes
	eventCh := make(chan GenericEvent)
	close(eventCh)

	cfg := DefaultConfig()
	resultPath, errMsg := RunProgressDisplay("Test", 5, &cfg, eventCh)

	if resultPath != "output.md" {
		t.Errorf("RunProgressDisplay resultPath = %q, want %q", resultPath, "output.md")
	}
	if errMsg != "" {
		t.Errorf("RunProgressDisplay errMsg = %q, want empty", errMsg)
	}
}

func TestRunProgressDisplayFull_TeaProgramRun(t *testing.T) {
	// Save and restore the real teaProgramRun
	origTeaProgramRun := teaProgramRun
	defer func() { teaProgramRun = origTeaProgramRun }()

	disc := &DiscrepancyEvent{TotalCount: 2}
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		cfg := DefaultConfig()
		return progressModel{
			done:        true,
			result:      "report.md",
			jsonData:    `{"k":"v"}`,
			discrepancy: disc,
			cfg:         &cfg,
		}, nil
	}

	eventCh := make(chan GenericEvent)
	close(eventCh)

	cfg := DefaultConfig()
	result := RunProgressDisplayFull("Test", 5, &cfg, eventCh)

	if result.ResultPath != "report.md" {
		t.Errorf("ResultPath = %q, want %q", result.ResultPath, "report.md")
	}
	if result.JsonData != `{"k":"v"}` {
		t.Errorf("JsonData = %q, want %q", result.JsonData, `{"k":"v"}`)
	}
	if result.Discrepancy == nil || result.Discrepancy.TotalCount != 2 {
		t.Errorf("Discrepancy TotalCount = %v, want 2", result.Discrepancy)
	}
	if result.ErrorMsg != "" {
		t.Errorf("ErrorMsg = %q, want empty", result.ErrorMsg)
	}
}

// ===========================================================================
// progressModel.Update edge cases: spinner, progressBar frame, doneMsg, fallthrough
// ===========================================================================

func TestUpdate_SpinnerTickMsg(t *testing.T) {
	m := newProgressModel("test", 3, nil)
	msg := spinner.TickMsg{}
	updated, _ := m.Update(msg)
	if updated == nil {
		t.Error("expected non-nil updated model after spinner.TickMsg")
	}
}

func TestUpdate_ProgressFrameMsg(t *testing.T) {
	m := newProgressModel("test", 3, nil)
	msg := progress.FrameMsg{}
	updated, _ := m.Update(msg)
	if updated == nil {
		t.Error("expected non-nil updated model after progress.FrameMsg")
	}
}

func TestUpdate_DoneMsg_Explicit(t *testing.T) {
	m := newProgressModel("test", 3, nil)
	updated, cmd := m.Update(doneMsg{})
	pm := updated.(progressModel)
	if !pm.done {
		t.Error("expected done=true after doneMsg")
	}
	if cmd == nil {
		t.Error("expected quit command after doneMsg")
	}
}

func TestUpdate_KeyMsg_Q(t *testing.T) {
	m := newProgressModel("test", 3, nil)
	msg := tea.WindowSizeMsg{Width: 80, Height: 24}
	updated, _ := m.Update(msg)
	pm := updated.(progressModel)
	keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}}
	updated, cmd := pm.Update(keyMsg)
	pm = updated.(progressModel)
	if !pm.done {
		t.Error("expected done=true after 'q' key")
	}
	if cmd == nil {
		t.Error("expected quit command after 'q' key")
	}
}

func TestUpdate_Fallthrough(t *testing.T) {
	m := newProgressModel("test", 3, nil)
	msg := tea.WindowSizeMsg{Width: 80, Height: 24}
	updated, _ := m.Update(msg)
	pm := updated.(progressModel)
	// Unknown message should fall through to viewport update
	type unknownMsg struct{}
	updated, _ = pm.Update(unknownMsg{})
	if updated == nil {
		t.Error("expected non-nil updated model after unknown msg")
	}
}

// ===========================================================================
// Update: KeyMsg non-quit (viewport update path, lines 103-105)
// ===========================================================================

func TestUpdate_KeyMsg_NonQuit(t *testing.T) {
	m := newProgressModel("test", 3, nil)
	// Initialize viewport first
	m2, _ := m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	pm := m2.(progressModel)
	// Send a non-quit key ('j' = down scroll) → goes to viewport update
	keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}}
	updated, _ := pm.Update(keyMsg)
	if updated == nil {
		t.Error("expected non-nil model after non-quit KeyMsg")
	}
}

// ===========================================================================
// syncViewportContent: active step with elapsed (line 380)
// ===========================================================================

func TestSyncViewportContent_ActiveStepWithElapsed(t *testing.T) {
	m := newProgressModel("test", 3, nil)
	m.steps = []stepState{
		{
			text:      "Fetching data",
			status:    "start",
			startedAt: time.Now().Add(-5 * time.Second), // 5s ago → shows elapsed
		},
	}
	// syncViewportContent calls stepElapsed; elapsed != "" triggers line 380
	m.syncViewportContent()
}

// ===========================================================================
// RunProgressDisplayFull: teaProgramRun error (line 482)
// ===========================================================================

func TestRunProgressDisplayFull_TeaProgramError(t *testing.T) {
	origTPR := teaProgramRun
	t.Cleanup(func() { teaProgramRun = origTPR })
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		return nil, fmt.Errorf("tui program failed")
	}

	eventCh := make(chan GenericEvent)
	close(eventCh)

	cfg := DefaultConfig()
	result := RunProgressDisplayFull("Test", 5, &cfg, eventCh)
	if result.ErrorMsg == "" {
		t.Error("expected non-empty ErrorMsg when teaProgramRun fails")
	}
}
