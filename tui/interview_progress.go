package main

import (
	"fmt"
	"strings"
)

type interviewPhaseStatus int

const (
	interviewPhasePending interviewPhaseStatus = iota
	interviewPhaseRunning
	interviewPhaseDone
	interviewPhaseFailed
)

// interviewPhases lists the canonical phases of the `interview grade`
// pipeline in execution order. The TS subprocess emits these step names via
// the InterviewProgressEvent protocol.
var interviewPhases = []string{
	"clone",
	"collect-evidence",
	"extract-measurements",
	"observe",
	"audit-write",
}

// interviewProgressModel holds the per-phase status. It is pure state; the
// caller (a bubbletea program in production, or a test) feeds it events via
// applyEvent and asks for Render() to display the current state.
type interviewProgressModel struct {
	phases   []string
	status   map[string]interviewPhaseStatus
	messages map[string]string
	styles   interviewStyles
}

func newInterviewProgressModel() *interviewProgressModel {
	phases := append([]string(nil), interviewPhases...)
	m := &interviewProgressModel{
		phases:   phases,
		status:   make(map[string]interviewPhaseStatus, len(phases)),
		messages: make(map[string]string, len(phases)),
		styles:   newInterviewStyles(),
	}
	for _, p := range phases {
		m.status[p] = interviewPhasePending
	}
	return m
}

func (m *interviewProgressModel) Phases() []string {
	return m.phases
}

func (m *interviewProgressModel) PhaseStatus(name string) interviewPhaseStatus {
	if s, ok := m.status[name]; ok {
		return s
	}
	return interviewPhasePending
}

func (m *interviewProgressModel) PhaseMessage(name string) string {
	return m.messages[name]
}

// applyEvent updates phase state from a single ProgressEvent. Unknown phase
// names are silently ignored so the model is resilient to subprocess
// extensions.
func (m *interviewProgressModel) applyEvent(evt GenericEvent) {
	if evt.Type != "progress" {
		return
	}
	if _, known := m.status[evt.Step]; !known {
		return
	}
	switch evt.Status {
	case "start":
		m.status[evt.Step] = interviewPhaseRunning
	case "done":
		m.status[evt.Step] = interviewPhaseDone
	case "error":
		m.status[evt.Step] = interviewPhaseFailed
		if evt.Message != "" {
			m.messages[evt.Step] = evt.Message
		}
	case "update":
		// keep running, just record message for tooltip-style display
		if evt.Message != "" {
			m.messages[evt.Step] = evt.Message
		}
	}
}

// AllDone reports whether every phase has reached the done state.
func (m *interviewProgressModel) AllDone() bool {
	for _, p := range m.phases {
		if m.status[p] != interviewPhaseDone {
			return false
		}
	}
	return true
}

// AnyFailed reports whether any phase reached the failed state.
func (m *interviewProgressModel) AnyFailed() bool {
	for _, p := range m.phases {
		if m.status[p] == interviewPhaseFailed {
			return true
		}
	}
	return false
}

// Render returns a plain-text view of the progress display suitable for
// printing to a bubbletea View() call. Each phase appears on its own line
// with a glyph for its state.
func (m *interviewProgressModel) Render() string {
	var b strings.Builder
	for _, p := range m.phases {
		glyph := "○"
		switch m.status[p] {
		case interviewPhaseRunning:
			glyph = "◐"
		case interviewPhaseDone:
			glyph = m.styles.PhaseDone().Render("✔")
		case interviewPhaseFailed:
			glyph = m.styles.PhaseFailed().Render("✖")
		}
		fmt.Fprintf(&b, "%s %s", glyph, p)
		if msg := m.messages[p]; msg != "" {
			fmt.Fprintf(&b, "  — %s", msg)
		}
		b.WriteByte('\n')
	}
	return b.String()
}
