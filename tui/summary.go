package main

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// renderSummary produces a styled configuration summary panel.
// Fields that have been set show values in bright text; fields not yet reached
// show "—" in dim text. currentState highlights the active field; highWater is
// the farthest state reached so that values remain visible when navigating back.
func renderSummary(cfg *ReportConfig, currentState wizardState, highWater wizardState, width int) string {
	if width < 20 {
		width = 20
	}

	headerStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("212"))
	labelStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("245"))
	valueStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("15"))
	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("239"))
	activeLabel := lipgloss.NewStyle().Foreground(lipgloss.Color("14")).Bold(true) // cyan for current step

	boxStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("240")).
		Padding(0, 1)

	// innerWidth is what we pass to Width() — lipgloss treats it as the total
	// (border+padding included), so the actual content area is smaller.
	innerWidth := width - boxStyle.GetHorizontalBorderSize()
	contentWidth := innerWidth - boxStyle.GetHorizontalFrameSize()

	// Helper: render a config line, with "—" if not yet reached.
	type entry struct {
		label string
		value string
		state wizardState // the state where this field gets set
	}

	// Build entries
	entries := []entry{
		{"Organization", cfg.Org, wsOrg},
		{"Cache", fmtCacheFlush(cfg), wsCacheFlush},
		{"Repositories", fmtRepos(cfg), wsRepoScope},
		{"Members", fmtMembers(cfg), wsMemberScope},
		{"Since", cfg.Since, wsDates},
		{"Until", cfg.Until, wsDates},
		{"Detailed", fmtBoolYN(cfg.Detailed), wsDetailed},
		{"Data sources", fmtDataSources(cfg), wsDataSources},
		{"Sections", fmtReportSections(cfg), wsReportSections},
	}

	var lines []string

	// Header row: "Report Setup" left, AI badge right
	header := headerStyle.Render("Report Setup")
	if cfg.AIModel != "" {
		aiBadge := dimStyle.Render(cfg.AIModel)
		if cfg.ServiceTier == "flex" {
			flexPill := lipgloss.NewStyle().
				Background(lipgloss.Color("63")).
				Foreground(lipgloss.Color("15")).
				Bold(true).
				Render(" flex ")
			aiBadge += " " + flexPill
		}
		leftW := lipgloss.Width(header)
		rightW := lipgloss.Width(aiBadge)
		gap := contentWidth - leftW - rightW
		if gap < 2 {
			lines = append(lines, header)
		} else {
			lines = append(lines, header+strings.Repeat(" ", gap)+aiBadge)
		}
	} else {
		lines = append(lines, header)
	}
	lines = append(lines, "")

	for _, e := range entries {
		lbl := labelStyle
		if e.state == currentState {
			lbl = activeLabel
		}

		val := dimStyle.Render("—")
		if highWater > e.state && e.value != "" {
			val = valueStyle.Render(e.value)
		}

		line := lbl.Render(e.label+": ") + val
		lines = append(lines, line)
	}

	content := strings.Join(lines, "\n")

	return boxStyle.Width(innerWidth).Render(content)
}

func fmtBoolYN(v bool) string {
	if v {
		return "Yes"
	}
	return "No"
}

func fmtRepos(cfg *ReportConfig) string {
	if cfg.UseAllRepos {
		return "All"
	}
	if len(cfg.Repos) > 0 {
		return formatCompact(cfg.Repos)
	}
	return ""
}

func fmtMembers(cfg *ReportConfig) string {
	if cfg.Team != "" {
		return fmt.Sprintf("Team: %s", cfg.Team)
	}
	if len(cfg.Members) > 0 {
		return formatCompact(cfg.Members)
	}
	return "All"
}

func fmtDataSources(cfg *ReportConfig) string {
	var parts []string
	if cfg.Sections.DataSources.Git {
		parts = append(parts, "Git")
	}
	if cfg.Sections.DataSources.Asana {
		parts = append(parts, "Asana")
	}
	if len(parts) == 0 {
		return "none"
	}
	return strings.Join(parts, ", ")
}

func fmtReportSections(cfg *ReportConfig) string {
	var parts []string
	if cfg.Sections.ReportSections.IndividualContributions {
		parts = append(parts, "Individual")
	}
	if cfg.Sections.ReportSections.VisibleWins {
		parts = append(parts, "Wins")
	}
	if cfg.Sections.ReportSections.Loc {
		parts = append(parts, "LOC")
	}
	if cfg.Sections.ReportSections.DiscrepancyLog {
		parts = append(parts, "Discrepancy Log")
	}
	if len(parts) == 0 {
		return "none"
	}
	return strings.Join(parts, ", ")
}

func fmtCacheFlush(cfg *ReportConfig) string {
	switch {
	case cfg.FlushCache == "":
		return "Use cached"
	case cfg.FlushCache == "all":
		return "Flush all"
	case strings.HasPrefix(cfg.FlushCache, "all:since="):
		return "Flush from " + strings.TrimPrefix(cfg.FlushCache, "all:since=")
	default:
		return cfg.FlushCache
	}
}
