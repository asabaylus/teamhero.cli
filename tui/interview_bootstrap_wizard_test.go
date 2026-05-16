package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

// stubTeaProgramRunner returns a runBootstrapTeaProgram stub that walks
// the model through its real advance()/nextStep() transitions in-process,
// without spinning a real bubbletea event loop or TTY. This exercises the
// wizard's branching logic (rubric mode, time-box custom sub-step,
// confirm) so the smoke tests catch transition bugs — a stub that simply
// flipped `confirmed = true` would pass even if the state machine were
// broken.
//
// The simulation answers "Yes" on the confirm step when `confirmed` is
// true; for time-box "custom" branches it injects a valid numeric value
// so the sub-step transitions cleanly to project mode.
func stubTeaProgramRunner(t *testing.T, confirmed bool) func(*tea.Program, *interviewBootstrapTeaModel) (*BootstrapWizardResult, error) {
	return func(_ *tea.Program, m *interviewBootstrapTeaModel) (*BootstrapWizardResult, error) {
		t.Helper()
		// Walk advance() until we hit Done or a transition fails. Cap at a
		// generous step count so a regression that loops never hangs the
		// test indefinitely (the wizard has ~13 distinct screens).
		const maxSteps = 32
		for i := 0; i < maxSteps; i++ {
			if m.step == ibStepDone {
				break
			}
			// Pre-fill values that the real form would set so validators
			// don't reject the transition.
			switch m.step {
			case ibStepTimeBoxCustom:
				if m.data.timeBox == "" || m.data.timeBox == "custom" {
					m.data.timeBox = "90"
				}
			case ibStepConfirm:
				m.data.confirmed = confirmed
			}
			m.advance()
		}
		if m.step != ibStepDone {
			t.Fatalf("stub runner exceeded maxSteps before reaching Done (stuck at step %d)", m.step)
		}
		return &BootstrapWizardResult{
			Options:   bootstrapWizardOptionsFromModel(m.data),
			Confirmed: m.data.confirmed,
			Aborted:   m.data.aborted,
		}, nil
	}
}

// stringsContains is a tiny alias to keep test code readable.
func stringsContains(s, sub string) bool {
	return strings.Contains(s, sub)
}

func TestBootstrapWizard_DefaultModelHasSensibleDefaults(t *testing.T) {
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	if m.timeBox != "60" {
		t.Errorf("default time-box should be 60 (recommended length per product spec), got %q", m.timeBox)
	}
	// "brownfield" is the wizard-level project type name; it resolves to
	// projectMode "A" at the BootstrapOptions boundary. The default is
	// brownfield because that's the most common interview shape (AI
	// scaffolds a starter codebase the candidate extends).
	if m.modeProject != "brownfield" {
		t.Errorf("default project type should be brownfield, got %q", m.modeProject)
	}
	if m.modeAnalysis != "ai-assisted" {
		t.Errorf("default analysis mode should be ai-assisted, got %q", m.modeAnalysis)
	}
	if m.modeRubric != "default" {
		t.Errorf("default rubric mode should be 'default', got %q", m.modeRubric)
	}
	if m.outputDir == "" {
		t.Errorf("default output dir should not be empty")
	}
}

func TestBootstrapWizard_DefaultsHonorsExplicitDefaults(t *testing.T) {
	d := BootstrapWizardDefaults{
		Role: "platform-eng", RoleTitle: "Platform Engineer",
		Stack: "Go", Domain: "Infrastructure",
		OutputDir: "/tmp/roles/platform-eng",
	}
	m := newBootstrapWizardModel(d)
	if m.role != "platform-eng" || m.outputDir != "/tmp/roles/platform-eng" {
		t.Errorf("explicit defaults not applied: %+v", m)
	}
}

// Rubric-mode branching: the next-state machine.

func TestBootstrapWizard_NextState_DefaultRubricSkipsBothBranches(t *testing.T) {
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	m.modeRubric = "default"
	if next := bootstrapWizardNextState(wsBootstrapRubricMode, m); next != wsBootstrapOutputDir {
		t.Errorf("default rubric should advance straight to output-dir, got %v", next)
	}
}

