package main

import (
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/term"
)

// bannerWriter is the output destination for banner functions — overridable in tests.
var bannerWriter io.Writer = os.Stderr

var (
	purple = lipgloss.Color("212")
	shellHeaderPrefix = "//// TEAM HERO "

	bannerStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(purple).
			Foreground(purple).
			Padding(1, 2).
			Align(lipgloss.Center)

	successBoxStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("14")). // cyan
			Padding(1, 2)

	errorStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("9")). // red
			Bold(true)
)

// RenderBanner prints a centered banner box.
func RenderBanner(text string) {
	width := termWidth()
	style := bannerStyle.Width(width - 2) // -2 for border chars
	fmt.Fprintln(bannerWriter, style.Render(text))
}

// RenderSuccessBox prints a styled result box.
func RenderSuccessBox(title, body string) {
	width := termWidth()
	style := successBoxStyle.Width(width - 4)

	titleStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("10")) // green
	pathStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("14"))             // cyan
	labelStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("245"))           // dim

	content := titleStyle.Render(title) + "\n\n" + labelStyle.Render("Markdown: ") + pathStyle.Render(body)
	fmt.Fprintln(bannerWriter, style.Render(content))
}

// RenderError prints a styled error message.
func RenderError(msg string) {
	fmt.Fprintln(bannerWriter, errorStyle.Render("Error: "+msg))
}

func formatSample(items []string, limit int) string {
	if len(items) == 0 {
		return "none"
	}
	if len(items) <= limit {
		return strings.Join(items, ", ")
	}
	return strings.Join(items[:limit], ", ") + fmt.Sprintf(", … (+%d more)", len(items)-limit)
}

// formatCompact shows the first item plus a "+N" suffix when there are more.
// Designed for the summary pane where space is tight.
func formatCompact(items []string) string {
	if len(items) == 0 {
		return "none"
	}
	if len(items) == 1 {
		return items[0]
	}
	return fmt.Sprintf("%s +%d", items[0], len(items)-1)
}

func boolStr(v bool) string {
	if v {
		return "Yes"
	}
	return "No"
}

func termWidth() int {
	w, _, err := term.GetSize(os.Stderr.Fd())
	if err != nil || w <= 0 {
		return 80
	}
	return w
}

func renderShellHeader(totalWidth int) string {
	contentWidth := max(20, totalWidth-1) // keep one-column safety margin to avoid wrapping
	if contentWidth <= 0 {
		return shellHeaderPrefix
	}

	prefix := shellHeaderPrefix
	if lipgloss.Width(prefix) > contentWidth {
		prefix = prefix[:contentWidth]
	}

	slashCount := max(0, contentWidth-lipgloss.Width(prefix))
	prefixStyled := lipgloss.NewStyle().Foreground(purple).Render(prefix)
	return prefixStyled + renderGradientSlashes(slashCount)
}

func buildSlashHeader(contentWidth int) string {
	if contentWidth <= 0 {
		return shellHeaderPrefix
	}
	prefixWidth := lipgloss.Width(shellHeaderPrefix)
	if prefixWidth >= contentWidth {
		return shellHeaderPrefix
	}
	return shellHeaderPrefix + strings.Repeat("/", contentWidth-prefixWidth)
}

func renderGradientSlashes(count int) string {
	if count <= 0 {
		return ""
	}

	// Subtle left-to-right gradient: soft pink -> purple.
	startR, startG, startB := 236, 132, 214
	endR, endG, endB := 186, 120, 255

	var b strings.Builder
	b.Grow(count * 18)
	for i := 0; i < count; i++ {
		t := float64(i)
		if count > 1 {
			t = t / float64(count-1)
		} else {
			t = 0
		}

		r := int(float64(startR) + (float64(endR-startR) * t))
		g := int(float64(startG) + (float64(endG-startG) * t))
		bl := int(float64(startB) + (float64(endB-startB) * t))
		hex := fmt.Sprintf("#%02x%02x%02x", r, g, bl)
		b.WriteString(lipgloss.NewStyle().Foreground(lipgloss.Color(hex)).Render("/"))
	}
	return b.String()
}

func renderDividerLine(contentWidth int) string {
	// Keep two-column safety margin to prevent wrap at frame edges
	// across terminals that reserve the last column.
	return strings.Repeat("─", max(0, contentWidth-2))
}
