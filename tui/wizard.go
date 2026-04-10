package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
)

// ---------------------------------------------------------------------------
// Wizard mode (express vs full)
// ---------------------------------------------------------------------------

type wizardMode int

const (
	wizardModeFull wizardMode = iota
	wizardModeExpress
)

// ---------------------------------------------------------------------------
// Wizard states
// ---------------------------------------------------------------------------

type wizardState int

const (
	wsReuse          wizardState = iota // "Reuse previous config?" (conditional — skipped if no prev)
	wsCacheFlush                        // "Fresh data or use cache?" (conditional — skipped if no prev)
	wsCacheFlushDate                    // custom date input for selective flush

	// Core config
	wsOrg
	wsPrivate
	wsArchived
	wsRepoScope

	// Conditional repo selection
	wsRepoFetch  // spinner: fetching repos
	wsRepoPick   // multi-select repos
	wsRepoManual // text input repos (fallback)

	// Member config
	wsMemberScope

	// Conditional team selection
	wsTeamFetch  // spinner: fetching teams
	wsTeamPick   // select team
	wsTeamManual // text input team (fallback)

	// Conditional member selection
	wsMemberFetch  // spinner: fetching members
	wsMemberPick   // multi-select members
	wsMemberManual // text input members (fallback)

	// Remaining config
	wsDates
	wsBots
	wsDetailed
	wsDataSources
	wsReportSections

	// Final confirmation
	wsConfirmRun

	wsDone
)

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

// fetchResultMsg carries the result of an async discovery call.
type fetchResultMsg[T any] struct {
	data []T
	err  error
}

// We need concrete message types because Bubble Tea messages must be concrete.
type reposFetched struct {
	repos []string
	err   error
}
type teamsFetched struct {
	teams []TeamInfo
	err   error
}
type membersFetched struct {
	members []string
	err     error
}

// ---------------------------------------------------------------------------
// Wizard model
// ---------------------------------------------------------------------------

type wizardModel struct {
	state  wizardState
	mode   wizardMode
	cfg    ReportConfig
	prev   *ReportConfig // previous saved config (may be nil)
	form   *huh.Form     // current active form (nil during fetch states)
	spin   spinner.Model // for loading states
	theme  *huh.Theme
	width  int
	height int

	// Navigation history — enables backward navigation via Escape.
	history   []wizardState
	highWater wizardState // farthest state reached (for summary display)

	// Form value bindings — must live on the struct so huh can write to them.
	reuse            bool
	includePrivate   bool
	repoScope        string
	memberScope      string
	repoInput        string
	teamInput        string
	memberInput      string
	selectedRepos    []string
	selectedMembers  []string
	selectedTeam     string
	selectedDataSrc  []string
	selectedSections []string
	flushCacheChoice string
	flushCacheDate   string
	confirmRun       bool

	// Express mode bindings
	expressChoice string // "run", "customize", "cancel"
	switchToFull  bool

	// Fetched data
	fetchedRepos   []string
	fetchedTeams   []TeamInfo
	fetchedMembers []string

	// Fetch errors (displayed in manual fallback forms)
	repoFetchErr   string
	teamFetchErr   string
	memberFetchErr string

	// Terminal state
	confirmed bool
	aborted   bool
}

// WizardResult is returned after the wizard completes.
type WizardResult struct {
	Config    *ReportConfig
	Confirmed bool
	Aborted   bool
}

