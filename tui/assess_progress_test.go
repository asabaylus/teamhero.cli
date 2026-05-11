package main

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func newProgressForTest() assessProgressModel {
	cfg := DefaultAssessConfig()
	m := newAssessProgressModel("Test", &cfg, 7, func(_, _ string, _ bool) error { return nil })
	m.width = 100
	m.height = 30
	m.reflow()
	return m
}

func TestNewAssessProgressModel(t *testing.T) {
	m := newProgressForTest()
	if m.title != "Test" {
		t.Errorf("title = %q, want %q", m.title, "Test")
	}
	if len(m.expectedSteps) != len(canonicalAssessSteps) {
		t.Errorf("expectedSteps = %d, want %d", len(m.expectedSteps), len(canonicalAssessSteps))
	}
	if m.totalQuestions != 7 {
		t.Errorf("totalQuestions = %d, want 7", m.totalQuestions)
	}
	if m.cfg == nil {
		t.Error("cfg is nil")
	}
}

func TestAssessProgress_HandleStepActiveAddsStep(t *testing.T) {
	m := newProgressForTest()
	updated, _ := m.handleStep(GenericEvent{Type: "progress", Step: "preflight", Status: "active", Message: "starting"})
	model := updated.(assessProgressModel)
	if len(model.steps) != 1 {
		t.Fatalf("steps count = %d, want 1", len(model.steps))
	}
	if model.steps[0].text != "preflight" || model.steps[0].status != "active" {
		t.Errorf("step = %+v", model.steps[0])
	}
}

func TestAssessProgress_HandleStepCompletePromotesStep(t *testing.T) {
	m := newProgressForTest()
	m1, _ := m.handleStep(GenericEvent{Type: "progress", Step: "preflight", Status: "active", Message: "..."})
	m2, _ := m1.(assessProgressModel).handleStep(GenericEvent{Type: "progress", Step: "preflight", Status: "complete", Message: "Tier resolved: gh"})
	final := m2.(assessProgressModel)
	if final.steps[0].status != "complete" {
		t.Errorf("status = %q, want complete", final.steps[0].status)
	}
	if final.steps[0].message != "Tier resolved: gh" {
		t.Errorf("message = %q", final.steps[0].message)
	}
	if final.steps[0].finishedAt.IsZero() {
		t.Error("finishedAt not set")
	}
}

func TestAssessProgress_PeakRatioMonotonic(t *testing.T) {
	m := newProgressForTest()
	steps := []string{"startup", "preflight", "adjacent-repos", "interview"}
	for _, s := range steps {
		updated, _ := m.handleStep(GenericEvent{Type: "progress", Step: s, Status: "complete"})
		m = updated.(assessProgressModel)
	}
	if m.peakRatio <= 0 {
		t.Errorf("peakRatio = %f, want >0", m.peakRatio)
	}
	prev := m.peakRatio
	updated, _ := m.handleStep(GenericEvent{Type: "progress", Step: "preflight", Status: "active"})
	final := updated.(assessProgressModel)
	if final.peakRatio < prev {
		t.Errorf("peakRatio regressed: prev=%f now=%f", prev, final.peakRatio)
	}
}

func TestAssessProgress_ResultEventStoresPaths(t *testing.T) {
	m := newProgressForTest()
	updated, cmd := m.handleStep(GenericEvent{
		Type:           "result",
		OutputPath:     "./audit.md",
		JsonOutputPath: "./audit.json",
		Data:           []byte(`{"items":[]}`),
	})
	final := updated.(assessProgressModel)
	if final.resultPath != "./audit.md" {
		t.Errorf("resultPath = %q", final.resultPath)
	}
	if final.jsonPath != "./audit.json" {
		t.Errorf("jsonPath = %q", final.jsonPath)
	}
	if !final.done {
		t.Error("done not set on result")
	}
	if cmd == nil {
		t.Error("expected a tea.Quit cmd on result")
	}
}

func TestAssessProgress_ErrorEventCapturesMessage(t *testing.T) {
	m := newProgressForTest()
	updated, _ := m.handleStep(GenericEvent{Type: "error", Message: "boom"})
	final := updated.(assessProgressModel)
	if final.errorMsg != "boom" {
		t.Errorf("errorMsg = %q", final.errorMsg)
	}
	if !final.done {
		t.Error("done not set on error")
	}
}

func TestAssessProgress_InterviewQuestionMountsForm(t *testing.T) {
	m := newProgressForTest()
	updated, _ := m.handleStep(GenericEvent{Type: "progress", Step: "interview", Status: "active", Message: "Gathering Phase-1…"})
	m = updated.(assessProgressModel)
	updated, _ = m.handleStep(GenericEvent{
		Type:         "interview-question",
		QuestionID:   "q1",
		QuestionText: "what?",
		Options:      []string{"a", "b", "I don't know"},
		AllowFreeText: true,
	})
	final := updated.(assessProgressModel)
	if final.interviewEvent == nil {
		t.Fatal("interviewEvent should be set")
	}
	if final.interviewForm == nil {
		t.Fatal("interviewForm should be mounted")
	}
	if final.interview != interviewSelecting {
		t.Errorf("interview state = %d, want interviewSelecting (%d)", final.interview, interviewSelecting)
	}
	idx := final.findStep("interview")
	if idx < 0 {
		t.Fatal("interview step not found")
	}
	if !strings.Contains(final.steps[idx].message, "Question 1 of 7") {
		t.Errorf("message = %q, want 'Question 1 of 7' progress", final.steps[idx].message)
	}
}

