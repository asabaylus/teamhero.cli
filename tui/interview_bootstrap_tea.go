package main

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/charmbracelet/bubbles/spinner"
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
	// ibStepPromptSource asks the proctor whether to write a custom
	// project-generation prompt themselves or have ChatGPT suggest ideas.
	ibStepPromptSource
	// ibStepProjectPrompt is the proctor's optional addendum to the AI
	// project-generation prompt. Optional — empty input is valid and
	// produces no addendum in the prompt sent to OpenAI.
	ibStepProjectPrompt
	// ibStepIdeaFetching is a transient spinner state shown while the
	// idea-fetcher runs. Reached only when promptSource == "suggest".
	ibStepIdeaFetching
	// ibStepIdeaSelect presents the fetched ideas as a single-select.
	// The chosen idea's title+blurb populates data.projectPrompt before
	// the wizard advances to confirm.
	ibStepIdeaSelect
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

	// ideaFetcher is the strategy used when promptSource == "suggest".
	// Production callers leave it nil; the tea model lazily constructs an
	// openAIIdeaFetcher when first needed. Tests inject a stub via the
	// constructor to avoid real HTTP traffic.
	ideaFetcher IdeaFetcher
	spin        spinner.Model

	width, height int
}

func newInterviewBootstrapTeaModel(d BootstrapWizardDefaults) *interviewBootstrapTeaModel {
	return newInterviewBootstrapTeaModelWithFetcher(d, nil)
}

