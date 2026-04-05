package main

import (
	"fmt"
	"os/exec"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
)

func TestExpressWizardStateTransitions(t *testing.T) {
	cfg := ExpressConfig()
	cfg.Org = "acme"
	ensureDateDefaults(&cfg)

	m := wizardModel{
		cfg:  cfg,
		mode: wizardModeExpress,
	}

	// Express: wsOrg → wsConfirmRun → wsDone
	m.state = wsOrg
	next := m.nextState()
	if next != wsConfirmRun {
		t.Errorf("express: from wsOrg expected wsConfirmRun, got %d", next)
	}

	m.state = wsConfirmRun
	next = m.nextState()
	if next != wsDone {
		t.Errorf("express: from wsConfirmRun expected wsDone, got %d", next)
	}
}

func TestFullWizardStateTransitionsUnchanged(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	ensureDateDefaults(&cfg)

	m := wizardModel{
		cfg:  cfg,
		mode: wizardModeFull,
	}

	// Full mode: wsOrg → wsRepoScope (private/archived/bots moved to settings)
	m.state = wsOrg
	next := m.nextState()
	if next != wsRepoScope {
		t.Errorf("full: from wsOrg expected wsRepoScope, got %d", next)
	}
}

func TestExpressSwitchToFull(t *testing.T) {
	cfg := ExpressConfig()
	cfg.Org = "acme"
	ensureDateDefaults(&cfg)

	m := wizardModel{
		cfg:           cfg,
		mode:          wizardModeExpress,
		expressChoice: "customize",
	}

	// Simulate reading confirm form with "customize" choice
	m.state = wsConfirmRun
	m.readFormValues()

	if !m.switchToFull {
		t.Error("expected switchToFull to be true after choosing 'customize'")
	}

	// After switch, mode should be full and we'd continue from wsRepoScope
	// (tested via advance() which requires a full tea.Program; here we just test the flag)
}

func TestExpressConfirmRun(t *testing.T) {
	cfg := ExpressConfig()
	cfg.Org = "acme"
	ensureDateDefaults(&cfg)

	m := wizardModel{
		cfg:           cfg,
		mode:          wizardModeExpress,
		expressChoice: "run",
	}

	m.state = wsConfirmRun
	m.readFormValues()

	if !m.confirmed {
		t.Error("expected confirmed to be true after choosing 'run'")
	}
	if m.switchToFull {
		t.Error("expected switchToFull to be false after choosing 'run'")
	}
}

func TestExpressConfirmCancel(t *testing.T) {
	cfg := ExpressConfig()
	cfg.Org = "acme"
	ensureDateDefaults(&cfg)

	m := wizardModel{
		cfg:           cfg,
		mode:          wizardModeExpress,
		expressChoice: "cancel",
	}

	m.state = wsConfirmRun
	m.readFormValues()

	if m.confirmed {
		t.Error("expected confirmed to be false after choosing 'cancel'")
	}
	if m.switchToFull {
		t.Error("expected switchToFull to be false after choosing 'cancel'")
	}
}

// ---------------------------------------------------------------------------
// Full wizard state transition tests
// ---------------------------------------------------------------------------

func TestFullWizardAllReposSkipsFetch(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}

	m.state = wsRepoScope
	m.repoScope = "all"
	m.readFormValues()

	next := m.nextState()
	if next != wsMemberScope {
		t.Errorf("repoScope=all: expected wsMemberScope, got %d", next)
	}
	if !m.cfg.UseAllRepos {
		t.Error("repoScope=all: expected UseAllRepos to be true")
	}
}

func TestFullWizardSpecificReposGoesToFetch(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}

	m.state = wsRepoScope
	m.repoScope = "specific"
	m.readFormValues()

	next := m.nextState()
	if next != wsRepoFetch {
		t.Errorf("repoScope=specific: expected wsRepoFetch, got %d", next)
	}
}

func TestFullWizardReuseReposSkipsFetch(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Repos = []string{"api", "web"}
	m := wizardModel{cfg: cfg, mode: wizardModeFull}

	m.state = wsRepoScope
	m.repoScope = "reuse"
	m.readFormValues()

	next := m.nextState()
	if next != wsMemberScope {
		t.Errorf("repoScope=reuse: expected wsMemberScope, got %d", next)
	}
}

func TestFullWizardMemberScopeTeamGoesToFetch(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}

	m.state = wsMemberScope
	m.memberScope = "team"
	m.readFormValues()

	next := m.nextState()
	if next != wsTeamFetch {
		t.Errorf("memberScope=team: expected wsTeamFetch, got %d", next)
	}
}

func TestFullWizardMemberScopeMembersGoesToFetch(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}

	m.state = wsMemberScope
	m.memberScope = "members"
	m.readFormValues()

	next := m.nextState()
	if next != wsMemberFetch {
		t.Errorf("memberScope=members: expected wsMemberFetch, got %d", next)
	}
}

func TestFullWizardMemberScopeAllSkipsFetch(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}

	m.state = wsMemberScope
	m.memberScope = "all"
	m.readFormValues()

	next := m.nextState()
	if next != wsDates {
		t.Errorf("memberScope=all: expected wsDates, got %d", next)
	}
}

func TestFullWizardMemberScopeReuseSkipsFetch(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Members = []string{"alice", "bob"}
	m := wizardModel{cfg: cfg, mode: wizardModeFull}

	m.state = wsMemberScope
	m.memberScope = "reuse-members"
	m.readFormValues()

	next := m.nextState()
	if next != wsDates {
		t.Errorf("memberScope=reuse-members: expected wsDates, got %d", next)
	}
}

// ---------------------------------------------------------------------------
// Fetch failure → manual fallback with error message
// ---------------------------------------------------------------------------

func TestRepoFetchError_FallsBackToManualWithError(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull, state: wsRepoFetch}

	msg := reposFetched{repos: nil, err: fmt.Errorf("Bad credentials")}
	m.handleReposFetched(msg)

	if m.state != wsRepoManual {
		t.Errorf("expected wsRepoManual after fetch error, got %d", m.state)
	}
	if m.repoFetchErr == "" {
		t.Error("expected repoFetchErr to be set after fetch error")
	}
	if !strings.Contains(m.repoFetchErr, "Bad credentials") {
		t.Errorf("expected repoFetchErr to contain 'Bad credentials', got %q", m.repoFetchErr)
	}
}

func TestRepoFetchEmpty_FallsBackToManualWithError(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull, state: wsRepoFetch}

	msg := reposFetched{repos: []string{}, err: nil}
	m.handleReposFetched(msg)

	if m.state != wsRepoManual {
		t.Errorf("expected wsRepoManual after empty fetch, got %d", m.state)
	}
	if m.repoFetchErr == "" {
		t.Error("expected repoFetchErr to be set after empty fetch")
	}
}

func TestRepoFetchSuccess_GoesToPick(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull, state: wsRepoFetch}

	msg := reposFetched{repos: []string{"api", "web"}, err: nil}
	m.handleReposFetched(msg)

	if m.state != wsRepoPick {
		t.Errorf("expected wsRepoPick after successful fetch, got %d", m.state)
	}
	if m.repoFetchErr != "" {
		t.Errorf("expected repoFetchErr to be empty, got %q", m.repoFetchErr)
	}
	if len(m.fetchedRepos) != 2 {
		t.Errorf("expected 2 fetched repos, got %d", len(m.fetchedRepos))
	}
}

func TestTeamFetchError_FallsBackToManualWithError(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull, state: wsTeamFetch}

	msg := teamsFetched{teams: nil, err: fmt.Errorf("403 Forbidden")}
	m.handleTeamsFetched(msg)

	if m.state != wsTeamManual {
		t.Errorf("expected wsTeamManual after fetch error, got %d", m.state)
	}
	if m.teamFetchErr == "" {
		t.Error("expected teamFetchErr to be set after fetch error")
	}
	if !strings.Contains(m.teamFetchErr, "403 Forbidden") {
		t.Errorf("expected teamFetchErr to contain '403 Forbidden', got %q", m.teamFetchErr)
	}
}

func TestTeamFetchEmpty_FallsBackToManualWithError(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull, state: wsTeamFetch}

	msg := teamsFetched{teams: []TeamInfo{}, err: nil}
	m.handleTeamsFetched(msg)

	if m.state != wsTeamManual {
		t.Errorf("expected wsTeamManual after empty fetch, got %d", m.state)
	}
	if m.teamFetchErr == "" {
		t.Error("expected teamFetchErr to be set after empty fetch")
	}
}

