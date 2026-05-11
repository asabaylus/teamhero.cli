package main

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// renderAssessSummary produces the right-pane configuration summary that mirrors
// the visual style of summary.go::renderSummary used by the report flow.
//
// Each field shows a value when it has been resolved, "—" (dim) otherwise.
// The "Assessment Setup" header includes an AI badge on the right when an
// renderAssessSummary renders a right-pane, bordered summary of an assessment configuration sized to the provided width.
// 
// The rendered box contains labeled fields for Scope, Target, Display name, Evidence tier, Output format, Output path,
// Interview answers, and Mode. If cfg is nil the box contains "No configuration". A minimum width of 20 is enforced.
// Empty or whitespace-only values are shown as a dim em dash ("—"). When cfg.DryRun is true a right-aligned "dry-run"
// badge is shown and is placed on the same header line if there is sufficient space.
func renderAssessSummary(cfg *AssessConfig, width int) string {
	if width < 20 {
		width = 20
	}
	if cfg == nil {
		return lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("240")).
			Padding(0, 1).
			Width(width).
			Render("No configuration")
	}

	headerStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("212"))
	labelStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("245"))
	valueStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("15"))
	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("239"))

	boxStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("240")).
		Padding(0, 1)

	innerWidth := width - boxStyle.GetHorizontalBorderSize()
	contentWidth := innerWidth - boxStyle.GetHorizontalFrameSize()

	type entry struct {
		label string
		value string
	}

	entries := []entry{
		{"Scope", fmtAssessScopeMode(cfg)},
		{"Target", fmtAssessTarget(cfg)},
		{"Display name", strings.TrimSpace(cfg.Scope.DisplayName)},
		{"Evidence tier", fmtAssessTier(cfg.EvidenceTier)},
		{"Output format", fmtAssessOutputFormat(cfg.OutputFormat)},
		{"Output path", strings.TrimSpace(cfg.OutputPath)},
		{"Interview answers", fmtAssessAnswersFile(cfg.InterviewAnswersPath)},
		{"Mode", fmtAssessRunMode(cfg)},
	}

	var lines []string

	header := headerStyle.Render("Assessment Setup")
	rightBadge := ""
	if cfg.DryRun {
		rightBadge = lipgloss.NewStyle().
			Background(lipgloss.Color("63")).
			Foreground(lipgloss.Color("15")).
			Bold(true).
			Render(" dry-run ")
	}
	if rightBadge != "" {
		gap := contentWidth - lipgloss.Width(header) - lipgloss.Width(rightBadge)
		if gap < 2 {
			lines = append(lines, header)
		} else {
			lines = append(lines, header+strings.Repeat(" ", gap)+rightBadge)
		}
	} else {
		lines = append(lines, header)
	}
	lines = append(lines, "")

	for _, e := range entries {
		val := dimStyle.Render("—")
		if v := strings.TrimSpace(e.value); v != "" {
			val = valueStyle.Render(v)
		}
		lines = append(lines, labelStyle.Render(e.label+": ")+val)
	}

	content := strings.Join(lines, "\n")
	return boxStyle.Width(innerWidth).Render(content)
}

// fmtAssessScopeMode converts the assessment scope mode in cfg into a human-readable label.
// It maps "org" to "GitHub org", "local-repo" to "Local repository", and "both" to "Org + local checkout".
// For any other mode it returns an empty string.
func fmtAssessScopeMode(cfg *AssessConfig) string {
	switch cfg.Scope.Mode {
	case "org":
		return "GitHub org"
	case "local-repo":
		return "Local repository"
	case "both":
		return "Org + local checkout"
	}
	return ""
}

// fmtAssessTarget returns a human-readable target string based on cfg.Scope.Mode.
// For "org" it returns "" when Org is empty, the Org name when no repos are listed,
// or "Org (repos...)" when repos are present (repos rendered compactly inside parentheses).
// For "local-repo" it returns cfg.Scope.LocalPath.
// For "both" it joins any non-empty Org and LocalPath with " · ".
// For any other mode it returns an empty string.
func fmtAssessTarget(cfg *AssessConfig) string {
	switch cfg.Scope.Mode {
	case "org":
		if cfg.Scope.Org == "" {
			return ""
		}
		if len(cfg.Scope.Repos) > 0 {
			return cfg.Scope.Org + " (" + formatCompact(cfg.Scope.Repos) + ")"
		}
		return cfg.Scope.Org
	case "local-repo":
		return cfg.Scope.LocalPath
	case "both":
		parts := []string{}
		if cfg.Scope.Org != "" {
			parts = append(parts, cfg.Scope.Org)
		}
		if cfg.Scope.LocalPath != "" {
			parts = append(parts, cfg.Scope.LocalPath)
		}
		return strings.Join(parts, " · ")
	}
	return ""
}

// fmtAssessTier converts an evidence tier identifier into a human-readable label.
// It maps "" and "auto" to "auto-detect", "gh" to "1 — gh CLI", "github-mcp" to
// "2 — GitHub MCP", and "git-only" to "3 — git-only". For any other input it
// returns the original tier string unchanged.
func fmtAssessTier(tier string) string {
	switch tier {
	case "", "auto":
		return "auto-detect"
	case "gh":
		return "1 — gh CLI"
	case "github-mcp":
		return "2 — GitHub MCP"
	case "git-only":
		return "3 — git-only"
	}
	return tier
}

// fmtAssessOutputFormat returns a user-facing label for an output format key.
// It maps the empty string to "both", "both" to "both (md + json)", and preserves
// "markdown" and "json" as-is. For any other input it returns the input unchanged.
func fmtAssessOutputFormat(format string) string {
	switch format {
	case "":
		return "both"
	case "both":
		return "both (md + json)"
	case "markdown":
		return "markdown"
	case "json":
		return "json"
	}
	return format
}

// fmtAssessAnswersFile provides a display string for the interview answers file.
// If path is empty it returns "interactive"; otherwise it returns the provided path.
func fmtAssessAnswersFile(path string) string {
	if path == "" {
		return "interactive"
	}
	return path
}

// fmtAssessRunMode determines the assessment run mode based on the provided configuration.
// If cfg.Mode is non-empty that value is used; otherwise it returns "interactive" when
// cfg.InteractiveInterview is true and "headless" otherwise.
func fmtAssessRunMode(cfg *AssessConfig) string {
	if cfg.Mode != "" {
		return cfg.Mode
	}
	if cfg.InteractiveInterview {
		return "interactive"
	}
	return "headless"
}
