package main

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
)

// interviewBootstrapStep enumerates the form screens of the bootstrap
// wizard. Branching for rubric mode (custom vs default+jd) is handled by
// the advance() transition, not by the enumeration order.
type interviewBootstrapStep int

const (
	ibStepRole interviewBootstrapStep = iota
	ibStepRoleTitle
	ibStepStack
	ibStepDomain
	ibStepFeature
	ibStepTimeBox
	// ibStepTimeBoxCustom is a sub-step shown only when the user chooses
	// "Custom" on the time-box select. It runs the validated minutes-input
	// form before the wizard advances to project-mode.
	ibStepTimeBoxCustom
	ibStepProjectMode
	ibStepAnalysisMode
	ibStepRubricMode
	ibStepCustomPrompt
	ibStepJDPath
	ibStepOutputDir
	ibStepConfirm
	ibStepDone
)

// interviewBootstrapTeaModel is a bubbletea Model that drives the bootstrap
// wizard. It wraps the existing bootstrapWizardModel data container and
// embeds a *huh.Form for the current screen, so the View() composition
// produces the same shell-header + summary-panel layout as the report
// wizard.
type interviewBootstrapTeaModel struct {
	data      bootstrapWizardModel
	step      interviewBootstrapStep
	highWater interviewBootstrapStep
	form      *huh.Form

	width, height int
}

func newInterviewBootstrapTeaModel(d BootstrapWizardDefaults) *interviewBootstrapTeaModel {
	m := &interviewBootstrapTeaModel{
		data:      newBootstrapWizardModel(d),
		step:      ibStepRole,
		highWater: ibStepRole,
	}
	m.form = m.buildForm()
	return m
}

func (m *interviewBootstrapTeaModel) Init() tea.Cmd {
	if m.form != nil {
		return m.form.Init()
	}
	return nil
}

func (m *interviewBootstrapTeaModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		if m.form != nil {
			m.form = m.form.WithWidth(m.formWidth())
			// Forward the resize message so internal viewport/scroll state
			// inside the form's fields re-layouts immediately rather than
			// waiting for the next keystroke.
			form, cmd := m.form.Update(msg)
			if f, ok := form.(*huh.Form); ok {
				m.form = f
			}
			return m, cmd
		}
		return m, nil

	case tea.KeyMsg:
		if msg.String() == "ctrl+c" {
			m.data.aborted = true
			return m, tea.Quit
		}
	}

	if m.form == nil {
		return m, tea.Quit
	}

	form, cmd := m.form.Update(msg)
	if f, ok := form.(*huh.Form); ok {
		m.form = f
	}

	if m.form.State == huh.StateCompleted {
		return m.advance()
	}
	if m.form.State == huh.StateAborted {
		m.data.aborted = true
		return m, tea.Quit
	}
	return m, cmd
}

func (m *interviewBootstrapTeaModel) View() string {
	if m.step == ibStepDone {
		return ""
	}

	w := m.width
	if w <= 0 {
		w = 80
	}

	title := renderShellHeader(w)

	formWidth := m.formWidth()
	summaryWidth := w - formWidth - 2

	leftFrame := lipgloss.NewStyle().
		Border(lipgloss.HiddenBorder()).
		Padding(0, 1)
	leftInnerWidth := max(20, formWidth-leftFrame.GetHorizontalFrameSize())

	leftPanel := ""
	if m.form != nil {
		leftPanel = m.form.View()
	}
	leftPanel = leftFrame.Width(leftInnerWidth).Render(leftPanel)

	rightPanel := renderInterviewBootstrapSummary(&m.data, m.step, m.highWater, summaryWidth)

	left := lipgloss.NewStyle().Width(formWidth).Render(leftPanel)
	right := lipgloss.NewStyle().Width(summaryWidth).Render(rightPanel)

	hintStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	hints := hintStyle.Render("enter continue • ctrl+c quit")

	body := lipgloss.JoinHorizontal(lipgloss.Top, left, "  ", right)

	return lipgloss.JoinVertical(lipgloss.Left, title, "", body, "", hints)
}

func (m *interviewBootstrapTeaModel) formWidth() int {
	w := m.width
	if w <= 0 {
		w = 80
	}
	return w * 3 / 5
}

