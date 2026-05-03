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

// assessStepState mirrors stepState but tracks the assess pipeline.
type assessStepState struct {
	text       string
	status     string // "active", "complete", "failed"
	message    string
	startedAt  time.Time
	finishedAt time.Time
}

// assessProgressModel is the Bubble Tea model for the maturity-assessment progress display.
// Mirrors progressModel (report) so visual design matches: two-pane layout, step list with
// ✔/✖/spinner icons, monotonic progress bar, right-side configuration summary.
type assessProgressModel struct {
	steps           []assessStepState
	expectedSteps   []string // canonical pipeline order, used to compute progress + show all steps from start
	spinner         spinner.Model
	progressBar     progress.Model
	shellViewport   viewport.Model
	viewport        viewport.Model
	cfg             *AssessConfig
	title           string
	resultPath      string
	jsonPath        string
	jsonData        string
	errorMsg        string
	pendingQuestion *GenericEvent // set when an interview-question event arrives mid-flow
	answersSent     int
	totalQuestions  int
	done            bool
	width           int
	height          int
	peakRatio       float64
	cancelled       bool
}

// Messages used by the assess progress program.
type assessStepMsg GenericEvent
type assessDoneMsg struct{}
type assessAskMsg struct{ evt GenericEvent }
type assessAnswerSentMsg struct{ ok bool }
type assessFatalMsg struct{ err error }

// canonicalAssessSteps drives the right-pane progress denominator and the
// always-visible step list.
var canonicalAssessSteps = []string{
	"startup",
	"preflight",
	"adjacent-repos",
	"interview",
	"evidence",
	"scoring",
	"writing",
	"audit-store",
	"complete",
}

func newAssessProgressModel(title string, cfg *AssessConfig, totalQuestions int) assessProgressModel {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("14"))

	p := progress.New(
		progress.WithDefaultGradient(),
		progress.WithoutPercentage(),
	)

	w := termWidth()
	p.Width = max(10, w-16)

	vp := viewport.New(max(20, w-6), 8)
	shell := viewport.New(max(20, w), 24)

	return assessProgressModel{
		spinner:        s,
		progressBar:    p,
		shellViewport:  shell,
		viewport:       vp,
		cfg:            cfg,
		title:          title,
		expectedSteps:  canonicalAssessSteps,
		totalQuestions: totalQuestions,
		width:          w,
		height:         24,
	}
}

func (m assessProgressModel) Init() tea.Cmd {
	return tea.Batch(m.spinner.Tick, tea.WindowSize())
}

func (m assessProgressModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
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
			if m.pendingQuestion == nil {
				m.cancelled = true
				m.done = true
				return m, tea.Quit
			}
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

	case assessStepMsg:
		return m.handleStep(GenericEvent(msg))

	case assessDoneMsg:
		m.done = true
		return m, tea.Quit

	case assessFatalMsg:
		m.errorMsg = msg.err.Error()
		m.done = true
		return m, tea.Quit
	}

	return m, nil
}

func (m assessProgressModel) handleStep(evt GenericEvent) (tea.Model, tea.Cmd) {
	switch evt.Type {
	case "progress":
		idx := m.findStep(evt.Step)
		switch evt.Status {
		case "active":
			if idx < 0 {
				m.steps = append(m.steps, assessStepState{
					text:      evt.Step,
					status:    "active",
					message:   evt.Message,
					startedAt: time.Now(),
				})
			} else {
				m.steps[idx].status = "active"
				if evt.Message != "" {
					m.steps[idx].message = evt.Message
				}
			}
		case "complete":
			if idx >= 0 {
				m.steps[idx].status = "complete"
				m.steps[idx].finishedAt = time.Now()
				if evt.Message != "" {
					m.steps[idx].message = evt.Message
				}
			} else {
				m.steps = append(m.steps, assessStepState{
					text:       evt.Step,
					status:     "complete",
					message:    evt.Message,
					startedAt:  time.Now(),
					finishedAt: time.Now(),
				})
			}
		case "failed":
			if idx >= 0 {
				m.steps[idx].status = "failed"
				m.steps[idx].finishedAt = time.Now()
				if evt.Message != "" {
					m.steps[idx].message = evt.Message
				}
			}
		}
		m.recalcPeakRatio()
		m.syncViewportContent()
		return m, m.progressBar.SetPercent(m.peakRatio)

	case "interview-frame":
		// Surface the framing message inline as an active step note.
		m.upsertActive("interview", evt.Message)
		m.syncViewportContent()
		return m, nil

	case "interview-question":
		m.pendingQuestion = &evt
		m.upsertActive(
			"interview",
			fmt.Sprintf("Question %d of %d — awaiting answer (%s)…", m.answersSent+1, m.totalQuestions, evt.QuestionID),
		)
		m.syncViewportContent()
		return m, nil

	case "result":
		m.resultPath = evt.OutputPath
		m.jsonPath = evt.JsonOutputPath
		if len(evt.Data) > 0 {
			m.jsonData = string(evt.Data)
		}
		m.done = true
		return m, tea.Quit

	case "report-data":
		if len(evt.Data) > 0 {
			m.jsonData = string(evt.Data)
		}
		return m, nil

	case "error":
		m.errorMsg = evt.Message
		m.done = true
		return m, tea.Quit
	}

	return m, nil
}

