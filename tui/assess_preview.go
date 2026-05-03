package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/glamour"
	"github.com/charmbracelet/lipgloss"
)

// Tab indices for the assess preview. Mirrors the report preview's
// (tabReport / tabDiscrepancy / tabJSON) — the assess flow has a different
// middle tab (Evidence) since maturity audits don't produce discrepancies.
const (
	assessTabAudit    = 0
	assessTabEvidence = 1
	assessTabJSON     = 2
	assessTabCount    = 3
)

var assessTabLabels = [assessTabCount]string{"Audit", "Evidence", "JSON Data"}

type assessRenderedMsg struct {
	rendered [assessTabCount]string
}

type assessPreviewModel struct {
	path      string
	jsonPath  string
	markdown  string
	jsonData  string
	renderErr string

	activeTab int
	viewports [assessTabCount]viewport.Model

	width  int
	height int

	rendering bool
	spinner   spinner.Model
}

func newAssessPreviewModel(path, jsonPath, jsonData string) assessPreviewModel {
	absPath, _ := filepath.Abs(path)

	md, err := os.ReadFile(absPath)
	renderErr := ""
	content := ""
	if err != nil {
		renderErr = fmt.Sprintf("Could not read audit file: %v", err)
	} else {
		content = string(md)
	}

	w := termWidth()
	vpWidth := max(20, w-2)
	var vps [assessTabCount]viewport.Model
	for i := range vps {
		vps[i] = viewport.New(vpWidth, 8)
	}

	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("14"))

	return assessPreviewModel{
		path:      absPath,
		jsonPath:  jsonPath,
		markdown:  content,
		jsonData:  jsonData,
		renderErr: renderErr,
		activeTab: assessTabAudit,
		viewports: vps,
		width:     w,
		height:    24,
		rendering: true,
		spinner:   s,
	}
}

func (m assessPreviewModel) Init() tea.Cmd {
	return tea.Batch(m.spinner.Tick, tea.WindowSize(), m.renderContentCmd())
}

func (m assessPreviewModel) renderContentCmd() tea.Cmd {
	markdown := m.markdown
	renderErr := m.renderErr
	jsonData := m.jsonData
	width := max(20, m.width-2)

	return func() tea.Msg {
		var rendered [assessTabCount]string

		// Audit tab — full Glamour render of the markdown audit.
		if renderErr != "" {
			rendered[assessTabAudit] = lipgloss.NewStyle().
				Foreground(lipgloss.Color("9")).
				Render(renderErr)
		} else {
			wrap := max(20, width-2)
			r, err := glamour.NewTermRenderer(
				glamourStyleOption(),
				glamour.WithWordWrap(wrap),
			)
			rendered[assessTabAudit] = markdown
			if err == nil {
				if out, gErr := r.Render(markdown); gErr == nil {
					rendered[assessTabAudit] = out
				}
			}
		}

		// Evidence tab — extract evidence facts from the JSON if available.
		evidenceMd := buildAssessEvidenceMarkdown(jsonData)
		wrap := max(20, width-2)
		r, err := glamour.NewTermRenderer(
			glamourStyleOption(),
			glamour.WithWordWrap(wrap),
		)
		rendered[assessTabEvidence] = evidenceMd
		if err == nil {
			if out, gErr := r.Render(evidenceMd); gErr == nil {
				rendered[assessTabEvidence] = out
			}
		}

		// JSON tab — pretty-print + colorize.
		if jsonData == "" {
			dim := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
			rendered[assessTabJSON] = dim.Render("No JSON data available.")
		} else {
			pretty := jsonData
			var raw json.RawMessage
			if jErr := json.Unmarshal([]byte(jsonData), &raw); jErr == nil {
				if indented, iErr := json.MarshalIndent(raw, "", "  "); iErr == nil {
					pretty = string(indented)
				}
			}
			rendered[assessTabJSON] = renderJSONContent(pretty)
		}

		return assessRenderedMsg{rendered: rendered}
	}
}

func (m assessPreviewModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case assessRenderedMsg:
		m.rendering = false
		for i, content := range msg.rendered {
			m.viewports[i].SetContent(content)
			m.viewports[i].GotoTop()
		}
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
			m.rendering = true
			return m, tea.Batch(m.spinner.Tick, m.renderContentCmd())
		}
		return m, nil

	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q", "esc", "enter":
			return m, tea.Quit
		case "tab", "right", "l":
			m.activeTab = (m.activeTab + 1) % assessTabCount
			return m, nil
		case "shift+tab", "left", "h":
			m.activeTab = (m.activeTab - 1 + assessTabCount) % assessTabCount
			return m, nil
		}
		if !m.rendering {
			var cmd tea.Cmd
			m.viewports[m.activeTab], cmd = m.viewports[m.activeTab].Update(msg)
			return m, cmd
		}
		return m, nil
	}

	var cmd tea.Cmd
	m.viewports[m.activeTab], cmd = m.viewports[m.activeTab].Update(msg)
	return m, cmd
}