func TestTeamFetchSuccess_GoesToPick(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull, state: wsTeamFetch}

	msg := teamsFetched{
		teams: []TeamInfo{{Name: "Engineering", Slug: "engineering"}},
		err:   nil,
	}
	m.handleTeamsFetched(msg)

	if m.state != wsTeamPick {
		t.Errorf("expected wsTeamPick after successful fetch, got %d", m.state)
	}
	if m.teamFetchErr != "" {
		t.Errorf("expected teamFetchErr to be empty, got %q", m.teamFetchErr)
	}
}

func TestMemberFetchError_FallsBackToManualWithError(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull, state: wsMemberFetch}

	msg := membersFetched{members: nil, err: fmt.Errorf("network timeout")}
	m.handleMembersFetched(msg)

	if m.state != wsMemberManual {
		t.Errorf("expected wsMemberManual after fetch error, got %d", m.state)
	}
	if m.memberFetchErr == "" {
		t.Error("expected memberFetchErr to be set after fetch error")
	}
	if !strings.Contains(m.memberFetchErr, "network timeout") {
		t.Errorf("expected memberFetchErr to contain 'network timeout', got %q", m.memberFetchErr)
	}
}

func TestMemberFetchEmpty_FallsBackToManualWithError(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull, state: wsMemberFetch}

	msg := membersFetched{members: []string{}, err: nil}
	m.handleMembersFetched(msg)

	if m.state != wsMemberManual {
		t.Errorf("expected wsMemberManual after empty fetch, got %d", m.state)
	}
	if m.memberFetchErr == "" {
		t.Error("expected memberFetchErr to be set after empty fetch")
	}
}

func TestMemberFetchSuccess_GoesToPick(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull, state: wsMemberFetch}

	msg := membersFetched{members: []string{"alice", "bob"}, err: nil}
	m.handleMembersFetched(msg)

	if m.state != wsMemberPick {
		t.Errorf("expected wsMemberPick after successful fetch, got %d", m.state)
	}
	if m.memberFetchErr != "" {
		t.Errorf("expected memberFetchErr to be empty, got %q", m.memberFetchErr)
	}
}

// ---------------------------------------------------------------------------
// readFormValues tests
// ---------------------------------------------------------------------------

func TestReadFormValues_RepoPickSetsRepos(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}
	m.selectedRepos = []string{"api", "web"}
	m.state = wsRepoPick
	m.readFormValues()

	if len(m.cfg.Repos) != 2 || m.cfg.Repos[0] != "api" || m.cfg.Repos[1] != "web" {
		t.Errorf("expected repos [api, web], got %v", m.cfg.Repos)
	}
}

func TestReadFormValues_RepoManualSplitsCSV(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}
	m.repoInput = "api, web, design-system"
	m.state = wsRepoManual
	m.readFormValues()

	if len(m.cfg.Repos) != 3 {
		t.Errorf("expected 3 repos, got %d: %v", len(m.cfg.Repos), m.cfg.Repos)
	}
	if m.cfg.Repos[0] != "api" || m.cfg.Repos[1] != "web" || m.cfg.Repos[2] != "design-system" {
		t.Errorf("expected [api web design-system], got %v", m.cfg.Repos)
	}
}

func TestReadFormValues_MemberPickSetsMembers(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}
	m.selectedMembers = []string{"alice", "bob"}
	m.state = wsMemberPick
	m.readFormValues()

	if len(m.cfg.Members) != 2 || m.cfg.Members[0] != "alice" || m.cfg.Members[1] != "bob" {
		t.Errorf("expected members [alice, bob], got %v", m.cfg.Members)
	}
}

func TestReadFormValues_TeamPickSetsTeam(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}
	m.selectedTeam = "engineering"
	m.state = wsTeamPick
	m.readFormValues()

	if m.cfg.Team != "engineering" {
		t.Errorf("expected team 'engineering', got %q", m.cfg.Team)
	}
}

// ---------------------------------------------------------------------------
// Back navigation tests
// ---------------------------------------------------------------------------

func TestGoBack_EmptyHistory_Aborts(t *testing.T) {
	m := wizardModel{
		cfg:     DefaultConfig(),
		mode:    wizardModeFull,
		state:   wsOrg,
		history: nil,
	}

	model, _ := m.goBack()
	wm := model.(*wizardModel)
	if !wm.aborted {
		t.Error("expected abort when going back with empty history")
	}
}

func TestGoBack_PopsHistory(t *testing.T) {
	m := wizardModel{
		cfg:     DefaultConfig(),
		mode:    wizardModeFull,
		state:   wsMemberScope,
		history: []wizardState{wsOrg, wsRepoScope},
		theme:   huh.ThemeCharm(),
		width:   80,
	}

	model, _ := m.goBack()
	wm := model.(*wizardModel)

	if wm.state != wsRepoScope {
		t.Errorf("expected state wsRepoScope after goBack, got %d", wm.state)
	}
	if len(wm.history) != 1 || wm.history[0] != wsOrg {
		t.Errorf("expected history [wsOrg], got %v", wm.history)
	}
}

func TestGoBack_TwiceReturnsTwoSteps(t *testing.T) {
	m := wizardModel{
		cfg:     DefaultConfig(),
		mode:    wizardModeFull,
		state:   wsMemberScope,
		history: []wizardState{wsOrg, wsRepoScope},
		theme:   huh.ThemeCharm(),
		width:   80,
	}

	model, _ := m.goBack()
	wm := model.(*wizardModel)
	if wm.state != wsRepoScope {
		t.Errorf("first goBack: expected wsRepoScope, got %d", wm.state)
	}

	model, _ = wm.goBack()
	wm = model.(*wizardModel)
	if wm.state != wsOrg {
		t.Errorf("second goBack: expected wsOrg, got %d", wm.state)
	}
	if len(wm.history) != 0 {
		t.Errorf("expected empty history after two goBack calls, got %v", wm.history)
	}
}

func TestAdvance_PushesHistory(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	ensureDateDefaults(&cfg)
	m := wizardModel{
		cfg:   cfg,
		mode:  wizardModeFull,
		state: wsOrg,
		theme: huh.ThemeCharm(),
		width: 80,
	}

	m.advance()

	if len(m.history) != 1 || m.history[0] != wsOrg {
		t.Errorf("expected history [wsOrg] after advance, got %v", m.history)
	}
}

func TestAdvance_TracksHighWater(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	ensureDateDefaults(&cfg)
	m := wizardModel{
		cfg:   cfg,
		mode:  wizardModeFull,
		state: wsOrg,
		theme: huh.ThemeCharm(),
		width: 80,
	}

	m.advance() // wsOrg → wsRepoScope

	if m.highWater < wsRepoScope {
		t.Errorf("expected highWater >= wsRepoScope, got %d", m.highWater)
	}
}

// ---------------------------------------------------------------------------
// readFormValues tests
// ---------------------------------------------------------------------------

func TestReadFormValues_MemberScopeAllClearsTeamAndMembers(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Team = "old-team"
	cfg.Members = []string{"old-member"}
	m := wizardModel{cfg: cfg, mode: wizardModeFull}
	m.memberScope = "all"
	m.state = wsMemberScope
	m.readFormValues()

	if m.cfg.Team != "" {
		t.Errorf("expected team to be cleared, got %q", m.cfg.Team)
	}
	if len(m.cfg.Members) != 0 {
		t.Errorf("expected members to be cleared, got %v", m.cfg.Members)
	}
}

// ---------------------------------------------------------------------------
// truncateLabel tests
// ---------------------------------------------------------------------------

func TestTruncateLabel_ShortString(t *testing.T) {
	got := truncateLabel("hello", 10)
	if got != "hello" {
		t.Errorf("truncateLabel(hello, 10) = %q, want hello", got)
	}
}

func TestTruncateLabel_ExactFit(t *testing.T) {
	got := truncateLabel("hello", 5)
	if got != "hello" {
		t.Errorf("truncateLabel(hello, 5) = %q, want hello", got)
	}
}

func TestTruncateLabel_TruncatesWithEllipsis(t *testing.T) {
	got := truncateLabel("hello world", 8)
	// Should be 7 chars of text + ellipsis = "hello w…"
	if got != "hello w…" {
		t.Errorf("truncateLabel(hello world, 8) = %q, want %q", got, "hello w…")
	}
}