func (m *assessProgressModel) upsertActive(stepName, message string) {
	idx := m.findStep(stepName)
	if idx < 0 {
		m.steps = append(m.steps, assessStepState{
			text:      stepName,
			status:    "active",
			message:   message,
			startedAt: time.Now(),
		})
		return
	}
	if m.steps[idx].status == "active" {
		m.steps[idx].message = message
	}
}

func (m assessProgressModel) findStep(step string) int {
	for i, s := range m.steps {
		if s.text == step {
			return i
		}
	}
	return -1
}

// recalcPeakRatio computes a monotonically increasing ratio over the
// canonical step list. Steps not yet seen contribute 0; active steps
// contribute 0.5; complete/failed contribute 1.
func (m *assessProgressModel) recalcPeakRatio() {
	denom := float64(len(m.expectedSteps))
	if denom == 0 {
		return
	}
	var completed float64
	for _, name := range m.expectedSteps {
		idx := m.findStep(name)
		if idx < 0 {
			continue
		}
		switch m.steps[idx].status {
		case "complete", "failed":
			completed += 1.0
		case "active":
			completed += 0.5
		}
	}
	ratio := completed / denom
	if ratio > 1.0 {
		ratio = 1.0
	}
	if ratio > m.peakRatio {
		m.peakRatio = ratio
	}
}

func (m assessProgressModel) View() string {
	if m.done && m.resultPath == "" && m.errorMsg == "" {
		return ""
	}

	m.reflow()
	m.syncViewportContent()

	title := renderShellHeader(m.width)
	leftPanel := m.renderProgressPanel()
	rightPanel := m.renderConfigPanel()

	left := lipgloss.NewStyle().Width(m.leftPanelWidth()).Render(leftPanel)
	right := lipgloss.NewStyle().Width(m.rightPanelWidth()).Render(rightPanel)
	body := lipgloss.JoinHorizontal(lipgloss.Top, left, "  ", right)

	shell := lipgloss.JoinVertical(lipgloss.Left, title, "", body)
	m.shellViewport.SetContent(shell)
	return m.shellViewport.View()
}

func (m *assessProgressModel) leftPanelWidth() int {
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

func (m *assessProgressModel) rightPanelWidth() int {
	w := m.width
	if w <= 0 {
		w = 80
	}
	rw := w - m.leftPanelWidth() - 2
	if rw < 24 {
		rw = 24
	}
	return rw
}

func (m *assessProgressModel) contentWidth() int {
	frame := lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).Padding(0, 1)
	return max(20, m.leftPanelWidth()-frame.GetHorizontalFrameSize())
}

func (m *assessProgressModel) viewportHeight() int {
	h := m.height
	if h <= 0 {
		h = 24
	}
	available := h - 12
	if available < 4 {
		available = 4
	}
	return min(14, available)
}