// RunWizard creates and runs the interactive wizard.
// Returns the collected config and whether the user confirmed.
func RunWizard(prev *ReportConfig, defaults ReportConfig, mode wizardMode) (*WizardResult, error) {
	cfg := defaults

	// Ensure slices are non-nil for form binding
	if cfg.Members == nil {
		cfg.Members = []string{}
	}
	if cfg.Repos == nil {
		cfg.Repos = []string{}
	}

	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("14"))

	w := termWidth()

	m := wizardModel{
		cfg:   cfg,
		prev:  prev,
		mode:  mode,
		spin:  s,
		theme: huh.ThemeCharm(),
		width: w,
	}

	// Determine starting state
	if mode == wizardModeExpress {
		m.state = wsOrg // express always starts at org (no saved config to reuse)
	} else if prev != nil {
		m.state = wsReuse
	} else {
		m.state = wsOrg
	}

	m.initFormBindings()
	m.form = m.buildForm()

	p := tea.NewProgram(&m, tea.WithOutput(os.Stderr), tea.WithAltScreen())
	finalModel, err := teaProgramRun(p)
	if err != nil {
		return nil, err
	}

	final := finalModel.(*wizardModel)
	return &WizardResult{
		Config:    &final.cfg,
		Confirmed: final.confirmed,
		Aborted:   final.aborted,
	}, nil
}

// initFormBindings sets form binding vars from the current config.
func (m *wizardModel) initFormBindings() {
	m.includePrivate = !m.cfg.ExcludePrivate

	m.repoScope = "all"
	if len(m.cfg.Repos) > 0 {
		m.repoScope = "reuse"
	} else if !m.cfg.UseAllRepos {
		m.repoScope = "specific"
	}

	m.memberScope = "all"
	if len(m.cfg.Members) > 0 {
		m.memberScope = "reuse-members"
	} else if m.cfg.Team != "" {
		m.memberScope = "team"
	}

	m.reuse = true
	m.confirmRun = true
	m.selectedRepos = []string{}
	m.selectedMembers = []string{}
	m.selectedDataSrc = []string{}
	m.selectedSections = []string{}
	m.teamInput = m.cfg.Team
	m.selectedTeam = m.cfg.Team

	ensureDateDefaults(&m.cfg)
}

func (m *wizardModel) Init() tea.Cmd {
	if m.form != nil {
		return m.form.Init()
	}
	return m.spin.Tick
}

func (m *wizardModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
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

	// Async fetch results
	case reposFetched:
		m.handleReposFetched(msg)
		m.form = m.buildForm()
		return m, m.form.Init()

	case teamsFetched:
		m.handleTeamsFetched(msg)
		m.form = m.buildForm()
		return m, m.form.Init()

	case membersFetched:
		m.handleMembersFetched(msg)
		m.form = m.buildForm()
		return m, m.form.Init()
	}

	// Active form
	if m.form != nil {
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}

		if m.form.State == huh.StateCompleted {
			return m.advance()
		}
		if m.form.State == huh.StateAborted {
			return m.goBack()
		}
		return m, cmd
	}

	// Spinner (fetch states)
	var cmd tea.Cmd
	m.spin, cmd = m.spin.Update(msg)
	return m, cmd
}

func (m *wizardModel) View() string {
	if m.state == wsDone {
		return ""
	}

	w := m.width
	if w <= 0 {
		w = 80
	}

	// Title banner
	title := renderShellHeader(w)

	// Form panel (left)
	formWidth := m.formWidth()
	summaryWidth := w - formWidth - 2 // 2 = gap between panels

	var leftPanel string
	if m.form != nil {
		leftPanel = m.form.View()
	} else {
		// Spinner for fetch states
		msg := "Loading…"
		switch m.state {
		case wsRepoFetch:
			msg = "Fetching repositories…"
		case wsTeamFetch:
			msg = "Fetching teams…"
		case wsMemberFetch:
			msg = "Fetching members…"
		}
		leftPanel = fmt.Sprintf("\n  %s %s\n", m.spin.View(), lipgloss.NewStyle().Foreground(lipgloss.Color("241")).Render(msg))
	}

	leftFrame := lipgloss.NewStyle().
		Border(lipgloss.HiddenBorder()).
		Padding(0, 1)
	leftInnerWidth := max(20, formWidth-leftFrame.GetHorizontalFrameSize())
	leftPanel = leftFrame.Width(leftInnerWidth).Render(leftPanel)

	rightPanel := renderSummary(&m.cfg, m.state, m.highWater, summaryWidth)

	left := lipgloss.NewStyle().Width(formWidth).Render(leftPanel)
	right := lipgloss.NewStyle().Width(summaryWidth).Render(rightPanel)

	// Navigation hints
	hintStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	hints := hintStyle.Render("esc back • ctrl+c quit")

	var body string
	if m.state == wsConfirmRun && m.mode != wizardModeExpress {
		// Render the normal two-panel layout as a dimmed background,
		// then overlay a modal with the config summary + confirm form.
		normalBody := lipgloss.JoinHorizontal(lipgloss.Top, left, "  ", right)
		bgHeight := max(10, lipgloss.Height(normalBody))

		modal := renderConfirmModal(&m.cfg, m.form, min(60, w-10))
		body = lipgloss.Place(w-2, bgHeight, lipgloss.Center, lipgloss.Center, modal,
			lipgloss.WithWhitespaceChars(" "),
		)
	} else {
		body = lipgloss.JoinHorizontal(lipgloss.Top, left, "  ", right)
	}

	return lipgloss.JoinVertical(lipgloss.Left, title, "", body, "", hints)
}

