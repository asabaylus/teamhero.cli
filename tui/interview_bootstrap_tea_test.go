package main

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
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
	mustContain(t, view, "Project type: Brownfield", "filled project type (prefix)")
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

func TestInterviewBootstrap_JDProvidedYes_RoutesToJDPath(t *testing.T) {
	// JD attachment is now its own branch sitting between Stack and
	// Domain. jdProvided=yes routes through the path + influence pair
	// AND skips Domain entirely (the JD describes the domain).
	m := newInterviewBootstrapTeaModel(BootstrapWizardDefaults{})
	m.data.jdProvided = "yes"
	m.step = ibStepJDProvided
	if next := m.nextStep(m.step); next != ibStepJDPath {
		t.Fatalf("jdProvided=yes should advance to JD-path, got %v", next)
	}
}

func TestInterviewBootstrap_JDProvidedNo_RoutesToDomain(t *testing.T) {
	// jdProvided=no flows into Domain so the proctor can type the
	// business context explicitly. With a JD, Domain is skipped.
	m := newInterviewBootstrapTeaModel(BootstrapWizardDefaults{})
	m.data.jdProvided = "no"
	m.step = ibStepJDProvided
	if next := m.nextStep(m.step); next != ibStepDomain {
		t.Fatalf("jdProvided=no should advance to Domain, got %v", next)
	}
}

func TestInterviewBootstrap_JDPath_RoutesToInfluencesProject(t *testing.T) {
	m := newInterviewBootstrapTeaModel(BootstrapWizardDefaults{})
	m.step = ibStepJDPath
	if next := m.nextStep(m.step); next != ibStepJDInfluencesProject {
		t.Fatalf("jd-path should advance to influences-project, got %v", next)
	}
}

func TestInterviewBootstrap_JDInfluencesProject_SkipsDomainGoesToFeatureSource(t *testing.T) {
	// With a JD attached, the wizard skips the Domain question.
	m := newInterviewBootstrapTeaModel(BootstrapWizardDefaults{})
	m.step = ibStepJDInfluencesProject
	if next := m.nextStep(m.step); next != ibStepFeatureSource {
		t.Fatalf("influences-project should skip Domain and advance to feature-source, got %v", next)
	}
}