// advance moves to the next step, accounting for the rubric-mode branch
// and the time-box "custom" sub-step. Returns (model, tea.Quit) when the
// wizard reaches its final state (Confirm answered).
func (m *interviewBootstrapTeaModel) advance() (tea.Model, tea.Cmd) {
	next := m.nextStep(m.step)
	if next == ibStepDone {
		m.step = ibStepDone
		return m, tea.Quit
	}
	m.step = next
	if next > m.highWater {
		m.highWater = next
	}
	m.form = m.buildForm()
	if m.form == nil {
		return m, tea.Quit
	}
	return m, m.form.Init()
}

func (m *interviewBootstrapTeaModel) nextStep(cur interviewBootstrapStep) interviewBootstrapStep {
	switch cur {
	case ibStepRole:
		return ibStepRoleTitle
	case ibStepRoleTitle:
		return ibStepStack
	case ibStepStack:
		return ibStepDomain
	case ibStepDomain:
		return ibStepFeature
	case ibStepFeature:
		return ibStepTimeBox
	case ibStepTimeBox:
		// Branch into the custom sub-step only when the user picked
		// "Custom" on the select. Otherwise skip straight to project mode.
		if m.data.timeBox == "custom" {
			return ibStepTimeBoxCustom
		}
		return ibStepProjectMode
	case ibStepTimeBoxCustom:
		return ibStepProjectMode
	case ibStepProjectMode:
		return ibStepAnalysisMode
	case ibStepAnalysisMode:
		return ibStepRubricMode
	case ibStepRubricMode:
		switch m.data.modeRubric {
		case "custom":
			return ibStepCustomPrompt
		case "default+jd":
			return ibStepJDPath
		default:
			return ibStepOutputDir
		}
	case ibStepCustomPrompt:
		return ibStepOutputDir
	case ibStepJDPath:
		return ibStepOutputDir
	case ibStepOutputDir:
		return ibStepConfirm
	case ibStepConfirm:
		return ibStepDone
	default:
		return ibStepDone
	}
}

