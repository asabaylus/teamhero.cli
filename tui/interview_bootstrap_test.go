package main

import (
	"bytes"
	"io"
	"strings"
	"testing"
)

func TestParseBootstrapFlags_AllFlags(t *testing.T) {
	args := []string{
		"--headless",
		"--no-confirm",
		"--foreground",
		"--role", "senior-backend",
		"--role-title", "Senior Backend Engineer",
		"--stack", "TypeScript",
		"--domain", "Payments",
		"--feature", "Add idempotency keys",
		"--time-box", "90",
		"--mode-project", "A",
		"--mode-analysis", "ai-assisted",
		"--mode-rubric", "default",
		"--output-dir", "./roles/senior-backend",
	}
	opts, parseErr := ParseBootstrapFlags(args)
	if parseErr != "" {
		t.Fatalf("unexpected parse error: %s", parseErr)
	}
	if opts.Role != "senior-backend" {
		t.Errorf("role: got %q", opts.Role)
	}
	if !opts.Headless || !opts.NoConfirm || !opts.Foreground {
		t.Errorf("boolean flags not parsed: %+v", opts)
	}
	if opts.TimeBox != "90" {
		t.Errorf("time-box: got %q", opts.TimeBox)
	}
}

func TestParseBootstrapFlags_MissingValueErrors(t *testing.T) {
	_, parseErr := ParseBootstrapFlags([]string{"--role"})
	if parseErr == "" {
		t.Fatal("expected parse error on dangling --role")
	}
}

func TestParseBootstrapFlags_DebugFlag(t *testing.T) {
	// --debug toggles verbose run-context logging in both the dispatcher
	// (Go side) and the bun subprocess. Off by default.
	opts, parseErr := ParseBootstrapFlags([]string{"--debug"})
	if parseErr != "" {
		t.Fatalf("unexpected parse error: %s", parseErr)
	}
	if !opts.Debug {
		t.Error("--debug should set Debug=true")
	}
	// Short form -d works the same way.
	opts2, parseErr2 := ParseBootstrapFlags([]string{"-d"})
	if parseErr2 != "" {
		t.Fatalf("unexpected parse error for -d: %s", parseErr2)
	}
	if !opts2.Debug {
		t.Error("-d should set Debug=true")
	}
}

func TestParseBootstrapFlags_UnknownFlagErrors(t *testing.T) {
	_, parseErr := ParseBootstrapFlags([]string{"--what-is-this"})
	if parseErr == "" {
		t.Fatal("expected parse error on unknown flag")
	}
}

func TestValidateBootstrapOptions_RejectsMissingRequired(t *testing.T) {
	opts := &BootstrapOptions{
		Role:         "x",
		Stack:        "x",
		ModeProject:  "A",
		ModeAnalysis: "ai-assisted",
		ModeRubric:   "default",
		OutputDir:    "x",
		// missing Domain and Feature
	}
	if msg := ValidateBootstrapOptions(opts); msg == "" {
		t.Fatal("expected validation error on missing fields")
	}
}

func TestValidateBootstrapOptions_RejectsBadModeProject(t *testing.T) {
	opts := &BootstrapOptions{
		Role: "x", Stack: "x", Domain: "x", Feature: "x", OutputDir: "x",
		ModeProject: "C", ModeAnalysis: "ai-assisted", ModeRubric: "default",
	}
	if msg := ValidateBootstrapOptions(opts); msg == "" {
		t.Fatal("expected validation error on bad mode-project")
	}
}

func TestValidateBootstrapOptions_CustomRubricRequiresPrompt(t *testing.T) {
	opts := &BootstrapOptions{
		Role: "x", Stack: "x", Domain: "x", Feature: "x", OutputDir: "x",
		ModeProject: "A", ModeAnalysis: "ai-assisted", ModeRubric: "custom",
	}
	if msg := ValidateBootstrapOptions(opts); msg == "" {
		t.Fatal("expected validation error on missing custom prompt")
	}
}

func TestValidateBootstrapOptions_JDRubricRequiresPath(t *testing.T) {
	opts := &BootstrapOptions{
		Role: "x", Stack: "x", Domain: "x", Feature: "x", OutputDir: "x",
		ModeProject: "A", ModeAnalysis: "ai-assisted", ModeRubric: "default+jd",
	}
	if msg := ValidateBootstrapOptions(opts); msg == "" {
		t.Fatal("expected validation error on missing jd-path")
	}
}