func TestTruncateLabel_VerySmallMaxWidth(t *testing.T) {
	got := truncateLabel("hello world", 1)
	if got != "…" {
		t.Errorf("truncateLabel(hello world, 1) = %q, want …", got)
	}
}

func TestTruncateLabel_ZeroMaxWidth(t *testing.T) {
	got := truncateLabel("hello world", 0)
	if got != "…" {
		t.Errorf("truncateLabel(hello world, 0) = %q, want …", got)
	}
}

func TestTruncateLabel_EmptyString(t *testing.T) {
	got := truncateLabel("", 10)
	if got != "" {
		t.Errorf("truncateLabel('', 10) = %q, want empty", got)
	}
}

func TestTruncateLabel_UnicodeChars(t *testing.T) {
	// "Hello" in Japanese katakana: ハロー (3 runes)
	got := truncateLabel("ハローワールド", 4)
	// Should be 3 chars + ellipsis = "ハロー…"
	if got != "ハロー…" {
		t.Errorf("truncateLabel(ハローワールド, 4) = %q, want ハロー…", got)
	}
}

func TestTruncateLabel_MaxWidthTwo(t *testing.T) {
	got := truncateLabel("hello", 2)
	// Should be 1 char + ellipsis = "h…"
	if got != "h…" {
		t.Errorf("truncateLabel(hello, 2) = %q, want h…", got)
	}
}

// ---------------------------------------------------------------------------
// Comprehensive nextState transition tests (full mode)
// ---------------------------------------------------------------------------

func TestNextState_FullMode_AllTransitions(t *testing.T) {
	tests := []struct {
		name        string
		state       wizardState
		setup       func(*wizardModel)
		wantNext    wizardState
	}{
		{
			name:     "wsReuse with reuse=true goes to wsCacheFlush",
			state:    wsReuse,
			setup:    func(m *wizardModel) { m.reuse = true },
			wantNext: wsCacheFlush,
		},
		{
			name:     "wsReuse with reuse=false goes to wsOrg",
			state:    wsReuse,
			setup:    func(m *wizardModel) { m.reuse = false },
			wantNext: wsOrg,
		},
		{
			name:     "wsCacheFlush with since goes to wsCacheFlushDate",
			state:    wsCacheFlush,
			setup:    func(m *wizardModel) { m.flushCacheChoice = "since" },
			wantNext: wsCacheFlushDate,
		},
		{
			name:     "wsCacheFlush with none goes to wsOrg",
			state:    wsCacheFlush,
			setup:    func(m *wizardModel) { m.flushCacheChoice = "none" },
			wantNext: wsOrg,
		},
		{
			name:     "wsCacheFlush with all goes to wsOrg",
			state:    wsCacheFlush,
			setup:    func(m *wizardModel) { m.flushCacheChoice = "all" },
			wantNext: wsOrg,
		},
		{
			name:     "wsCacheFlushDate goes to wsOrg",
			state:    wsCacheFlushDate,
			setup:    nil,
			wantNext: wsOrg,
		},
		{
			name:     "wsOrg goes to wsRepoScope",
			state:    wsOrg,
			setup:    nil,
			wantNext: wsRepoScope,
		},
		{
			name:     "wsRepoScope all goes to wsMemberScope",
			state:    wsRepoScope,
			setup:    func(m *wizardModel) { m.repoScope = "all" },
			wantNext: wsMemberScope,
		},
		{
			name:     "wsRepoScope specific goes to wsRepoFetch",
			state:    wsRepoScope,
			setup:    func(m *wizardModel) { m.repoScope = "specific" },
			wantNext: wsRepoFetch,
		},
		{
			name:     "wsRepoScope reuse goes to wsMemberScope",
			state:    wsRepoScope,
			setup:    func(m *wizardModel) { m.repoScope = "reuse" },
			wantNext: wsMemberScope,
		},
		{
			name:     "wsRepoFetch goes to wsRepoPick",
			state:    wsRepoFetch,
			setup:    nil,
			wantNext: wsRepoPick,
		},
		{
			name:     "wsRepoPick goes to wsMemberScope",
			state:    wsRepoPick,
			setup:    nil,
			wantNext: wsMemberScope,
		},
		{
			name:     "wsRepoManual goes to wsMemberScope",
			state:    wsRepoManual,
			setup:    nil,
			wantNext: wsMemberScope,
		},
		{
			name:     "wsMemberScope team goes to wsTeamFetch",
			state:    wsMemberScope,
			setup:    func(m *wizardModel) { m.memberScope = "team" },
			wantNext: wsTeamFetch,
		},
		{
			name:     "wsMemberScope members goes to wsMemberFetch",
			state:    wsMemberScope,
			setup:    func(m *wizardModel) { m.memberScope = "members" },
			wantNext: wsMemberFetch,
		},
		{
			name:     "wsMemberScope reuse-members goes to wsDates",
			state:    wsMemberScope,
			setup:    func(m *wizardModel) { m.memberScope = "reuse-members" },
			wantNext: wsDates,
		},
		{
			name:     "wsMemberScope all goes to wsDates",
			state:    wsMemberScope,
			setup:    func(m *wizardModel) { m.memberScope = "all" },
			wantNext: wsDates,
		},
		{
			name:     "wsTeamFetch goes to wsTeamPick",
			state:    wsTeamFetch,
			setup:    nil,
			wantNext: wsTeamPick,
		},
		{
			name:     "wsTeamPick goes to wsDates",
			state:    wsTeamPick,
			setup:    nil,
			wantNext: wsDates,
		},
		{
			name:     "wsTeamManual goes to wsDates",
			state:    wsTeamManual,
			setup:    nil,
			wantNext: wsDates,
		},
		{
			name:     "wsMemberFetch goes to wsMemberPick",
			state:    wsMemberFetch,
			setup:    nil,
			wantNext: wsMemberPick,
		},
		{
			name:     "wsMemberPick goes to wsDates",
			state:    wsMemberPick,
			setup:    nil,
			wantNext: wsDates,
		},
		{
			name:     "wsMemberManual goes to wsDates",
			state:    wsMemberManual,
			setup:    nil,
			wantNext: wsDates,
		},
		{
			name:     "wsDates goes to wsDetailed",
			state:    wsDates,
			setup:    nil,
			wantNext: wsDetailed,
		},
		{
			name:     "wsDetailed goes to wsDataSources",
			state:    wsDetailed,
			setup:    nil,
			wantNext: wsDataSources,
		},
		{
			name:     "wsDataSources goes to wsReportSections",
			state:    wsDataSources,
			setup:    nil,
			wantNext: wsReportSections,
		},
		{
			name:     "wsReportSections goes to wsConfirmRun",
			state:    wsReportSections,
			setup:    nil,
			wantNext: wsConfirmRun,
		},
		{
			name:     "wsConfirmRun goes to wsDone",
			state:    wsConfirmRun,
			setup:    nil,
			wantNext: wsDone,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}
			m.state = tt.state
			if tt.setup != nil {
				tt.setup(&m)
			}
			got := m.nextState()
			if got != tt.wantNext {
				t.Errorf("nextState() = %d, want %d", got, tt.wantNext)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// nextStateExpress tests
// ---------------------------------------------------------------------------

func TestNextStateExpress_AllTransitions(t *testing.T) {
	tests := []struct {
		state    wizardState
		wantNext wizardState
	}{
		{wsOrg, wsConfirmRun},
		{wsConfirmRun, wsDone},
		{wsPrivate, wsDone},   // any other state returns wsDone
		{wsDates, wsDone},
		{wsBots, wsDone},
	}

	for _, tt := range tests {
		m := wizardModel{cfg: DefaultConfig(), mode: wizardModeExpress}
		m.state = tt.state
		got := m.nextStateExpress()
		if got != tt.wantNext {
			t.Errorf("nextStateExpress() from state %d = %d, want %d", tt.state, got, tt.wantNext)
		}
	}
}

// ---------------------------------------------------------------------------
// isFetchState tests
// ---------------------------------------------------------------------------

func TestIsFetchState_AllStates(t *testing.T) {
	tests := []struct {
		state    wizardState
		isFetch  bool
	}{
		{wsReuse, false},
		{wsCacheFlush, false},
		{wsCacheFlushDate, false},
		{wsOrg, false},
		{wsPrivate, false},
		{wsArchived, false},
		{wsRepoScope, false},
		{wsRepoFetch, true},
		{wsRepoPick, false},
		{wsRepoManual, false},
		{wsMemberScope, false},
		{wsTeamFetch, true},
		{wsTeamPick, false},
		{wsTeamManual, false},
		{wsMemberFetch, true},
		{wsMemberPick, false},
		{wsMemberManual, false},
		{wsDates, false},
		{wsBots, false},
		{wsDetailed, false},
		{wsDataSources, false},
		{wsReportSections, false},
		{wsConfirmRun, false},
		{wsDone, false},
	}

	for _, tt := range tests {
		m := wizardModel{state: tt.state}
		got := m.isFetchState()
		if got != tt.isFetch {
			t.Errorf("isFetchState() for state %d = %v, want %v", tt.state, got, tt.isFetch)
		}
	}
}

// ---------------------------------------------------------------------------
// More readFormValues tests
// ---------------------------------------------------------------------------

// TestReadFormValues_PrivateSetsExcludePrivate removed:
// wsPrivate, wsArchived, wsBots are no longer wizard steps — they are
// persistent settings managed via the settings editor.

func TestReadFormValues_RepoScopeAll(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}
	m.cfg.Repos = []string{"should-clear"}
	m.repoScope = "all"
	m.state = wsRepoScope
	m.readFormValues()

	if !m.cfg.UseAllRepos {
		t.Error("expected UseAllRepos=true")
	}
	if len(m.cfg.Repos) != 0 {
		t.Errorf("expected empty repos, got %v", m.cfg.Repos)
	}
}

func TestReadFormValues_RepoScopeSpecific(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}
	m.repoScope = "specific"
	m.state = wsRepoScope
	m.readFormValues()

	if m.cfg.UseAllRepos {
		t.Error("expected UseAllRepos=false for specific scope")
	}
}

func TestReadFormValues_MemberScopeTeam(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Members = []string{"should-clear"}
	m := wizardModel{cfg: cfg, mode: wizardModeFull}
	m.memberScope = "team"
	m.state = wsMemberScope
	m.readFormValues()

	if len(m.cfg.Members) != 0 {
		t.Errorf("expected members cleared for team scope, got %v", m.cfg.Members)
	}
}

func TestReadFormValues_MemberScopeMembers(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Team = "should-clear"
	m := wizardModel{cfg: cfg, mode: wizardModeFull}
	m.memberScope = "members"
	m.state = wsMemberScope
	m.readFormValues()

	if m.cfg.Team != "" {
		t.Errorf("expected team cleared for members scope, got %q", m.cfg.Team)
	}
}

func TestReadFormValues_MemberScopeReuseMembers(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Team = "should-clear"
	cfg.Members = []string{"alice"}
	m := wizardModel{cfg: cfg, mode: wizardModeFull}
	m.memberScope = "reuse-members"
	m.state = wsMemberScope
	m.readFormValues()

	if m.cfg.Team != "" {
		t.Errorf("expected team cleared for reuse-members scope, got %q", m.cfg.Team)
	}
	// Members should be preserved
	if len(m.cfg.Members) != 1 || m.cfg.Members[0] != "alice" {
		t.Errorf("expected members preserved, got %v", m.cfg.Members)
	}
}

func TestReadFormValues_TeamManualTrimsSpaces(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}
	m.teamInput = "  engineering  "
	m.state = wsTeamManual
	m.readFormValues()

	if m.cfg.Team != "engineering" {
		t.Errorf("expected trimmed team, got %q", m.cfg.Team)
	}
}

