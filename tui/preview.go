package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/glamour"
	"github.com/charmbracelet/lipgloss"
)

// Tab indices for the tabbed preview.
const (
	tabReport       = 0
	tabDiscrepancy  = 1
	tabJSON         = 2
	tabCount        = 3
)

var tabLabels = [tabCount]string{"Report", "Discrepancy Log", "JSON Data"}

// contentRenderedMsg signals that background glamour rendering is complete.
type contentRenderedMsg struct {
	rendered [tabCount]string
}

type previewModel struct {
	path      string
	markdown  string
	renderErr string

	// Discrepancy data received from the service runner.
	discrepancyData *DiscrepancyEvent

	// JSON report data for the JSON Data tab.
	jsonData string

	// Tabbed UI state.
	activeTab int
	viewports [tabCount]viewport.Model

	width  int
	height int

	// Async rendering state.
	rendering bool
	spinner   spinner.Model

	// Legacy single-viewport field kept for backward compatibility.
	viewport viewport.Model
}

func newPreviewModel(path string) previewModel {
	return newPreviewModelFull(path, nil, "")
}

func newPreviewModelWithDiscrepancy(path string, discrepancy *DiscrepancyEvent) previewModel {
	return newPreviewModelFull(path, discrepancy, "")
}

func newPreviewModelFull(path string, discrepancy *DiscrepancyEvent, jsonData string) previewModel {
	absPath, _ := filepath.Abs(path)

	md, err := os.ReadFile(absPath)
	renderErr := ""
	content := ""
	if err != nil {
		renderErr = fmt.Sprintf("Could not read markdown file: %v", err)
	} else {
		content = string(md)
	}

	w := termWidth()
	vpWidth := max(20, w-2)

	var vps [tabCount]viewport.Model
	for i := range vps {
		vps[i] = viewport.New(vpWidth, 8)
	}

	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("14"))

	return previewModel{
		path:            absPath,
		markdown:        content,
		renderErr:       renderErr,
		discrepancyData: discrepancy,
		jsonData:        jsonData,
		activeTab:       tabReport,
		viewports:       vps,
		width:           w,
		height:          24,
		rendering:       true,
		spinner:         s,
		viewport:        vps[tabReport],
	}
}

func (m previewModel) Init() tea.Cmd {
	return tea.Batch(m.spinner.Tick, tea.WindowSize(), m.renderContentCmd())
}

// renderContentCmd returns a tea.Cmd that performs glamour rendering off the main thread.
func (m previewModel) renderContentCmd() tea.Cmd {
	markdown := m.markdown
	renderErr := m.renderErr
	discrepancyData := m.discrepancyData
	jsonData := m.jsonData
	width := max(20, m.width-2)

	return func() tea.Msg {
		var rendered [tabCount]string

		// Report tab
		if renderErr != "" {
			rendered[tabReport] = lipgloss.NewStyle().Foreground(lipgloss.Color("9")).Render(renderErr)
		} else {
			md := stripDiscrepancyLinks(markdown)
			rendered[tabReport] = md
			wordWrap := max(20, width-2)
			r, err := glamour.NewTermRenderer(
				glamour.WithAutoStyle(),
				glamour.WithWordWrap(wordWrap),
			)
			if err == nil {
				if out, gErr := r.Render(md); gErr == nil {
					rendered[tabReport] = out
				}
			}
		}

		// Discrepancy tab
		if discrepancyData == nil || (discrepancyData.TotalCount == 0 && len(discrepancyData.AllItems) == 0) {
			dim := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))
			rendered[tabDiscrepancy] = dim.Render("No discrepancies detected.")
		} else {
			md := buildDiscrepancyMarkdown(discrepancyData)
			wordWrap := max(20, width-2)
			r, err := glamour.NewTermRenderer(
				glamour.WithAutoStyle(),
				glamour.WithWordWrap(wordWrap),
			)
			rendered[tabDiscrepancy] = md
			if err == nil {
				if out, gErr := r.Render(md); gErr == nil {
					rendered[tabDiscrepancy] = out
				}
			}
		}

		// JSON tab
		if jsonData == "" {
			dim := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
			rendered[tabJSON] = dim.Render("No JSON data available. Use --output-format json or --output-format both.")
		} else {
			prettyJSON := jsonData
			var raw json.RawMessage
			if err := json.Unmarshal([]byte(jsonData), &raw); err == nil {
				if indented, err := json.MarshalIndent(raw, "", "  "); err == nil {
					prettyJSON = string(indented)
				}
			}
			rendered[tabJSON] = renderJSONContent(prettyJSON)
		}

		return contentRenderedMsg{rendered: rendered}
	}
}