func TestValidateBootstrapOptions_HappyPath(t *testing.T) {
	opts := &BootstrapOptions{
		Role: "x", Stack: "x", Domain: "x", Feature: "x", OutputDir: "x",
		ModeProject: "A", ModeAnalysis: "ai-assisted", ModeRubric: "default",
	}
	if msg := ValidateBootstrapOptions(opts); msg != "" {
		t.Fatalf("expected validation pass, got: %s", msg)
	}
}

type stubRunner struct {
	gotOpts *BootstrapOptions
	code    int
}

func (s *stubRunner) Run(opts *BootstrapOptions, _, _ io.Writer) int {
	s.gotOpts = opts
	return s.code
}

func TestRunInterviewBootstrap_RequiresHeadlessForNow(t *testing.T) {
	var out, errBuf bytes.Buffer
	stub := &stubRunner{code: 0}
	code := runInterviewBootstrap([]string{
		"--role", "x", "--stack", "x", "--domain", "x", "--feature", "x",
		"--mode-project", "A", "--mode-analysis", "ai-assisted",
		"--mode-rubric", "default", "--output-dir", "x",
	}, stub, &out, &errBuf)
	if code == 0 {
		t.Error("expected non-zero exit without --headless")
	}
	if !strings.Contains(errBuf.String(), "headless") {
		t.Errorf("expected message about --headless, got: %s", errBuf.String())
	}
}

func TestRunInterviewBootstrap_DelegatesToRunner(t *testing.T) {
	var out, errBuf bytes.Buffer
	stub := &stubRunner{code: 0}
	code := runInterviewBootstrap([]string{
		"--headless",
		"--role", "x", "--stack", "x", "--domain", "x", "--feature", "x",
		"--mode-project", "A", "--mode-analysis", "ai-assisted",
		"--mode-rubric", "default", "--output-dir", "x",
	}, stub, &out, &errBuf)
	if code != 0 {
		t.Errorf("expected exit 0 from stub, got %d (stderr: %s)", code, errBuf.String())
	}
	if stub.gotOpts == nil {
		t.Fatal("runner not called")
	}
	if stub.gotOpts.Role != "x" {
		t.Errorf("runner saw role=%q", stub.gotOpts.Role)
	}
}

func TestRunInterviewBootstrap_ForwardsRunnerExitCode(t *testing.T) {
	var out, errBuf bytes.Buffer
	stub := &stubRunner{code: 7}
	code := runInterviewBootstrap([]string{
		"--headless",
		"--role", "x", "--stack", "x", "--domain", "x", "--feature", "x",
		"--mode-project", "A", "--mode-analysis", "ai-assisted",
		"--mode-rubric", "default", "--output-dir", "x",
	}, stub, &out, &errBuf)
	if code != 7 {
		t.Errorf("expected exit 7 forwarded from runner, got %d", code)
	}
}

// withPublishHooks installs no-op replacements for offerPublishToGitHub and
// isStdinTTY for the duration of a test. The cleanup runs on teardown so
// later tests see the production behavior.
func withPublishHooks(t *testing.T, tty bool, onPublish func(opts *BootstrapOptions)) {
	t.Helper()
	origPublish := offerPublishToGitHub
	origTTY := isStdinTTY
	t.Cleanup(func() {
		offerPublishToGitHub = origPublish
		isStdinTTY = origTTY
	})
	offerPublishToGitHub = func(opts *BootstrapOptions, _, _ io.Writer) {
		if onPublish != nil {
			onPublish(opts)
		}
	}
	isStdinTTY = func() bool { return tty }
}

func TestRunInterviewBootstrap_PrintsSuccessLinkOnZeroExit(t *testing.T) {
	withPublishHooks(t, false, nil) // non-TTY so publish stays out of the way
	var out, errBuf bytes.Buffer
	stub := &stubRunner{code: 0}
	code := runInterviewBootstrap([]string{
		"--headless",
		"--role", "x", "--stack", "x", "--domain", "x", "--feature", "x",
		"--mode-project", "A", "--mode-analysis", "ai-assisted",
		"--mode-rubric", "default", "--output-dir", "/tmp/teamhero-test",
	}, stub, &out, &errBuf)
	if code != 0 {
		t.Fatalf("exit=%d stderr=%s", code, errBuf.String())
	}
	got := out.String()
	if !strings.Contains(got, "/tmp/teamhero-test") {
		t.Errorf("stdout missing output-dir path; got: %q", got)
	}
	// OSC 8 envelope: ESC ] 8 ; ; <url> ESC \   ...   ESC ] 8 ; ; ESC \
	if !strings.Contains(got, "\x1b]8;;file://") {
		t.Errorf("stdout should wrap path in an OSC 8 file:// hyperlink; got: %q", got)
	}
}

