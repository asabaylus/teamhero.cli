package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
)

// runAssessInteractive is the entry point for `teamhero assess` (no flags). It:
//  1. Runs the framed scope wizard (matches the report's two-pane layout).
//  2. Spawns the service runner and drives the Bubble Tea progress display.
//  3. Round-trips interview questions through huh prompts (one at a time).
//  4. Opens the tabbed Glamour preview when the audit is written.
func runAssessInteractive(cfg *AssessConfig) error {
	res, err := runAssessScopeWizard(cfg)
	if err != nil {
		return err
	}
	if res.Aborted {
		fmt.Fprintln(os.Stderr, "\nAssessment cancelled.")
		return nil
	}
	if res.Config != nil {
		*cfg = *res.Config
	}

	cfg.Mode = "interactive"
	cfg.InteractiveInterview = true

	runner, err := RunAssessServiceRunner(*cfg)
	if err != nil {
		return err
	}
	defer runner.Close()

	progress := RunAssessProgressDisplay(
		"Agent Maturity Assessment",
		cfg,
		runner,
		func(qid, value string, isOption bool) error {
			return SendInterviewAnswer(runner, qid, value, isOption)
		},
	)

	for runErr := range runner.Errors {
		if runErr != nil {
			if runner.Stderr != nil && runner.Stderr.Len() > 0 {
				fmt.Fprintln(os.Stderr, runner.Stderr.String())
			}
			return runErr
		}
	}

	if progress.Cancelled {
		fmt.Fprintln(os.Stderr, "\nAssessment cancelled.")
		return nil
	}
	if progress.ErrorMsg != "" {
		RenderError(progress.ErrorMsg)
		return fmt.Errorf("assess: %s", progress.ErrorMsg)
	}

	if err := SaveAssessConfig(cfg); err != nil {
		fmt.Fprintf(os.Stderr, "Note: failed to save assess config: %v\n", err)
	}

	if progress.ResultPath == "" {
		return nil
	}

	if err := RunAssessPreview(progress.ResultPath, progress.JsonPath, progress.JsonData); err != nil {
		fmt.Fprintf(os.Stderr, "Note: preview unavailable (%v). Audit at: %s\n", err, progress.ResultPath)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Bubble Tea wizard — scope selection in the same shell layout as report.
// ---------------------------------------------------------------------------

type assessWizardState int

const (
	awScopeMode assessWizardState = iota
	awLocalPath
	awOrg
	awBoth
	awConfirm
	awDone
)

type assessWizardModel struct {
	state     assessWizardState
	cfg       AssessConfig
	form      *huh.Form
	width     int
	height    int
	confirmed bool
	aborted   bool
	history   []assessWizardState

	// Form bindings
	scopeMode   string
	localPath   string
	orgName     string
	repoCSV     string
	displayName string
	confirmRun  bool
}

// AssessWizardResult is returned after the framed wizard completes.
type AssessWizardResult struct {
	Config    *AssessConfig
	Confirmed bool
	Aborted   bool
}

// runAssessScopeWizard runs the scope-selection wizard inside a Bubble Tea
// program. The View() renders the same shell-header + two-pane layout as
// the report wizard, with the right pane showing renderAssessSummary().
func runAssessScopeWizard(cfg *AssessConfig) (*AssessWizardResult, error) {
	cwd, _ := os.Getwd()

	m := assessWizardModel{
		cfg:       *cfg,
		width:     termWidth(),
		state:     awScopeMode,
		scopeMode: defaultScopeMode(cfg, cwd),
		localPath: defaultLocalPath(cfg, cwd),
		orgName:   strings.TrimSpace(cfg.Scope.Org),
		repoCSV:   strings.Join(cfg.Scope.Repos, ","),
		displayName: strings.TrimSpace(cfg.Scope.DisplayName),
		confirmRun:  true,
	}
	m.form = m.buildForm()

	p := tea.NewProgram(&m, tea.WithOutput(os.Stderr), tea.WithAltScreen())
	finalModel, err := teaProgramRun(p)
	if err != nil {
		return nil, err
	}
	final := finalModel.(*assessWizardModel)
	return &AssessWizardResult{
		Config:    &final.cfg,
		Confirmed: final.confirmed,
		Aborted:   final.aborted,
	}, nil
}

func defaultScopeMode(cfg *AssessConfig, cwd string) string {
	if cfg.Scope.Mode != "" {
		return cfg.Scope.Mode
	}
	_ = cwd
	return "local-repo"
}

func defaultLocalPath(cfg *AssessConfig, cwd string) string {
	if cfg.Scope.LocalPath != "" {
		return cfg.Scope.LocalPath
	}
	return cwd
}

func (m *assessWizardModel) Init() tea.Cmd {
	if m.form != nil {
		return m.form.Init()
	}
	return nil
}

func (m *assessWizardModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		if m.form != nil {
			m.form = m.form.WithWidth(m.formWidth())
		}
		return m, nil

	case tea.KeyMsg:
		if msg.String() == "ctrl+c" {
			m.aborted = true
			return m, tea.Quit
		}
		if msg.String() == "esc" {
			return m.goBack()
		}
	}

	if m.form != nil {
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		switch m.form.State {
		case huh.StateCompleted:
			return m.advance()
		case huh.StateAborted:
			return m.goBack()
		}
		return m, cmd
	}
	return m, nil
}

func (m *assessWizardModel) advance() (tea.Model, tea.Cmd) {
	prev := m.state
	switch m.state {
	case awScopeMode:
		m.cfg.Scope.Mode = m.scopeMode
		switch m.scopeMode {
		case "local-repo":
			m.state = awLocalPath
		case "org":
			m.state = awOrg
		case "both":
			m.state = awBoth
		}

	case awLocalPath:
		m.cfg.Scope.LocalPath = strings.TrimSpace(m.localPath)
		m.cfg.Scope.Org = ""
		m.cfg.Scope.Repos = nil
		if strings.TrimSpace(m.displayName) == "" {
			m.cfg.Scope.DisplayName = filepath.Base(m.cfg.Scope.LocalPath)
		} else {
			m.cfg.Scope.DisplayName = strings.TrimSpace(m.displayName)
		}
		m.state = awConfirm

	case awOrg:
		m.cfg.Scope.Org = strings.TrimSpace(m.orgName)
		m.cfg.Scope.Repos = parseRepoCSV(m.repoCSV)
		m.cfg.Scope.LocalPath = ""
		if strings.TrimSpace(m.displayName) == "" {
			m.cfg.Scope.DisplayName = m.cfg.Scope.Org
		} else {
			m.cfg.Scope.DisplayName = strings.TrimSpace(m.displayName)
		}
		m.state = awConfirm

	case awBoth:
		m.cfg.Scope.Org = strings.TrimSpace(m.orgName)
		m.cfg.Scope.LocalPath = strings.TrimSpace(m.localPath)
		m.cfg.Scope.Repos = parseRepoCSV(m.repoCSV)
		if strings.TrimSpace(m.displayName) == "" {
			if m.cfg.Scope.Org != "" {
				m.cfg.Scope.DisplayName = m.cfg.Scope.Org
			} else {
				m.cfg.Scope.DisplayName = filepath.Base(m.cfg.Scope.LocalPath)
			}
		} else {
			m.cfg.Scope.DisplayName = strings.TrimSpace(m.displayName)
		}
		m.state = awConfirm

	case awConfirm:
		if !m.confirmRun {
			m.aborted = true
			m.state = awDone
			return m, tea.Quit
		}
		fillAssessDefaults(&m.cfg)
		m.confirmed = true
		m.state = awDone
		return m, tea.Quit
	}

	m.history = append(m.history, prev)
	m.form = m.buildForm()
	if m.form == nil {
		return m, nil
	}
	return m, m.form.Init()
}

func (m *assessWizardModel) goBack() (tea.Model, tea.Cmd) {
	if len(m.history) == 0 {
		m.aborted = true
		return m, tea.Quit
	}
	m.state = m.history[len(m.history)-1]
	m.history = m.history[:len(m.history)-1]
	m.form = m.buildForm()
	if m.form == nil {
		return m, nil
	}
	return m, m.form.Init()
}

func (m *assessWizardModel) buildForm() *huh.Form {
	switch m.state {
	case awScopeMode:
		return huh.NewForm(
			huh.NewGroup(
				huh.NewSelect[string]().
					Title("What's the scope of this audit?").
					Description("Choose what you're assessing.").
					Options(
						huh.NewOption("This local repo", "local-repo"),
						huh.NewOption("A GitHub organization", "org"),
						huh.NewOption("Both (org + a local checkout)", "both"),
					).
					Value(&m.scopeMode),
			),
		).WithWidth(m.formWidth()).WithTheme(huh.ThemeCharm())

	case awLocalPath:
		return huh.NewForm(
			huh.NewGroup(
				huh.NewInput().
					Title("Local repo path").
					Description("Path to the repo you want to audit.").
					Value(&m.localPath).
					Validate(validateLocalPath),
				huh.NewInput().
					Title("Display name (optional)").
					Description("Used in the audit title and filename. Defaults to the directory name.").
					Value(&m.displayName),
			),
		).WithWidth(m.formWidth()).WithTheme(huh.ThemeCharm())

	case awOrg:
		return huh.NewForm(
			huh.NewGroup(
				huh.NewInput().
					Title("GitHub organization").
					Description("e.g. acme-co (no slashes).").
					Value(&m.orgName).
					Validate(requireNonEmpty("organization")),
				huh.NewInput().
					Title("Repos to narrow scope (optional)").
					Description("Comma-separated repo names. Leave blank to assess the whole org.").
					Value(&m.repoCSV),
				huh.NewInput().
					Title("Display name (optional)").
					Description("Used in the audit title. Defaults to the org name.").
					Value(&m.displayName),
			),
		).WithWidth(m.formWidth()).WithTheme(huh.ThemeCharm())

	case awBoth:
		return huh.NewForm(
			huh.NewGroup(
				huh.NewInput().
					Title("GitHub organization").
					Value(&m.orgName).
					Validate(requireNonEmpty("organization")),
				huh.NewInput().
					Title("Local repo path").
					Description("A representative checkout to gather repo-side evidence from.").
					Value(&m.localPath).
					Validate(validateLocalPath),
				huh.NewInput().
					Title("Repos to narrow scope (optional)").
					Description("Comma-separated; leave blank for the whole org.").
					Value(&m.repoCSV),
				huh.NewInput().
					Title("Display name (optional)").
					Description("Defaults to the org name.").
					Value(&m.displayName),
			),
		).WithWidth(m.formWidth()).WithTheme(huh.ThemeCharm())

	case awConfirm:
		return huh.NewForm(
			huh.NewGroup(
				huh.NewConfirm().
					Title("Run this audit?").
					Description("Press Enter to start, or Escape to go back and edit.").
					Affirmative("Run audit").
					Negative("Cancel").
					Value(&m.confirmRun),
			),
		).WithWidth(m.formWidth()).WithTheme(huh.ThemeCharm())
	}
	return nil
}

func (m *assessWizardModel) View() string {
	if m.state == awDone {
		return ""
	}

	w := m.width
	if w <= 0 {
		w = 80
	}

	title := renderShellHeader(w)

	formWidth := m.formWidth()
	summaryWidth := w - formWidth - 2

	leftPanel := ""
	if m.form != nil {
		leftPanel = m.form.View()
	}
	leftFrame := lipgloss.NewStyle().Border(lipgloss.HiddenBorder()).Padding(0, 1)
	leftInnerWidth := max(20, formWidth-leftFrame.GetHorizontalFrameSize())
	leftPanel = leftFrame.Width(leftInnerWidth).Render(leftPanel)

	rightPanel := renderAssessSummary(&m.cfg, summaryWidth)

	left := lipgloss.NewStyle().Width(formWidth).Render(leftPanel)
	right := lipgloss.NewStyle().Width(summaryWidth).Render(rightPanel)
	body := lipgloss.JoinHorizontal(lipgloss.Top, left, "  ", right)

	hintStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	hints := hintStyle.Render("esc back • ctrl+c quit")

	return lipgloss.JoinVertical(lipgloss.Left, title, "", body, "", hints)
}

func (m *assessWizardModel) formWidth() int {
	w := m.width
	if w <= 0 {
		w = 80
	}
	return w * 3 / 5
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func validateLocalPath(s string) error {
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return fmt.Errorf("path is required")
	}
	info, err := os.Stat(trimmed)
	if err != nil {
		return fmt.Errorf("path does not exist: %s", trimmed)
	}
	if !info.IsDir() {
		return fmt.Errorf("path is not a directory: %s", trimmed)
	}
	return nil
}

func requireNonEmpty(field string) func(string) error {
	return func(s string) error {
		if strings.TrimSpace(s) == "" {
			return fmt.Errorf("%s is required", field)
		}
		return nil
	}
}

func parseRepoCSV(s string) []string {
	parts := strings.Split(strings.TrimSpace(s), ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// Interview prompts are hosted inside the progress model now (see
// assess_progress.go::buildInterviewSelectForm). Keeping that logic out
// of a standalone huh.Form.Run() keeps the framed two-pane layout
// continuous through the entire pipeline.
