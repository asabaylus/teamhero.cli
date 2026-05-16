package main

import (
	"strings"
	"testing"
)

func TestInterviewProgress_DefaultPhasesPending(t *testing.T) {
	m := newInterviewProgressModel()
	for _, phase := range m.Phases() {
		if m.PhaseStatus(phase) != interviewPhasePending {
			t.Errorf("phase %q should start pending, got %v", phase, m.PhaseStatus(phase))
		}
	}
	expected := []string{"clone", "collect-evidence", "extract-measurements", "observe", "audit-write"}
	if len(m.Phases()) != len(expected) {
		t.Fatalf("expected %d phases, got %d (%v)", len(expected), len(m.Phases()), m.Phases())
	}
	for i, want := range expected {
		if m.Phases()[i] != want {
			t.Errorf("phase[%d]: want %q got %q", i, want, m.Phases()[i])
		}
	}
}

func TestInterviewProgress_StartTransitionsPhaseToRunning(t *testing.T) {
	m := newInterviewProgressModel()
	m.applyEvent(GenericEvent{Type: "progress", Step: "clone", Status: "start"})
	if m.PhaseStatus("clone") != interviewPhaseRunning {
		t.Errorf("clone should be running after start event")
	}
	if m.PhaseStatus("collect-evidence") != interviewPhasePending {
		t.Errorf("subsequent phases should remain pending")
	}
}

func TestInterviewProgress_DoneTransitionsPhaseToCompleted(t *testing.T) {
	m := newInterviewProgressModel()
	m.applyEvent(GenericEvent{Type: "progress", Step: "clone", Status: "start"})
	m.applyEvent(GenericEvent{Type: "progress", Step: "clone", Status: "done"})
	if m.PhaseStatus("clone") != interviewPhaseDone {
		t.Errorf("clone should be done")
	}
}

func TestInterviewProgress_ErrorTransitionsPhaseToFailed(t *testing.T) {
	m := newInterviewProgressModel()
	m.applyEvent(GenericEvent{Type: "progress", Step: "observe", Status: "start"})
	m.applyEvent(GenericEvent{Type: "progress", Step: "observe", Status: "error", Message: "OpenAI 503"})
	if m.PhaseStatus("observe") != interviewPhaseFailed {
		t.Errorf("observe should be failed")
	}
	if !strings.Contains(m.PhaseMessage("observe"), "OpenAI 503") {
		t.Errorf("error message should be retained for display, got %q", m.PhaseMessage("observe"))
	}
}

func TestInterviewProgress_UnknownPhaseIsIgnored(t *testing.T) {
	m := newInterviewProgressModel()
	// Should not panic or change other phases when an unknown step name arrives.
	m.applyEvent(GenericEvent{Type: "progress", Step: "definitely-not-a-real-phase", Status: "start"})
	for _, phase := range m.Phases() {
		if m.PhaseStatus(phase) != interviewPhasePending {
			t.Errorf("unknown phase event must not change real phase %q", phase)
		}
	}
}

func TestInterviewProgress_RenderShowsAllPhases(t *testing.T) {
	m := newInterviewProgressModel()
	m.applyEvent(GenericEvent{Type: "progress", Step: "clone", Status: "done"})
	m.applyEvent(GenericEvent{Type: "progress", Step: "collect-evidence", Status: "start"})
	view := m.Render()
	for _, expected := range []string{"clone", "collect-evidence", "extract-measurements", "observe", "audit-write"} {
		if !strings.Contains(view, expected) {
			t.Errorf("render must show phase %q, got %q", expected, view)
		}
	}
}

func TestInterviewProgress_RenderShowsFailureGlyphAndMessage(t *testing.T) {
	m := newInterviewProgressModel()
	m.applyEvent(GenericEvent{Type: "progress", Step: "observe", Status: "error", Message: "OpenAI rate limit"})
	view := m.Render()
	if !strings.Contains(view, "OpenAI rate limit") {
		t.Errorf("render must surface error message for failed phase, got %q", view)
	}
}

func TestInterviewProgress_AllDoneReportsCompletion(t *testing.T) {
	m := newInterviewProgressModel()
	for _, phase := range m.Phases() {
		m.applyEvent(GenericEvent{Type: "progress", Step: phase, Status: "done"})
	}
	if !m.AllDone() {
		t.Errorf("AllDone should be true after every phase reports done")
	}
}

func TestInterviewProgress_AnyFailedReportsFailure(t *testing.T) {
	m := newInterviewProgressModel()
	m.applyEvent(GenericEvent{Type: "progress", Step: "observe", Status: "error", Message: "x"})
	if !m.AnyFailed() {
		t.Errorf("AnyFailed should be true when at least one phase failed")
	}
	if m.AllDone() {
		t.Errorf("AllDone should be false when a phase failed")
	}
}