func (m previewModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case contentRenderedMsg:
		m.rendering = false
		for i, content := range msg.rendered {
			m.viewports[i].SetContent(content)
			m.viewports[i].GotoTop()
		}
		m.viewport = m.viewports[m.activeTab]
		return m, nil

	case spinner.TickMsg:
		if m.rendering {
			var cmd tea.Cmd
			m.spinner, cmd = m.spinner.Update(msg)
			return m, cmd
		}
		return m, nil

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.reflow()
		if !m.rendering {
			// Re-render with new dimensions
			m.rendering = true
			return m, tea.Batch(m.spinner.Tick, m.renderContentCmd())
		}
		return m, nil

	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q", "esc", "enter":
			return m, tea.Quit
		case "tab", "right", "l":
			m.activeTab = (m.activeTab + 1) % tabCount
			m.viewport = m.viewports[m.activeTab]
			return m, nil
		case "shift+tab", "left", "h":
			m.activeTab = (m.activeTab - 1 + tabCount) % tabCount
			m.viewport = m.viewports[m.activeTab]
			return m, nil
		}
		if !m.rendering {
			var cmd tea.Cmd
			m.viewports[m.activeTab], cmd = m.viewports[m.activeTab].Update(msg)
			m.viewport = m.viewports[m.activeTab]
			return m, cmd
		}
		return m, nil
	}

	var cmd tea.Cmd
	m.viewports[m.activeTab], cmd = m.viewports[m.activeTab].Update(msg)
	m.viewport = m.viewports[m.activeTab]
	return m, cmd
}

func (m previewModel) View() string {
	m.reflow()

	header := renderShellHeader(m.width)

	contentWidth := max(20, m.width-2)

	titleStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("10"))
	labelStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("245"))
	pathStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("14"))
	helpStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))

	info := lipgloss.JoinVertical(
		lipgloss.Left,
		titleStyle.Render("Report Ready"),
		labelStyle.Render("Open: ")+pathStyle.Render("file://"+m.path),
		helpStyle.Render("Tab/Arrow to switch tabs, scroll to preview, Enter/q to exit."),
	)

	infoFrame := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("240")).
		Padding(0, 1).
		Width(contentWidth).
		Render(info)

	// Render tab bar
	tabBar := m.renderTabBar(contentWidth)

	// Render active viewport or spinner
	var tabContent string
	if m.rendering {
		spinnerStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
		tabContent = "\n  " + m.spinner.View() + spinnerStyle.Render(" Rendering preview…")
	} else {
		tabContent = m.viewports[m.activeTab].View()
	}
	previewBody := lipgloss.JoinVertical(
		lipgloss.Left,
		tabBar,
		tabContent,
	)

	previewFrame := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("240")).
		Padding(0, 1).
		Width(contentWidth).
		Height(m.previewFrameHeight()).
		Render(previewBody)

	return lipgloss.JoinVertical(lipgloss.Left, header, "", infoFrame, "", previewFrame)
}

func (m *previewModel) renderTabBar(contentWidth int) string {
	activeStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("212")).
		Border(lipgloss.NormalBorder(), false, false, true, false).
		BorderForeground(lipgloss.Color("212"))

	inactiveStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("241")).
		Border(lipgloss.NormalBorder(), false, false, true, false).
		BorderForeground(lipgloss.Color("240"))

	var tabs []string
	for i, label := range tabLabels {
		displayLabel := " " + label + " "
		// Append discrepancy count badge (total including below-threshold items)
		if i == tabDiscrepancy {
			count := 0
			if m.discrepancyData != nil {
				count = len(m.discrepancyData.AllItems)
				if count == 0 {
					count = m.discrepancyData.TotalCount
				}
			}
			if count > 0 {
				displayLabel += fmt.Sprintf("(%d) ", count)
			}
		}
		// Show checkmark if JSON data is available
		if i == tabJSON && m.jsonData != "" {
			displayLabel += "✔ "
		}
		if i == m.activeTab {
			tabs = append(tabs, activeStyle.Render(displayLabel))
		} else {
			tabs = append(tabs, inactiveStyle.Render(displayLabel))
		}
	}

	return lipgloss.JoinHorizontal(lipgloss.Top, tabs...)
}