func TestAssessProgress_SubmitInterviewAdvances(t *testing.T) {
	captured := struct {
		qid     string
		value   string
		isOption bool
	}{}
	cfg := DefaultAssessConfig()
	m := newAssessProgressModel("Test", &cfg, 7, func(qid, value string, isOption bool) error {
		captured.qid = qid
		captured.value = value
		captured.isOption = isOption
		return nil
	})
	m.width = 100
	m.height = 30
	m.reflow()

	// Fire the question then simulate the form completing with a chosen option.
	updated, _ := m.handleStep(GenericEvent{
		Type:         "interview-question",
		QuestionID:   "q1",
		QuestionText: "what?",
		Options:      []string{"yes", "no", "I don't know"},
	})
	m = updated.(assessProgressModel)
	m.interviewChoice = "yes"

	updated2, _ := m.advanceInterview()
	final := updated2.(assessProgressModel)
	if captured.qid != "q1" || captured.value != "yes" || !captured.isOption {
		t.Errorf("captured = %+v, want q1/yes/true", captured)
	}
	if final.interview != interviewIdle {
		t.Errorf("interview state should be idle after submit, got %d", final.interview)
	}
	if final.interviewForm != nil {
		t.Error("interviewForm should be nil after submit")
	}
	if final.answersSent != 1 {
		t.Errorf("answersSent = %d, want 1", final.answersSent)
	}
}

func TestAssessProgress_FreeTextSentinelTransitions(t *testing.T) {
	cfg := DefaultAssessConfig()
	m := newAssessProgressModel("Test", &cfg, 7, func(_, _ string, _ bool) error { return nil })
	m.width = 100
	m.height = 30
	m.reflow()

	updated, _ := m.handleStep(GenericEvent{
		Type:         "interview-question",
		QuestionID:   "q5",
		QuestionText: "?",
		Options:      []string{"a"},
		AllowFreeText: true,
	})
	m = updated.(assessProgressModel)
	m.interviewChoice = interviewFreeTextSentinel

	updated2, _ := m.advanceInterview()
	final := updated2.(assessProgressModel)
	if final.interview != interviewFreeText {
		t.Errorf("expected transition to interviewFreeText, got %d", final.interview)
	}
	if final.interviewForm == nil {
		t.Error("free-text form should be mounted")
	}
}

func TestAssessProgress_FreeTextEmptyMapsToUnknown(t *testing.T) {
	captured := ""
	cfg := DefaultAssessConfig()
	m := newAssessProgressModel("Test", &cfg, 7, func(_, value string, _ bool) error {
		captured = value
		return nil
	})
	m.width = 100
	m.height = 30
	m.reflow()
	m.interviewEvent = &GenericEvent{QuestionID: "q5"}
	m.interview = interviewFreeText
	m.interviewFreeText = "   "

	updated, _ := m.advanceInterview()
	final := updated.(assessProgressModel)
	if captured != "unknown" {
		t.Errorf("empty free-text should map to 'unknown', got %q", captured)
	}
	if final.interview != interviewIdle {
		t.Errorf("should reset to interviewIdle, got %d", final.interview)
	}
}

func TestAssessProgress_HumanizeStep(t *testing.T) {
	cases := map[string]string{
		"startup":        "Initializing assessment",
		"preflight":      "Detecting evidence tier",
		"adjacent-repos": "Mapping adjacent repositories",
		"interview":      "Phase-1 interview",
		"evidence":       "Collecting evidence",
		"scoring":        "AI scoring",
		"writing":        "Writing audit",
		"audit-store":    "Updating CONFIG.md",
		"complete":       "Audit complete",
		"unknown-step":   "unknown-step",
	}
	for input, want := range cases {
		got := humanizeStep(input)
		if got != want {
			t.Errorf("humanizeStep(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestAssessProgress_ViewRendersTitleAndPanels(t *testing.T) {
	m := newProgressForTest()
	updated, _ := m.handleStep(GenericEvent{Type: "progress", Step: "preflight", Status: "active"})
	m = updated.(assessProgressModel)
	view := m.View()
	if !strings.Contains(view, "Test") {
		t.Error("view missing title")
	}
	if !strings.Contains(view, "Assessment Setup") {
		t.Error("view missing right-pane summary header")
	}
}

func TestAssessProgress_KeyCtrlCSetsCancelled(t *testing.T) {
	m := newProgressForTest()
	updated, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	final := updated.(assessProgressModel)
	if !final.cancelled {
		t.Error("cancelled should be true after ctrl+c")
	}
	if !final.done {
		t.Error("done should be true after ctrl+c")
	}
	if cmd == nil {
		t.Error("expected tea.Quit cmd")
	}
}

func TestAssessProgress_QKeyDuringInterviewIsRoutedToForm(t *testing.T) {
	// While the interview form is mounted, key events go to the form (not
	// the progress display's quit handler) so users can type freely.
	m := newProgressForTest()
	updated, _ := m.handleStep(GenericEvent{
		Type:         "interview-question",
		QuestionID:   "q1",
		QuestionText: "?",
		Options:      []string{"a", "b"},
	})
	m = updated.(assessProgressModel)
	updated2, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}})
	final := updated2.(assessProgressModel)
	if final.cancelled {
		t.Error("cancelled should remain false while interview form is active")
	}
}

func TestAssessProgress_ViewportSizesScaleWithWindow(t *testing.T) {
	m := newProgressForTest()
	updated, _ := m.Update(tea.WindowSizeMsg{Width: 200, Height: 60})
	final := updated.(assessProgressModel)
	if final.contentWidth() < 50 {
		t.Errorf("contentWidth too small at width=200: got %d", final.contentWidth())
	}
}