func TestRunInterviewBootstrap_OffersPublishWhenTTY(t *testing.T) {
	called := false
	withPublishHooks(t, true, func(opts *BootstrapOptions) {
		called = true
		if opts.OutputDir != "/tmp/teamhero-test" {
			t.Errorf("publish saw output-dir %q", opts.OutputDir)
		}
	})
	var out, errBuf bytes.Buffer
	stub := &stubRunner{code: 0}
	runInterviewBootstrap([]string{
		"--headless",
		"--role", "x", "--stack", "x", "--domain", "x", "--feature", "x",
		"--mode-project", "A", "--mode-analysis", "ai-assisted",
		"--mode-rubric", "default", "--output-dir", "/tmp/teamhero-test",
	}, stub, &out, &errBuf)
	if !called {
		t.Error("offerPublishToGitHub should be invoked when stdin is a TTY and --no-confirm is absent")
	}
}

func TestRunInterviewBootstrap_SkipsPublishWhenNoConfirm(t *testing.T) {
	called := false
	withPublishHooks(t, true, func(*BootstrapOptions) { called = true })
	var out, errBuf bytes.Buffer
	stub := &stubRunner{code: 0}
	runInterviewBootstrap([]string{
		"--headless", "--no-confirm",
		"--role", "x", "--stack", "x", "--domain", "x", "--feature", "x",
		"--mode-project", "A", "--mode-analysis", "ai-assisted",
		"--mode-rubric", "default", "--output-dir", "/tmp/teamhero-test",
	}, stub, &out, &errBuf)
	if called {
		t.Error("publish must NOT prompt when --no-confirm is set")
	}
}

func TestRunInterviewBootstrap_SkipsPublishWhenNotTTY(t *testing.T) {
	called := false
	withPublishHooks(t, false, func(*BootstrapOptions) { called = true })
	var out, errBuf bytes.Buffer
	stub := &stubRunner{code: 0}
	runInterviewBootstrap([]string{
		"--headless",
		"--role", "x", "--stack", "x", "--domain", "x", "--feature", "x",
		"--mode-project", "A", "--mode-analysis", "ai-assisted",
		"--mode-rubric", "default", "--output-dir", "/tmp/teamhero-test",
	}, stub, &out, &errBuf)
	if called {
		t.Error("publish must NOT prompt on non-TTY stdin (CI, piped)")
	}
}

func TestApplyBootstrapDefaults_FillsOutputDirFromRole(t *testing.T) {
	opts := &BootstrapOptions{Role: "senior-frontend"}
	applyBootstrapDefaults(opts)
	want := "interviews/senior-frontend"
	if opts.OutputDir != want {
		t.Errorf("OutputDir = %q, want %q", opts.OutputDir, want)
	}
}

func TestApplyBootstrapDefaults_DoesNotOverrideExplicitOutputDir(t *testing.T) {
	opts := &BootstrapOptions{Role: "senior-frontend", OutputDir: "/tmp/custom"}
	applyBootstrapDefaults(opts)
	if opts.OutputDir != "/tmp/custom" {
		t.Errorf("explicit --output-dir must win; got %q", opts.OutputDir)
	}
}

func TestApplyBootstrapDefaults_LeavesOutputDirEmptyWhenRoleMissing(t *testing.T) {
	// If --role wasn't supplied, validation will reject the run regardless
	// of OutputDir, so leaving it empty surfaces the missing-role error
	// instead of producing a misleading "./interviews/<empty>" path.
	opts := &BootstrapOptions{}
	applyBootstrapDefaults(opts)
	if opts.OutputDir != "" {
		t.Errorf("OutputDir should remain empty when Role is missing; got %q", opts.OutputDir)
	}
}

func TestApplyBootstrapDefaults_FillsTimeBoxWhenMissing(t *testing.T) {
	opts := &BootstrapOptions{Role: "x"}
	applyBootstrapDefaults(opts)
	if opts.TimeBox != "60" {
		t.Errorf("TimeBox default should be 60 minutes; got %q", opts.TimeBox)
	}
}

func TestApplyBootstrapDefaults_DoesNotOverrideExplicitTimeBox(t *testing.T) {
	opts := &BootstrapOptions{Role: "x", TimeBox: "120"}
	applyBootstrapDefaults(opts)
	if opts.TimeBox != "120" {
		t.Errorf("explicit --time-box must win; got %q", opts.TimeBox)
	}
}