func (m *previewModel) reflow() {
	if m.width <= 0 {
		m.width = 80
	}
	if m.height <= 0 {
		m.height = 24
	}
	vpWidth := max(20, m.width-2)
	vpHeight := max(6, m.previewFrameHeight()-6)
	for i := range m.viewports {
		m.viewports[i].Width = vpWidth
		m.viewports[i].Height = vpHeight
	}
	m.viewport = m.viewports[m.activeTab]
}

func (m *previewModel) previewFrameHeight() int {
	// header + spacer + info frame + spacer leaves remainder for preview panel.
	available := m.height - 11
	if available < 10 {
		available = 10
	}
	return available
}

func (m *previewModel) updateAllViewportContent() {
	m.updateReportViewport()
	m.updateDiscrepancyViewport()
	m.updateJSONViewport()
}

func (m *previewModel) updateReportViewport() {
	vp := &m.viewports[tabReport]
	if m.renderErr != "" {
		vp.SetContent(lipgloss.NewStyle().Foreground(lipgloss.Color("9")).Render(m.renderErr))
		vp.GotoTop()
		return
	}

	// Strip anchor links before glamour sees them so it doesn't
	// generate a reference-link list at the bottom of the output.
	md := stripDiscrepancyLinks(m.markdown)
	rendered := md
	wordWrap := max(20, vp.Width-2)
	r, err := glamour.NewTermRenderer(
		glamour.WithAutoStyle(),
		glamour.WithWordWrap(wordWrap),
	)
	if err == nil {
		if out, renderErr := r.Render(md); renderErr == nil {
			rendered = out
		}
	}

	vp.SetContent(rendered)
	vp.GotoTop()
}

func (m *previewModel) updateDiscrepancyViewport() {
	vp := &m.viewports[tabDiscrepancy]

	if m.discrepancyData == nil || (m.discrepancyData.TotalCount == 0 && len(m.discrepancyData.AllItems) == 0) {
		dim := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))
		vp.SetContent(dim.Render("No discrepancies detected."))
		vp.GotoTop()
		return
	}

	md := buildDiscrepancyMarkdown(m.discrepancyData)
	wordWrap := max(20, vp.Width-2)
	r, err := glamour.NewTermRenderer(
		glamour.WithAutoStyle(),
		glamour.WithWordWrap(wordWrap),
	)
	rendered := md
	if err == nil {
		if out, renderErr := r.Render(md); renderErr == nil {
			rendered = out
		}
	}

	vp.SetContent(rendered)
	vp.GotoTop()
}

func (m *previewModel) updateJSONViewport() {
	vp := &m.viewports[tabJSON]

	if m.jsonData == "" {
		dim := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
		vp.SetContent(dim.Render("No JSON data available. Use --output-format json or --output-format both."))
		vp.GotoTop()
		return
	}

	// Pretty-print compact JSON into indented multi-line form so the viewport can scroll.
	prettyJSON := m.jsonData
	var raw json.RawMessage
	if err := json.Unmarshal([]byte(m.jsonData), &raw); err == nil {
		if indented, err := json.MarshalIndent(raw, "", "  "); err == nil {
			prettyJSON = string(indented)
		}
	}

	content := renderJSONContent(prettyJSON)
	vp.SetContent(content)
	vp.GotoTop()
}