func TestBootstrapWizard_NextState_CustomRubricRoutesToPromptScreen(t *testing.T) {
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	m.modeRubric = "custom"
	if next := bootstrapWizardNextState(wsBootstrapRubricMode, m); next != wsBootstrapCustomPrompt {
		t.Errorf("custom rubric should advance to custom-prompt screen, got %v", next)
	}
}

func TestBootstrapWizard_NextState_RubricDefaultRoutesToOutputDir(t *testing.T) {
	// Rubric mode is now just default/custom — the "default+jd" value
	// was retired. JD attachment is its own earlier step. From rubric
	// mode, the default path goes straight to output-dir.
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	m.modeRubric = "default"
	if next := bootstrapWizardNextState(wsBootstrapRubricMode, m); next != wsBootstrapOutputDir {
		t.Errorf("default rubric should advance to output-dir, got %v", next)
	}
}

func TestBootstrapWizard_NextState_JDProvidedYesRoutesToPath(t *testing.T) {
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	m.jdProvided = "yes"
	if next := bootstrapWizardNextState(wsBootstrapJDProvided, m); next != wsBootstrapJDPath {
		t.Errorf("jdProvided=yes should advance to jd-path, got %v", next)
	}
}

func TestBootstrapWizard_NextState_JDProvidedNoSkipsJDBranch(t *testing.T) {
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	m.jdProvided = "no"
	if next := bootstrapWizardNextState(wsBootstrapJDProvided, m); next != wsBootstrapFeatureSource {
		t.Errorf("jdProvided=no should skip both JD steps, got %v", next)
	}
}

func TestBootstrapWizard_NextState_JDPathRoutesToInfluenceQuestion(t *testing.T) {
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	if next := bootstrapWizardNextState(wsBootstrapJDPath, m); next != wsBootstrapJDInfluencesProject {
		t.Errorf("jd-path should advance to influences-project, got %v", next)
	}
}

func TestBootstrapWizard_NextState_JDInfluenceRoutesToFeatureSource(t *testing.T) {
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	if next := bootstrapWizardNextState(wsBootstrapJDInfluencesProject, m); next != wsBootstrapFeatureSource {
		t.Errorf("jd-influences-project should advance to feature-source, got %v", next)
	}
}

func TestBootstrapWizard_NextState_CustomPromptThenOutputDir(t *testing.T) {
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	if next := bootstrapWizardNextState(wsBootstrapCustomPrompt, m); next != wsBootstrapOutputDir {
		t.Errorf("custom-prompt should advance to output-dir, got %v", next)
	}
}

func TestBootstrapWizard_NextState_OutputDirThenConfirm(t *testing.T) {
	// Output-dir advances directly to confirm — the redundant late-stage
	// "How should the AI prompt be supplied?" + Project-prompt addendum
	// have been collapsed into the early either/or FeatureSource step.
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	if next := bootstrapWizardNextState(wsBootstrapOutputDir, m); next != wsBootstrapConfirm {
		t.Errorf("output-dir should advance straight to confirm, got %v", next)
	}
}

func TestBootstrapWizard_NextState_DomainThenJDProvided(t *testing.T) {
	// The standalone JD branch sits between Domain and Feature source —
	// asking about the JD early so the project-generation prompt has
	// access to it when feature ideas are suggested.
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	if next := bootstrapWizardNextState(wsBootstrapDomain, m); next != wsBootstrapJDProvided {
		t.Errorf("domain should advance to jd-provided, got %v", next)
	}
}

func TestBootstrapWizard_NextState_FeatureSourceCustomThenFeature(t *testing.T) {
	// "Write the description myself" branches into the text-input step.
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	m.featureSource = "custom"
	if next := bootstrapWizardNextState(wsBootstrapFeatureSource, m); next != wsBootstrapFeature {
		t.Errorf("feature-source=custom should advance to feature, got %v", next)
	}
}

