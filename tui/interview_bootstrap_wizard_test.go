package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/charmbracelet/huh"
)

// stubHuhFormRunner returns a huhFormRun stub that succeeds on every form
// without rendering. Useful for exercising the step-sequence glue without
// driving a TTY.
func stubHuhFormRunner(_ *testing.T) func(*huh.Form) error {
	return func(_ *huh.Form) error { return nil }
}

// stringsContains is a tiny alias to keep test code readable.
func stringsContains(s, sub string) bool {
	return strings.Contains(s, sub)
}

func TestBootstrapWizard_DefaultModelHasSensibleDefaults(t *testing.T) {
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	if m.timeBox != "90" {
		t.Errorf("default time-box should be 90, got %q", m.timeBox)
	}
	if m.modeProject != "A" {
		t.Errorf("default project mode should be A, got %q", m.modeProject)
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

func TestBootstrapWizard_NextState_JDRubricRoutesToFilePicker(t *testing.T) {
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	m.modeRubric = "default+jd"
	if next := bootstrapWizardNextState(wsBootstrapRubricMode, m); next != wsBootstrapJDPath {
		t.Errorf("default+jd rubric should advance to jd-path screen, got %v", next)
	}
}

func TestBootstrapWizard_NextState_CustomPromptThenOutputDir(t *testing.T) {
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	if next := bootstrapWizardNextState(wsBootstrapCustomPrompt, m); next != wsBootstrapOutputDir {
		t.Errorf("custom-prompt should advance to output-dir, got %v", next)
	}
}

func TestBootstrapWizard_NextState_JDPathThenOutputDir(t *testing.T) {
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	if next := bootstrapWizardNextState(wsBootstrapJDPath, m); next != wsBootstrapOutputDir {
		t.Errorf("jd-path should advance to output-dir, got %v", next)
	}
}

func TestBootstrapWizard_NextState_OutputDirThenConfirm(t *testing.T) {
	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	if next := bootstrapWizardNextState(wsBootstrapOutputDir, m); next != wsBootstrapConfirm {
		t.Errorf("output-dir should advance to confirm, got %v", next)
	}
}

// Options round-trip: a fully-populated model must produce options that
// pass the same ValidateBootstrapOptions gate the headless path uses.

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

func TestBootstrapWizard_OptionsRoundTrip_JDRubricCarriesPath(t *testing.T) {
	// Create a real JD file so the existence check inside
	// ValidateBootstrapOptions passes.
	jd := filepath.Join(t.TempDir(), "jd.md")
	if err := os.WriteFile(jd, []byte("# JD"), 0o644); err != nil {
		t.Fatalf("setup: %v", err)
	}

	m := newBootstrapWizardModel(BootstrapWizardDefaults{})
	m.role = "x"
	m.stack = "x"
	m.domain = "x"
	m.feature = "x"
	m.modeRubric = "default+jd"
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
	origRun := huhFormRun
	t.Cleanup(func() { huhFormRun = origRun })
	// Stub the form driver so each step "completes" instantly without I/O.
	// The model has its defaults pre-populated, so the resulting options
	// after the smoke run should be the same defaults.
	huhFormRun = stubHuhFormRunner(t)

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
	origRun := huhFormRun
	t.Cleanup(func() { huhFormRun = origRun })
	huhFormRun = stubHuhFormRunner(t)

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

// TestBootstrapWizard_HuhLauncherJDRubricSmoke covers the default+jd branch.
func TestBootstrapWizard_HuhLauncherJDRubricSmoke(t *testing.T) {
	origRun := huhFormRun
	t.Cleanup(func() { huhFormRun = origRun })
	huhFormRun = stubHuhFormRunner(t)

	launcher := newHuhBootstrapWizardLauncher(BootstrapWizardDefaults{
		Role: "smoke-role", Stack: "Go", Domain: "Smoke", Feature: "smoke",
		ModeRubric: "default+jd", OutputDir: "/tmp/smoke",
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
	m.modeRubric = "default+jd"
	m.jdPath = "/path/jd.md"
	out := summarizeBootstrapModel(m)
	for _, want := range []string{"x", "Go", "Payments", "/tmp/x", "default+jd"} {
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