func TestReadFormValues_MemberManualSplitsCSV(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}
	m.memberInput = "alice, bob, charlie"
	m.state = wsMemberManual
	m.readFormValues()

	if len(m.cfg.Members) != 3 {
		t.Errorf("expected 3 members, got %d: %v", len(m.cfg.Members), m.cfg.Members)
	}
}

func TestReadFormValues_DataSources(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}
	m.selectedDataSrc = []string{"git"}
	m.state = wsDataSources
	m.readFormValues()

	if !m.cfg.Sections.DataSources.Git {
		t.Error("expected Git=true")
	}
	if m.cfg.Sections.DataSources.Asana {
		t.Error("expected Asana=false when only git selected")
	}
}

func TestReadFormValues_DataSourcesBoth(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}
	m.selectedDataSrc = []string{"git", "asana"}
	m.state = wsDataSources
	m.readFormValues()

	if !m.cfg.Sections.DataSources.Git {
		t.Error("expected Git=true")
	}
	if !m.cfg.Sections.DataSources.Asana {
		t.Error("expected Asana=true")
	}
}

func TestReadFormValues_ReportSections(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}
	m.selectedSections = []string{"individual", "visibleWins", "loc"}
	m.state = wsReportSections
	m.readFormValues()

	if !m.cfg.Sections.ReportSections.IndividualContributions {
		t.Error("expected IndividualContributions=true")
	}
	if !m.cfg.Sections.ReportSections.VisibleWins {
		t.Error("expected VisibleWins=true")
	}
	if !m.cfg.Sections.ReportSections.Loc {
		t.Error("expected Loc=true")
	}
	if m.cfg.Sections.ReportSections.DiscrepancyLog {
		t.Error("expected DiscrepancyLog=false when not selected")
	}
}

func TestReadFormValues_ReportSectionsDiscrepancy(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}
	m.selectedSections = []string{"discrepancyLog"}
	m.state = wsReportSections
	m.readFormValues()

	if !m.cfg.Sections.ReportSections.DiscrepancyLog {
		t.Error("expected DiscrepancyLog=true")
	}
}

func TestReadFormValues_CacheFlushAll(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}
	m.flushCacheChoice = "all"
	m.state = wsCacheFlush
	m.readFormValues()

	if m.cfg.FlushCache != "all" {
		t.Errorf("expected FlushCache=all, got %q", m.cfg.FlushCache)
	}
}

func TestReadFormValues_CacheFlushNone(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}
	m.flushCacheChoice = "none"
	m.state = wsCacheFlush
	m.readFormValues()

	if m.cfg.FlushCache != "" {
		t.Errorf("expected FlushCache to be empty, got %q", m.cfg.FlushCache)
	}
}

func TestReadFormValues_CacheFlushDate(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}
	m.flushCacheDate = "2026-02-20"
	m.state = wsCacheFlushDate
	m.readFormValues()

	if m.cfg.FlushCache != "all:since=2026-02-20" {
		t.Errorf("expected FlushCache=all:since=2026-02-20, got %q", m.cfg.FlushCache)
	}
}

func TestReadFormValues_CacheFlushDateEmpty(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}
	m.flushCacheDate = ""
	m.state = wsCacheFlushDate
	m.readFormValues()

	if m.cfg.FlushCache != "" {
		t.Errorf("expected FlushCache to be empty for blank date, got %q", m.cfg.FlushCache)
	}
}

func TestReadFormValues_ConfirmRunFull(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}
	m.confirmRun = true
	m.state = wsConfirmRun
	m.readFormValues()

	if !m.confirmed {
		t.Error("expected confirmed=true in full mode with confirmRun=true")
	}
}

func TestReadFormValues_ConfirmRunFullDecline(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}
	m.confirmRun = false
	m.state = wsConfirmRun
	m.readFormValues()

	if m.confirmed {
		t.Error("expected confirmed=false in full mode with confirmRun=false")
	}
}

func TestReadFormValues_ReuseNo_ResetsConfig(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "old-org"
	cfg.Team = "old-team"
	prev := cfg
	m := wizardModel{cfg: cfg, prev: &prev, mode: wizardModeFull}
	m.reuse = false
	m.state = wsReuse
	m.readFormValues()

	if m.prev != nil {
		t.Error("expected prev to be nil after choosing not to reuse")
	}
	if m.cfg.Org != "" {
		t.Errorf("expected org to be reset, got %q", m.cfg.Org)
	}
}

// ---------------------------------------------------------------------------
// initFormBindings tests
// ---------------------------------------------------------------------------

func TestInitFormBindings_Defaults(t *testing.T) {
	cfg := DefaultConfig()
	// RunWizard ensures slices are non-nil before calling initFormBindings.
	// Test the binding defaults that initFormBindings is responsible for.
	m := wizardModel{cfg: cfg}
	m.initFormBindings()

	if !m.reuse {
		t.Error("expected reuse to default to true")
	}
	if !m.confirmRun {
		t.Error("expected confirmRun to default to true")
	}
	if m.selectedRepos == nil {
		t.Error("expected selectedRepos to be non-nil")
	}
	if m.selectedMembers == nil {
		t.Error("expected selectedMembers to be non-nil")
	}
	if m.selectedDataSrc == nil {
		t.Error("expected selectedDataSrc to be non-nil")
	}
	if m.selectedSections == nil {
		t.Error("expected selectedSections to be non-nil")
	}
}

