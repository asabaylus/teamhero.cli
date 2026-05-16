package main

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/exp/teatest"
)

// ---------------------------------------------------------------------------
// Golden-style layout tests for the interview bootstrap wizard.
//
// These tests drive interviewBootstrapTeaModel through teatest so the huh
// form gets a real bubbletea runtime (initial WindowSizeMsg, Init() Cmds,
// etc.), then capture the rendered output and assert that the layout
// invariants are present. This catches the regression we shipped where the
// wizard rendered as a bare huh.Form with no shell header or summary panel.
//
// Per-field cursor/animation state is suppressed by stripping ANSI before
// assertions. We do NOT assert exact byte-for-byte snapshots because huh's
// internal rendering depends on terminal capability detection; the
// invariants we care about are:
//   1. The shared "//// TEAM HERO" shell header is present.
//   2. The right-side "Interview Bootstrap" summary panel renders with
//      the correct label for the active step and bracketed values for
//      every step already reached.
//   3. The navigation hints footer is present.
//
// Together those three invariants tell us the wizard now wears the same
// frame as the report wizard.
// ---------------------------------------------------------------------------

const (
	testTermWidth  = 100
	testTermHeight = 32
)

// driveWizardOutput drives interviewBootstrapTeaModel through teatest until
// the layout marker appears, then quits and reliably tears down the
// program. Returns both the raw rendered output (including ANSI styling)
// and a stripped plaintext version for assertions.
func driveWizardOutput(t *testing.T, m *interviewBootstrapTeaModel) (raw, stripped string) {
	t.Helper()

	tm := teatest.NewTestModel(t, m, teatest.WithInitialTermSize(testTermWidth, testTermHeight))
	tm.Send(tea.WindowSizeMsg{Width: testTermWidth, Height: testTermHeight})

	// Always tear down the program before returning, regardless of how we
	// exit this function. tm.Quit() shuts the program down via its
	// internal channel — more reliable than sending Ctrl+C, which races
	// with huh's cursor blink goroutines and leaves them parked on
	// channel reads.
	defer func() {
		_ = tm.Quit()
		tm.WaitFinished(t, teatest.WithFinalTimeout(3*time.Second))
	}()

	var buf strings.Builder
	r := tm.Output()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		chunk := make([]byte, 8192)
		n, _ := r.Read(chunk)
		if n > 0 {
			buf.Write(chunk[:n])
			s := stripANSI(buf.String())
			if strings.Contains(s, "//// TEAM HERO") && strings.Contains(s, "Interview Bootstrap") {
				return buf.String(), s
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	s := stripANSI(buf.String())
	t.Logf("captured output (no settled frame):\n%s", s)
	return buf.String(), s
}

var _ = io.ReadAll // reserved for future variants that need full readback

func TestInterviewBootstrap_RoleStep_HasSharedLayout(t *testing.T) {
	m := newInterviewBootstrapTeaModel(BootstrapWizardDefaults{})
	_, view := driveWizardOutput(t, m)

	mustContain(t, view, "//// TEAM HERO ", "shell header prefix")
	mustContain(t, view, "Interview Bootstrap", "summary panel header")
	mustContain(t, view, "Role slug:", "active step label in summary")
	mustContain(t, view, "Role slug (URL-safe identifier)", "form title")
	mustContain(t, view, "ctrl+c quit", "navigation hints footer")
}

func TestInterviewBootstrap_SummaryShowsValuesAsStepsAdvance(t *testing.T) {
	m := newInterviewBootstrapTeaModel(BootstrapWizardDefaults{
		Role:         "senior-backend",
		Stack:        "Go",
		Domain:       "Payments",
		Feature:      "build a ledger entry-point",
		TimeBox:      "90",
		ModeProject:  "A",
		ModeAnalysis: "ai-assisted",
		ModeRubric:   "default",
	})
	// Jump to the output-dir step so the summary shows everything before it.
	m.step = ibStepOutputDir
	m.highWater = ibStepOutputDir
	m.form = m.buildForm()

	_, view := driveWizardOutput(t, m)

	mustContain(t, view, "Role slug: senior-backend", "filled role slug")
	mustContain(t, view, "Stack: Go", "filled stack")
	mustContain(t, view, "Domain: Payments", "filled domain")
	mustContain(t, view, "Time-box: 90 min", "filled time-box")
	// Long values wrap across lines in the narrow summary column; assert
	// only the unwrappable prefix.
	mustContain(t, view, "Project mode: A — generated", "filled project mode (prefix)")
	mustContain(t, view, "Rubric: default", "filled rubric")
	// Active step's form title should appear in the left panel.
	mustContain(t, view, "Output directory", "current step form title")
}

func TestInterviewBootstrap_View_AdvancesPastRubricStep_ShowsCustomTruncatedInSummary(t *testing.T) {
	m := newInterviewBootstrapTeaModel(BootstrapWizardDefaults{})
	m.data.role = "x"
	m.data.stack = "Go"
	m.data.domain = "Payments"
	m.data.modeRubric = "custom"
	m.data.customPrompt = "Score primarily on architectural decisions and verification discipline"
	m.step = ibStepOutputDir
	m.highWater = ibStepOutputDir
	m.form = m.buildForm()

	_, view := driveWizardOutput(t, m)
	mustContain(t, view, "Rubric: custom (", "rubric label shows custom prefix")
	mustContain(t, view, "…", "long custom prompt is truncated with ellipsis")
}

// ---------------------------------------------------------------------------
// Branching transitions for rubric mode are pure state-machine tests; they
// don't need the bubbletea runtime, so we test them directly for speed.
// ---------------------------------------------------------------------------

func TestInterviewBootstrap_RubricJDBranch_RoutesToJDStep(t *testing.T) {
	m := newInterviewBootstrapTeaModel(BootstrapWizardDefaults{})
	m.data.modeRubric = "default+jd"
	m.step = ibStepRubricMode
	if next := m.nextStep(m.step); next != ibStepJDPath {
		t.Fatalf("rubric=default+jd should advance to JD step, got %v", next)
	}
}

func TestInterviewBootstrap_RubricCustomBranch_RoutesToCustomPrompt(t *testing.T) {
	m := newInterviewBootstrapTeaModel(BootstrapWizardDefaults{})
	m.data.modeRubric = "custom"
	m.step = ibStepRubricMode
	if next := m.nextStep(m.step); next != ibStepCustomPrompt {
		t.Fatalf("rubric=custom should advance to custom prompt step, got %v", next)
	}
}

func TestInterviewBootstrap_RubricDefaultBranch_SkipsConditionalSteps(t *testing.T) {
	m := newInterviewBootstrapTeaModel(BootstrapWizardDefaults{})
	m.data.modeRubric = "default"
	m.step = ibStepRubricMode
	if next := m.nextStep(m.step); next != ibStepOutputDir {
		t.Fatalf("rubric=default should jump to output dir, got %v", next)
	}
}

// TestInterviewBootstrap_Screenshot_WritesGolden renders three
// representative wizard states and writes both the raw ANSI capture and a
// plaintext-stripped version to tui/testdata/interview_bootstrap/. When
// TEAMHERO_UPDATE_SCREENSHOTS=1 is set, the files are overwritten;
// otherwise the test compares against the existing golden files. This
// gives us a human-reviewable artifact under version control so layout
// regressions show up as diffs in PRs.
func TestInterviewBootstrap_Screenshot_WritesGolden(t *testing.T) {
	cases := []struct {
		name string
		seed func() *interviewBootstrapTeaModel
	}{
		{
			name: "01-role-step-empty",
			seed: func() *interviewBootstrapTeaModel {
				return newInterviewBootstrapTeaModel(BootstrapWizardDefaults{})
			},
		},
		{
			name: "02-output-dir-step-filled",
			seed: func() *interviewBootstrapTeaModel {
				m := newInterviewBootstrapTeaModel(BootstrapWizardDefaults{
					Role: "senior-backend", RoleTitle: "Senior Backend Engineer",
					Stack: "Go", Domain: "Payments",
					Feature: "build a ledger entry-point", TimeBox: "60",
					ModeProject: "A", ModeAnalysis: "ai-assisted", ModeRubric: "default",
				})
				m.step = ibStepOutputDir
				m.highWater = ibStepOutputDir
				m.form = m.buildForm()
				return m
			},
		},
		{
			name: "03-confirm-step",
			seed: func() *interviewBootstrapTeaModel {
				m := newInterviewBootstrapTeaModel(BootstrapWizardDefaults{
					Role: "senior-backend", Stack: "Go", Domain: "Payments",
					Feature: "ledger entry-point", TimeBox: "60",
					ModeProject: "A", ModeAnalysis: "ai-assisted", ModeRubric: "default",
					OutputDir: "./interviews/senior-backend",
				})
				m.step = ibStepConfirm
				m.highWater = ibStepConfirm
				m.form = m.buildForm()
				return m
			},
		},
	}

	outDir := filepath.Join("testdata", "interview_bootstrap")
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		t.Fatalf("mkdir testdata: %v", err)
	}
	update := os.Getenv("TEAMHERO_UPDATE_SCREENSHOTS") == "1"

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw, stripped := driveWizardOutput(t, tc.seed())
			rawPath := filepath.Join(outDir, tc.name+".ansi.txt")
			strippedPath := filepath.Join(outDir, tc.name+".plain.txt")

			if update {
				if err := os.WriteFile(rawPath, []byte(raw), 0o644); err != nil {
					t.Fatalf("write raw: %v", err)
				}
				if err := os.WriteFile(strippedPath, []byte(stripped), 0o644); err != nil {
					t.Fatalf("write stripped: %v", err)
				}
				return
			}

			want, err := os.ReadFile(strippedPath)
			if err != nil {
				t.Fatalf("read golden (run with TEAMHERO_UPDATE_SCREENSHOTS=1 to create): %v", err)
			}
			// Compare stripped plaintext only — the raw file includes
			// cursor-blink and cursor-position sequences that vary between
			// runs and aren't load-bearing for layout regressions.
			if got := normalizeForGolden(stripped); got != normalizeForGolden(string(want)) {
				t.Errorf("layout regression in %s. Got:\n%s\n\nWant:\n%s", tc.name, stripped, string(want))
			}
		})
	}
}

