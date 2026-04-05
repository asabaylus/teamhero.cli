package main

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/progress"
	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// stepState tracks a single progress step.
type stepState struct {
	text       string
	status     string    // "start", "update", "done", "error"
	message    string
	progress   float64   // 0.0 – 1.0
	startedAt  time.Time // set when step enters "start"
	finishedAt time.Time // set when step reaches "done" or "error"
}

// progressModel is the Bubble Tea model for the progress display.
type progressModel struct {
	steps         []stepState
	spinner       spinner.Model
	progressBar   progress.Model
	shellViewport viewport.Model
	viewport      viewport.Model
	cfg           *ReportConfig
	title         string
	result        string
	errorMsg      string
	done          bool
	width         int
	height        int
	peakRatio     float64 // monotonically increasing — prevents backward jumps
	expectedSteps int     // fixed denominator for progress calculation
	preflightStepCount int // preconditions before real data processing starts
	discrepancy   *DiscrepancyEvent // captured discrepancy data for preview tab
	jsonData      string // captured report-data JSON for preview tab
}

// Messages sent from the event reader goroutine into the Bubble Tea program.
type stepMsg GenericEvent
type doneMsg struct{}

func newProgressModel(title string, expectedSteps int, cfg *ReportConfig) progressModel {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("14")) // cyan

	p := progress.New(
		progress.WithDefaultGradient(),
		progress.WithoutPercentage(),
	)

	w := termWidth()
	p.Width = max(10, w-16)

	vp := viewport.New(max(20, w-6), 8)
	shell := viewport.New(max(20, w), 24)

	return progressModel{
		spinner:       s,
		progressBar:   p,
		shellViewport: shell,
		viewport:      vp,
		cfg:           cfg,
		title:         title,
		width:         w,
		height:        24,
		expectedSteps: expectedSteps,
		preflightStepCount: 3,
	}
}

func (m progressModel) Init() tea.Cmd {
	m.reflow()
	m.syncViewportContent()
	return tea.Batch(m.spinner.Tick, tea.WindowSize())
}

func (m progressModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.reflow()
		m.syncViewportContent()
		return m, nil

	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q":
			m.done = true
			return m, tea.Quit
		}
		var cmd tea.Cmd
		m.viewport, cmd = m.viewport.Update(msg)
		return m, cmd

	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		m.syncViewportContent()
		return m, cmd

	case progress.FrameMsg:
		var cmd tea.Cmd
		model, nextCmd := m.progressBar.Update(msg)
		if pm, ok := model.(progress.Model); ok {
			m.progressBar = pm
		}
		cmd = nextCmd
		return m, cmd

	case stepMsg:
		return m.handleStep(GenericEvent(msg))

	case doneMsg:
		m.done = true
		return m, tea.Quit
	}

	return m, nil
}

func (m progressModel) handleStep(evt GenericEvent) (tea.Model, tea.Cmd) {
	switch evt.Type {
	case "progress":
		idx := m.findStep(evt.Step)
		switch evt.Status {
		case "start":
			if idx < 0 {
				m.steps = append(m.steps, stepState{
					text:      evt.Step,
					status:    "start",
					startedAt: time.Now(),
				})
			}
		case "update":
			if idx >= 0 {
				m.steps[idx].status = "update"
				if evt.Message != "" {
					m.steps[idx].message = evt.Message
				}
				if evt.Progress != nil {
					m.steps[idx].progress = *evt.Progress
				}
			}
		case "done":
			if idx >= 0 {
				m.steps[idx].status = "done"
				m.steps[idx].progress = 1.0
				m.steps[idx].finishedAt = time.Now()
				if evt.Message != "" {
					m.steps[idx].message = evt.Message
				}
			}
		case "error":
			if idx >= 0 {
				m.steps[idx].status = "error"
				m.steps[idx].finishedAt = time.Now()
				if evt.Message != "" {
					m.steps[idx].message = evt.Message
				}
			}
		}

		// Recalculate peak ratio after every step update.
		changed := m.recalcPeakRatio()
		m.syncViewportContent()
		if changed {
			return m, m.progressBar.SetPercent(m.peakRatio)
		}

	case "result":
		m.result = evt.OutputPath
		m.done = true
		return m, tea.Quit

	case "report-data":
		if len(evt.Data) > 0 {
			m.jsonData = string(evt.Data)
		}
		return m, nil

	case "discrepancy":
		m.discrepancy = &DiscrepancyEvent{
			Type:          evt.Type,
			TotalCount:    evt.TotalCount,
			ByContributor: evt.ByContributor,
			Unattributed:  evt.Unattributed,
			Items:         evt.Items,
			AllItems:      evt.AllItems,
			DiscrepancyThreshold: evt.DiscrepancyThreshold,
		}
		return m, nil

	case "error":
		m.errorMsg = evt.Message
		m.done = true
		return m, tea.Quit
	}

	return m, nil
}