func TestInitFormBindings_RepoScopeFromConfig(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Repos = []string{"api", "web"}
	m := wizardModel{cfg: cfg}
	m.initFormBindings()

	if m.repoScope != "reuse" {
		t.Errorf("expected repoScope=reuse when repos are set, got %q", m.repoScope)
	}
}

func TestInitFormBindings_RepoScopeAllRepos(t *testing.T) {
	cfg := DefaultConfig()
	cfg.UseAllRepos = true
	m := wizardModel{cfg: cfg}
	m.initFormBindings()

	if m.repoScope != "all" {
		t.Errorf("expected repoScope=all when UseAllRepos=true, got %q", m.repoScope)
	}
}

func TestInitFormBindings_RepoScopeSpecific(t *testing.T) {
	cfg := DefaultConfig()
	cfg.UseAllRepos = false
	cfg.Repos = []string{}
	m := wizardModel{cfg: cfg}
	m.initFormBindings()

	if m.repoScope != "specific" {
		t.Errorf("expected repoScope=specific, got %q", m.repoScope)
	}
}

func TestInitFormBindings_MemberScopeTeam(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Team = "engineering"
	cfg.Members = []string{}
	m := wizardModel{cfg: cfg}
	m.initFormBindings()

	if m.memberScope != "team" {
		t.Errorf("expected memberScope=team when team is set, got %q", m.memberScope)
	}
}

func TestInitFormBindings_MemberScopeReuseMembers(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Members = []string{"alice", "bob"}
	m := wizardModel{cfg: cfg}
	m.initFormBindings()

	if m.memberScope != "reuse-members" {
		t.Errorf("expected memberScope=reuse-members when members are set, got %q", m.memberScope)
	}
}

// ---------------------------------------------------------------------------
// formWidth tests
// ---------------------------------------------------------------------------

func TestFormWidth_NormalWidth(t *testing.T) {
	m := wizardModel{width: 100}
	got := m.formWidth()
	if got != 60 { // 100 * 3/5
		t.Errorf("formWidth() = %d, want 60", got)
	}
}

func TestFormWidth_ZeroWidth(t *testing.T) {
	m := wizardModel{width: 0}
	got := m.formWidth()
	if got != 48 { // 80 * 3/5
		t.Errorf("formWidth() with zero width = %d, want 48 (from default 80)", got)
	}
}

func TestFormWidth_NegativeWidth(t *testing.T) {
	m := wizardModel{width: -10}
	got := m.formWidth()
	if got != 48 { // 80 * 3/5
		t.Errorf("formWidth() with negative width = %d, want 48 (from default 80)", got)
	}
}

// ---------------------------------------------------------------------------
// Init() tests
// ---------------------------------------------------------------------------

func TestWizardInit_WithForm(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state: wsOrg,
		cfg:   cfg,
		mode:  wizardModeFull,
		theme: huh.ThemeCharm(),
		width: 80,
	}
	m.initFormBindings()
	m.form = m.buildForm()

	cmd := m.Init()
	// Init with a form should return the form's Init cmd (non-nil)
	if cmd == nil {
		t.Error("Init() with active form should return a non-nil Cmd")
	}
}

func TestWizardInit_WithoutForm_ReturnsSpinnerTick(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state: wsRepoFetch,
		cfg:   cfg,
		mode:  wizardModeFull,
		form:  nil, // no form in fetch state
	}

	cmd := m.Init()
	// Without a form, Init should return the spinner tick command
	if cmd == nil {
		t.Error("Init() without form should return spinner tick (non-nil Cmd)")
	}
}

// ---------------------------------------------------------------------------
// Update() tests
// ---------------------------------------------------------------------------

func TestWizardUpdate_WindowSizeMsg(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state: wsOrg,
		cfg:   cfg,
		mode:  wizardModeFull,
		theme: huh.ThemeCharm(),
		width: 80,
	}
	m.initFormBindings()
	m.form = m.buildForm()

	model, cmd := m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	wm := model.(*wizardModel)

	if wm.width != 120 {
		t.Errorf("width = %d, want 120", wm.width)
	}
	if wm.height != 40 {
		t.Errorf("height = %d, want 40", wm.height)
	}
	if cmd != nil {
		t.Error("WindowSizeMsg should return nil cmd")
	}
}

func TestWizardUpdate_CtrlC_Aborts(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state: wsOrg,
		cfg:   cfg,
		mode:  wizardModeFull,
		theme: huh.ThemeCharm(),
		width: 80,
	}
	m.initFormBindings()
	m.form = m.buildForm()

	model, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	wm := model.(*wizardModel)

	if !wm.aborted {
		t.Error("ctrl+c should set aborted to true")
	}
	if cmd == nil {
		t.Error("ctrl+c should return a quit command")
	}
}

func TestWizardUpdate_Esc_GoesBack(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state:   wsRepoScope,
		cfg:     cfg,
		mode:    wizardModeFull,
		theme:   huh.ThemeCharm(),
		width:   80,
		history: []wizardState{wsOrg},
	}

	model, _ := m.Update(tea.KeyMsg{Type: tea.KeyEsc})
	wm := model.(*wizardModel)

	if wm.state != wsOrg {
		t.Errorf("esc should go back to wsOrg, got %d", wm.state)
	}
}

func TestWizardUpdate_Esc_EmptyHistory_Aborts(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state:   wsOrg,
		cfg:     cfg,
		mode:    wizardModeFull,
		theme:   huh.ThemeCharm(),
		width:   80,
		history: nil,
	}

	model, _ := m.Update(tea.KeyMsg{Type: tea.KeyEsc})
	wm := model.(*wizardModel)

	if !wm.aborted {
		t.Error("esc with no history should abort")
	}
}

func TestWizardUpdate_ReposFetched_Success(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state: wsRepoFetch,
		cfg:   cfg,
		mode:  wizardModeFull,
		theme: huh.ThemeCharm(),
		width: 80,
		form:  nil,
	}

	model, _ := m.Update(reposFetched{repos: []string{"repo1", "repo2"}, err: nil})
	wm := model.(*wizardModel)

	if wm.state != wsRepoPick {
		t.Errorf("expected state wsRepoPick after successful repos fetch, got %d", wm.state)
	}
	if wm.form == nil {
		t.Error("form should be set after repos fetched")
	}
}

func TestWizardUpdate_ReposFetched_Error(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state: wsRepoFetch,
		cfg:   cfg,
		mode:  wizardModeFull,
		theme: huh.ThemeCharm(),
		width: 80,
		form:  nil,
	}

	model, _ := m.Update(reposFetched{repos: nil, err: fmt.Errorf("network error")})
	wm := model.(*wizardModel)

	if wm.state != wsRepoManual {
		t.Errorf("expected state wsRepoManual after fetch error, got %d", wm.state)
	}
	if wm.repoFetchErr == "" {
		t.Error("repoFetchErr should be set")
	}
}

func TestWizardUpdate_TeamsFetched_Success(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state: wsTeamFetch,
		cfg:   cfg,
		mode:  wizardModeFull,
		theme: huh.ThemeCharm(),
		width: 80,
		form:  nil,
	}

	model, _ := m.Update(teamsFetched{teams: []TeamInfo{{Name: "Eng", Slug: "eng"}}, err: nil})
	wm := model.(*wizardModel)

	if wm.state != wsTeamPick {
		t.Errorf("expected wsTeamPick, got %d", wm.state)
	}
	if wm.form == nil {
		t.Error("form should be set after teams fetched")
	}
}

func TestWizardUpdate_MembersFetched_Success(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state: wsMemberFetch,
		cfg:   cfg,
		mode:  wizardModeFull,
		theme: huh.ThemeCharm(),
		width: 80,
		form:  nil,
	}

	model, _ := m.Update(membersFetched{members: []string{"alice", "bob"}, err: nil})
	wm := model.(*wizardModel)

	if wm.state != wsMemberPick {
		t.Errorf("expected wsMemberPick, got %d", wm.state)
	}
	if wm.form == nil {
		t.Error("form should be set after members fetched")
	}
}