// TestInterviewBootstrap_ConfirmStep_OmitsVerboseSummary pins the fix for
// a reported clutter bug: the confirm step used to repeat every collected
// field (role=… · stack=… · domain=… · time-box=…) as the huh.Confirm
// form's Description, which duplicated the right-hand summary panel and
// hid the only choice the user has to make. The summary panel is the
// source of truth — the left-hand form should only show the prompt and
// the two buttons. Any regression that pipes summarizeBootstrapModel back
// into the form will reintroduce the "role=" / "stack=" markers and fail
// this assertion.
func TestInterviewBootstrap_ConfirmStep_OmitsVerboseSummary(t *testing.T) {
	m := newInterviewBootstrapTeaModel(BootstrapWizardDefaults{
		Role: "senior-backend", Stack: "Go", Domain: "Payments",
		Feature: "ledger entry-point", TimeBox: "60",
		ModeProject: "A", ModeAnalysis: "ai-assisted", ModeRubric: "default",
		OutputDir: "./interviews/senior-backend",
	})
	m.step = ibStepConfirm
	m.highWater = ibStepConfirm
	m.form = m.buildForm()
	_, stripped := driveWizardOutput(t, m)

	// The verbose summary's signature tokens — if any of these leak back
	// into the confirm-step view, the description was reattached.
	for _, banned := range []string{"role=", "stack=", "time-box=", "out="} {
		if strings.Contains(stripped, banned) {
			t.Errorf("confirm step should NOT contain summary token %q (it duplicates the side panel); got:\n%s", banned, stripped)
		}
	}
	// Sanity: the title and the affirmative button MUST still be visible
	// — without these the user has nothing to act on.
	mustContain(t, stripped, "Ready to bootstrap?", "confirm title")
	mustContain(t, stripped, "Yes, generate the role", "affirmative button")
}

// normalizeForGolden collapses trailing whitespace on each line so minor
// width changes don't churn the golden file.
func normalizeForGolden(s string) string {
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		lines[i] = strings.TrimRight(l, " \t\r")
	}
	return strings.Join(lines, "\n")
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func mustContain(t *testing.T, haystack, needle, what string) {
	t.Helper()
	if !strings.Contains(haystack, needle) {
		t.Errorf("expected view to contain %s (%q); got:\n%s", what, needle, haystack)
	}
}