func TestInterviewBootstrap_Domain_RoutesToFeatureSource(t *testing.T) {
	// When the JD branch was declined, Domain rejoins the main flow
	// at feature-source.
	m := newInterviewBootstrapTeaModel(BootstrapWizardDefaults{})
	m.step = ibStepDomain
	if next := m.nextStep(m.step); next != ibStepFeatureSource {
		t.Fatalf("domain (no-JD branch) should advance to feature-source, got %v", next)
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

// TestInterviewBootstrap_CommitSelectedIdea_WritesToFeature pins the
// either/or contract: when the proctor picks an AI-suggested idea, the
// chosen title+blurb MUST land in data.feature (the single source of
// truth for what the candidate builds). Earlier code wrote to
// data.projectPrompt and left feature blank, which left the OpenAI
// generator with an empty "Feature focus:" field and the candidate-facing
// role-config without a description. Both fields are gone now — this
// test exists so a future refactor can't reintroduce the split.
func TestInterviewBootstrap_CommitSelectedIdea_WritesToFeature(t *testing.T) {
	m := newInterviewBootstrapTeaModel(BootstrapWizardDefaults{})
	m.data.ideas = []ProjectIdea{
		{Title: "Refund retries", Blurb: "Idempotent retries with exponential backoff."},
		{Title: "Audit log", Blurb: "Append-only ledger of refund state transitions."},
	}
	m.data.ideaSelected = 1
	m.commitSelectedIdea()
	if !strings.Contains(m.data.feature, "Audit log") {
		t.Errorf("commitSelectedIdea must populate data.feature with the chosen idea; got %q", m.data.feature)
	}
	if !strings.Contains(m.data.feature, "Append-only ledger") {
		t.Errorf("commitSelectedIdea must include the blurb; got %q", m.data.feature)
	}
}

// TestInterviewBootstrap_NextStep_StackRoutesToJDProvided ensures the
// JD-provided gate sits between Stack and Domain (Domain is then asked
// only when no JD was attached).
func TestInterviewBootstrap_NextStep_StackRoutesToJDProvided(t *testing.T) {
	m := newInterviewBootstrapTeaModel(BootstrapWizardDefaults{})
	m.step = ibStepStack
	if next := m.nextStep(m.step); next != ibStepJDProvided {
		t.Fatalf("stack should advance to jd-provided, got %v", next)
	}
}

// TestInterviewBootstrap_NextStep_FeatureSourceSuggestRoutesToFetch
// pins the suggest branch — picking "Suggest ideas for me" triggers
// the spinner state, then idea-select, then time-box (rejoining the
// main flow).
func TestInterviewBootstrap_NextStep_FeatureSourceSuggestRoutesToFetch(t *testing.T) {
	m := newInterviewBootstrapTeaModel(BootstrapWizardDefaults{})
	m.data.featureSource = "suggest"
	m.step = ibStepFeatureSource
	if next := m.nextStep(m.step); next != ibStepIdeaFetching {
		t.Fatalf("featureSource=suggest should advance to idea-fetching, got %v", next)
	}
}

// TestInterviewBootstrap_NextStep_OutputDirRoutesToConfirm ensures the
// late-stage PromptSource/ProjectPrompt redundancy is gone: output-dir
// now flows straight into the confirm screen.
func TestInterviewBootstrap_NextStep_OutputDirRoutesToConfirm(t *testing.T) {
	m := newInterviewBootstrapTeaModel(BootstrapWizardDefaults{})
	m.step = ibStepOutputDir
	if next := m.nextStep(m.step); next != ibStepConfirm {
		t.Fatalf("output-dir should advance to confirm, got %v", next)
	}
}

// TestInterviewBootstrap_IdeaSelectForm_HasSentinelRow pins the
// sentinel-option contract on the idea-select form: after the real
// ideas, the form MUST expose one extra huh.Option[int] whose label
// contains "Generate a fresh set". This is how the wizard offers a
// regenerate affordance without a new keybinding or a new screen — the
// existing huh.Select takes one more row of value len(ideas).
//
// We drive the form past the real ideas with synthetic "down" key
// messages so the sentinel scrolls into the visible viewport — huh's
// View() only renders a window of options, so we can't just call
// View() and grep for the label.
func TestInterviewBootstrap_IdeaSelectForm_HasSentinelRow(t *testing.T) {
	m := newInterviewBootstrapTeaModel(BootstrapWizardDefaults{})
	m.data.ideas = []ProjectIdea{
		{Title: "Refund retries", Blurb: "Idempotent retries with backoff."},
		{Title: "Audit log", Blurb: "Append-only state transitions."},
		{Title: "Reconciliation", Blurb: "Settlement reconciliation tooling."},
	}
	m.step = ibStepIdeaSelect
	form := m.buildForm()
	if form == nil {
		t.Fatal("buildForm returned nil for ibStepIdeaSelect with non-empty ideas")
	}
	// Give huh a tall enough terminal that every option fits in the
	// rendered viewport — without this huh windows the select and only
	// shows the first 2-3 entries, so the sentinel never reaches
	// View()'s output even though it exists in the option list.
	form = form.WithHeight(20)
	_ = form.Init()
	// Press down len(ideas) times so the cursor lands on the sentinel
	// row; huh re-renders with the sentinel inside the viewport.
	for i := 0; i < len(m.data.ideas); i++ {
		next, _ := form.Update(tea.KeyMsg{Type: tea.KeyDown})
		if f, ok := next.(*huh.Form); ok {
			form = f
		}
	}
	want := "Generate a fresh set"
	view := form.View()
	if !strings.Contains(view, want) {
		t.Errorf("idea-select form view missing sentinel label %q; view:\n%s", want, view)
	}
}

// TestInterviewBootstrap_IdeaSelect_RealPickStillCommits is the
// regression guard around the upcoming sentinel branch in advance().
// When data.ideaSelected is a valid real-idea index (0..len-1), the
// existing commit-to-feature path MUST still run: the picked title +
// blurb lands in data.feature, the step advances to ibStepTimeBox per
// nextStep(), and the regenerate side-effects (rejectedTitles append,
// ideas clear) MUST NOT fire.
func TestInterviewBootstrap_IdeaSelect_RealPickStillCommits(t *testing.T) {
	m := newInterviewBootstrapTeaModel(BootstrapWizardDefaults{})
	m.data.ideas = []ProjectIdea{
		{Title: "Refund retries", Blurb: "Idempotent retries with backoff."},
		{Title: "Audit log", Blurb: "Append-only state transitions."},
	}
	m.data.ideaSelected = 0
	m.step = ibStepIdeaSelect
	_, _ = m.advance()
	if !strings.Contains(m.data.feature, "Refund retries") {
		t.Errorf("real-index pick must commit chosen title to data.feature; got %q", m.data.feature)
	}
	if m.step != ibStepTimeBox {
		t.Errorf("real-index pick should advance to time-box, got step %v", m.step)
	}
	if len(m.data.rejectedTitles) != 0 {
		t.Errorf("real-index pick must NOT append to rejectedTitles; got %v", m.data.rejectedTitles)
	}
	if len(m.data.ideas) == 0 {
		t.Errorf("real-index pick must NOT clear the ideas slice; got empty")
	}
}

// TestInterviewBootstrap_IdeaSelect_SentinelTriggersRefetch pins the
// regenerate side-effects when the manager picks the sentinel row
// (ideaSelected == len(ideas)). advance() MUST intercept before
// commitSelectedIdea fires: every current title is appended to
// rejectedTitles, the ideas slice clears, the step shunts back to
// ibStepIdeaFetching (the spinner state), and a non-nil tea.Cmd is
// returned so Bubble Tea actually kicks off the next fetch.
func TestInterviewBootstrap_IdeaSelect_SentinelTriggersRefetch(t *testing.T) {
	m := newInterviewBootstrapTeaModelWithFetcher(BootstrapWizardDefaults{}, stubIdeaFetcher{
		Ideas: []ProjectIdea{{Title: "fresh", Blurb: "x"}},
	})
	m.data.ideas = []ProjectIdea{
		{Title: "Refund retries", Blurb: "Idempotent retries with backoff."},
		{Title: "Audit log", Blurb: "Append-only state transitions."},
	}
	m.data.ideaSelected = len(m.data.ideas) // sentinel index
	m.step = ibStepIdeaSelect
	_, cmd := m.advance()
	if len(m.data.ideas) != 0 {
		t.Errorf("sentinel pick must clear data.ideas; got %d entries", len(m.data.ideas))
	}
	for _, want := range []string{"Refund retries", "Audit log"} {
		found := false
		for _, got := range m.data.rejectedTitles {
			if got == want {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("rejectedTitles missing %q; got %v", want, m.data.rejectedTitles)
		}
	}
	if m.step != ibStepIdeaFetching {
		t.Errorf("sentinel pick should land on idea-fetching, got step %v", m.step)
	}
	if cmd == nil {
		t.Errorf("sentinel pick must return a non-nil tea.Cmd to re-enter the fetch loop")
	}
}

// TestInterviewBootstrap_Regenerate_AccumulatesRejectedTitles is the
// cross-batch contract: rejectedTitles must KEEP every prior title,
// not overwrite the slice when a second sentinel pick fires. Without
// this, the third re-roll would only see the second batch's titles
// and the model could re-emit the first batch's ideas verbatim.
//
// Simulates the wizard's user flow: first batch A/B shown → sentinel;
// second batch C/D loaded → sentinel. After the second sentinel pick
// rejectedTitles must contain A, B, C, AND D.
func TestInterviewBootstrap_Regenerate_AccumulatesRejectedTitles(t *testing.T) {
	m := newInterviewBootstrapTeaModelWithFetcher(BootstrapWizardDefaults{}, stubIdeaFetcher{
		Ideas: []ProjectIdea{{Title: "fresh", Blurb: "x"}},
	})

	// First batch.
	m.data.ideas = []ProjectIdea{
		{Title: "A", Blurb: "first batch idea A"},
		{Title: "B", Blurb: "first batch idea B"},
	}
	m.data.ideaSelected = len(m.data.ideas)
	m.step = ibStepIdeaSelect
	_, _ = m.advance()

	// Simulate the new batch landing (what ideasFetchedMsg would do).
	m.data.ideas = []ProjectIdea{
		{Title: "C", Blurb: "second batch idea C"},
		{Title: "D", Blurb: "second batch idea D"},
	}
	m.data.ideaSelected = len(m.data.ideas)
	m.step = ibStepIdeaSelect
	_, _ = m.advance()

	for _, want := range []string{"A", "B", "C", "D"} {
		found := false
		for _, got := range m.data.rejectedTitles {
			if got == want {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("rejectedTitles after two regenerations missing %q; got %v", want, m.data.rejectedTitles)
		}
	}
}

// TestInterviewBootstrap_ReadJD_OnlyWhenInfluencingYes is a table-
// driven check of the two flags that gate JD inclusion in the
// idea-generation prompt. Only when BOTH the manager attached a JD
// (jdProvided="yes") AND opted to let it shape the project
// (jdInfluencesProject="yes") may the file body cross into the
// prompt. Every other combination must return the empty string so
// the downstream IdeaProfile carries an empty JobDescription and
// buildIdeaPrompt routes to the no-JD branch.
func TestInterviewBootstrap_ReadJD_OnlyWhenInfluencingYes(t *testing.T) {
	dir := t.TempDir()
	jdPath := filepath.Join(dir, "jd.md")
	const body = "About Acme: factory floor automation for tier-2 auto suppliers."
	if err := os.WriteFile(jdPath, []byte(body), 0o644); err != nil {
		t.Fatalf("seed JD file: %v", err)
	}

	cases := []struct {
		provided   string
		influences string
		wantBody   bool
	}{
		{"yes", "yes", true},
		{"yes", "no", false},
		{"yes", "", false},
		{"no", "yes", false},
		{"no", "no", false},
		{"", "yes", false},
		{"", "", false},
	}
	for _, tc := range cases {
		t.Run("provided="+tc.provided+",influences="+tc.influences, func(t *testing.T) {
			m := newInterviewBootstrapTeaModel(BootstrapWizardDefaults{})
			m.data.jdProvided = tc.provided
			m.data.jdInfluencesProject = tc.influences
			m.data.jdPath = jdPath
			got := m.readJDIfInfluencing()
			if tc.wantBody {
				if got != body {
					t.Errorf("expected JD body, got %q", got)
				}
			} else {
				if got != "" {
					t.Errorf("expected empty string, got %q", got)
				}
			}
		})
	}
}

// TestInterviewBootstrap_ReadJD_DegradesOnReadError pins the
// silent-degrade contract: a JD path that no longer resolves (file
// moved, deleted, permission revoked) must NOT propagate the read
// error up the stack. The JD is enrichment, not a hard requirement,
// and the manager should be able to complete the wizard even when
// the JD is briefly unreadable.
func TestInterviewBootstrap_ReadJD_DegradesOnReadError(t *testing.T) {
	m := newInterviewBootstrapTeaModel(BootstrapWizardDefaults{})
	m.data.jdProvided = "yes"
	m.data.jdInfluencesProject = "yes"
	m.data.jdPath = filepath.Join(t.TempDir(), "does-not-exist.md")

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("readJDIfInfluencing panicked on missing file: %v", r)
		}
	}()
	if got := m.readJDIfInfluencing(); got != "" {
		t.Errorf("expected empty string on read error, got %q", got)
	}
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