// renderJSONContent formats JSON data for the viewport with color highlighting.
func renderJSONContent(jsonStr string) string {
	keyStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("14"))  // cyan
	strStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))  // green
	numStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("11"))  // yellow
	punctStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241")) // dim

	var lines []string
	for _, line := range strings.Split(jsonStr, "\n") {
		trimmed := strings.TrimSpace(line)
		leading := line[:len(line)-len(strings.TrimLeft(line, " \t"))]

		if strings.Contains(trimmed, ":") {
			// Line with a key
			colonIdx := strings.Index(trimmed, ":")
			key := trimmed[:colonIdx]
			rest := trimmed[colonIdx:]
			lines = append(lines, leading+keyStyle.Render(key)+colorizeJSONValue(rest, strStyle, numStyle, punctStyle))
		} else if trimmed == "{" || trimmed == "}" || trimmed == "[" || trimmed == "]" ||
			trimmed == "}," || trimmed == "]," {
			lines = append(lines, leading+punctStyle.Render(trimmed))
		} else {
			lines = append(lines, leading+colorizeJSONValue(trimmed, strStyle, numStyle, punctStyle))
		}
	}
	return strings.Join(lines, "\n")
}

func colorizeJSONValue(s string, strStyle, numStyle, punctStyle lipgloss.Style) string {
	trimmed := strings.TrimSpace(s)
	if strings.HasPrefix(trimmed, ": ") {
		value := strings.TrimPrefix(trimmed, ": ")
		value = strings.TrimSuffix(value, ",")
		hasSuffix := strings.HasSuffix(trimmed, ",")
		suffix := ""
		if hasSuffix {
			suffix = punctStyle.Render(",")
		}
		if strings.HasPrefix(value, "\"") {
			return punctStyle.Render(": ") + strStyle.Render(value) + suffix
		}
		if value == "true" || value == "false" || value == "null" {
			return punctStyle.Render(": ") + numStyle.Render(value) + suffix
		}
		if len(value) > 0 && (value[0] >= '0' && value[0] <= '9' || value[0] == '-') {
			return punctStyle.Render(": ") + numStyle.Render(value) + suffix
		}
		return punctStyle.Render(": ") + value + suffix
	}
	return s
}

// buildDiscrepancyMarkdown produces the discrepancy log markdown.
// Uses AllItems (unfiltered) when available so the log contains all findings,
// with a threshold header indicating how many are below the confidence cutoff.
func buildDiscrepancyMarkdown(data *DiscrepancyEvent) string {
	// Prefer allItems (unfiltered) for the log; fall back to filtered items.
	items := data.AllItems
	if len(items) == 0 {
		items = data.Items
	}
	if len(items) == 0 {
		// Last-resort fallback: flatten ByContributor + Unattributed
		contribOrder := make([]string, 0, len(data.ByContributor))
		for login := range data.ByContributor {
			contribOrder = append(contribOrder, login)
		}
		sort.Strings(contribOrder)
		for _, login := range contribOrder {
			items = append(items, data.ByContributor[login]...)
		}
		items = append(items, data.Unattributed...)
		sort.Slice(items, func(i, j int) bool {
			return items[i].Confidence > items[j].Confidence
		})
	}

	var b strings.Builder
	b.WriteString("## Discrepancy Log\n\n")

	// Threshold info header
	total := len(items)
	if data.DiscrepancyThreshold > 0 {
		aboveCount := 0
		belowCount := 0
		for _, d := range items {
			if d.Confidence >= data.DiscrepancyThreshold {
				aboveCount++
			} else {
				belowCount++
			}
		}
		b.WriteString(fmt.Sprintf("**%d** discrepancies found — **%d** above the report threshold of **%d%%**, **%d** below.\n\n",
			total, aboveCount, data.DiscrepancyThreshold, belowCount))
	} else {
		b.WriteString(fmt.Sprintf("**%d** discrepancies found.\n\n", total))
	}

	// Summary table
	b.WriteString("| # | Issue | Contributor | Confidence |\n")
	b.WriteString("|---|-------|-------------|------------|\n")
	for i, d := range items {
		num := i + 1
		summary := extractSummaryGo(d.Message)
		contributor := d.ContributorDisplayName
		if d.Contributor == "" {
			contributor = "Unattributed"
		}
		b.WriteString(fmt.Sprintf("| %d | %s | %s | %d%% |\n", num, summary, contributor, d.Confidence))
	}
	b.WriteString("\n")

	// Detailed cards
	for i, d := range items {
		num := i + 1
		summary := extractSummaryGo(d.Message)
		explanation := extractExplanationGo(d.Message)

		b.WriteString("---\n\n")
		b.WriteString(fmt.Sprintf("### %d. %s\n", num, summary))

		if d.Contributor != "" {
			b.WriteString(fmt.Sprintf("**Contributor:** %s (@%s) | **Confidence: %d%%**\n", d.ContributorDisplayName, d.Contributor, d.Confidence))
		} else {
			b.WriteString(fmt.Sprintf("**Contributor:** Unattributed | **Confidence: %d%%**\n", d.Confidence))
		}
		b.WriteString("\n")

		if explanation != "" {
			b.WriteString(explanation + "\n\n")
		}

		b.WriteString("**Evidence:**\n")
		b.WriteString(formatEvidenceBulletGo(d.SourceA) + "\n")
		b.WriteString(formatEvidenceBulletGo(d.SourceB) + "\n")
		b.WriteString("\n")

		gap := extractRuleDescriptionGo(d.Rule)
		if gap != "" {
			b.WriteString(fmt.Sprintf("**Gap:** %s\n\n", gap))
		}

		b.WriteString(fmt.Sprintf("**Action:** %s\n\n", d.SuggestedResolution))
	}

	return b.String()
}

