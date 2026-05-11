package main

import (
	"github.com/charmbracelet/lipgloss"
)

// interviewStyles centralizes the lipgloss colors and helpers used across
// every `teamhero interview` screen. Keeping these in one place is what lets
// future polish keep visual parity with the report wizard.
type interviewStyles struct {
	HeaderColor  lipgloss.Color // primary purple — matches renderShellHeader
	DimColor     lipgloss.Color // muted gray for descriptions
	WarningColor lipgloss.Color // ADVISORY banner
	SuccessColor lipgloss.Color // ✔ phase complete
	ErrorColor   lipgloss.Color // ✖ phase failed
}

func newInterviewStyles() interviewStyles {
	return interviewStyles{
		HeaderColor:  lipgloss.Color("212"), // matches `purple` in banner.go
		DimColor:     lipgloss.Color("241"), // matches wizard.go hint style
		WarningColor: lipgloss.Color("214"), // amber for advisory
		SuccessColor: lipgloss.Color("10"),  // green
		ErrorColor:   lipgloss.Color("9"),   // red
	}
}

// AdvisoryBanner is the lipgloss style for the mandatory ADVISORY warning that
// must appear at the top of every review run, every audit, and every cohort
// report.
func (s interviewStyles) AdvisoryBanner() lipgloss.Style {
	return lipgloss.NewStyle().
		Bold(true).
		Foreground(s.WarningColor).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(s.WarningColor).
		Padding(0, 1)
}

// RenderHeader returns a shell-style header line embedding the section name,
// aligned with the project's primary `///` header treatment.
func (s interviewStyles) RenderHeader(section string, width int) string {
	prefix := "//// TEAM HERO INTERVIEW · " + section + " "
	if width <= 0 {
		width = 80
	}
	if lipgloss.Width(prefix) >= width {
		return lipgloss.NewStyle().Foreground(s.HeaderColor).Render(prefix)
	}
	tail := width - lipgloss.Width(prefix)
	prefixStyled := lipgloss.NewStyle().Foreground(s.HeaderColor).Render(prefix)
	return prefixStyled + renderGradientSlashes(tail)
}

// Description returns a muted-gray style for descriptive text.
func (s interviewStyles) Description() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(s.DimColor)
}

// PhaseLabel returns the style used for phase names in the progress display.
func (s interviewStyles) PhaseLabel() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(s.HeaderColor).Bold(true)
}

// PhaseDone returns the style for the ✔ glyph next to a completed phase.
func (s interviewStyles) PhaseDone() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(s.SuccessColor)
}

// PhaseFailed returns the style for the ✖ glyph next to a failed phase.
func (s interviewStyles) PhaseFailed() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(s.ErrorColor)
}