func (m *wizardModel) formWidth() int {
	w := m.width
	if w <= 0 {
		w = 80
	}
	return w * 3 / 5
}

// truncateLabel clips a label string so it fits within maxWidth runes,
// appending an ellipsis (…) when truncated.
func truncateLabel(s string, maxWidth int) string {
	runes := []rune(s)
	if len(runes) <= maxWidth {
		return s
	}
	if maxWidth <= 1 {
		return "…"
	}
	return string(runes[:maxWidth-1]) + "…"
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

// advance is called when the current form completes. It reads form values,
// updates cfg, determines the next state, and returns the next model + cmd.
func (m *wizardModel) advance() (tea.Model, tea.Cmd) {
	m.readFormValues()

	// Push current state to history for back-navigation.
	m.history = append(m.history, m.state)

	// Handle express → full mode switch ("Customize settings first")
	if m.switchToFull {
		m.switchToFull = false
		m.mode = wizardModeFull
		m.state = wsRepoScope // org already collected, continue from next full-mode state
		// Reset history — only keep wsOrg so "back" from wsRepoScope returns there.
		m.history = []wizardState{wsOrg}
		m.form = m.buildForm()
		return m, m.form.Init()
	}

	next := m.nextState()
	m.state = next

	// Track the farthest state reached (for summary panel).
	if m.state > m.highWater {
		m.highWater = m.state
	}

	if m.state == wsDone {
		return m, tea.Quit
	}

	// Fetch states don't have a form — start async work + spinner.
	if m.isFetchState() {
		m.form = nil
		return m, tea.Batch(m.spin.Tick, m.startFetch())
	}

	m.form = m.buildForm()
	return m, m.form.Init()
}

// goBack navigates to the previous wizard state. If there is no history
// (user is on the first screen), it aborts the wizard.
func (m *wizardModel) goBack() (tea.Model, tea.Cmd) {
	if len(m.history) == 0 {
		m.aborted = true
		return m, tea.Quit
	}

	// Pop the previous state.
	prev := m.history[len(m.history)-1]
	m.history = m.history[:len(m.history)-1]
	m.state = prev

	m.form = m.buildForm()
	return m, m.form.Init()
}

func (m *wizardModel) isFetchState() bool {
	switch m.state {
	case wsRepoFetch, wsTeamFetch, wsMemberFetch:
		return true
	}
	return false
}

// readFormValues reads values from form bindings into cfg.
func (m *wizardModel) readFormValues() {
	switch m.state {
	case wsReuse:
		if !m.reuse {
			// User chose not to reuse — reset to defaults
			m.prev = nil
			m.cfg = DefaultConfig()
			ensureDateDefaults(&m.cfg)
			m.initFormBindings()
		}

	case wsOrg:
		// cfg.Org is bound directly

	case wsRepoScope:
		if m.repoScope == "all" {
			m.cfg.UseAllRepos = true
			m.cfg.Repos = []string{}
		} else {
			m.cfg.UseAllRepos = false
		}

	case wsRepoPick:
		m.cfg.Repos = m.selectedRepos

	case wsRepoManual:
		m.cfg.Repos = splitCSV(m.repoInput)

	case wsMemberScope:
		switch m.memberScope {
		case "all":
			m.cfg.Team = ""
			m.cfg.Members = []string{}
		case "team":
			m.cfg.Members = []string{}
		case "members":
			m.cfg.Team = ""
		case "reuse-members":
			m.cfg.Team = ""
		}

	case wsTeamPick:
		m.cfg.Team = m.selectedTeam

	case wsTeamManual:
		m.cfg.Team = strings.TrimSpace(m.teamInput)

	case wsMemberPick:
		m.cfg.Members = m.selectedMembers

	case wsMemberManual:
		m.cfg.Members = splitCSV(m.memberInput)

	case wsDates:
		// cfg.Since and cfg.Until bound directly

	case wsDetailed:
		// cfg.Detailed bound directly

	case wsDataSources:
		m.cfg.Sections.DataSources.Git = contains(m.selectedDataSrc, "git")
		m.cfg.Sections.DataSources.Asana = contains(m.selectedDataSrc, "asana")

	case wsReportSections:
		m.cfg.Sections.ReportSections.IndividualContributions = contains(m.selectedSections, "individual")
		m.cfg.Sections.ReportSections.VisibleWins = contains(m.selectedSections, "visibleWins")
		m.cfg.Sections.ReportSections.TechnicalFoundationalWins = contains(m.selectedSections, "technicalWins")
		m.cfg.Sections.ReportSections.DiscrepancyLog = contains(m.selectedSections, "discrepancyLog")
		m.cfg.Sections.ReportSections.Loc = contains(m.selectedSections, "loc")

	case wsCacheFlush:
		switch m.flushCacheChoice {
		case "all":
			m.cfg.FlushCache = "all"
		default:
			m.cfg.FlushCache = ""
		}

	case wsCacheFlushDate:
		if m.flushCacheDate != "" {
			m.cfg.FlushCache = "all:since=" + m.flushCacheDate
		}

	case wsConfirmRun:
		if m.mode == wizardModeExpress {
			switch m.expressChoice {
			case "run":
				m.confirmed = true
			case "customize":
				m.switchToFull = true
			case "cancel":
				m.confirmed = false
			}
		} else {
			m.confirmed = m.confirmRun
		}
	}
}

// nextStateExpress is the express-mode state machine shortcut.
// It jumps from org straight to confirm, skipping all intermediate questions.
func (m *wizardModel) nextStateExpress() wizardState {
	switch m.state {
	case wsOrg:
		return wsConfirmRun
	case wsConfirmRun:
		return wsDone
	default:
		return wsDone
	}
}

// nextState determines which state follows the current one.
func (m *wizardModel) nextState() wizardState {
	if m.mode == wizardModeExpress {
		return m.nextStateExpress()
	}

	switch m.state {
	case wsReuse:
		if m.reuse {
			return wsCacheFlush
		}
		return wsOrg

	case wsCacheFlush:
		if m.flushCacheChoice == "since" {
			return wsCacheFlushDate
		}
		return wsOrg

	case wsCacheFlushDate:
		return wsOrg

	case wsOrg:
		return wsRepoScope

	case wsRepoScope:
		if m.repoScope == "all" {
			return wsMemberScope
		}
		// Explicit reuse from scope selection; skip repo discovery.
		if m.repoScope == "reuse" {
			return wsMemberScope
		}
		return wsRepoFetch

	case wsRepoFetch:
		// Shouldn't reach here — fetch completion sets state directly
		return wsRepoPick

	case wsRepoPick, wsRepoManual:
		return wsMemberScope

	case wsMemberScope:
		switch m.memberScope {
		case "team":
			return wsTeamFetch
		case "reuse-members":
			return wsDates
		case "members":
			return wsMemberFetch
		default:
			return wsDates
		}

	case wsTeamFetch:
		return wsTeamPick

	case wsTeamPick, wsTeamManual:
		return wsDates

	case wsMemberFetch:
		return wsMemberPick

	case wsMemberPick, wsMemberManual:
		return wsDates

	case wsDates:
		return wsDetailed

	case wsDetailed:
		return wsDataSources

	case wsDataSources:
		return wsReportSections

	case wsReportSections:
		return wsConfirmRun

	case wsConfirmRun:
		return wsDone

	default:
		return wsDone
	}
}

// ---------------------------------------------------------------------------
// Async fetch commands
// ---------------------------------------------------------------------------

func (m *wizardModel) startFetch() tea.Cmd {
	switch m.state {
	case wsRepoFetch:
		org := m.cfg.Org
		priv := !m.cfg.ExcludePrivate
		arch := m.cfg.IncludeArchived
		return func() tea.Msg {
			repos, err := DiscoverRepos(org, priv, arch)
			return reposFetched{repos: repos, err: err}
		}
	case wsTeamFetch:
		org := m.cfg.Org
		return func() tea.Msg {
			teams, err := DiscoverTeams(org)
			return teamsFetched{teams: teams, err: err}
		}
	case wsMemberFetch:
		org := m.cfg.Org
		return func() tea.Msg {
			members, err := DiscoverMembers(org)
			return membersFetched{members: members, err: err}
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Fetch result handlers (extracted for testability)
// ---------------------------------------------------------------------------

func (m *wizardModel) handleReposFetched(msg reposFetched) {
	m.fetchedRepos = msg.repos
	if msg.err != nil {
		m.repoFetchErr = msg.err.Error()
		m.state = wsRepoManual
	} else if len(msg.repos) == 0 {
		m.repoFetchErr = "no repositories found"
		m.state = wsRepoManual
	} else {
		m.repoFetchErr = ""
		m.state = wsRepoPick
	}
}

func (m *wizardModel) handleTeamsFetched(msg teamsFetched) {
	m.fetchedTeams = msg.teams
	if msg.err != nil {
		m.teamFetchErr = msg.err.Error()
		m.state = wsTeamManual
	} else if len(msg.teams) == 0 {
		m.teamFetchErr = "no teams found"
		m.state = wsTeamManual
	} else {
		m.teamFetchErr = ""
		m.state = wsTeamPick
	}
}

func (m *wizardModel) handleMembersFetched(msg membersFetched) {
	m.fetchedMembers = msg.members
	if msg.err != nil {
		m.memberFetchErr = msg.err.Error()
		m.state = wsMemberManual
	} else if len(msg.members) == 0 {
		m.memberFetchErr = "no members found"
		m.state = wsMemberManual
	} else {
		m.memberFetchErr = ""
		m.state = wsMemberPick
	}
}

// ---------------------------------------------------------------------------
// Form builders — one per non-fetch state
// ---------------------------------------------------------------------------

func (m *wizardModel) buildForm() *huh.Form {
	fw := m.formWidth()

	var f *huh.Form

	switch m.state {
	case wsReuse:
		m.reuse = true
		org := ""
		if m.prev != nil {
			org = m.prev.Org
		}
		titleStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("212"))
		f = huh.NewForm(huh.NewGroup(
			huh.NewSelect[bool]().
				Title(fmt.Sprintf("Start from previous configuration for %s?", titleStyle.Render(org))).
				Options(
					huh.NewOption("Yes", true),
					huh.NewOption("No", false),
				).
				Value(&m.reuse),
		))

	case wsOrg:
		f = huh.NewForm(huh.NewGroup(
			huh.NewInput().
				Title("GitHub Organization").
				Placeholder("acme-inc").
				Value(&m.cfg.Org).
				Validate(func(s string) error {
					if strings.TrimSpace(s) == "" {
						return fmt.Errorf("organization is required")
					}
					return nil
				}),
		))

	case wsRepoScope:
		var scopeOptions []huh.Option[string]
		if len(m.cfg.Repos) > 0 {
			scopeOptions = append(scopeOptions,
				huh.NewOption(
					fmt.Sprintf("Reuse previously selected repositories (%d)", len(m.cfg.Repos)),
					"reuse",
				),
			)
		}
		scopeOptions = append(scopeOptions,
			huh.NewOption("Use all available repositories", "all"),
			huh.NewOption("Choose specific repositories", "specific"),
		)
		f = huh.NewForm(huh.NewGroup(
			huh.NewSelect[string]().
				Title("Repository scope").
				Options(scopeOptions...).
				Value(&m.repoScope),
		))

	case wsRepoPick:
		m.selectedRepos = []string{}
		// huh MultiSelect prefix (cursor + checkbox + spaces) is ~8 chars;
		// leave margin so labels never wrap inside the form panel.
		labelMax := m.formWidth() - 10
		options := make([]huh.Option[string], len(m.fetchedRepos))
		for i, r := range m.fetchedRepos {
			opt := huh.NewOption(truncateLabel(r, labelMax), r)
			if contains(m.cfg.Repos, r) {
				opt = opt.Selected(true)
			}
			options[i] = opt
		}
		f = huh.NewForm(huh.NewGroup(
			huh.NewMultiSelect[string]().
				Title("Select repositories (space to toggle, enter to confirm)").
				Options(options...).
				Value(&m.selectedRepos).
				Height(min(20, len(m.fetchedRepos)+2)),
		))

	case wsRepoManual:
		if len(m.cfg.Repos) > 0 {
			m.repoInput = strings.Join(m.cfg.Repos, ", ")
		} else {
			m.repoInput = ""
		}
		repoInputField := huh.NewInput().
			Title("Repository names (comma-separated)").
			Placeholder("api, web, design-system").
			Value(&m.repoInput)
		if m.repoFetchErr != "" {
			repoInputField = repoInputField.
				Description(fmt.Sprintf("Could not fetch repositories: %s", m.repoFetchErr))
		}
		f = huh.NewForm(huh.NewGroup(repoInputField))

	case wsMemberScope:
		var memberOptions []huh.Option[string]
		if len(m.cfg.Members) > 0 {
			memberOptions = append(memberOptions,
				huh.NewOption(
					fmt.Sprintf("Reuse previously selected members (%d)", len(m.cfg.Members)),
					"reuse-members",
				),
			)
		}
		memberOptions = append(memberOptions,
			huh.NewOption("Entire organization", "all"),
			huh.NewOption("Filter by team", "team"),
			huh.NewOption("Select specific members", "members"),
		)
		f = huh.NewForm(huh.NewGroup(
			huh.NewSelect[string]().
				Title("Member scope").
				Options(memberOptions...).
				Value(&m.memberScope),
		))

	case wsTeamPick:
		teamLabelMax := m.formWidth() - 10
		options := make([]huh.Option[string], len(m.fetchedTeams))
		for i, t := range m.fetchedTeams {
			label := t.Slug
			if t.Name != "" && t.Name != t.Slug {
				label = fmt.Sprintf("%s (%s)", t.Name, t.Slug)
			}
			options[i] = huh.NewOption(truncateLabel(label, teamLabelMax), t.Slug)
		}
		m.selectedTeam = m.cfg.Team
		f = huh.NewForm(huh.NewGroup(
			huh.NewSelect[string]().
				Title("Select a team").
				Options(options...).
				Value(&m.selectedTeam),
		))

	case wsTeamManual:
		m.teamInput = m.cfg.Team
		teamInputField := huh.NewInput().
			Title("Team slug").
			Placeholder("engineering").
			Value(&m.teamInput)
		if m.teamFetchErr != "" {
			teamInputField = teamInputField.
				Description(fmt.Sprintf("Could not fetch teams: %s", m.teamFetchErr))
		}
		f = huh.NewForm(huh.NewGroup(teamInputField))

	case wsMemberPick:
		m.selectedMembers = []string{}
		memberLabelMax := m.formWidth() - 10
		options := make([]huh.Option[string], len(m.fetchedMembers))
		for i, mb := range m.fetchedMembers {
			opt := huh.NewOption(truncateLabel(mb, memberLabelMax), mb)
			if contains(m.cfg.Members, mb) {
				opt = opt.Selected(true)
			}
			options[i] = opt
		}
		f = huh.NewForm(huh.NewGroup(
			huh.NewMultiSelect[string]().
				Title("Select members (space to toggle, enter to confirm)").
				Options(options...).
				Value(&m.selectedMembers).
				Height(min(20, len(m.fetchedMembers)+2)),
		))

	case wsMemberManual:
		if len(m.cfg.Members) > 0 {
			m.memberInput = strings.Join(m.cfg.Members, ", ")
		} else {
			m.memberInput = ""
		}
		memberInputField := huh.NewInput().
			Title("Member logins (comma-separated)").
			Placeholder("alice, bob, charlie").
			Value(&m.memberInput)
		if m.memberFetchErr != "" {
			memberInputField = memberInputField.
				Description(fmt.Sprintf("Could not fetch members: %s", m.memberFetchErr))
		}
		f = huh.NewForm(huh.NewGroup(memberInputField))

	case wsDates:
		f = huh.NewForm(huh.NewGroup(
			huh.NewInput().
				Title("Start date (YYYY-MM-DD)").
				Value(&m.cfg.Since).
				Validate(validateDate),
			huh.NewInput().
				Title("End date (YYYY-MM-DD)").
				Value(&m.cfg.Until).
				Validate(validateDate),
		))

	case wsDetailed:
		f = huh.NewForm(huh.NewGroup(
			boolSelect("Include detailed PR and commit listings?", &m.cfg.Detailed),
		))

	case wsDataSources:
		m.selectedDataSrc = []string{}
		f = huh.NewForm(huh.NewGroup(
			huh.NewMultiSelect[string]().
				Title("Which data sources should be fetched?").
				Options(
					huh.NewOption("Git", "git").Selected(m.cfg.Sections.DataSources.Git),
					huh.NewOption("Asana", "asana").Selected(m.cfg.Sections.DataSources.Asana),
				).
				Value(&m.selectedDataSrc),
		))

	case wsReportSections:
		m.selectedSections = []string{}
		f = huh.NewForm(huh.NewGroup(
			huh.NewMultiSelect[string]().
				Title("Which report sections should be included?").
				Options(
					huh.NewOption("Individual Contributions", "individual").Selected(m.cfg.Sections.ReportSections.IndividualContributions),
					huh.NewOption("Visible Wins", "visibleWins").Selected(m.cfg.Sections.ReportSections.VisibleWins),
					huh.NewOption("Technical / Foundational Wins", "technicalWins").Selected(m.cfg.Sections.ReportSections.TechnicalFoundationalWins),
					huh.NewOption("Lines of Code (LOC)", "loc").Selected(m.cfg.Sections.ReportSections.Loc),
					huh.NewOption("Discrepancy Log", "discrepancyLog").Selected(m.cfg.Sections.ReportSections.DiscrepancyLog),
				).
				Value(&m.selectedSections),
		))

	case wsCacheFlush:
		m.flushCacheChoice = "none"
		f = huh.NewForm(huh.NewGroup(
			huh.NewSelect[string]().
				Title("Use previously cached data?").
				Description("Cached results speed up repeat runs. Re-fetch if source data has changed.").
				Options(
					huh.NewOption("Yes, use cached data (faster)", "none"),
					huh.NewOption("No, re-fetch everything", "all"),
					huh.NewOption("Re-fetch from a specific date", "since"),
				).
				Value(&m.flushCacheChoice),
		))

	case wsCacheFlushDate:
		m.flushCacheDate = m.cfg.Since
		f = huh.NewForm(huh.NewGroup(
			huh.NewInput().
				Title("Re-fetch data from this date onward (YYYY-MM-DD)").
				Description("Cached data before this date will be kept.").
				Value(&m.flushCacheDate).
				Validate(validateDate),
		))

	case wsConfirmRun:
		if m.mode == wizardModeExpress {
			m.expressChoice = "run"
			f = huh.NewForm(huh.NewGroup(
				huh.NewSelect[string]().
					Title("Ready to generate a report for "+m.cfg.Org+"?").
					Description("All repos, all members, last 7 days, Git data only").
					Options(
						huh.NewOption("Run report", "run"),
						huh.NewOption("Customize settings first", "customize"),
						huh.NewOption("Cancel", "cancel"),
					).
					Value(&m.expressChoice),
			))
		} else {
			m.confirmRun = true
			f = huh.NewForm(huh.NewGroup(
				huh.NewConfirm().
					Title("Run report with this configuration?").
					Affirmative("Yes").
					Negative("No").
					Value(&m.confirmRun),
			))
		}

	default:
		// Should not happen — return a no-op form
		var dummy bool
		f = huh.NewForm(huh.NewGroup(
			boolSelect("Continue?", &dummy),
		))
	}

	return f.WithTheme(m.theme).WithWidth(fw)
}

// renderConfirmModal builds a centered modal showing the full config summary
// and the confirm form, used as an overlay at wsConfirmRun.
func renderConfirmModal(cfg *ReportConfig, confirmForm *huh.Form, width int) string {
	headerStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("212"))
	labelStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("245"))
	valueStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("15"))

	modalStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("212")).
		Padding(1, 2).
		Width(width)

	var lines []string
	lines = append(lines, headerStyle.Render("Ready to generate report?"))
	lines = append(lines, "")

	addLine := func(label, value string) {
		lines = append(lines, labelStyle.Render(label+": ")+valueStyle.Render(value))
	}

	addLine("Organization", cfg.Org)
	if cfg.UseAllRepos {
		addLine("Repositories", "All")
	} else if len(cfg.Repos) > 0 {
		addLine("Repositories", formatCompact(cfg.Repos))
	}
	if cfg.Team != "" {
		addLine("Team", cfg.Team)
	} else if len(cfg.Members) > 0 {
		addLine("Members", formatCompact(cfg.Members))
	} else {
		addLine("Members", "All")
	}
	addLine("Period", cfg.Since+" → "+cfg.Until)

	var sources []string
	if cfg.Sections.DataSources.Git {
		sources = append(sources, "Git")
	}
	if cfg.Sections.DataSources.Asana {
		sources = append(sources, "Asana")
	}
	if len(sources) > 0 {
		addLine("Sources", strings.Join(sources, ", "))
	}

	var sections []string
	if cfg.Sections.ReportSections.IndividualContributions {
		sections = append(sections, "Individual")
	}
	if cfg.Sections.ReportSections.VisibleWins {
		sections = append(sections, "Wins")
	}
	if cfg.Sections.ReportSections.TechnicalFoundationalWins {
		sections = append(sections, "Tech Wins")
	}
	if cfg.Sections.ReportSections.Loc {
		sections = append(sections, "LOC")
	}
	if cfg.Sections.ReportSections.DiscrepancyLog {
		sections = append(sections, "Discrepancy")
	}
	if len(sections) > 0 {
		addLine("Sections", strings.Join(sections, ", "))
	}

	lines = append(lines, "")

	if confirmForm != nil {
		lines = append(lines, confirmForm.View())
	}

	content := strings.Join(lines, "\n")
	return modalStyle.Render(content)
}