// recalcPeakRatio updates the monotonically increasing progress ratio.
// Excludes setup/preflight steps from the denominator so the bar starts at 0%
// when report processing begins.
func (m *progressModel) recalcPeakRatio() bool {
	total := float64(max(1, m.expectedSteps-m.preflightStepCount))
	if total == 0 {
		return false
	}
	completed := 0.0
	for _, s := range m.steps {
		if isPreflightStep(s.text) {
			continue
		}
		switch s.status {
		case "done", "error":
			completed += 1.0
		default:
			completed += s.progress
		}
	}
	if completed > total {
		completed = total
	}
	ratio := completed / total
	if ratio > m.peakRatio {
		m.peakRatio = ratio
		return true
	}
	return false
}

func (m progressModel) findStep(step string) int {
	for i, s := range m.steps {
		if s.text == step {
			return i
		}
	}
	return -1
}

func (m progressModel) View() string {
	if m.done && m.result == "" && m.errorMsg == "" {
		return ""
	}

	m.reflow()
	m.syncViewportContent()

	title := renderShellHeader(m.width)

	leftPanel := m.renderProgressPanel()
	rightPanel := m.renderConfigPanel()

	left := lipgloss.NewStyle().
		Width(m.leftPanelWidth()).
		Render(leftPanel)
	right := lipgloss.NewStyle().
		Width(m.rightPanelWidth()).
		Render(rightPanel)
	body := lipgloss.JoinHorizontal(lipgloss.Top, left, "  ", right)

	shell := lipgloss.JoinVertical(lipgloss.Left, title, "", body)
	m.shellViewport.SetContent(shell)
	return m.shellViewport.View()
}

func (m *progressModel) leftPanelWidth() int {
	w := m.width
	if w <= 0 {
		w = 80
	}
	lw := w * 3 / 5
	if lw < 32 {
		lw = 32
	}
	return lw
}

func (m *progressModel) rightPanelWidth() int {
	w := m.width
	if w <= 0 {
		w = 80
	}
	rw := w - m.leftPanelWidth() - 2 // 2-char gap
	if rw < 24 {
		rw = 24
	}
	return rw
}

func (m *progressModel) contentWidth() int {
	frame := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		Padding(0, 1)
	return max(20, m.leftPanelWidth()-frame.GetHorizontalFrameSize())
}

func (m *progressModel) viewportHeight() int {
	h := m.height
	if h <= 0 {
		h = 24
	}
	// Keep this bounded so the progress area never consumes the whole screen.
	// Extra step lines are handled via viewport scrolling.
	available := h - 12
	if available < 4 {
		available = 4
	}
	return min(14, available)
}

func (m *progressModel) reflow() {
	m.progressBar.Width = max(10, m.contentWidth()-6)
	m.viewport.Width = m.contentWidth()
	m.viewport.Height = m.viewportHeight()
	if m.width <= 0 {
		m.width = 80
	}
	if m.height <= 0 {
		m.height = 24
	}
	m.shellViewport.Width = m.width
	m.shellViewport.Height = m.height
}

func (m *progressModel) syncViewportContent() {
	doneIconStr := lipgloss.NewStyle().Foreground(lipgloss.Color("10")).Render("✔")
	errIconStr := lipgloss.NewStyle().Foreground(lipgloss.Color("9")).Render("✖")
	dim := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))

	lines := make([]string, 0, len(m.steps)*2)
	if len(m.steps) == 0 {
		lines = append(lines, dim.Render("Waiting for progress events…"))
	}

	now := time.Now()

	for _, s := range m.steps {
		switch s.status {
		case "done":
			// Single dim line for completed steps with inline timer.
			display := s.text
			if s.message != "" {
				display = s.message
			}
			line := doneIconStr + " " + display
			if elapsed := m.stepElapsed(s, now); elapsed != "" {
				line += " — " + elapsed
			}
			lines = append(lines, m.fitLine(dim.Render(line)))

		case "error":
			display := s.text
			if s.message != "" {
				display = s.message
			}
			line := errIconStr + " " + display
			if elapsed := m.stepElapsed(s, now); elapsed != "" {
				line += " — " + dim.Render(elapsed)
			}
			lines = append(lines, m.fitLine(line))

		default:
			// Active step with inline timer.
			label := s.text
			line := m.spinner.View() + " " + label
			if elapsed := m.stepElapsed(s, now); elapsed != "" {
				line += " — " + elapsed
			}
			lines = append(lines, m.fitLine(line))

			// Indented detail line when message differs from label.
			if s.message != "" && s.message != s.text {
				detail := dim.Render("   " + s.message)
				lines = append(lines, m.fitLine(detail))
			}
		}
	}

	m.viewport.SetContent(strings.Join(lines, "\n"))
	m.viewport.GotoBottom()
}