// extractSummaryGo returns the first line of a discrepancy message.
func extractSummaryGo(message string) string {
	if idx := strings.Index(message, "\n"); idx >= 0 {
		return strings.TrimSpace(message[:idx])
	}
	return strings.TrimSpace(message)
}

// extractExplanationGo returns everything after the first line.
func extractExplanationGo(message string) string {
	if idx := strings.Index(message, "\n"); idx >= 0 {
		return strings.TrimSpace(message[idx+1:])
	}
	return ""
}

// extractRuleDescriptionGo returns the text after " — " in a rule string.
func extractRuleDescriptionGo(rule string) string {
	if idx := strings.Index(rule, " — "); idx >= 0 {
		return strings.TrimSpace(rule[idx+len(" — "):])
	}
	return ""
}

// formatEvidenceBulletGo formats a source as a markdown bullet with optional hyperlink.
func formatEvidenceBulletGo(src DiscrepancySourceState) string {
	url := strings.TrimSpace(src.URL)
	itemID := strings.TrimSpace(src.ItemID)

	label := src.SourceName
	if itemID != "" {
		label = src.SourceName + ": " + itemID
	}

	if url != "" {
		return fmt.Sprintf("- [%s](%s) — %s", label, url, src.State)
	}
	return fmt.Sprintf("- %s — %s", label, src.State)
}

// discrepancyLinkRe matches markdown inline links like [1](#discrepancy-1)
// and replaces them with just the link text (the number).
var discrepancyLinkRe = regexp.MustCompile(`\[(\d+)\]\(#discrepancy-\d+\)`)

// stripDiscrepancyLinks converts [N](#discrepancy-N) to plain N in markdown
// source so glamour doesn't generate a reference-link list.
func stripDiscrepancyLinks(md string) string {
	return discrepancyLinkRe.ReplaceAllString(md, "$1")
}

// updateViewportContent is kept for backward compatibility with existing code paths.
func (m *previewModel) updateViewportContent() {
	m.updateAllViewportContent()
}

func RunReportPreview(path string) error {
	return RunReportPreviewFull(path, nil, "")
}

// RunReportPreviewWithDiscrepancy creates and runs the tabbed preview with optional discrepancy data.
func RunReportPreviewWithDiscrepancy(path string, discrepancy *DiscrepancyEvent) error {
	return RunReportPreviewFull(path, discrepancy, "")
}

// RunReportPreviewFull creates and runs the tabbed preview with all optional data.
func RunReportPreviewFull(path string, discrepancy *DiscrepancyEvent, jsonData string) error {
	m := newPreviewModelFull(path, discrepancy, jsonData)
	p := tea.NewProgram(m, tea.WithOutput(os.Stderr), tea.WithAltScreen())
	_, err := teaProgramRun(p)
	return err
}
