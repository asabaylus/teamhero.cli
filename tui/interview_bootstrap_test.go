package main

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
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

func TestParseBootstrapFlags_EmitJSONFlag(t *testing.T) {
	// --json switches the bootstrap into agent-payload mode: a single
	// JSON object goes to stdout describing the run, and human-readable
	// chatter (Project: link, publish prompt) is routed to stderr.
	// The flag exists so an orchestrating agent (HR notifier, scheduler,
	// etc.) can `read` stdout and act on the payload without parsing
	// our human formatting.
	opts, parseErr := ParseBootstrapFlags([]string{"--json"})
	if parseErr != "" {
		t.Fatalf("unexpected parse error: %s", parseErr)
	}
	if !opts.EmitJSON {
		t.Error("--json should set EmitJSON=true")
	}
}

func TestParseBootstrapFlags_PublishFlag(t *testing.T) {
	// --publish is orthogonal to --json. When set, the dispatcher
	// auto-publishes to GitHub on success (no prompt), so a downstream
	// agent caller can pass --publish --json and get a payload with a
	// real github.url to put in an HR email.
	opts, parseErr := ParseBootstrapFlags([]string{"--publish"})
	if parseErr != "" {
		t.Fatalf("unexpected parse error: %s", parseErr)
	}
	if !opts.Publish {
		t.Error("--publish should set Publish=true")
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

func TestValidateBootstrapOptions_JDInfluencesProjectRequiresPath(t *testing.T) {
	// --jd-influences-project tells the project-generation prompt to
	// read the JD; without a path there's nothing to read. The
	// validator rejects the combination so the misconfiguration is
	// caught before the bun subprocess starts.
	opts := &BootstrapOptions{
		Role: "x", Stack: "x", Domain: "x", Feature: "x", OutputDir: "x",
		ModeProject: "A", ModeAnalysis: "ai-assisted", ModeRubric: "default",
		JDInfluencesProject: true,
	}
	msg := ValidateBootstrapOptions(opts)
	if msg == "" {
		t.Fatal("expected validation error when --jd-influences-project is set without --jd-path")
	}
	if !strings.Contains(msg, "jd-influences-project") {
		t.Errorf("validation error should mention jd-influences-project; got %q", msg)
	}
}

func TestValidateBootstrapOptions_RejectsDefaultPlusJD(t *testing.T) {
	// "default+jd" is retired. JD attachment is its own field. A caller
	// still passing the old value should get a clear validation error
	// rather than the bun subprocess receiving an unsupported rubric.
	opts := &BootstrapOptions{
		Role: "x", Stack: "x", Domain: "x", Feature: "x", OutputDir: "x",
		ModeProject: "A", ModeAnalysis: "ai-assisted", ModeRubric: "default+jd",
	}
	if msg := ValidateBootstrapOptions(opts); msg == "" {
		t.Fatal("expected validation error on retired 'default+jd' rubric value")
	}
}

func TestValidateBootstrapOptions_AcceptsStandaloneJDPath(t *testing.T) {
	// JD path is now optional regardless of rubric mode. A caller can
	// supply --jd-path with --mode-rubric default and it should pass
	// validation (the JD will be used by the AI observer).
	jd := t.TempDir() + "/jd.md"
	if err := os.WriteFile(jd, []byte("# JD"), 0o644); err != nil {
		t.Fatalf("setup: %v", err)
	}
	opts := &BootstrapOptions{
		Role: "x", Stack: "x", Domain: "x", Feature: "x", OutputDir: "x",
		ModeProject: "A", ModeAnalysis: "ai-assisted", ModeRubric: "default",
		JDPath: jd,
	}
	if msg := ValidateBootstrapOptions(opts); msg != "" {
		t.Fatalf("expected validation pass for default rubric + jd-path, got %q", msg)
	}
}

func TestParseBootstrapFlags_StackByCandidateFlag(t *testing.T) {
	// --stack-by-candidate is the headless equivalent of the wizard's
	// "Greenfield (candidate picks stack)" option. Boolean flag; off by
	// default. Combined with --mode-project A it should fail validation
	// (covered by TestValidateBootstrapOptions_StackByCandidateRequiresModeB).
	opts, parseErr := ParseBootstrapFlags([]string{"--stack-by-candidate"})
	if parseErr != "" {
		t.Fatalf("unexpected parse error: %s", parseErr)
	}
	if !opts.StackByCandidate {
		t.Error("--stack-by-candidate should set StackByCandidate=true")
	}
}

func TestValidateBootstrapOptions_StackByCandidateRequiresModeB(t *testing.T) {
	// Stack-by-candidate is incoherent with Mode A — Mode A scaffolds
	// code IN a stack, so "candidate picks the stack" makes no sense
	// there. The validator rejects the combination so headless callers
	// don't get a brownfield project with a confused brief.
	opts := &BootstrapOptions{
		Role: "x", Stack: "x", Domain: "x", Feature: "x", OutputDir: "x",
		ModeProject: "A", ModeAnalysis: "ai-assisted", ModeRubric: "default",
		StackByCandidate: true,
	}
	msg := ValidateBootstrapOptions(opts)
	if msg == "" {
		t.Fatal("expected validation error when --stack-by-candidate is combined with --mode-project A")
	}
	if !strings.Contains(msg, "stack-by-candidate") {
		t.Errorf("validation error should mention stack-by-candidate; got %q", msg)
	}
}

func TestValidateBootstrapOptions_StackByCandidateAllowedWithModeB(t *testing.T) {
	// Stack-by-candidate IS valid in combination with Mode B — that's
	// the only mode where "no starter code, candidate picks the stack"
	// makes sense.
	opts := &BootstrapOptions{
		Role: "x", Stack: "x", Domain: "x", Feature: "x", OutputDir: "x",
		ModeProject: "B", ModeAnalysis: "ai-assisted", ModeRubric: "default",
		StackByCandidate: true,
	}
	if msg := ValidateBootstrapOptions(opts); msg != "" {
		t.Fatalf("expected validation pass for B + StackByCandidate, got %q", msg)
	}
}

func TestValidateBootstrapOptions_DomainOptionalWhenJDAttached(t *testing.T) {
	// A JD describes the business domain, so requiring --domain on
	// top of --jd-path is redundant. The validator drops the domain
	// requirement when a JD is supplied — the OpenAI prompt falls back
	// to the JD's body for domain context, and the wizard skips the
	// Domain question entirely on the JD-yes branch.
	jd := t.TempDir() + "/jd.md"
	if err := os.WriteFile(jd, []byte("# JD"), 0o644); err != nil {
		t.Fatalf("setup: %v", err)
	}
	opts := &BootstrapOptions{
		Role: "x", Stack: "x", Feature: "x", OutputDir: "x",
		ModeProject: "A", ModeAnalysis: "ai-assisted", ModeRubric: "default",
		JDPath: jd,
		// Domain intentionally omitted.
	}
	if msg := ValidateBootstrapOptions(opts); msg != "" {
		t.Fatalf("expected validation pass with JD-but-no-domain, got %q", msg)
	}
}

func TestValidateBootstrapOptions_DomainRequiredWhenNoJD(t *testing.T) {
	// Without a JD attached, the proctor must name the domain
	// explicitly — otherwise the AI has no business context at all.
	opts := &BootstrapOptions{
		Role: "x", Stack: "x", Feature: "x", OutputDir: "x",
		ModeProject: "A", ModeAnalysis: "ai-assisted", ModeRubric: "default",
		// Domain and JDPath both omitted.
	}
	msg := ValidateBootstrapOptions(opts)
	if msg == "" {
		t.Fatal("expected validation error: domain required when no JD")
	}
	if !strings.Contains(msg, "--domain") {
		t.Errorf("error should mention --domain; got %q", msg)
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

func TestPrintBootstrapSuccessLink_DisplaysRelativePath(t *testing.T) {
	// Display label should be cwd-relative — running `teamhero` from
	// ~/Documents and writing into ~/Documents/interviews/foo should
	// surface as "interviews/foo", not "/home/<user>/Documents/...".
	// The underlying OSC 8 file:// URL is still absolute (so the link
	// actually works on click), but the human-readable label is what
	// the proctor reads.
	tmp := t.TempDir()
	prevCwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	if err := os.Chdir(tmp); err != nil {
		t.Fatalf("chdir: %v", err)
	}
	t.Cleanup(func() { _ = os.Chdir(prevCwd) })

	subDir := tmp + "/interviews/foo"
	if err := os.MkdirAll(subDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	var buf bytes.Buffer
	printBootstrapSuccessLink(subDir, &buf)
	got := buf.String()
	// The OSC 8 envelope wraps the absolute file:// URL around a
	// human-readable label: ESC]8;;<url>ESC\<label>ESC]8;;ESC\
	// We want the LABEL (between the inner escapes) to be the
	// cwd-relative path, while the URL stays absolute so a ctrl-click
	// still resolves on disk.
	if !strings.Contains(got, "\\interviews/foo\x1b]8;;\x1b\\") {
		t.Errorf("expected cwd-relative label 'interviews/foo' between the OSC 8 escapes; got %q", got)
	}
	if !strings.Contains(got, "file://"+tmp+"/interviews/foo") {
		t.Errorf("expected absolute file:// URL embedded for the click target; got %q", got)
	}
}

func TestRunInterviewBootstrap_EmitJSON_WritesPayloadToStdout(t *testing.T) {
	// With --json, stdout MUST contain exactly one parseable JSON
	// object describing the run. The schema field is a stable marker
	// so an orchestrating agent can version-check what it's getting.
	withPublishHooks(t, false, nil)
	var out, errBuf bytes.Buffer
	stub := &stubRunner{code: 0}
	code := runInterviewBootstrap([]string{
		"--headless", "--json",
		"--role", "senior-backend",
		"--role-title", "Senior Backend Engineer",
		"--stack", "TypeScript",
		"--domain", "Payments",
		"--feature", "Add idempotency keys",
		"--time-box", "90",
		"--mode-project", "A",
		"--mode-analysis", "ai-assisted",
		"--mode-rubric", "default",
		"--output-dir", "/tmp/teamhero-emit-json-test",
	}, stub, &out, &errBuf)
	if code != 0 {
		t.Fatalf("exit=%d stderr=%s", code, errBuf.String())
	}

	var payload struct {
		Schema string `json:"schema"`
		Role   struct {
			Slug   string `json:"slug"`
			Title  string `json:"title"`
			Stack  string `json:"stack"`
			Domain string `json:"domain"`
		} `json:"role"`
		Project struct {
			Mode           string `json:"mode"`
			OutputDir      string `json:"outputDir"`
			TimeBoxMinutes int    `json:"timeBoxMinutes"`
		} `json:"project"`
		Github *struct {
			URL string `json:"url"`
		} `json:"github"`
	}
	if err := json.Unmarshal(out.Bytes(), &payload); err != nil {
		t.Fatalf("stdout was not valid JSON: %v\nstdout: %q", err, out.String())
	}
	if payload.Schema != "teamhero.interview.bootstrap/v1" {
		t.Errorf("schema mismatch: got %q", payload.Schema)
	}
	if payload.Role.Slug != "senior-backend" {
		t.Errorf("role.slug: got %q", payload.Role.Slug)
	}
	if payload.Role.Title != "Senior Backend Engineer" {
		t.Errorf("role.title: got %q", payload.Role.Title)
	}
	if payload.Role.Stack != "TypeScript" {
		t.Errorf("role.stack: got %q", payload.Role.Stack)
	}
	if payload.Role.Domain != "Payments" {
		t.Errorf("role.domain: got %q", payload.Role.Domain)
	}
	if payload.Project.Mode != "A" {
		t.Errorf("project.mode: got %q", payload.Project.Mode)
	}
	if payload.Project.TimeBoxMinutes != 90 {
		t.Errorf("project.timeBoxMinutes: got %d", payload.Project.TimeBoxMinutes)
	}
	// github MUST be null when --publish wasn't passed (orthogonal flags).
	if payload.Github != nil {
		t.Errorf("github should be null when --publish was not set; got %+v", payload.Github)
	}
}

func TestRunInterviewBootstrap_EmitJSON_RoutesHumanOutputToStderr(t *testing.T) {
	// Stdout must contain ONLY the JSON object. The clickable
	// "Project: ..." line that printBootstrapSuccessLink normally
	// writes to stdout has to be either suppressed or routed to
	// stderr in --json mode, otherwise the calling agent's
	// json.Unmarshal fails.
	withPublishHooks(t, false, nil)
	var out, errBuf bytes.Buffer
	stub := &stubRunner{code: 0}
	runInterviewBootstrap([]string{
		"--headless", "--json",
		"--role", "x", "--stack", "x", "--domain", "x", "--feature", "x",
		"--mode-project", "A", "--mode-analysis", "ai-assisted",
		"--mode-rubric", "default", "--output-dir", "/tmp/teamhero-json-stderr",
	}, stub, &out, &errBuf)
	if strings.Contains(out.String(), "Project:") {
		t.Errorf("stdout must NOT contain the human-readable 'Project:' line in --json mode; got:\n%s", out.String())
	}
	if strings.Contains(out.String(), "file://") {
		t.Errorf("stdout must NOT contain the file:// link in --json mode; got:\n%s", out.String())
	}
	// stdout must still be parseable.
	if !strings.HasPrefix(strings.TrimSpace(out.String()), "{") {
		t.Errorf("stdout should start with JSON object; got:\n%s", out.String())
	}
}

func TestRunInterviewBootstrap_EmitJSON_IncludesAIModel(t *testing.T) {
	// The orchestrating agent needs to know which LLM produced the
	// output for cost attribution and audit. The payload's ai.model
	// field reflects whatever AI_MODEL env override is in play, or
	// the gpt-5-mini default.
	t.Setenv("AI_MODEL", "gpt-5.4-mini")
	withPublishHooks(t, false, nil)
	var out, errBuf bytes.Buffer
	stub := &stubRunner{code: 0}
	code := runInterviewBootstrap([]string{
		"--headless", "--json",
		"--role", "x", "--stack", "x", "--domain", "x", "--feature", "x",
		"--mode-project", "A", "--mode-analysis", "ai-assisted",
		"--mode-rubric", "default", "--output-dir", "/tmp/teamhero-json-model",
	}, stub, &out, &errBuf)
	if code != 0 {
		t.Fatalf("exit=%d stderr=%s", code, errBuf.String())
	}
	var payload struct {
		AI struct {
			Model string `json:"model"`
		} `json:"ai"`
	}
	if err := json.Unmarshal(out.Bytes(), &payload); err != nil {
		t.Fatalf("stdout was not valid JSON: %v", err)
	}
	if payload.AI.Model != "gpt-5.4-mini" {
		t.Errorf("ai.model: got %q, want gpt-5.4-mini (from AI_MODEL env)", payload.AI.Model)
	}
}

func TestRunInterviewBootstrap_EmitJSON_IncludesJDFieldsWhenAttached(t *testing.T) {
	// When the run was driven with a JD attached, the payload's
	// project.jd block must surface the path + influencesProject flag
	// so a downstream agent knows whether the AI was JD-shaped.
	jd := t.TempDir() + "/jd.md"
	if err := os.WriteFile(jd, []byte("# JD"), 0o644); err != nil {
		t.Fatalf("setup: %v", err)
	}
	withPublishHooks(t, false, nil)
	var out, errBuf bytes.Buffer
	stub := &stubRunner{code: 0}
	code := runInterviewBootstrap([]string{
		"--headless", "--json",
		"--role", "x", "--stack", "x", "--feature", "x",
		"--mode-project", "A", "--mode-analysis", "ai-assisted",
		"--mode-rubric", "default", "--output-dir", "/tmp/teamhero-json-jd",
		"--jd-path", jd,
		"--jd-influences-project",
	}, stub, &out, &errBuf)
	if code != 0 {
		t.Fatalf("exit=%d stderr=%s", code, errBuf.String())
	}
	var payload struct {
		Project struct {
			JD *struct {
				Path              string `json:"path"`
				InfluencesProject bool   `json:"influencesProject"`
			} `json:"jd"`
		} `json:"project"`
	}
	if err := json.Unmarshal(out.Bytes(), &payload); err != nil {
		t.Fatalf("stdout was not valid JSON: %v", err)
	}
	if payload.Project.JD == nil {
		t.Fatal("project.jd should be present when --jd-path was supplied")
	}
	if payload.Project.JD.Path != jd {
		t.Errorf("project.jd.path: got %q, want %q", payload.Project.JD.Path, jd)
	}
	if !payload.Project.JD.InfluencesProject {
		t.Error("project.jd.influencesProject should be true when --jd-influences-project was set")
	}
}

func TestRunInterviewBootstrap_PublishAndJSON_IncludesGithubURLInPayload(t *testing.T) {
	// The combination an HR/scheduler agent will actually use:
	// --publish to push the repo, --json to get a machine-readable
	// summary back. The payload's github.url must equal whatever the
	// publish path produced.
	origPublish := autoPublishToGitHub
	t.Cleanup(func() { autoPublishToGitHub = origPublish })
	autoPublishToGitHub = func(opts *BootstrapOptions, _ io.Writer) string {
		return "https://github.com/acme/iv-senior-backend"
	}
	withPublishHooks(t, false, nil)
	var out, errBuf bytes.Buffer
	stub := &stubRunner{code: 0}
	code := runInterviewBootstrap([]string{
		"--headless", "--json", "--publish",
		"--role", "senior-backend",
		"--stack", "TypeScript",
		"--domain", "Payments",
		"--feature", "Add idempotency keys",
		"--mode-project", "A",
		"--mode-analysis", "ai-assisted",
		"--mode-rubric", "default",
		"--output-dir", "/tmp/teamhero-publish-json",
	}, stub, &out, &errBuf)
	if code != 0 {
		t.Fatalf("exit=%d stderr=%s", code, errBuf.String())
	}
	var payload struct {
		Github *struct {
			URL string `json:"url"`
		} `json:"github"`
	}
	if err := json.Unmarshal(out.Bytes(), &payload); err != nil {
		t.Fatalf("stdout was not valid JSON: %v", err)
	}
	if payload.Github == nil {
		t.Fatal("github should be present after --publish; got null")
	}
	if payload.Github.URL != "https://github.com/acme/iv-senior-backend" {
		t.Errorf("github.url: got %q", payload.Github.URL)
	}
}

func TestRunInterviewBootstrap_PublishWithoutJSON_DoesNotEmitPayload(t *testing.T) {
	// --publish on its own pushes to GitHub but stdout stays
	// human-readable; no JSON envelope is emitted unless --json is
	// also set. Pins the orthogonality from the design discussion.
	origPublish := autoPublishToGitHub
	t.Cleanup(func() { autoPublishToGitHub = origPublish })
	publishCalled := false
	autoPublishToGitHub = func(opts *BootstrapOptions, _ io.Writer) string {
		publishCalled = true
		return "https://github.com/acme/iv-x"
	}
	withPublishHooks(t, false, nil) // also disables interactive prompt
	var out, errBuf bytes.Buffer
	stub := &stubRunner{code: 0}
	runInterviewBootstrap([]string{
		"--headless", "--publish",
		"--role", "x", "--stack", "x", "--domain", "x", "--feature", "x",
		"--mode-project", "A", "--mode-analysis", "ai-assisted",
		"--mode-rubric", "default", "--output-dir", "/tmp/teamhero-publish-only",
	}, stub, &out, &errBuf)
	if !publishCalled {
		t.Error("--publish should trigger autoPublishToGitHub")
	}
	if strings.HasPrefix(strings.TrimSpace(out.String()), "{") {
		t.Errorf("--publish alone should NOT emit a JSON envelope on stdout; got:\n%s", out.String())
	}
}

func TestRunInterviewBootstrap_NoJSONFlag_PreservesHumanOutput(t *testing.T) {
	// Regression guard: when --json is NOT passed, the existing
	// human-readable "Project: <osc8-link>" stdout behavior must
	// remain intact.
	withPublishHooks(t, false, nil)
	var out, errBuf bytes.Buffer
	stub := &stubRunner{code: 0}
	runInterviewBootstrap([]string{
		"--headless",
		"--role", "x", "--stack", "x", "--domain", "x", "--feature", "x",
		"--mode-project", "A", "--mode-analysis", "ai-assisted",
		"--mode-rubric", "default", "--output-dir", "/tmp/teamhero-no-json",
	}, stub, &out, &errBuf)
	if !strings.Contains(out.String(), "Project:") {
		t.Errorf("without --json the human-readable Project: line should still appear on stdout; got:\n%s", out.String())
	}
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

func TestRunInterviewBootstrap_WizardPathAppliesKitDirDefault(t *testing.T) {
	// Regression guard for a manual-test report: a proctor running the
	// interactive wizard (Mode B) got an output directory containing
	// only BRIEF.md and role-config.json — none of the kit overlay
	// (INTERVIEW_RULES.md, AGENTS.md, etc.). Cause: the wizard path
	// never called applyBootstrapDefaults, so KitDir stayed empty and
	// the bun subprocess copied no kit templates. The fix calls
	// applyBootstrapDefaults right after the wizard returns; this test
	// asserts the runner sees KitDir populated by the time it runs.
	var out, errBuf bytes.Buffer
	stubRun := &stubRunner{code: 0}
	stubLauncher := &stubWizardLauncher{
		result: &BootstrapWizardResult{
			Confirmed: true,
			Options: &BootstrapOptions{
				Role: "wizard-role", Stack: "TS", Domain: "Payments",
				Feature: "Add idempotency", ModeProject: "A",
				ModeAnalysis: "ai-assisted", ModeRubric: "default",
				OutputDir: "./interviews/wizard-role",
				// KitDir intentionally NOT set — bootstrapWizardOptionsFromModel
				// doesn't populate it; the dispatcher must.
			},
		},
	}
	orig := runBootstrapGenerate
	t.Cleanup(func() { runBootstrapGenerate = orig })
	runBootstrapGenerate = func(runner BootstrapRunner, opts *BootstrapOptions, stdout, stderr io.Writer) int {
		return runner.Run(opts, stdout, stderr)
	}
	// The wizard path only fires on a TTY. withPublishHooks(true, ...)
	// makes isStdinTTY report TTY so the dispatcher enters the wizard
	// branch instead of falling through to "not a TTY" exit.
	withPublishHooks(t, true, nil)
	code := runInterviewBootstrapWithWizard([]string{}, stubRun, stubLauncher, &out, &errBuf)
	if code != 0 {
		t.Fatalf("expected exit 0, got %d (stderr=%q)", code, errBuf.String())
	}
	if stubRun.gotOpts == nil {
		t.Fatal("runner not invoked")
	}
	if stubRun.gotOpts.KitDir != "teamhero-interview-kit" {
		t.Errorf(
			"wizard path must fill KitDir via applyBootstrapDefaults; got %q",
			stubRun.gotOpts.KitDir,
		)
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
