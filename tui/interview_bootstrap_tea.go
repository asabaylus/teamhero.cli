package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
)

// interviewBootstrapStep enumerates the form screens of the bootstrap
// wizard. Branching for the JD provided/influences-project pair and
// the rubric-mode custom-prompt detour is handled by advance(), not by
// the enumeration order.
type interviewBootstrapStep int

const (
	ibStepRole interviewBootstrapStep = iota
	ibStepRoleTitle
	ibStepStack
	// ibStepJDProvided sits BEFORE Domain so a job-description-supplied
	// domain doesn't have to be re-typed by the proctor. "yes" routes
	// through the path + influences-project pair AND skips Domain
	// entirely; "no" routes to Domain so the proctor can name the
	// business context explicitly.
	ibStepJDProvided
	ibStepJDPath
	ibStepJDInfluencesProject
	// ibStepDomain is reached only when no JD was attached. With a JD
	// the AI infers domain from the JD context block; the role-config
	// validator accepts empty domain in that case.
	ibStepDomain
	// ibStepFeatureSource is the either/or step that picks whether the
	// proctor types the feature description themselves or asks the AI to
	// suggest project ideas scoped to the role profile. The "Feature"
	// description is the single source of truth for what the candidate
	// builds — the old PromptSource + ProjectPrompt addendum pair were
	// redundant and have been removed.
	ibStepFeatureSource
	ibStepFeature
	// ibStepIdeaFetching is a transient spinner state shown while the
	// idea-fetcher runs. Reached only when featureSource == "suggest".
	ibStepIdeaFetching
	// ibStepIdeaSelect presents the fetched ideas as a single-select.
	// The chosen idea's title+blurb populates data.feature before the
	// wizard advances to time-box.
	ibStepIdeaSelect
	ibStepTimeBox
	// ibStepTimeBoxCustom is a sub-step shown only when the user chooses
	// "Custom" on the time-box select. It runs the validated minutes-input
	// form before the wizard advances to project-mode.
	ibStepTimeBoxCustom
	ibStepProjectMode
	ibStepAnalysisMode
	// ibStepRubricMode is now just default/custom — the "default+jd"
	// value was retired in favour of the standalone JD branch.
	ibStepRubricMode
	ibStepCustomPrompt
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

	// ideaFetcher is the strategy used when featureSource == "suggest".
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
	// Sentinel branch: when the manager picked the "Generate a fresh
	// set…" row (its value is one past the last real idea), bypass
	// the commit-to-feature path entirely. Append every just-shown
	// title to rejectedTitles so the next prompt names them as
	// anti-examples, clear the ideas slice, reset the selection
	// cursor, and re-enter the fetch loop with the same spinner +
	// Cmd combo the initial fetch uses. The existing
	// ideasFetchedMsg handler routes back to ibStepIdeaSelect via
	// nextStep() once the new batch lands. Must run BEFORE the
	// commitSelectedIdea() block below so the sentinel index never
	// leaks into data.feature as a chosen "idea".
	if m.step == ibStepIdeaSelect && m.data.ideaSelected == len(m.data.ideas) && len(m.data.ideas) > 0 {
		for _, idea := range m.data.ideas {
			m.data.rejectedTitles = append(m.data.rejectedTitles, idea.Title)
		}
		m.data.ideas = nil
		m.data.ideaSelected = 0
		m.step = ibStepIdeaFetching
		m.form = nil
		return m, tea.Batch(m.spin.Tick, m.fetchIdeasCmd())
	}
	// Persist the selected idea into the feature description as the user
	// leaves the idea-select step — that becomes the candidate-facing
	// project description AND the AI prompt's feature focus.
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
// data.feature so the downstream generator and the candidate-facing
// role-config both see the AI-suggested project as the single feature
// description. No-op when no idea is selected (e.g. when the fetch
// failed and the user pressed enter on the error note).
func (m *interviewBootstrapTeaModel) commitSelectedIdea() {
	if len(m.data.ideas) == 0 {
		return
	}
	idx := m.data.ideaSelected
	if idx < 0 || idx >= len(m.data.ideas) {
		idx = 0
	}
	chosen := m.data.ideas[idx]
	m.data.feature = strings.TrimSpace(chosen.Title + "\n\n" + chosen.Blurb)
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
			JobDescription: m.readJDIfInfluencing(),
			// Defensive copy so a concurrent append on the wizard
			// side (next sentinel pick) can't mutate the slice the
			// fetcher is reading. Cheap — the slice is at most a
			// handful of titles per re-roll.
			RejectedTitles: append([]string(nil), m.data.rejectedTitles...),
		}
		ideas, err := fetcher.Fetch(profile)
		if err != nil {
			return ideasFetchedMsg{err: err.Error()}
		}
		return ideasFetchedMsg{ideas: ideas}
	}
}