// buildForm constructs the huh.Form for the current step. Each form binds
// to a field on m.data so the data container stays the single source of
// truth for the validated final result.
func (m *interviewBootstrapTeaModel) buildForm() *huh.Form {
	d := &m.data
	switch m.step {
	case ibStepRole:
		return huh.NewForm(huh.NewGroup(
			huh.NewInput().
				Title("Role slug (URL-safe identifier)").
				Description("Lowercase, hyphenated — e.g. 'senior-backend' or 'staff-frontend'").
				Value(&d.role).
				Validate(validateRoleSlug),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepRoleTitle:
		return huh.NewForm(huh.NewGroup(
			huh.NewInput().
				Title("Role title (human-readable, optional)").
				Description("e.g. 'Senior Backend Engineer'").
				Value(&d.roleTitle),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepStack:
		return huh.NewForm(huh.NewGroup(
			huh.NewInput().
				Title("Primary tech stack").
				Description("e.g. 'TypeScript', 'Go', 'Python'").
				Value(&d.stack).
				Validate(nonEmpty("stack")),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepDomain:
		return huh.NewForm(huh.NewGroup(
			huh.NewInput().
				Title("Business domain").
				Description("e.g. 'Payments', 'Storefront', 'Identity'").
				Value(&d.domain).
				Validate(nonEmpty("domain")),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepFeature:
		return huh.NewForm(huh.NewGroup(
			huh.NewText().
				Title("Feature description").
				Description("A short paragraph describing what the candidate will build").
				Value(&d.feature).
				Validate(nonEmpty("feature")),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepTimeBox:
		return huh.NewForm(huh.NewGroup(
			huh.NewSelect[string]().
				Title("Time-box (minutes)").
				Options(
					huh.NewOption("60 minutes", "60"),
					huh.NewOption("90 minutes (recommended)", "90"),
					huh.NewOption("120 minutes", "120"),
					huh.NewOption("Custom", "custom"),
				).
				Value(&d.timeBox),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepTimeBoxCustom:
		// The select binds to d.timeBox; arriving here means it's the
		// literal "custom". Replace it with the empty string so the input
		// field starts blank rather than showing "custom" as the value.
		if d.timeBox == "custom" {
			d.timeBox = ""
		}
		return m.buildTimeBoxCustomForm()

	case ibStepProjectMode:
		return huh.NewForm(huh.NewGroup(
			huh.NewSelect[string]().
				Title("Project mode").
				Description("A: generate a starter project for the candidate. B: candidate brings their own.").
				Options(
					huh.NewOption("A — generate starter project", "A"),
					huh.NewOption("B — candidate brings their own", "B"),
				).
				Value(&d.modeProject),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepAnalysisMode:
		return huh.NewForm(huh.NewGroup(
			huh.NewSelect[string]().
				Title("Analysis mode").
				Description("ai-assisted: AI generates observations for the manager to review. human-only: manager writes everything.").
				Options(
					huh.NewOption("AI-assisted (recommended)", "ai-assisted"),
					huh.NewOption("Human-only", "human-only"),
				).
				Value(&d.modeAnalysis),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepRubricMode:
		return huh.NewForm(huh.NewGroup(
			huh.NewSelect[string]().
				Title("Rubric mode").
				Description("default: 9 built-in dimensions. custom: write your own prompt. default+jd: 9 dims plus your JD as additional context.").
				Options(
					huh.NewOption("Default (recommended)", "default"),
					huh.NewOption("Custom prompt", "custom"),
					huh.NewOption("Default + Job Description", "default+jd"),
				).
				Value(&d.modeRubric),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepCustomPrompt:
		return huh.NewForm(huh.NewGroup(
			huh.NewText().
				Title("Custom rubric prompt").
				Description("Describe the dimensions you want to assess").
				Value(&d.customPrompt).
				Validate(nonEmpty("custom prompt")),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepJDPath:
		return huh.NewForm(huh.NewGroup(
			huh.NewInput().
				Title("Path to job description file").
				Description("Absolute or relative path to a .md or .txt file").
				Value(&d.jdPath).
				Validate(func(s string) error {
					if err := validateJDPath(s); err != nil {
						return err
					}
					if s == "" {
						return fmt.Errorf("JD path is required for 'default+jd' rubric mode")
					}
					return nil
				}),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepOutputDir:
		if d.outputDir == "./roles/role" && d.role != "" {
			d.outputDir = "./roles/" + d.role
		}
		return huh.NewForm(huh.NewGroup(
			huh.NewInput().
				Title("Output directory").
				Description("Where the role config and starter project will be written").
				Value(&d.outputDir).
				Validate(nonEmpty("output directory")),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepConfirm:
		return huh.NewForm(huh.NewGroup(
			huh.NewConfirm().
				Title("Ready to bootstrap?").
				Description(summarizeBootstrapModel(m.data)).
				Affirmative("Yes, generate the role").
				Negative("Cancel").
				Value(&d.confirmed),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())
	}
	return nil
}

func (m *interviewBootstrapTeaModel) buildTimeBoxCustomForm() *huh.Form {
	return huh.NewForm(huh.NewGroup(
		huh.NewInput().
			Title("Custom time-box (30-240 minutes)").
			Value(&m.data.timeBox).
			Validate(validateTimeBox),
	)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())
}

// runBootstrapTeaWizard launches the bubbletea program for the bootstrap
// wizard. Production callers get stdin/stdout/alt-screen; tests replace
// runBootstrapTeaProgram with a stub that drives the model in-process.
func runBootstrapTeaWizard(d BootstrapWizardDefaults) (*BootstrapWizardResult, error) {
	model := newInterviewBootstrapTeaModel(d)
	// No WithInput/WithOutput overrides — bubbletea uses the inherited
	// stdin/stdout. Passing nil here previously left the program with no
	// I/O at all and the wizard hung the moment the user pressed a key.
	p := tea.NewProgram(model, tea.WithAltScreen())
	return runBootstrapTeaProgram(p, model)
}

// runBootstrapTeaProgram is the indirection seam for tests. The default
// implementation runs the real bubbletea event loop; smoke tests in
// interview_bootstrap_wizard_test.go replace it with a driver that walks
// the model through advance() transitions in-process.
var runBootstrapTeaProgram = func(p *tea.Program, _ *interviewBootstrapTeaModel) (*BootstrapWizardResult, error) {
	finalModel, err := p.Run()
	if err != nil {
		return nil, err
	}
	tm, ok := finalModel.(*interviewBootstrapTeaModel)
	if !ok {
		return nil, fmt.Errorf(
			"bootstrap tea program returned unexpected model type %T", finalModel,
		)
	}
	return &BootstrapWizardResult{
		Options:   bootstrapWizardOptionsFromModel(tm.data),
		Confirmed: tm.data.confirmed,
		Aborted:   tm.data.aborted,
	}, nil
}
