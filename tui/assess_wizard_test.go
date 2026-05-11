package main

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func newAssessWizardForTest(scope string) *assessWizardModel {
	cfg := AssessConfig{}
	m := &assessWizardModel{
		cfg:       cfg,
		width:     100,
		state:     awScopeMode,
		scopeMode: scope,
		localPath: "/tmp/foo",
		orgName:   "acme",
		confirmRun: true,
	}
	m.form = m.buildForm()
	return m
}

func TestAssessWizard_AdvanceLocalRepo(t *testing.T) {
	m := newAssessWizardForTest("local-repo")
	updated, _ := m.advance()
	final := updated.(*assessWizardModel)
	if final.cfg.Scope.Mode != "local-repo" {
		t.Errorf("Mode = %q, want local-repo", final.cfg.Scope.Mode)
	}
	if final.state != awLocalPath {
		t.Errorf("state = %d, want awLocalPath (%d)", final.state, awLocalPath)
	}
}

func TestAssessWizard_AdvanceOrg(t *testing.T) {
	m := newAssessWizardForTest("org")
	updated, _ := m.advance()
	final := updated.(*assessWizardModel)
	if final.cfg.Scope.Mode != "org" {
		t.Errorf("Mode = %q, want org", final.cfg.Scope.Mode)
	}
	if final.state != awOrg {
		t.Errorf("state = %d, want awOrg (%d)", final.state, awOrg)
	}
}

func TestAssessWizard_AdvanceBoth(t *testing.T) {
	m := newAssessWizardForTest("both")
	updated, _ := m.advance()
	final := updated.(*assessWizardModel)
	if final.state != awBoth {
		t.Errorf("state = %d, want awBoth (%d)", final.state, awBoth)
	}
}

func TestAssessWizard_LocalPathSetsDisplayNameFromBasename(t *testing.T) {
	m := newAssessWizardForTest("local-repo")
	m.advance()
	m.localPath = "/home/foo/some-repo"
	m.displayName = "" // empty -> derive from basename
	m.state = awLocalPath
	updated, _ := m.advance()
	final := updated.(*assessWizardModel)
	if final.cfg.Scope.DisplayName != "some-repo" {
		t.Errorf("DisplayName = %q, want some-repo", final.cfg.Scope.DisplayName)
	}
	if final.state != awConfirm {
		t.Errorf("state = %d, want awConfirm", final.state)
	}
}

func TestAssessWizard_OrgPopulatesScope(t *testing.T) {
	m := newAssessWizardForTest("org")
	m.advance()
	m.orgName = "acme"
	m.repoCSV = "frontend, backend ,  mobile"
	m.displayName = ""
	m.state = awOrg
	updated, _ := m.advance()
	final := updated.(*assessWizardModel)
	if final.cfg.Scope.Org != "acme" {
		t.Errorf("Org = %q, want acme", final.cfg.Scope.Org)
	}
	if final.cfg.Scope.DisplayName != "acme" {
		t.Errorf("DisplayName = %q, want acme", final.cfg.Scope.DisplayName)
	}
	if got := final.cfg.Scope.Repos; len(got) != 3 || got[0] != "frontend" || got[1] != "backend" || got[2] != "mobile" {
		t.Errorf("Repos = %v, want [frontend backend mobile]", got)
	}
}

func TestAssessWizard_ConfirmRunSetsConfirmed(t *testing.T) {
	m := newAssessWizardForTest("local-repo")
	m.state = awConfirm
	m.confirmRun = true
	updated, cmd := m.advance()
	final := updated.(*assessWizardModel)
	if !final.confirmed {
		t.Error("confirmed should be true after confirm=true")
	}
	if final.state != awDone {
		t.Errorf("state = %d, want awDone", final.state)
	}
	if cmd == nil {
		t.Error("expected tea.Quit cmd")
	}
}

func TestAssessWizard_ConfirmCancelSetsAborted(t *testing.T) {
	m := newAssessWizardForTest("local-repo")
	m.state = awConfirm
	m.confirmRun = false
	updated, cmd := m.advance()
	final := updated.(*assessWizardModel)
	if !final.aborted {
		t.Error("aborted should be true on confirm=false")
	}
	if cmd == nil {
		t.Error("expected tea.Quit cmd")
	}
}

func TestAssessWizard_GoBackPopsHistory(t *testing.T) {
	m := newAssessWizardForTest("local-repo")
	m.advance() // -> awLocalPath
	if len(m.history) != 1 {
		t.Fatalf("history len = %d, want 1", len(m.history))
	}
	updated, _ := m.goBack()
	final := updated.(*assessWizardModel)
	if final.state != awScopeMode {
		t.Errorf("state after goBack = %d, want awScopeMode", final.state)
	}
	if len(final.history) != 0 {
		t.Errorf("history len = %d, want 0", len(final.history))
	}
}

func TestAssessWizard_GoBackEmptyHistoryAborts(t *testing.T) {
	m := newAssessWizardForTest("local-repo")
	updated, cmd := m.goBack()
	final := updated.(*assessWizardModel)
	if !final.aborted {
		t.Error("expected aborted=true when goBack with empty history")
	}
	if cmd == nil {
		t.Error("expected tea.Quit cmd")
	}
}

func TestAssessWizard_CtrlCAborts(t *testing.T) {
	m := newAssessWizardForTest("local-repo")
	updated, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	final := updated.(*assessWizardModel)
	if !final.aborted {
		t.Error("ctrl+c should set aborted")
	}
	if cmd == nil {
		t.Error("expected tea.Quit cmd")
	}
}

func TestAssessWizard_ViewRendersHeaderAndPanels(t *testing.T) {
	m := newAssessWizardForTest("local-repo")
	view := m.View()
	if !strings.Contains(view, "Assessment Setup") {
		t.Error("view should include the Assessment Setup summary header")
	}
	if !strings.Contains(view, "esc back") {
		t.Error("view should include nav hints (esc back • ctrl+c quit)")
	}
}

func TestAssessWizard_ViewEmptyWhenDone(t *testing.T) {
	m := newAssessWizardForTest("local-repo")
	m.state = awDone
	if m.View() != "" {
		t.Error("View() should be empty when state is awDone")
	}
}

func TestParseRepoCSV(t *testing.T) {
	cases := map[string][]string{
		"":                  {},
		"foo":               {"foo"},
		"foo,bar,baz":       {"foo", "bar", "baz"},
		"  foo , bar ,baz ": {"foo", "bar", "baz"},
		",foo,,bar,":        {"foo", "bar"},
	}
	for input, want := range cases {
		got := parseRepoCSV(input)
		if len(got) != len(want) {
			t.Errorf("parseRepoCSV(%q) = %v, want %v", input, got, want)
			continue
		}
		for i, v := range want {
			if got[i] != v {
				t.Errorf("parseRepoCSV(%q)[%d] = %q, want %q", input, i, got[i], v)
			}
		}
	}
}

func TestRequireNonEmpty(t *testing.T) {
	v := requireNonEmpty("name")
	if err := v(""); err == nil {
		t.Error("empty should error")
	}
	if err := v("   "); err == nil {
		t.Error("whitespace should error")
	}
	if err := v("acme"); err != nil {
		t.Errorf("non-empty should pass: %v", err)
	}
}