func (m *progressModel) fitLine(line string) string {
	maxWidth := m.viewport.Width
	if maxWidth <= 0 {
		maxWidth = 20
	}
	if lipgloss.Width(line) <= maxWidth {
		return line
	}
	runes := []rune(line)
	for len(runes) > 0 && lipgloss.Width(string(runes)) > maxWidth-1 {
		runes = runes[:len(runes)-1]
	}
	return string(runes) + "…"
}

func (m progressModel) renderProgressPanel() string {
	contentWidth := m.contentWidth()
	title := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("212")).
		Render(m.title)

	pctStr := fmt.Sprintf("%3d%%", int(m.peakRatio*100))
	bar := m.progressBar.View()
	barPadding := max(0, contentWidth-lipgloss.Width(bar)-1-len(pctStr))
	progressLine := fmt.Sprintf("%s %s%s", bar, pctStr, strings.Repeat(" ", barPadding))

	frame := lipgloss.NewStyle().
		Border(lipgloss.HiddenBorder()).
		Padding(0, 1).
		Width(contentWidth)

	body := lipgloss.JoinVertical(
		lipgloss.Left,
		title,
		"",
		progressLine,
		renderDividerLine(m.viewport.Width),
		m.viewport.View(),
	)
	return frame.Render(body)
}

func (m progressModel) renderConfigPanel() string {
	if m.cfg == nil {
		return lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("240")).
			Padding(0, 1).
			Width(max(20, m.rightPanelWidth()-4)).
			Render("Configuration unavailable")
	}
	return renderSummary(m.cfg, wsDone, wsDone, m.rightPanelWidth())
}

// ProgressResult contains the outcome of a progress display run.
type ProgressResult struct {
	ResultPath  string
	ErrorMsg    string
	Discrepancy *DiscrepancyEvent
	JsonData    string // serialized report data JSON for preview tab
}

// RunProgressDisplay creates and runs the Bubble Tea progress program.
// It reads events from the eventCh channel and returns the result path or error.
func RunProgressDisplay(title string, expectedSteps int, cfg *ReportConfig, eventCh <-chan GenericEvent) (resultPath string, errMsg string) {
	result := RunProgressDisplayFull(title, expectedSteps, cfg, eventCh)
	return result.ResultPath, result.ErrorMsg
}

// RunProgressDisplayFull is like RunProgressDisplay but also returns captured discrepancy data.
func RunProgressDisplayFull(title string, expectedSteps int, cfg *ReportConfig, eventCh <-chan GenericEvent) ProgressResult {
	m := newProgressModel(title, expectedSteps, cfg)

	p := tea.NewProgram(m, tea.WithOutput(os.Stderr), tea.WithAltScreen())

	// Feed events from the channel into the Bubble Tea program
	go func() {
		for evt := range eventCh {
			p.Send(stepMsg(evt))
		}
		p.Send(doneMsg{})
	}()

	finalModel, err := teaProgramRun(p)
	if err != nil {
		return ProgressResult{ErrorMsg: fmt.Sprintf("TUI error: %v", err)}
	}

	final := finalModel.(progressModel)
	return ProgressResult{
		ResultPath:  final.result,
		ErrorMsg:    final.errorMsg,
		Discrepancy: final.discrepancy,
		JsonData:    final.jsonData,
	}
}

// stepElapsed returns a formatted elapsed string for a step.
// For finished steps, uses the recorded duration. For active steps,
// only shows after 3s to avoid flicker on quick steps.
func (m *progressModel) stepElapsed(s stepState, now time.Time) string {
	if s.startedAt.IsZero() {
		return ""
	}
	if !s.finishedAt.IsZero() {
		return formatElapsed(s.finishedAt.Sub(s.startedAt))
	}
	dur := now.Sub(s.startedAt)
	if dur >= 3*time.Second {
		return formatElapsed(dur)
	}
	return ""
}

// formatElapsed renders a duration as "M:SS" for display in the progress view.
func formatElapsed(d time.Duration) string {
	secs := int(d.Seconds())
	return fmt.Sprintf("%d:%02d", secs/60, secs%60)
}

func isPreflightStep(step string) bool {
	s := strings.ToLower(strings.TrimSpace(step))
	return strings.HasPrefix(s, "collecting organization details") ||
		strings.HasPrefix(s, "listing repositories") ||
		strings.HasPrefix(s, "collecting members for") ||
		strings.HasPrefix(s, "skipping repository discovery")
}