func TestWizardUpdate_SpinnerUpdate_NoForm(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state: wsRepoFetch,
		cfg:   cfg,
		mode:  wizardModeFull,
		form:  nil,
	}

	// Sending a generic message when no form is active should update spinner
	model, _ := m.Update("some-unhandled-msg")
	wm := model.(*wizardModel)

	// Should not crash — model should remain in same state
	if wm.state != wsRepoFetch {
		t.Errorf("state should remain wsRepoFetch, got %d", wm.state)
	}
}

// ---------------------------------------------------------------------------
// View() tests
// ---------------------------------------------------------------------------

func TestWizardView_DoneState_ReturnsEmpty(t *testing.T) {
	m := wizardModel{
		state: wsDone,
		width: 80,
	}

	view := m.View()
	if view != "" {
		t.Errorf("View() in wsDone should return empty string, got %q", view)
	}
}

func TestWizardView_WithForm_ReturnsNonEmpty(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state: wsOrg,
		cfg:   cfg,
		mode:  wizardModeFull,
		theme: huh.ThemeCharm(),
		width: 80,
	}
	m.initFormBindings()
	m.form = m.buildForm()

	view := m.View()
	if view == "" {
		t.Error("View() with active form should return non-empty string")
	}
	if !strings.Contains(view, "TEAM HERO") {
		t.Error("View() should contain shell header")
	}
}

func TestWizardView_ZeroWidth_UsesDefault(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state: wsOrg,
		cfg:   cfg,
		mode:  wizardModeFull,
		theme: huh.ThemeCharm(),
		width: 0,
	}
	m.initFormBindings()
	m.form = m.buildForm()

	view := m.View()
	if view == "" {
		t.Error("View() with zero width should still return non-empty string using default width")
	}
}

func TestWizardView_FetchState_ShowsSpinner(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state: wsRepoFetch,
		cfg:   cfg,
		mode:  wizardModeFull,
		theme: huh.ThemeCharm(),
		width: 80,
		form:  nil,
	}

	view := m.View()
	if view == "" {
		t.Error("View() in fetch state should return non-empty string")
	}
	if !strings.Contains(view, "Fetching repositories") {
		t.Error("View() in wsRepoFetch should mention fetching repositories")
	}
}

func TestWizardView_TeamFetchState_ShowsTeamMessage(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state: wsTeamFetch,
		cfg:   cfg,
		mode:  wizardModeFull,
		theme: huh.ThemeCharm(),
		width: 80,
		form:  nil,
	}

	view := m.View()
	if !strings.Contains(view, "Fetching teams") {
		t.Error("View() in wsTeamFetch should mention fetching teams")
	}
}

func TestWizardView_MemberFetchState_ShowsMemberMessage(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state: wsMemberFetch,
		cfg:   cfg,
		mode:  wizardModeFull,
		theme: huh.ThemeCharm(),
		width: 80,
		form:  nil,
	}

	view := m.View()
	if !strings.Contains(view, "Fetching members") {
		t.Error("View() in wsMemberFetch should mention fetching members")
	}
}

func TestWizardView_ContainsNavigationHints(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state: wsOrg,
		cfg:   cfg,
		mode:  wizardModeFull,
		theme: huh.ThemeCharm(),
		width: 80,
	}
	m.initFormBindings()
	m.form = m.buildForm()

	view := m.View()
	if !strings.Contains(view, "ctrl+c") {
		t.Error("View() should contain ctrl+c hint")
	}
}

// ---------------------------------------------------------------------------
// buildForm() — comprehensive tests for each wizard state
// ---------------------------------------------------------------------------

func TestBuildForm_WsOrg(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{state: wsOrg, cfg: cfg, mode: wizardModeFull, theme: huh.ThemeCharm(), width: 80}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsOrg) returned nil")
	}
}

func TestBuildForm_WsReuse(t *testing.T) {
	cfg := DefaultConfig()
	prev := DefaultConfig()
	prev.Org = "prev-org"
	ensureDateDefaults(&cfg)
	m := wizardModel{state: wsReuse, cfg: cfg, prev: &prev, mode: wizardModeFull, theme: huh.ThemeCharm(), width: 80}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsReuse) returned nil")
	}
}

func TestBuildForm_WsReuse_NilPrev(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{state: wsReuse, cfg: cfg, prev: nil, mode: wizardModeFull, theme: huh.ThemeCharm(), width: 80}
	m.initFormBindings()
	// Should still produce a form even with nil prev (org will be empty)
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsReuse) with nil prev returned nil")
	}
}

// TestBuildForm_WsPrivate and TestBuildForm_WsArchived removed:
// wsPrivate and wsArchived are no longer wizard steps with dedicated forms.
// They are managed via the settings editor instead.

func TestBuildForm_WsRepoScope(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{state: wsRepoScope, cfg: cfg, mode: wizardModeFull, theme: huh.ThemeCharm(), width: 80}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsRepoScope) returned nil")
	}
}

func TestBuildForm_WsRepoScope_WithExistingRepos(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Repos = []string{"api", "web"}
	ensureDateDefaults(&cfg)
	m := wizardModel{state: wsRepoScope, cfg: cfg, mode: wizardModeFull, theme: huh.ThemeCharm(), width: 80}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsRepoScope) with existing repos returned nil")
	}
}

func TestBuildForm_WsRepoPick(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state:        wsRepoPick,
		cfg:          cfg,
		mode:         wizardModeFull,
		theme:        huh.ThemeCharm(),
		width:        80,
		fetchedRepos: []string{"repo-a", "repo-b", "repo-c"},
	}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsRepoPick) returned nil")
	}
}

func TestBuildForm_WsRepoManual(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{state: wsRepoManual, cfg: cfg, mode: wizardModeFull, theme: huh.ThemeCharm(), width: 80}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsRepoManual) returned nil")
	}
}

func TestBuildForm_WsRepoManual_WithFetchError(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state:        wsRepoManual,
		cfg:          cfg,
		mode:         wizardModeFull,
		theme:        huh.ThemeCharm(),
		width:        80,
		repoFetchErr: "Bad credentials",
	}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsRepoManual) with fetch error returned nil")
	}
}

func TestBuildForm_WsRepoManual_WithExistingRepos(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Repos = []string{"api", "web"}
	ensureDateDefaults(&cfg)
	m := wizardModel{state: wsRepoManual, cfg: cfg, mode: wizardModeFull, theme: huh.ThemeCharm(), width: 80}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsRepoManual) with existing repos returned nil")
	}
}

func TestBuildForm_WsMemberScope(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{state: wsMemberScope, cfg: cfg, mode: wizardModeFull, theme: huh.ThemeCharm(), width: 80}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsMemberScope) returned nil")
	}
}

func TestBuildForm_WsMemberScope_WithExistingMembers(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Members = []string{"alice", "bob"}
	ensureDateDefaults(&cfg)
	m := wizardModel{state: wsMemberScope, cfg: cfg, mode: wizardModeFull, theme: huh.ThemeCharm(), width: 80}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsMemberScope) with existing members returned nil")
	}
}

func TestBuildForm_WsTeamPick(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state:        wsTeamPick,
		cfg:          cfg,
		mode:         wizardModeFull,
		theme:        huh.ThemeCharm(),
		width:        80,
		fetchedTeams: []TeamInfo{{Name: "Engineering", Slug: "engineering"}, {Name: "Design", Slug: "design"}},
	}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsTeamPick) returned nil")
	}
}

func TestBuildForm_WsTeamPick_SameNameAndSlug(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state:        wsTeamPick,
		cfg:          cfg,
		mode:         wizardModeFull,
		theme:        huh.ThemeCharm(),
		width:        80,
		fetchedTeams: []TeamInfo{{Name: "engineering", Slug: "engineering"}},
	}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsTeamPick) with same name/slug returned nil")
	}
}

func TestBuildForm_WsTeamManual(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{state: wsTeamManual, cfg: cfg, mode: wizardModeFull, theme: huh.ThemeCharm(), width: 80}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsTeamManual) returned nil")
	}
}

func TestBuildForm_WsTeamManual_WithFetchError(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state:        wsTeamManual,
		cfg:          cfg,
		mode:         wizardModeFull,
		theme:        huh.ThemeCharm(),
		width:        80,
		teamFetchErr: "403 Forbidden",
	}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsTeamManual) with fetch error returned nil")
	}
}

func TestBuildForm_WsMemberPick(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state:          wsMemberPick,
		cfg:            cfg,
		mode:           wizardModeFull,
		theme:          huh.ThemeCharm(),
		width:          80,
		fetchedMembers: []string{"alice", "bob", "charlie"},
	}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsMemberPick) returned nil")
	}
}