func TestApplyBootstrapDefaults_FillsKitDirSoScaffoldingAlwaysShipsToCandidate(t *testing.T) {
	// Reported gap: proctors who forgot --kit-dir got the AI-generated
	// project but none of the kit scaffolding (start/end scripts,
	// INTERVIEW_RULES.md, AGENTS.md, PRIVACY_RELEASE.md, .claude/). The
	// recording workflow depends on those files, so the default must
	// always point at the canonical kit directory.
	opts := &BootstrapOptions{Role: "x"}
	applyBootstrapDefaults(opts)
	if opts.KitDir != "teamhero-interview-kit" {
		t.Errorf("KitDir default should be 'teamhero-interview-kit'; got %q", opts.KitDir)
	}
}

func TestApplyBootstrapDefaults_DoesNotOverrideExplicitKitDir(t *testing.T) {
	opts := &BootstrapOptions{Role: "x", KitDir: "/opt/custom-kit"}
	applyBootstrapDefaults(opts)
	if opts.KitDir != "/opt/custom-kit" {
		t.Errorf("explicit --kit-dir must win; got %q", opts.KitDir)
	}
}

func TestApplyBootstrapDefaults_NilSafe(t *testing.T) {
	// Defensive: panicking on a nil opts pointer would crash production
	// callers that wire applyBootstrapDefaults into hot paths without an
	// explicit nil check.
	applyBootstrapDefaults(nil)
}

func TestRunInterviewBootstrap_AllowsOmittedOutputDirAndTimeBox(t *testing.T) {
	// End-to-end: the dispatcher should fill in --output-dir from --role
	// and --time-box from the 60-min default, then validation should pass
	// (it would previously fail with "missing required flag --output-dir").
	withPublishHooks(t, false, nil)
	var out, errBuf bytes.Buffer
	var seen *BootstrapOptions
	stub := &stubRunner{code: 0}
	// Capture what the runner sees so we can assert defaults made it through.
	origRunner := stub
	wrapped := &captureRunner{inner: origRunner, sink: &seen}
	code := runInterviewBootstrap([]string{
		"--headless",
		"--role", "senior-frontend",
		"--stack", "React", "--domain", "B2B", "--feature", "timeline",
		"--mode-project", "A", "--mode-analysis", "ai-assisted",
		"--mode-rubric", "default",
		// Note: --output-dir and --time-box intentionally omitted.
	}, wrapped, &out, &errBuf)
	if code != 0 {
		t.Fatalf("exit=%d stderr=%s", code, errBuf.String())
	}
	if seen == nil {
		t.Fatal("runner not called")
	}
	if seen.OutputDir != "interviews/senior-frontend" {
		t.Errorf("default OutputDir = %q, want interviews/senior-frontend", seen.OutputDir)
	}
	if seen.TimeBox != "60" {
		t.Errorf("default TimeBox = %q, want 60", seen.TimeBox)
	}
}

// captureRunner records the BootstrapOptions the dispatcher passes through
// after applyBootstrapDefaults runs, then forwards to an inner runner so
// the rest of the dispatcher's post-success flow (link + publish) still
// fires. stubRunner already captures via gotOpts, but the dispatcher's
// `code := runner.Run(opts, ...)` runs *after* defaults, so any wrapper
// here just needs to remember the resolved opts.
type captureRunner struct {
	inner BootstrapRunner
	sink  **BootstrapOptions
}

func (c *captureRunner) Run(opts *BootstrapOptions, stdout, stderr io.Writer) int {
	*c.sink = opts
	return c.inner.Run(opts, stdout, stderr)
}

func TestRunInterviewBootstrap_NoPublishOnFailure(t *testing.T) {
	called := false
	withPublishHooks(t, true, func(*BootstrapOptions) { called = true })
	var out, errBuf bytes.Buffer
	stub := &stubRunner{code: 1}
	code := runInterviewBootstrap([]string{
		"--headless",
		"--role", "x", "--stack", "x", "--domain", "x", "--feature", "x",
		"--mode-project", "A", "--mode-analysis", "ai-assisted",
		"--mode-rubric", "default", "--output-dir", "/tmp/teamhero-test",
	}, stub, &out, &errBuf)
	if code != 1 {
		t.Errorf("expected forwarded failure exit, got %d", code)
	}
	if called {
		t.Error("publish must NOT be offered when bootstrap fails")
	}
	if strings.Contains(out.String(), "file://") {
		t.Errorf("success link should NOT print on failure; got stdout: %q", out.String())
	}
}