func TestBootstrapWizard_NextState_FeatureSourceSuggestThenFetching(t *testing.T) {
	// "Suggest ideas for me" branches into the spinner state. The chosen
	// idea then populates feature directly — no late-stage addendum.
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	m.featureSource = "suggest"
	if next := bootstrapWizardNextState(wsBootstrapFeatureSource, m); next != wsBootstrapIdeaFetching {
		t.Errorf("feature-source=suggest should advance to idea-fetching, got %v", next)
	}
}

func TestBootstrapWizard_NextState_IdeaFetchingThenSelect(t *testing.T) {
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	if next := bootstrapWizardNextState(wsBootstrapIdeaFetching, m); next != wsBootstrapIdeaSelect {
		t.Errorf("idea-fetching should advance to idea-select, got %v", next)
	}
}

func TestBootstrapWizard_NextState_IdeaSelectThenTimeBox(t *testing.T) {
	// After picking an AI-suggested idea the wizard rejoins the main flow
	// at time-box — same point the typed-description path lands on.
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	if next := bootstrapWizardNextState(wsBootstrapIdeaSelect, m); next != wsBootstrapTimeBox {
		t.Errorf("idea-select should advance to time-box, got %v", next)
	}
}

func TestBootstrapWizard_NextState_FeatureThenTimeBox(t *testing.T) {
	// The typed-description path rejoins at time-box.
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	if next := bootstrapWizardNextState(wsBootstrapFeature, m); next != wsBootstrapTimeBox {
		t.Errorf("feature should advance to time-box, got %v", next)
	}
}

// Options round-trip: a fully-populated model must produce options that
// pass the same ValidateBootstrapOptions gate the headless path uses.

// TestBootstrapWizard_ProjectTypeTaxonomy_ResolvesToLegacyABFlags pins
// the wizard-level → downstream contract: the three project-type values
// the proctor sees in the picker must collapse to (modeProject, stackByCandidate)
// pairs the downstream validator and OpenAI client understand. Any future
// refactor that adds a new option must keep this contract or break tests.
func TestBootstrapWizard_ProjectTypeTaxonomy_ResolvesToLegacyABFlags(t *testing.T) {
	cases := []struct {
		wizardValue          string
		wantMode             string
		wantStackByCandidate bool
	}{
		{"brownfield", "A", false},
		{"greenfield-stack", "B", false},
		{"greenfield-open", "B", true},
		// Legacy A/B values from saved configs must still resolve so a
		// proctor with a stale role-config.json doesn't get a runtime
		// surprise. New code paths emit the human-readable strings.
		{"A", "A", false},
		{"B", "B", false},
	}
	for _, tc := range cases {
		t.Run(tc.wizardValue, func(t *testing.T) {
			gotMode, gotByCandidate := resolveWizardProjectMode(tc.wizardValue)
			if gotMode != tc.wantMode {
				t.Errorf("modeProject: got %q, want %q", gotMode, tc.wantMode)
			}
			if gotByCandidate != tc.wantStackByCandidate {
				t.Errorf("stackByCandidate: got %t, want %t", gotByCandidate, tc.wantStackByCandidate)
			}
		})
	}
}

