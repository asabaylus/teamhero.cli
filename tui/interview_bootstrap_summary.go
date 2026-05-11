package main

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// renderInterviewBootstrapSummary builds the right-side configuration summary
// panel for the interview bootstrap wizard. It mirrors renderSummary() for
// the report wizard: a bordered box with one labelled row per field, the
// current field highlighted, and fields not yet reached shown as "—".
func renderInterviewBootstrapSummary(
	m *bootstrapWizardModel,
	currentStep interviewBootstrapStep,
	highWater interviewBootstrapStep,
	width int,
) string {
	if width < 20 {
		width = 20
	}

	headerStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("212"))
	labelStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("245"))
	valueStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("15"))
	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("239"))
	activeLabel := lipgloss.NewStyle().Foreground(lipgloss.Color("14")).Bold(true)

	boxStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("240")).
		Padding(0, 1)

	innerWidth := width - boxStyle.GetHorizontalBorderSize()

	type entry struct {
		label string
		value string
		step  interviewBootstrapStep
	}

	rubricValue := m.modeRubric
	if m.modeRubric == "default+jd" && m.jdPath != "" {
		rubricValue = "default+jd (" + m.jdPath + ")"
	} else if m.modeRubric == "custom" && m.customPrompt != "" {
		rubricValue = "custom (" + truncate(m.customPrompt, 24) + ")"
	}

	entries := []entry{
		{"Role slug", m.role, ibStepRole},
		{"Role title", m.roleTitle, ibStepRoleTitle},
		{"Stack", m.stack, ibStepStack},
		{"Domain", m.domain, ibStepDomain},
		{"Feature", truncate(m.feature, 28), ibStepFeature},
		{"Time-box", fmtTimeBox(m.timeBox), ibStepTimeBox},
		{"Project mode", fmtProjectMode(m.modeProject), ibStepProjectMode},
		{"Analysis mode", m.modeAnalysis, ibStepAnalysisMode},
		{"Rubric", rubricValue, ibStepRubricMode},
		{"Output dir", m.outputDir, ibStepOutputDir},
	}

	lines := []string{
		headerStyle.Render("Interview Bootstrap"),
		"",
	}

	for _, e := range entries {
		lbl := labelStyle
		if e.step == currentStep {
			lbl = activeLabel
		}
		val := dimStyle.Render("—")
		if highWater > e.step && strings.TrimSpace(e.value) != "" {
			val = valueStyle.Render(e.value)
		}
		lines = append(lines, lbl.Render(e.label+": ")+val)
	}

	return boxStyle.Width(innerWidth).Render(strings.Join(lines, "\n"))
}

func fmtProjectMode(s string) string {
	switch s {
	case "A":
		return "A — generated starter"
	case "B":
		return "B — bring your own"
	default:
		return s
	}
}

func fmtTimeBox(s string) string {
	if s == "" {
		return ""
	}
	return s + " min"
}

// truncate clips a string to `max` runes and appends "…" when clipped.
// Operates on runes (not bytes) so multi-byte characters like accented
// Latin or CJK don't get split mid-codepoint into invalid UTF-8.
func truncate(s string, max int) string {
	if max <= 0 {
		return ""
	}
	runes := []rune(s)
	if max == 1 {
		return s
	}
	if len(runes) <= max {
		return s
	}
	return string(runes[:max-1]) + "…"
}