func TestBuildForm_WsMemberManual(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{state: wsMemberManual, cfg: cfg, mode: wizardModeFull, theme: huh.ThemeCharm(), width: 80}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsMemberManual) returned nil")
	}
}

func TestBuildForm_WsMemberManual_WithFetchError(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state:          wsMemberManual,
		cfg:            cfg,
		mode:           wizardModeFull,
		theme:          huh.ThemeCharm(),
		width:          80,
		memberFetchErr: "network timeout",
	}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsMemberManual) with fetch error returned nil")
	}
}

func TestBuildForm_WsMemberManual_WithExistingMembers(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Members = []string{"alice"}
	ensureDateDefaults(&cfg)
	m := wizardModel{state: wsMemberManual, cfg: cfg, mode: wizardModeFull, theme: huh.ThemeCharm(), width: 80}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsMemberManual) with existing members returned nil")
	}
}

func TestBuildForm_WsDates(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{state: wsDates, cfg: cfg, mode: wizardModeFull, theme: huh.ThemeCharm(), width: 80}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsDates) returned nil")
	}
}

// TestBuildForm_WsBots removed:
// wsBots is no longer a wizard step with a dedicated form.
// It is managed via the settings editor instead.

func TestBuildForm_WsDetailed(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{state: wsDetailed, cfg: cfg, mode: wizardModeFull, theme: huh.ThemeCharm(), width: 80}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsDetailed) returned nil")
	}
}

func TestBuildForm_WsDataSources(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{state: wsDataSources, cfg: cfg, mode: wizardModeFull, theme: huh.ThemeCharm(), width: 80}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsDataSources) returned nil")
	}
}

func TestBuildForm_WsReportSections(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{state: wsReportSections, cfg: cfg, mode: wizardModeFull, theme: huh.ThemeCharm(), width: 80}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsReportSections) returned nil")
	}
}

func TestBuildForm_WsCacheFlush(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{state: wsCacheFlush, cfg: cfg, mode: wizardModeFull, theme: huh.ThemeCharm(), width: 80}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsCacheFlush) returned nil")
	}
}

func TestBuildForm_WsCacheFlushDate(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{state: wsCacheFlushDate, cfg: cfg, mode: wizardModeFull, theme: huh.ThemeCharm(), width: 80}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsCacheFlushDate) returned nil")
	}
}

func TestBuildForm_WsConfirmRun_FullMode(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	m := wizardModel{state: wsConfirmRun, cfg: cfg, mode: wizardModeFull, theme: huh.ThemeCharm(), width: 80}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsConfirmRun) in full mode returned nil")
	}
}

func TestBuildForm_WsConfirmRun_ExpressMode(t *testing.T) {
	cfg := ExpressConfig()
	cfg.Org = "acme"
	ensureDateDefaults(&cfg)
	m := wizardModel{state: wsConfirmRun, cfg: cfg, mode: wizardModeExpress, theme: huh.ThemeCharm(), width: 80}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(wsConfirmRun) in express mode returned nil")
	}
}

func TestBuildForm_DefaultState(t *testing.T) {
	cfg := DefaultConfig()
	ensureDateDefaults(&cfg)
	// Use a state value that doesn't match any case (wsDone)
	m := wizardModel{state: wsDone, cfg: cfg, mode: wizardModeFull, theme: huh.ThemeCharm(), width: 80}
	m.initFormBindings()
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm(default state) returned nil — should return a no-op form")
	}
}

// ---------------------------------------------------------------------------
// advance() edge case tests
// ---------------------------------------------------------------------------

func TestAdvance_ExpressToFull_SwitchToFull(t *testing.T) {
	cfg := ExpressConfig()
	cfg.Org = "acme"
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state:         wsConfirmRun,
		cfg:           cfg,
		mode:          wizardModeExpress,
		theme:         huh.ThemeCharm(),
		width:         80,
		switchToFull:  false,
		expressChoice: "customize",
	}
	m.initFormBindings()

	// Simulate form completion where expressChoice is "customize"
	m.expressChoice = "customize" // re-set after initFormBindings
	m.readFormValues()
	if !m.switchToFull {
		t.Fatal("expected switchToFull after choosing 'customize'")
	}

	// Now advance should switch mode to full and go to wsRepoScope
	model, _ := m.advance()
	wm := model.(*wizardModel)

	if wm.mode != wizardModeFull {
		t.Errorf("expected mode wizardModeFull, got %d", wm.mode)
	}
	if wm.state != wsRepoScope {
		t.Errorf("expected state wsRepoScope after switch to full, got %d", wm.state)
	}
	if len(wm.history) != 1 || wm.history[0] != wsOrg {
		t.Errorf("expected history [wsOrg], got %v", wm.history)
	}
	if wm.form == nil {
		t.Error("form should be set after switching to full mode")
	}
}

func TestAdvance_ToDone_Quits(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state:      wsConfirmRun,
		cfg:        cfg,
		mode:       wizardModeFull,
		theme:      huh.ThemeCharm(),
		width:      80,
		confirmRun: true,
	}
	m.initFormBindings()

	model, cmd := m.advance()
	wm := model.(*wizardModel)

	if wm.state != wsDone {
		t.Errorf("expected state wsDone, got %d", wm.state)
	}
	// Should return tea.Quit
	if cmd == nil {
		t.Error("advance to wsDone should return a quit command")
	}
}

func TestAdvance_ToFetchState_StartsSpinner(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	cfg.UseAllRepos = false // forces repoScope to "specific" via initFormBindings
	ensureDateDefaults(&cfg)
	m := wizardModel{
		state: wsRepoScope,
		cfg:   cfg,
		mode:  wizardModeFull,
		theme: huh.ThemeCharm(),
		width: 80,
	}
	m.initFormBindings()
	// Verify initFormBindings set repoScope correctly
	if m.repoScope != "specific" {
		t.Fatalf("expected repoScope=specific after initFormBindings, got %q", m.repoScope)
	}

	model, cmd := m.advance()
	wm := model.(*wizardModel)

	if wm.state != wsRepoFetch {
		t.Errorf("expected state wsRepoFetch, got %d", wm.state)
	}
	if wm.form != nil {
		t.Error("form should be nil during fetch state")
	}
	if cmd == nil {
		t.Error("fetch state should return batch command (spinner tick + fetch)")
	}
}

// ---------------------------------------------------------------------------
// startFetch tests
// ---------------------------------------------------------------------------

func TestStartFetch_NonFetchState_ReturnsNil(t *testing.T) {
	m := wizardModel{state: wsOrg, cfg: DefaultConfig()}
	cmd := m.startFetch()
	if cmd != nil {
		t.Error("startFetch for non-fetch state should return nil")
	}
}

func TestStartFetch_RepoFetch_ReturnsCmdFunc(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	m := wizardModel{state: wsRepoFetch, cfg: cfg}
	cmd := m.startFetch()
	if cmd == nil {
		t.Error("startFetch for wsRepoFetch should return a non-nil Cmd")
	}
}

func TestStartFetch_TeamFetch_ReturnsCmdFunc(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	m := wizardModel{state: wsTeamFetch, cfg: cfg}
	cmd := m.startFetch()
	if cmd == nil {
		t.Error("startFetch for wsTeamFetch should return a non-nil Cmd")
	}
}

func TestStartFetch_MemberFetch_ReturnsCmdFunc(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	m := wizardModel{state: wsMemberFetch, cfg: cfg}
	cmd := m.startFetch()
	if cmd == nil {
		t.Error("startFetch for wsMemberFetch should return a non-nil Cmd")
	}
}

// ---------------------------------------------------------------------------
// RunWizard via teaProgramRun injection
// ---------------------------------------------------------------------------

func TestRunWizard_TeaProgramRun(t *testing.T) {
	// Save and restore the real teaProgramRun
	origTeaProgramRun := teaProgramRun
	defer func() { teaProgramRun = origTeaProgramRun }()

	// Inject a fake that returns a wizardModel with confirmed=true
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		cfg := DefaultConfig()
		cfg.Org = "injected-org"
		wm := &wizardModel{
			cfg:       cfg,
			confirmed: true,
			aborted:   false,
			state:     wsDone,
		}
		return wm, nil
	}

	result, err := RunWizard(nil, DefaultConfig(), wizardModeFull)
	if err != nil {
		t.Fatalf("RunWizard returned error: %v", err)
	}
	if result == nil {
		t.Fatal("RunWizard returned nil result")
	}
	if !result.Confirmed {
		t.Error("RunWizard result.Confirmed should be true")
	}
	if result.Config == nil {
		t.Error("RunWizard result.Config should not be nil")
	}
	if result.Config.Org != "injected-org" {
		t.Errorf("RunWizard result.Config.Org = %q, want %q", result.Config.Org, "injected-org")
	}
}