// stubLauncher records the wizard invocation and returns a pre-built result.
type stubWizardLauncher struct {
	called bool
	result *BootstrapWizardResult
	err    error
}

func (s *stubWizardLauncher) Launch() (*BootstrapWizardResult, error) {
	s.called = true
	return s.result, s.err
}

func TestRunInterviewBootstrap_WizardAbortReturnsCleanZero(t *testing.T) {
	var out, errBuf bytes.Buffer
	stubRun := &stubRunner{code: 99}
	stubLauncher := &stubWizardLauncher{
		result: &BootstrapWizardResult{Aborted: true},
	}
	code := runInterviewBootstrapWithWizard([]string{}, stubRun, stubLauncher, &out, &errBuf)
	if code != 0 {
		t.Errorf("expected exit 0 on wizard abort, got %d", code)
	}
	if stubRun.gotOpts != nil {
		t.Errorf("runner must NOT be invoked when wizard aborts")
	}
}

func TestRunInterviewBootstrap_WizardDeclineSkipsRunner(t *testing.T) {
	var out, errBuf bytes.Buffer
	stubRun := &stubRunner{code: 99}
	stubLauncher := &stubWizardLauncher{
		result: &BootstrapWizardResult{Confirmed: false, Options: &BootstrapOptions{}},
	}
	code := runInterviewBootstrapWithWizard([]string{}, stubRun, stubLauncher, &out, &errBuf)
	if code != 0 {
		t.Errorf("expected exit 0 when user declines confirm screen, got %d", code)
	}
	if stubRun.gotOpts != nil {
		t.Errorf("runner must NOT be invoked when user declines confirm screen")
	}
}

func TestRunInterviewBootstrap_FlagsBypassWizard(t *testing.T) {
	var out, errBuf bytes.Buffer
	stubRun := &stubRunner{code: 0}
	stubLauncher := &stubWizardLauncher{}
	code := runInterviewBootstrapWithWizard([]string{
		"--headless",
		"--role", "x", "--stack", "x", "--domain", "x", "--feature", "x",
		"--mode-project", "A", "--mode-analysis", "ai-assisted",
		"--mode-rubric", "default", "--output-dir", "x",
	}, stubRun, stubLauncher, &out, &errBuf)
	if code != 0 {
		t.Errorf("expected exit 0 from headless path, got %d (stderr=%s)", code, errBuf.String())
	}
	if stubLauncher.called {
		t.Errorf("wizard must NOT be launched when flags are present")
	}
	if stubRun.gotOpts == nil {
		t.Errorf("runner should be invoked with parsed headless flags")
	}
}

func TestRunInterviewBootstrap_NoFlagsInvokesWizard(t *testing.T) {
	var out, errBuf bytes.Buffer
	stubRun := &stubRunner{code: 0}
	stubLauncher := &stubWizardLauncher{
		result: &BootstrapWizardResult{
			Confirmed: true,
			Options: &BootstrapOptions{
				Role: "wizard-role", Stack: "TS", Domain: "Payments",
				Feature: "Add idempotency", ModeProject: "A",
				ModeAnalysis: "ai-assisted", ModeRubric: "default",
				OutputDir: "./roles/wizard-role",
			},
		},
	}
	// Skip the real tea program — invoke the runner inline so this test stays
	// fast and headless. The bubbletea generate-screen has its own coverage in
	// interview_bootstrap_generate_test.go.
	orig := runBootstrapGenerate
	t.Cleanup(func() { runBootstrapGenerate = orig })
	runBootstrapGenerate = func(runner BootstrapRunner, opts *BootstrapOptions, stdout, stderr io.Writer) int {
		return runner.Run(opts, stdout, stderr)
	}
	code := runInterviewBootstrapWithWizard([]string{}, stubRun, stubLauncher, &out, &errBuf)
	if !stubLauncher.called {
		t.Fatalf("expected wizard launcher to be called when no flags are present; stderr=%q", errBuf.String())
	}
	if code != 0 {
		t.Errorf("expected exit 0 after wizard+runner success, got %d (stderr=%q)", code, errBuf.String())
	}
	if stubRun.gotOpts == nil || stubRun.gotOpts.Role != "wizard-role" {
		t.Errorf("expected runner invoked with wizard-supplied options, got %+v", stubRun.gotOpts)
	}
}