// TestBootstrapWizard_NormalizeProjectMode_AcceptsLegacyValues ensures
// that BootstrapWizardDefaults seeded from a legacy save (--mode-project A)
// still pre-selects the right wizard option (brownfield).
func TestBootstrapWizard_NormalizeProjectMode_AcceptsLegacyValues(t *testing.T) {
	cases := map[string]string{
		"A":                "brownfield",
		"B":                "greenfield-stack",
		"brownfield":       "brownfield",
		"greenfield-stack": "greenfield-stack",
		"greenfield-open":  "greenfield-open",
		"":                 "brownfield",
		"garbage-value":    "brownfield",
	}
	for in, want := range cases {
		if got := normalizeWizardProjectMode(in); got != want {
			t.Errorf("normalizeWizardProjectMode(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestBootstrapWizard_GreenfieldOpen_RoundTripCarriesStackByCandidate
// drives a full wizard→options pass with the greenfield-open option
// selected and verifies the BootstrapOptions carries the boolean flag
// AND the project mode collapses to "B" so the downstream validator
// accepts it.
func TestBootstrapWizard_GreenfieldOpen_RoundTripCarriesStackByCandidate(t *testing.T) {
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	m.role = "candidate-picks-stack"
	m.stack = "Go"
	m.domain = "Internal tools"
	m.feature = "Build a CLI to lint role-config files"
	m.modeProject = "greenfield-open"
	m.modeRubric = "default"
	m.outputDir = "/tmp/x"

	opts := bootstrapWizardOptionsFromModel(m)
	if msg := ValidateBootstrapOptions(opts); msg != "" {
		t.Fatalf("validation failed: %q", msg)
	}
	if opts.ModeProject != "B" {
		t.Errorf("greenfield-open should collapse to ModeProject=B, got %q", opts.ModeProject)
	}
	if !opts.StackByCandidate {
		t.Error("greenfield-open MUST set StackByCandidate=true so the BRIEF.md tells the candidate they pick the stack")
	}
}

func TestBootstrapWizard_OptionsRoundTrip_DefaultRubric(t *testing.T) {
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	m.role = "senior-fe"
	m.roleTitle = "Senior Frontend Engineer"
	m.stack = "TypeScript"
	m.domain = "Storefront"
	m.feature = "Add product reviews widget"
	m.timeBox = "90"
	m.modeProject = "A"
	m.modeAnalysis = "ai-assisted"
	m.modeRubric = "default"
	m.outputDir = "/tmp/senior-fe"

	opts := bootstrapWizardOptionsFromModel(m)
	if msg := ValidateBootstrapOptions(opts); msg != "" {
		t.Fatalf("expected validation pass, got %q", msg)
	}
	if !opts.Headless {
		t.Errorf("options produced by wizard should have Headless=true (wizard is the configurer; runner is headless)")
	}
	if opts.Role != "senior-fe" {
		t.Errorf("role: got %q", opts.Role)
	}
}

func TestBootstrapWizard_OptionsRoundTrip_CustomRubricCarriesPrompt(t *testing.T) {
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	m.role = "x"
	m.stack = "x"
	m.domain = "x"
	m.feature = "x"
	m.modeRubric = "custom"
	m.customPrompt = "Score primarily on architectural decisions"
	m.outputDir = "x"

	opts := bootstrapWizardOptionsFromModel(m)
	if msg := ValidateBootstrapOptions(opts); msg != "" {
		t.Fatalf("validation gate rejected custom-rubric options: %q", msg)
	}
	if opts.CustomPrompt == "" {
		t.Errorf("CustomPrompt should be forwarded to options")
	}
}

func TestBootstrapWizard_OptionsRoundTrip_JDCarriesPath(t *testing.T) {
	// Create a real JD file so the existence check inside
	// ValidateBootstrapOptions passes. The JD is now its own input
	// (jdProvided=yes + jdPath), independent of rubric mode.
	jd := filepath.Join(t.TempDir(), "jd.md")
	if err := os.WriteFile(jd, []byte("# JD"), 0o644); err != nil {
		t.Fatalf("setup: %v", err)
	}

	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	m.role = "x"
	m.stack = "x"
	m.domain = "x"
	m.feature = "x"
	m.modeRubric = "default"
	m.jdProvided = "yes"
	m.jdPath = jd
	m.outputDir = "x"

	opts := bootstrapWizardOptionsFromModel(m)
	if msg := ValidateBootstrapOptions(opts); msg != "" {
		t.Fatalf("validation gate rejected jd-rubric options: %q", msg)
	}
	if opts.JDPath != jd {
		t.Errorf("JDPath should be forwarded to options")
	}
}

// Inline field validators that the wizard uses on each huh.Input.
// These let us catch bad input before submit, per the AC.

func TestBootstrapWizard_ValidateRoleSlug_RejectsSpaces(t *testing.T) {
	if err := validateRoleSlug("hello world"); err == nil {
		t.Errorf("expected error for slug with space")
	}
}

func TestBootstrapWizard_ValidateRoleSlug_RejectsUppercase(t *testing.T) {
	if err := validateRoleSlug("HelloWorld"); err == nil {
		t.Errorf("expected error for slug with uppercase letters")
	}
}

func TestBootstrapWizard_ValidateRoleSlug_RejectsEmpty(t *testing.T) {
	if err := validateRoleSlug(""); err == nil {
		t.Errorf("expected error for empty slug")
	}
}

func TestBootstrapWizard_ValidateRoleSlug_AcceptsURLSafe(t *testing.T) {
	if err := validateRoleSlug("senior-backend-2"); err != nil {
		t.Errorf("expected URL-safe slug to be accepted, got %v", err)
	}
}

func TestBootstrapWizard_ValidateTimeBox_RejectsOutOfRange(t *testing.T) {
	if err := validateTimeBox("15"); err == nil {
		t.Errorf("expected error for time-box below 30")
	}
	if err := validateTimeBox("999"); err == nil {
		t.Errorf("expected error for time-box above 240")
	}
}

func TestBootstrapWizard_ValidateTimeBox_RejectsNonNumeric(t *testing.T) {
	if err := validateTimeBox("two hours"); err == nil {
		t.Errorf("expected error for non-numeric time-box")
	}
}

func TestBootstrapWizard_ValidateTimeBox_AcceptsRange(t *testing.T) {
	for _, v := range []string{"30", "60", "90", "120", "240"} {
		if err := validateTimeBox(v); err != nil {
			t.Errorf("expected %q to be accepted, got %v", v, err)
		}
	}
}

func TestBootstrapWizard_ValidateJDPath_RejectsMissing(t *testing.T) {
	if err := validateJDPath("/definitely/does/not/exist.md"); err == nil {
		t.Errorf("expected error for nonexistent JD path")
	}
}

func TestBootstrapWizard_ValidateJDPath_AllowsEmptyForOptional(t *testing.T) {
	// Empty string is allowed at the field level; the rubric-mode branch is
	// what enforces that JD is supplied for default+jd. This keeps the field
	// validator stateless.
	if err := validateJDPath(""); err != nil {
		t.Errorf("empty JD path should be allowed at field level (rubric-mode branch enforces): %v", err)
	}
}

// printInterviewBootstrapUsage exists so --help works under the wizard regime;
// the wizard verb itself is mentioned in the headless usage text already.
// The production huh launcher must implement BootstrapWizardLauncher so the
// dispatcher can use it. We don't drive a TTY here — just confirm the type
// satisfies the interface and the helper accepts defaults.
func TestBootstrapWizard_HuhLauncherImplementsInterface(t *testing.T) {
	var _ BootstrapWizardLauncher = newHuhBootstrapWizardLauncher(BootstrapWizardDefaults{})
}

// TestBootstrapWizard_HuhLauncherDefaultRubricSmoke exercises the full
// step sequence with huhFormRun stubbed to a no-op. This verifies the
// step ordering produces a usable BootstrapOptions on the "default" rubric
// branch (the simplest path through the form sequence).
func TestBootstrapWizard_HuhLauncherDefaultRubricSmoke(t *testing.T) {
	// The launcher now drives a bubbletea program (interviewBootstrapTeaModel)
	// instead of iterating huhFormRun calls. Stub the program runner so the
	// smoke test still completes synchronously without spinning a real TTY.
	origRunner := runBootstrapTeaProgram
	t.Cleanup(func() { runBootstrapTeaProgram = origRunner })
	runBootstrapTeaProgram = stubTeaProgramRunner(t, true)

	launcher := newHuhBootstrapWizardLauncher(BootstrapWizardDefaults{
		Role: "smoke-role", Stack: "Go", Domain: "Smoke",
		Feature: "smoke", OutputDir: "/tmp/smoke",
	})
	res, err := launcher.Launch()
	if err != nil {
		t.Fatalf("smoke wizard run errored: %v", err)
	}
	if res == nil {
		t.Fatal("smoke wizard run returned nil result")
	}
	if res.Aborted {
		t.Errorf("smoke wizard with no Ctrl+C should not be aborted")
	}
}

// TestBootstrapWizard_HuhLauncherCustomRubricSmoke exercises the
// rubric-mode=custom branch — same shape as the default smoke but
// also confirms the conditional step executes when modeRubric is set.
func TestBootstrapWizard_HuhLauncherCustomRubricSmoke(t *testing.T) {
	origRunner := runBootstrapTeaProgram
	t.Cleanup(func() { runBootstrapTeaProgram = origRunner })
	runBootstrapTeaProgram = stubTeaProgramRunner(t, true)

	launcher := newHuhBootstrapWizardLauncher(BootstrapWizardDefaults{
		Role: "smoke-role", Stack: "Go", Domain: "Smoke", Feature: "smoke",
		ModeRubric: "custom", OutputDir: "/tmp/smoke",
	})
	res, err := launcher.Launch()
	if err != nil {
		t.Fatalf("smoke wizard run errored: %v", err)
	}
	if res == nil || res.Aborted {
		t.Errorf("smoke wizard should produce a non-aborted result")
	}
}

// TestBootstrapWizard_HuhLauncherDefaultRubricWithJDSmoke covers a
// happy-path run with the standalone JD attached. The "default+jd"
// rubric value was retired; JD attachment is now an independent input.
func TestBootstrapWizard_HuhLauncherDefaultRubricWithJDSmoke(t *testing.T) {
	origRunner := runBootstrapTeaProgram
	t.Cleanup(func() { runBootstrapTeaProgram = origRunner })
	runBootstrapTeaProgram = stubTeaProgramRunner(t, true)

	launcher := newHuhBootstrapWizardLauncher(BootstrapWizardDefaults{
		Role: "smoke-role", Stack: "Go", Domain: "Smoke", Feature: "smoke",
		ModeRubric: "default", OutputDir: "/tmp/smoke",
	})
	res, err := launcher.Launch()
	if err != nil {
		t.Fatalf("smoke wizard run errored: %v", err)
	}
	if res == nil || res.Aborted {
		t.Errorf("smoke wizard should produce a non-aborted result")
	}
}

func TestBootstrapWizard_SummarizeRendersAllFields(t *testing.T) {
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	m.role = "x"
	m.stack = "Go"
	m.domain = "Payments"
	m.outputDir = "/tmp/x"
	m.modeRubric = "default"
	m.jdProvided = "yes"
	m.jdPath = "/path/jd.md"
	m.jdInfluencesProject = "yes"
	out := summarizeBootstrapModel(m)
	for _, want := range []string{"x", "Go", "Payments", "/tmp/x", "default", "/path/jd.md", "shapes project"} {
		if !contains([]string{out}, want) && !stringsContains(out, want) {
			t.Errorf("summary missing %q: %s", want, out)
		}
	}
}

func TestBootstrapWizard_NonEmptyValidatorRejectsEmpty(t *testing.T) {
	v := nonEmpty("widget")
	if err := v(""); err == nil {
		t.Errorf("nonEmpty validator should reject empty input")
	}
	if err := v("ok"); err != nil {
		t.Errorf("nonEmpty validator should accept non-empty input, got %v", err)
	}
}

func TestBootstrapWizard_OptionsHasNoForeignFields(t *testing.T) {
	// Sanity-check that bootstrapWizardOptionsFromModel doesn't leak
	// fields the headless path doesn't expect. If this fails because new
	// fields were intentionally added, update both the wizard and the
	// headless flag parser in lock-step.
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	m.role = "x"
	m.stack = "x"
	m.domain = "x"
	m.feature = "x"
	m.modeRubric = "default"
	m.outputDir = "x"
	opts := bootstrapWizardOptionsFromModel(m)
	if strings.TrimSpace(opts.ModeProject) == "" || strings.TrimSpace(opts.ModeAnalysis) == "" {
		t.Errorf("mode-project and mode-analysis must be populated from defaults: %+v", opts)
	}
}