// ===========================================================================
// RunWizard edge cases: nil slices, express mode, prev != nil, error path
// ===========================================================================

func TestRunWizard_NilSlices(t *testing.T) {
	origTeaProgramRun := teaProgramRun
	defer func() { teaProgramRun = origTeaProgramRun }()

	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		wm := &wizardModel{
			cfg:       DefaultConfig(),
			confirmed: true,
		}
		return wm, nil
	}

	// Pass a config with nil Members and Repos to hit the nil-check branches
	cfg := ReportConfig{Org: "test-org"}
	result, err := RunWizard(nil, cfg, wizardModeFull)
	if err != nil {
		t.Fatalf("RunWizard returned error: %v", err)
	}
	if result == nil {
		t.Fatal("RunWizard returned nil result")
	}
}

func TestRunWizard_ExpressMode(t *testing.T) {
	origTeaProgramRun := teaProgramRun
	defer func() { teaProgramRun = origTeaProgramRun }()

	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		wm := &wizardModel{
			cfg:       DefaultConfig(),
			confirmed: true,
		}
		return wm, nil
	}

	cfg := DefaultConfig()
	result, err := RunWizard(nil, cfg, wizardModeExpress)
	if err != nil {
		t.Fatalf("RunWizard with express mode returned error: %v", err)
	}
	if result == nil {
		t.Fatal("RunWizard returned nil result")
	}
}

func TestRunWizard_WithPrev(t *testing.T) {
	origTeaProgramRun := teaProgramRun
	defer func() { teaProgramRun = origTeaProgramRun }()

	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		wm := &wizardModel{
			cfg:       DefaultConfig(),
			confirmed: true,
		}
		return wm, nil
	}

	prev := DefaultConfig()
	prev.Org = "prev-org"
	cfg := DefaultConfig()

	result, err := RunWizard(&prev, cfg, wizardModeFull)
	if err != nil {
		t.Fatalf("RunWizard with prev returned error: %v", err)
	}
	if result == nil {
		t.Fatal("RunWizard returned nil result")
	}
}

func TestRunWizard_Error(t *testing.T) {
	origTeaProgramRun := teaProgramRun
	defer func() { teaProgramRun = origTeaProgramRun }()

	expectedErr := fmt.Errorf("program failed")
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		return nil, expectedErr
	}

	result, err := RunWizard(nil, DefaultConfig(), wizardModeFull)
	if err == nil {
		t.Fatal("expected error from RunWizard, got nil")
	}
	if result != nil {
		t.Errorf("expected nil result on error, got %+v", result)
	}
}

// ===========================================================================
// wizard.Update: active form path (lines 287-299)
// ===========================================================================

func TestWizardUpdate_ActiveForm(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	ensureDateDefaults(&cfg)

	m := &wizardModel{
		cfg:   cfg,
		mode:  wizardModeFull,
		state: wsOrg,
		width: 80,
	}
	m.form = m.buildForm()

	// A non-special KeyMsg ('j') falls through the switch and hits the active-form block.
	keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}}
	updated, _ := m.Update(keyMsg)
	if updated == nil {
		t.Error("expected non-nil model after active form update")
	}
}

// ===========================================================================
// wizard.startFetch closures (lines 680-681, 685-687, 691-693)
// ===========================================================================

func TestWizardStartFetch_RepoFetch(t *testing.T) {
	origFn := execCommandFn
	t.Cleanup(func() { execCommandFn = origFn })
	execCommandFn = func(_ string, _ ...string) *exec.Cmd {
		return exec.Command("echo", `["repo1","repo2"]`)
	}

	cfg := DefaultConfig()
	cfg.Org = "acme"
	m := &wizardModel{cfg: cfg, state: wsRepoFetch}

	cmd := m.startFetch()
	if cmd == nil {
		t.Fatal("expected non-nil cmd for wsRepoFetch")
	}
	msg := cmd()
	if _, ok := msg.(reposFetched); !ok {
		t.Errorf("expected reposFetched, got %T", msg)
	}
}

func TestWizardStartFetch_TeamFetch(t *testing.T) {
	origFn := execCommandFn
	t.Cleanup(func() { execCommandFn = origFn })
	execCommandFn = func(_ string, _ ...string) *exec.Cmd {
		return exec.Command("echo", `[{"name":"Team1","slug":"team1"}]`)
	}

	cfg := DefaultConfig()
	cfg.Org = "acme"
	m := &wizardModel{cfg: cfg, state: wsTeamFetch}

	cmd := m.startFetch()
	if cmd == nil {
		t.Fatal("expected non-nil cmd for wsTeamFetch")
	}
	msg := cmd()
	if _, ok := msg.(teamsFetched); !ok {
		t.Errorf("expected teamsFetched, got %T", msg)
	}
}

func TestWizardStartFetch_MemberFetch(t *testing.T) {
	origFn := execCommandFn
	t.Cleanup(func() { execCommandFn = origFn })
	execCommandFn = func(_ string, _ ...string) *exec.Cmd {
		return exec.Command("echo", `["alice","bob"]`)
	}

	cfg := DefaultConfig()
	cfg.Org = "acme"
	m := &wizardModel{cfg: cfg, state: wsMemberFetch}

	cmd := m.startFetch()
	if cmd == nil {
		t.Fatal("expected non-nil cmd for wsMemberFetch")
	}
	msg := cmd()
	if _, ok := msg.(membersFetched); !ok {
		t.Errorf("expected membersFetched, got %T", msg)
	}
}

// ---------------------------------------------------------------------------
// nextState: wsOrg skips wsPrivate/wsArchived, wsDates skips wsBots
// ---------------------------------------------------------------------------

func TestNextState_OrgSkipsPrivateArchived(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}
	m.state = wsOrg
	next := m.nextState()
	if next != wsRepoScope {
		t.Errorf("wsOrg should skip wsPrivate/wsArchived and go to wsRepoScope, got %d", next)
	}
}

func TestNextState_DatesSkipsBots(t *testing.T) {
	m := wizardModel{cfg: DefaultConfig(), mode: wizardModeFull}
	m.state = wsDates
	next := m.nextState()
	if next != wsDetailed {
		t.Errorf("wsDates should skip wsBots and go to wsDetailed, got %d", next)
	}
}

// ---------------------------------------------------------------------------
// renderConfirmModal tests
// ---------------------------------------------------------------------------

func TestRenderConfirmModal_ContainsOrg(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme-corp"
	cfg.Since = "2026-03-01"
	cfg.Until = "2026-03-15"
	result := renderConfirmModal(&cfg, nil, 60)
	if !strings.Contains(result, "acme-corp") {
		t.Error("expected modal to contain org name")
	}
	if !strings.Contains(result, "Ready to generate report?") {
		t.Error("expected modal header")
	}
}

func TestRenderConfirmModal_ShowsAllFields(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "myorg"
	cfg.Since = "2026-01-01"
	cfg.Until = "2026-01-31"
	cfg.UseAllRepos = true
	cfg.Sections.DataSources.Git = true
	cfg.Sections.DataSources.Asana = true
	cfg.Sections.ReportSections.IndividualContributions = true
	cfg.Sections.ReportSections.Loc = true

	result := renderConfirmModal(&cfg, nil, 60)
	for _, want := range []string{"myorg", "All", "2026-01-01", "2026-01-31", "Git", "Asana", "Individual", "LOC"} {
		if !strings.Contains(result, want) {
			t.Errorf("expected modal to contain %q", want)
		}
	}
}

func TestRenderConfirmModal_WithTeam(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "org"
	cfg.Team = "backend"
	cfg.Since = "2026-01-01"
	cfg.Until = "2026-01-31"

	result := renderConfirmModal(&cfg, nil, 60)
	if !strings.Contains(result, "backend") {
		t.Error("expected modal to contain team name")
	}
}

func TestRenderConfirmModal_WithMembers(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "org"
	cfg.Members = []string{"alice", "bob", "charlie"}
	cfg.Since = "2026-01-01"
	cfg.Until = "2026-01-31"

	result := renderConfirmModal(&cfg, nil, 60)
	if !strings.Contains(result, "alice") {
		t.Error("expected modal to contain first member name")
	}
}