// readJDIfInfluencing returns the JD body for inclusion in the idea-
// generation prompt, but ONLY when the hiring manager has both attached
// a JD and explicitly opted to let it shape the candidate-facing
// project (the wizard's earlier-step toggles). Every other combination
// — JD declined, JD attached but "informs review only", or either flag
// blank — yields the empty string and the prompt routes to the no-JD
// branch.
//
// Filesystem failures degrade silently: a missing or unreadable JD
// path returns "" rather than propagating an error up into the fetch
// pipeline. The JD is enrichment, not a hard requirement, and the
// manager should not be blocked from completing the wizard because of
// a transient file-system issue.
func (m *interviewBootstrapTeaModel) readJDIfInfluencing() string {
	if m.data.jdProvided != "yes" || m.data.jdInfluencesProject != "yes" {
		return ""
	}
	body, err := os.ReadFile(m.data.jdPath)
	if err != nil {
		return ""
	}
	return string(body)
}

func (m *interviewBootstrapTeaModel) nextStep(cur interviewBootstrapStep) interviewBootstrapStep {
	switch cur {
	case ibStepRole:
		return ibStepRoleTitle
	case ibStepRoleTitle:
		return ibStepStack
	case ibStepStack:
		return ibStepJDProvided
	case ibStepJDProvided:
		if m.data.jdProvided == "yes" {
			return ibStepJDPath
		}
		// No JD → ask Domain explicitly. With a JD, skip Domain;
		// the AI infers it from the JD context block.
		return ibStepDomain
	case ibStepJDPath:
		return ibStepJDInfluencesProject
	case ibStepJDInfluencesProject:
		return ibStepFeatureSource
	case ibStepDomain:
		return ibStepFeatureSource
	case ibStepFeatureSource:
		if m.data.featureSource == "suggest" {
			return ibStepIdeaFetching
		}
		return ibStepFeature
	case ibStepFeature:
		return ibStepTimeBox
	case ibStepIdeaFetching:
		return ibStepIdeaSelect
	case ibStepIdeaSelect:
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
		if m.data.modeRubric == "custom" {
			return ibStepCustomPrompt
		}
		return ibStepOutputDir
	case ibStepCustomPrompt:
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
				Description("Used in paths and role-config.json; not shown to the candidate.").
				Value(&d.role).
				Validate(validateRoleSlug),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepRoleTitle:
		return huh.NewForm(huh.NewGroup(
			huh.NewInput().
				Title("Role title (human-readable, optional)").
				Description("Appears in the candidate-facing README/BRIEF header.").
				Value(&d.roleTitle),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepStack:
		return huh.NewForm(huh.NewGroup(
			huh.NewInput().
				Title("Primary tech stack").
				Description("Sets the language the AI uses for source files and tests.").
				Value(&d.stack).
				Validate(nonEmpty("stack")),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepDomain:
		return huh.NewForm(huh.NewGroup(
			huh.NewInput().
				Title("Business domain").
				Description("Shapes the GLOSSARY vocabulary and naming in generated code.").
				Value(&d.domain).
				Validate(nonEmpty("domain")),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepFeatureSource:
		// The single either/or step that replaces the old PromptSource +
		// ProjectPrompt redundancy. The feature description IS the project
		// prompt; the proctor either writes it themselves or picks from a
		// few AI-drafted ideas. Description kept under one line at the
		// default formWidth to dodge huh.ThemeCharm's left-bar break on
		// wrapped Description lines.
		return huh.NewForm(huh.NewGroup(
			huh.NewSelect[string]().
				Title("How should we describe the project?").
				Description("Drives what the candidate is asked to build.").
				Options(
					huh.NewOption("I'll write the description myself", "custom"),
					huh.NewOption("Suggest project ideas for me", "suggest"),
				).
				Value(&d.featureSource),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepFeature:
		return huh.NewForm(huh.NewGroup(
			huh.NewText().
				Title("Feature description").
				Description("Becomes the project's central focus and shapes every generated file.").
				Value(&d.feature).
				Validate(nonEmpty("feature")),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepTimeBox:
		return huh.NewForm(huh.NewGroup(
			huh.NewSelect[string]().
				Title("Time-box (minutes)").
				Description("Bounds the acceptance criteria; appears in the candidate's brief.").
				Options(
					huh.NewOption("60 minutes (recommended)", "60"),
					huh.NewOption("90 minutes", "90"),
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
		// Three options drive what the AI scaffolds:
		//   brownfield        — generate a starter codebase in your stack
		//   greenfield-stack  — written brief; candidate codes from scratch using your stack
		//   greenfield-open   — written brief; candidate also picks the tech stack
		// Internally the first two map to projectMode "A"/"B" so the
		// downstream validator and OpenAI client only need to know about
		// scaffolding-vs-brief. The third is "B" + stackByCandidate=true,
		// resolved in bootstrapWizardOptionsFromModel.
		return huh.NewForm(huh.NewGroup(
			huh.NewSelect[string]().
				Title("Project type").
				Description("Picks whether the AI scaffolds starter code or only a written brief.").
				Options(
					huh.NewOption("Brownfield — AI scaffolds a starter codebase", "brownfield"),
					huh.NewOption("Greenfield (use the stack above) — brief only", "greenfield-stack"),
					huh.NewOption("Greenfield (candidate picks stack) — brief only", "greenfield-open"),
				).
				Value(&d.modeProject),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepAnalysisMode:
		// Description kept short enough to fit on one line at the
		// default formWidth (3/5 of an 80-col terminal = 48 chars).
		// huh.ThemeCharm's left vertical bar fails to extend onto
		// wrapped Description lines, producing a visual break, so we
		// pre-shorten static descriptions to dodge huh's wrap path.
		return huh.NewForm(huh.NewGroup(
			huh.NewSelect[string]().
				Title("Analysis mode").
				Description("AI-assisted drafts post-interview observations; human-only doesn't.").
				Options(
					huh.NewOption("AI-assisted (recommended)", "ai-assisted"),
					huh.NewOption("Human-only", "human-only"),
				).
				Value(&d.modeAnalysis),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepRubricMode:
		// JD attachment moved to its own earlier step so the rubric
		// question is now a clean default-vs-custom. The default option
		// label and description signal what the rubric actually
		// observes — traditional engineering discipline (domain-driven
		// design, deep modules, verification, etc.) surfaced through
		// how the candidate works with AI — rather than the opaque
		// "9 built-in dimensions" phrasing it used to carry.
		return huh.NewForm(huh.NewGroup(
			huh.NewSelect[string]().
				Title("How should AI share observations?").
				Description("Default rubric looks for sound engineering practices applied to AI-assisted work.").
				Options(
					huh.NewOption("Default — DDD, deep modules, verification (recommended)", "default"),
					huh.NewOption("Custom — write your own prompt", "custom"),
				).
				Value(&d.modeRubric),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepCustomPrompt:
		return huh.NewForm(huh.NewGroup(
			huh.NewText().
				Title("Custom rubric prompt").
				Description("Free-form prompt the AI uses in place of the built-in dimensions.").
				Value(&d.customPrompt).
				Validate(nonEmpty("custom prompt")),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepJDProvided:
		// Standalone JD branch. Defaults to "no" so a hiring manager
		// who pressed enter through everything ends up without a JD
		// rather than with a broken path. Description kept short to
		// dodge huh.ThemeCharm's left-bar wrap bug.
		return huh.NewForm(huh.NewGroup(
			huh.NewSelect[string]().
				Title("Will you provide a job description?").
				Description("Optional. Feeds the AI observer when set.").
				Options(
					huh.NewOption("No", "no"),
					huh.NewOption("Yes — I have a JD file", "yes"),
				).
				Value(&d.jdProvided),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepJDPath:
		return huh.NewForm(huh.NewGroup(
			huh.NewInput().
				Title("Path to job description file").
				Description("Markdown or text JD; AI reads it as evaluation context.").
				Value(&d.jdPath).
				Validate(func(s string) error {
					if err := validateJDPath(s); err != nil {
						return err
					}
					if strings.TrimSpace(s) == "" {
						return fmt.Errorf("JD path is required (or pick No on the previous step)")
					}
					return nil
				}),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepJDInfluencesProject:
		// When "yes", the project-generation prompt reads the JD and
		// tailors the project's complexity and domain to match — e.g.,
		// a junior healthtech JD nudges the AI toward an EHR-flavoured
		// feature. When "no", the JD is still used by the post-interview
		// observer; it just doesn't shape what the candidate sees.
		return huh.NewForm(huh.NewGroup(
			huh.NewSelect[string]().
				Title("Should the JD influence the project?").
				Description("Tailors the generated project to the JD's seniority and domain.").
				Options(
					huh.NewOption("No — JD informs review only", "no"),
					huh.NewOption("Yes — JD shapes what the candidate sees", "yes"),
				).
				Value(&d.jdInfluencesProject),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepOutputDir:
		if d.outputDir == "./interviews/role" && d.role != "" {
			d.outputDir = "./interviews/" + d.role
		}
		return huh.NewForm(huh.NewGroup(
			huh.NewInput().
				Title("Output directory").
				Description("Where the generated repo (and kit overlay) will be written.").
				Value(&d.outputDir).
				Validate(nonEmpty("output directory")),
		)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())

	case ibStepIdeaFetching:
		// No huh form — the spinner is rendered in View(). The fetch was
		// kicked off by advance() as a tea.Cmd; we just wait for the
		// resulting ideasFetchedMsg.
		return nil

	case ibStepIdeaSelect:
		if d.ideaFetchErr != "" || len(d.ideas) == 0 {
			// Surface the fetch error so the user can press enter to
			// continue with an empty feature description (the next screen
			// is the validator-protected time-box, so the wizard will
			// still reject an empty feature at confirm time — better than
			// hanging here).
			return huh.NewForm(huh.NewGroup(
				huh.NewNote().
					Title("Idea generation failed").
					Description(d.ideaFetchErr + "\n\nPress enter to continue; you'll need to back up and type a feature description manually."),
			)).WithTheme(huh.ThemeCharm()).WithWidth(m.formWidth())
		}
		opts := make([]huh.Option[int], 0, len(d.ideas)+1)
		for i, idea := range d.ideas {
			label := fmt.Sprintf("%s — %s", idea.Title, truncate(idea.Blurb, 60))
			opts = append(opts, huh.NewOption(label, i))
		}
		// Sentinel "regenerate" row. Its value is one past the last real
		// idea (len(d.ideas)), so advance() can detect a regenerate
		// request by checking `d.ideaSelected == len(d.ideas)` without
		// extending the huh.Select[int] binding to a richer enum type.
		opts = append(opts, huh.NewOption("↻ Generate a fresh set…", len(d.ideas)))
		if d.ideaSelected < 0 {
			d.ideaSelected = 0
		}
		return huh.NewForm(huh.NewGroup(
			huh.NewSelect[int]().
				Title("Pick a project idea").
				Description("The full title + blurb becomes the feature description.").
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
		// No description on this confirm form — the right-hand summary
		// panel already lists every collected field. Repeating them in
		// the form's Description was reported as visual clutter that
		// hid the only thing the user has to act on (Yes / Cancel).
		return huh.NewForm(huh.NewGroup(
			huh.NewConfirm().
				Title("Ready to bootstrap?").
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