func (m *assessProgressModel) reflow() {
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

func (m *assessProgressModel) syncViewportContent() {
	doneIcon := lipgloss.NewStyle().Foreground(lipgloss.Color("10")).Render("✔")
	errIcon := lipgloss.NewStyle().Foreground(lipgloss.Color("9")).Render("✖")
	dim := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	pendingDim := lipgloss.NewStyle().Foreground(lipgloss.Color("239"))

	lines := make([]string, 0, len(m.expectedSteps)*2)
	now := time.Now()

	for _, name := range m.expectedSteps {
		idx := m.findStep(name)
		if idx < 0 {
			lines = append(lines, m.fitLine(pendingDim.Render("○ "+humanizeStep(name))))
			continue
		}
		s := m.steps[idx]
		switch s.status {
		case "complete":
			label := s.message
			if label == "" {
				label = humanizeStep(s.text)
			}
			line := doneIcon + " " + label
			if elapsed := assessStepElapsed(s, now); elapsed != "" {
				line += " — " + elapsed
			}
			lines = append(lines, m.fitLine(dim.Render(line)))
		case "failed":
			label := s.message
			if label == "" {
				label = humanizeStep(s.text)
			}
			line := errIcon + " " + label
			lines = append(lines, m.fitLine(line))
		case "active":
			line := m.spinner.View() + " " + humanizeStep(s.text)
			if elapsed := assessStepElapsed(s, now); elapsed != "" {
				line += " — " + elapsed
			}
			lines = append(lines, m.fitLine(line))
			if s.message != "" && s.message != s.text {
				lines = append(lines, m.fitLine(dim.Render("   "+s.message)))
			}
		}
	}

	m.viewport.SetContent(strings.Join(lines, "\n"))
	m.viewport.GotoBottom()
}

func (m *assessProgressModel) fitLine(line string) string {
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

func (m assessProgressModel) renderProgressPanel() string {
	contentWidth := m.contentWidth()
	title := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("212")).Render(m.title)

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

func (m assessProgressModel) renderConfigPanel() string {
	if m.cfg == nil {
		return lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("240")).
			Padding(0, 1).
			Width(max(20, m.rightPanelWidth()-4)).
			Render("Configuration unavailable")
	}
	return renderAssessSummary(m.cfg, m.rightPanelWidth())
}

// AssessProgressResult is the outcome of a maturity-assessment progress run.
type AssessProgressResult struct {
	ResultPath string
	JsonPath   string
	JsonData   string
	ErrorMsg   string
	Cancelled  bool
}

// RunAssessProgressDisplay drives the Bubble Tea progress program for the assess flow.
// It owns event-channel reading, dispatches interview prompts to a callback, and
// returns the final result + path data (or an error).
//
// askInterview is invoked synchronously when an "interview-question" event arrives;
// it must return the answer + isOption flag (or an error to abort). The Tea program
// exits the alt-screen for the duration of the prompt so huh can take over the TTY,
// then resumes.
func RunAssessProgressDisplay(
	title string,
	cfg *AssessConfig,
	res *AssessRunResult,
	askInterview func(evt GenericEvent) (string, bool, error),
) AssessProgressResult {
	m := newAssessProgressModel(title, cfg, 7)

	p := tea.NewProgram(m, tea.WithOutput(os.Stderr), tea.WithAltScreen())

	go func() {
		for evt := range res.Events {
			if evt.Type == "interview-question" {
				// Pause the alt-screen, run the prompt synchronously, then forward the answer.
				p.ReleaseTerminal()
				value, isOption, err := askInterview(evt)
				if err != nil {
					p.Send(assessFatalMsg{err: err})
					p.RestoreTerminal()
					continue
				}
				_ = SendInterviewAnswer(res, evt.QuestionID, value, isOption)
				p.RestoreTerminal()
				p.Send(assessStepMsg(evt))
				continue
			}
			p.Send(assessStepMsg(evt))
		}
		p.Send(assessDoneMsg{})
	}()

	finalModel, err := teaProgramRun(p)
	if err != nil {
		return AssessProgressResult{ErrorMsg: fmt.Sprintf("TUI error: %v", err)}
	}
	final, ok := finalModel.(assessProgressModel)
	if !ok {
		return AssessProgressResult{ErrorMsg: "internal: unexpected final model"}
	}
	return AssessProgressResult{
		ResultPath: final.resultPath,
		JsonPath:   final.jsonPath,
		JsonData:   final.jsonData,
		ErrorMsg:   final.errorMsg,
		Cancelled:  final.cancelled,
	}
}

func assessStepElapsed(s assessStepState, now time.Time) string {
	if s.startedAt.IsZero() {
		return ""
	}
	if !s.finishedAt.IsZero() {
		return formatElapsed(s.finishedAt.Sub(s.startedAt))
	}
	if dur := now.Sub(s.startedAt); dur >= 3*time.Second {
		return formatElapsed(dur)
	}
	return ""
}

// humanizeStep maps the lower-kebab step name to a label that fits the
// existing report's tone (capitalized verb-phrases).
func humanizeStep(step string) string {
	switch step {
	case "startup":
		return "Initializing assessment"
	case "preflight":
		return "Detecting evidence tier"
	case "adjacent-repos":
		return "Mapping adjacent repositories"
	case "interview":
		return "Phase-1 interview"
	case "evidence":
		return "Collecting evidence"
	case "scoring":
		return "AI scoring"
	case "writing":
		return "Writing audit"
	case "audit-store":
		return "Updating CONFIG.md"
	case "complete":
		return "Audit complete"
	}
	return step
}