func (m assessPreviewModel) View() string {
	m.reflow()

	header := renderShellHeader(m.width)
	contentWidth := max(20, m.width-2)

	titleStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("10"))
	labelStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("245"))
	pathStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("14"))
	helpStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))

	infoLines := []string{
		titleStyle.Render("Audit Ready"),
		labelStyle.Render("Markdown: ") + pathStyle.Render("file://"+m.path),
	}
	if m.jsonPath != "" {
		infoLines = append(
			infoLines,
			labelStyle.Render("JSON:     ")+pathStyle.Render("file://"+m.jsonPath),
		)
	}
	infoLines = append(
		infoLines,
		helpStyle.Render("Tab/Arrow to switch tabs, scroll to read, Enter/q to exit."),
	)
	info := lipgloss.JoinVertical(lipgloss.Left, infoLines...)

	infoFrame := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("240")).
		Padding(0, 1).
		Width(contentWidth).
		Render(info)

	tabBar := m.renderTabBar()

	var tabContent string
	if m.rendering {
		dim := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
		tabContent = "\n  " + m.spinner.View() + dim.Render(" Rendering audit…")
	} else {
		tabContent = m.viewports[m.activeTab].View()
	}

	previewBody := lipgloss.JoinVertical(lipgloss.Left, tabBar, tabContent)
	previewFrame := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("240")).
		Padding(0, 1).
		Width(contentWidth).
		Height(m.previewFrameHeight()).
		Render(previewBody)

	return lipgloss.JoinVertical(lipgloss.Left, header, "", infoFrame, "", previewFrame)
}

func (m *assessPreviewModel) renderTabBar() string {
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
	for i, label := range assessTabLabels {
		display := " " + label + " "
		if i == assessTabJSON && m.jsonData != "" {
			display += "✔ "
		}
		if i == m.activeTab {
			tabs = append(tabs, activeStyle.Render(display))
		} else {
			tabs = append(tabs, inactiveStyle.Render(display))
		}
	}
	return lipgloss.JoinHorizontal(lipgloss.Top, tabs...)
}

func (m *assessPreviewModel) reflow() {
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
}

func (m *assessPreviewModel) previewFrameHeight() int {
	available := m.height - 11
	if available < 10 {
		available = 10
	}
	return available
}

// buildAssessEvidenceMarkdown extracts the evidence facts and per-item scores
// from the audit JSON and renders them as a single markdown document for the
// Evidence tab. Falls back to a placeholder when no JSON is present.
func buildAssessEvidenceMarkdown(jsonData string) string {
	if jsonData == "" {
		return "## Evidence\n\n_No JSON data available — re-run with `--audit-output-format both`._\n"
	}
	var artifact map[string]any
	if err := json.Unmarshal([]byte(jsonData), &artifact); err != nil {
		return fmt.Sprintf("## Evidence\n\n_Failed to parse audit JSON: %v_\n", err)
	}

	var b []byte
	b = append(b, "## Per-item evidence\n\n"...)
	items, _ := artifact["items"].([]any)
	if len(items) == 0 {
		b = append(b, "_No items in audit JSON._\n"...)
		return string(b)
	}

	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		id := item["itemId"]
		score := item["score"]
		why, _ := item["whyThisScore"].(string)
		b = append(b, fmt.Sprintf("### Item %v — score %v\n\n", id, score)...)
		if why != "" {
			b = append(b, why...)
			b = append(b, "\n\n"...)
		}
	}

	notes, _ := artifact["notesForReaudit"].([]any)
	if len(notes) > 0 {
		b = append(b, "\n## Notes for re-audit\n\n"...)
		for _, n := range notes {
			if s, ok := n.(string); ok {
				b = append(b, "- "...)
				b = append(b, s...)
				b = append(b, '\n')
			}
		}
	}

	return string(b)
}

// RunAssessPreview displays the audit markdown in a tabbed Glamour-rendered
// preview matching the report flow's RunReportPreviewFull look-and-feel.
func RunAssessPreview(path, jsonPath, jsonData string) error {
	m := newAssessPreviewModel(path, jsonPath, jsonData)
	p := tea.NewProgram(m, tea.WithOutput(os.Stderr), tea.WithAltScreen())
	_, err := teaProgramRun(p)
	return err
}