// newInterviewBootstrapTeaModelWithFetcher is the test seam — supply a
// stubIdeaFetcher in tests so the "suggest ideas" branch can be exercised
// without HTTP. Pass nil to use the production OpenAI fetcher (constructed
// lazily on first need).
func newInterviewBootstrapTeaModelWithFetcher(d BootstrapWizardDefaults, fetcher IdeaFetcher) *interviewBootstrapTeaModel {
	sp := spinner.New()
	sp.Spinner = spinner.Dot
	sp.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("14"))
	m := &interviewBootstrapTeaModel{
		data:        newBootstrapWizardModel(d),
		step:        ibStepRole,
		highWater:   ibStepRole,
		ideaFetcher: fetcher,
		spin:        sp,
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

// ideasFetchedMsg is dispatched by the async idea-fetch tea.Cmd. Carries
// either the populated ideas slice or a human-readable error string.
type ideasFetchedMsg struct {
	ideas []ProjectIdea
	err   string
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

	case ideasFetchedMsg:
		// The async fetch completed. Land on the idea-select screen
		// regardless of success/failure — buildForm() renders an error
		// note when err != "" so the user can dismiss it and fall through.
		m.data.ideas = msg.ideas
		m.data.ideaFetchErr = msg.err
		return m.advance()

	case spinner.TickMsg:
		// Only progress the spinner while we're in a transient
		// async-work state, to keep redraws cheap when forms are active.
		if m.step == ibStepIdeaFetching {
			var cmd tea.Cmd
			m.spin, cmd = m.spin.Update(msg)
			return m, cmd
		}
	}

	// While fetching, we have no form to drive — return early so the
	// View() path renders the spinner without forwarding the message
	// into a nil form.
	if m.step == ibStepIdeaFetching {
		return m, nil
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
	if m.step == ibStepIdeaFetching {
		label := lipgloss.NewStyle().Foreground(lipgloss.Color("245"))
		title := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("212"))
		leftPanel = fmt.Sprintf(
			"  %s %s\n\n  %s\n",
			m.spin.View(),
			title.Render("Fetching project ideas…"),
			label.Render("OpenAI is drafting a handful of ideas scoped to your role profile."),
		)
	} else if m.form != nil {
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

// advance moves to the next step, accounting for the rubric-mode branch,
// the time-box "custom" sub-step, and the suggest-ideas async fetch.
// Returns (model, tea.Quit) when the wizard reaches its final state
// (Confirm answered).
func (m *interviewBootstrapTeaModel) advance() (tea.Model, tea.Cmd) {
	// Persist the selected idea into projectPrompt as the user leaves
	// the idea-select step — that way the downstream OpenAI call sees
	// the addendum without any additional plumbing.
	if m.step == ibStepIdeaSelect {
		m.commitSelectedIdea()
	}

	next := m.nextStep(m.step)
	if next == ibStepDone {
		m.step = ibStepDone
		return m, tea.Quit
	}
	m.step = next
	if next > m.highWater {
		m.highWater = next
	}

	// Entering the async fetch state: form is nil, spinner runs, and we
	// dispatch the actual OpenAI call as a tea.Cmd. The corresponding
	// ideasFetchedMsg lands back in Update() and re-enters advance().
	if next == ibStepIdeaFetching {
		m.form = nil
		return m, tea.Batch(m.spin.Tick, m.fetchIdeasCmd())
	}

	m.form = m.buildForm()
	if m.form == nil {
		return m, tea.Quit
	}
	return m, m.form.Init()
}

// commitSelectedIdea copies the chosen idea's "title — blurb" into
// data.projectPrompt so the downstream generator picks it up via the
// existing addendum path. No-op when no idea is selected (e.g. when the
// fetch failed and the user pressed enter on the error note).
func (m *interviewBootstrapTeaModel) commitSelectedIdea() {
	if len(m.data.ideas) == 0 {
		return
	}
	idx := m.data.ideaSelected
	if idx < 0 || idx >= len(m.data.ideas) {
		idx = 0
	}
	chosen := m.data.ideas[idx]
	m.data.projectPrompt = strings.TrimSpace(chosen.Title + "\n\n" + chosen.Blurb)
}

// fetchIdeasCmd returns a tea.Cmd that runs the OpenAI idea-fetch on a
// goroutine (Bubble Tea schedules Cmd in goroutines) and emits an
// ideasFetchedMsg when it finishes. The fetcher is lazily constructed
// the first time it's needed in production; tests inject a stub via the
// constructor and skip this lazy path entirely.
func (m *interviewBootstrapTeaModel) fetchIdeasCmd() tea.Cmd {
	return func() tea.Msg {
		fetcher := m.ideaFetcher
		if fetcher == nil {
			f, err := newOpenAIIdeaFetcher()
			if err != nil {
				return ideasFetchedMsg{err: err.Error()}
			}
			fetcher = f
		}
		tbMin := 0
		if n, err := strconv.Atoi(strings.TrimSpace(m.data.timeBox)); err == nil {
			tbMin = n
		}
		profile := IdeaProfile{
			Role:           m.data.role,
			RoleTitle:      m.data.roleTitle,
			Stack:          m.data.stack,
			Domain:         m.data.domain,
			Feature:        m.data.feature,
			TimeBoxMinutes: tbMin,
			ProjectMode:    m.data.modeProject,
		}
		ideas, err := fetcher.Fetch(profile)
		if err != nil {
			return ideasFetchedMsg{err: err.Error()}
		}
		return ideasFetchedMsg{ideas: ideas}
	}
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
		return ibStepPromptSource
	case ibStepPromptSource:
		if m.data.promptSource == "suggest" {
			return ibStepIdeaFetching
		}
		return ibStepProjectPrompt
	case ibStepProjectPrompt:
		return ibStepConfirm
	case ibStepIdeaFetching:
		return ibStepIdeaSelect
	case ibStepIdeaSelect:
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

	case ibStepProjectPrompt:
		// Optional. Empty input is valid — the AI generator just skips the
		// addendum. The proctor types domain or framing guidance that gets
		// appended after the rubric block in the project-generation prompt.
		return huh.NewForm(huh.NewGroup(
			huh.NewText().
				Title("Project prompt (optional)").
				Description("Extra instructions for the AI that will scaffold the project. Leave blank to use defaults.").
				Value(&d.projectPrompt),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepPromptSource:
		return huh.NewForm(huh.NewGroup(
			huh.NewSelect[string]().
				Title("How should the AI prompt be supplied?").
				Description("Custom: you type domain guidance. Suggest: ChatGPT proposes ideas scoped to the role profile; you pick one.").
				Options(
					huh.NewOption("Write a custom prompt", "custom"),
					huh.NewOption("Suggest ideas for me", "suggest"),
				).
				Value(&d.promptSource),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepIdeaFetching:
		// No huh form — the spinner is rendered in View(). The fetch was
		// kicked off by advance() as a tea.Cmd; we just wait for the
		// resulting ideasFetchedMsg.
		return nil

	case ibStepIdeaSelect:
		if d.ideaFetchErr != "" || len(d.ideas) == 0 {
			// Surface the fetch error as a one-line confirm screen; the user
			// can press enter to fall back to the custom-prompt path.
			return huh.NewForm(huh.NewGroup(
				huh.NewNote().
					Title("Idea generation failed").
					Description(d.ideaFetchErr + "\n\nPress enter to continue without an AI-suggested idea (you can type a custom prompt next, or leave projectPrompt empty)."),
			)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())
		}
		opts := make([]huh.Option[int], 0, len(d.ideas))
		for i, idea := range d.ideas {
			label := fmt.Sprintf("%s — %s", idea.Title, truncate(idea.Blurb, 60))
			opts = append(opts, huh.NewOption(label, i))
		}
		if d.ideaSelected < 0 {
			d.ideaSelected = 0
		}
		return huh.NewForm(huh.NewGroup(
			huh.NewSelect[int]().
				Title("Pick a project idea").
				Description("The full title + blurb of the selected idea becomes the project prompt.").
				Options(opts...).
				Value(&d.ideaSelected),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepConfirm:
		// Default to affirmative — after 13 screens of input the user almost
		// always wants to commit. huh.Confirm uses the initial value of the
		// bound variable to pick which button has focus, so without this
		// pre-set the user lands on "Cancel" and a stray Enter cancels the
		// whole wizard. Reported by a user who completed all steps, hit
		// Enter on confirm, and got "Wizard cancelled at confirm" instead
		// of a generated project.
		d.confirmed = true
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
