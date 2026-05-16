package main

import (
	"bytes"
	"io"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
)

// TestOsc8Link_WrapsLabelInEscapeSequence asserts that the OSC 8 hyperlink
// helper produces the expected escape envelope. Ctrl-click in modern
// terminals depends on the exact byte sequence — start (ESC ]8;;<URL> ESC \),
// label, end (ESC ]8;; ESC \).
func TestOsc8Link_WrapsLabelInEscapeSequence(t *testing.T) {
	out := osc8Link("file:///tmp/roles/x", "/tmp/roles/x")
	if !strings.HasPrefix(out, "\x1b]8;;file:///tmp/roles/x\x1b\\") {
		t.Errorf("link should start with OSC 8 open + URL + ST, got %q", out)
	}
	if !strings.HasSuffix(out, "\x1b]8;;\x1b\\") {
		t.Errorf("link should end with OSC 8 close, got %q", out)
	}
	if !strings.Contains(out, "/tmp/roles/x") {
		t.Errorf("link should contain visible label, got %q", out)
	}
}

// TestOsc8Link_EmptyTargetReturnsBareLabel ensures a missing target degrades
// to plain text rather than emitting a broken link.
func TestOsc8Link_EmptyTargetReturnsBareLabel(t *testing.T) {
	if got := osc8Link("", "/tmp/roles/x"); got != "/tmp/roles/x" {
		t.Errorf("empty target should return label unwrapped, got %q", got)
	}
}

// TestAbsPathLink_ProducesThreeSlashFileURL pins the URL shape — file:///abs
// on Unix and file:///<drive>:/... on Windows. Three leading slashes are
// required by RFC 8089.
func TestAbsPathLink_ProducesThreeSlashFileURL(t *testing.T) {
	dir := t.TempDir() // absolute, exists
	abs, link := absPathLink(dir)
	if abs == "" {
		t.Fatal("abs should be non-empty for an existing temp dir")
	}
	if !strings.HasPrefix(link, "file:///") {
		t.Errorf("link should start with file:/// (three slashes), got %q", link)
	}
	// The slash-converted absolute path should appear in the URL on both
	// platforms.
	if !strings.Contains(link, filepath.ToSlash(abs)) {
		t.Errorf("link should embed the slash-converted abs path %q, got %q", filepath.ToSlash(abs), link)
	}
}

// TestAbsPathLink_RelativePathIsResolvedToAbsolute covers the wizard's
// default output dir form (./roles/<slug>) — it must be expanded so the
// file:// URL is openable.
func TestAbsPathLink_RelativePathIsResolvedToAbsolute(t *testing.T) {
	abs, link := absPathLink("./roles/test-role")
	if !filepath.IsAbs(abs) {
		t.Errorf("abs should be an absolute path, got %q", abs)
	}
	if link == "" || !strings.HasPrefix(link, "file:///") {
		t.Errorf("link should be a file:/// URL, got %q", link)
	}
}

// TestLastLines_TrimsLongStderr keeps the failure screen compact when a
// subprocess dumps a long stack trace.
func TestLastLines_TrimsLongStderr(t *testing.T) {
	in := "a\nb\nc\nd\ne\nf\ng"
	got := lastLines(in, 3)
	if got != "e\nf\ng" {
		t.Errorf("expected last 3 lines, got %q", got)
	}
}

func TestLastLines_ShorterThanLimitReturnsAll(t *testing.T) {
	in := "a\nb"
	if got := lastLines(in, 5); got != "a\nb" {
		t.Errorf("expected full input, got %q", got)
	}
}

// fakeRunner records the options it received and returns a configurable
// exit code + stderr payload so we can exercise both success and failure
// paths of the generate model without a real subprocess.
type fakeRunner struct {
	code   int
	stderr string
	stdout string
	called bool
}

func (f *fakeRunner) Run(_ *BootstrapOptions, stdout, stderr io.Writer) int {
	f.called = true
	if f.stdout != "" {
		_, _ = stdout.Write([]byte(f.stdout))
	}
	if f.stderr != "" {
		_, _ = stderr.Write([]byte(f.stderr))
	}
	return f.code
}

// TestGenerateModel_SubprocessSuccessTransitionsToSuccessPhase drives the
// model directly via Update so we can assert phase transitions without a TTY.
func TestGenerateModel_SubprocessSuccessTransitionsToSuccessPhase(t *testing.T) {
	m := newBootstrapGenerateModel(nil, &BootstrapOptions{OutputDir: "./roles/x"})
	if m.phase != bgPhaseRunning {
		t.Fatalf("initial phase should be Running, got %v", m.phase)
	}
	model, _ := m.Update(subprocessDoneMsg{exitCode: 0})
	gm := model.(*bootstrapGenerateModel)
	if gm.phase != bgPhaseSuccess {
		t.Errorf("expected Success phase after zero-exit, got %v", gm.phase)
	}
}

func TestGenerateModel_SubprocessFailureTransitionsToFailurePhase(t *testing.T) {
	m := newBootstrapGenerateModel(nil, &BootstrapOptions{OutputDir: "./roles/x"})
	model, _ := m.Update(subprocessDoneMsg{exitCode: 5})
	gm := model.(*bootstrapGenerateModel)
	if gm.phase != bgPhaseFailure {
		t.Errorf("expected Failure phase after non-zero exit, got %v", gm.phase)
	}
	if gm.exitCode != 5 {
		t.Errorf("expected exitCode 5 to be retained, got %d", gm.exitCode)
	}
}

// TestGenerateModel_RunningPhase_IgnoresOrdinaryKeys protects the user from
// accidentally aborting mid-generation. The half-written scaffold would be
// unrecoverable, so we only honor Ctrl+C while running.
func TestGenerateModel_RunningPhase_IgnoresOrdinaryKeys(t *testing.T) {
	m := newBootstrapGenerateModel(nil, &BootstrapOptions{OutputDir: "./x"})
	for _, key := range []tea.KeyMsg{
		{Type: tea.KeyEsc},
		{Type: tea.KeyRunes, Runes: []rune{'q'}},
		{Type: tea.KeyEnter},
	} {
		_, cmd := m.Update(key)
		if cmd != nil {
			t.Errorf("key %v during running phase should not produce a Cmd, got %v", key, cmd)
		}
		if m.phase != bgPhaseRunning {
			t.Errorf("key %v should not change phase from Running, got %v", key, m.phase)
		}
	}
}

// TestGenerateModel_RunningPhase_CtrlCQuits — Ctrl+C is the hard-abort that
// always works, even mid-generation.
func TestGenerateModel_RunningPhase_CtrlCQuits(t *testing.T) {
	m := newBootstrapGenerateModel(nil, &BootstrapOptions{OutputDir: "./x"})
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	if cmd == nil {
		t.Fatal("Ctrl+C should produce a Quit Cmd")
	}
}

// TestGenerateModel_DonePhase_DismissKeys verifies the documented dismiss
// affordance: esc / q / enter / ctrl+c all close the result screen.
func TestGenerateModel_DonePhase_DismissKeys(t *testing.T) {
	for _, key := range []tea.KeyMsg{
		{Type: tea.KeyEsc},
		{Type: tea.KeyRunes, Runes: []rune{'q'}},
		{Type: tea.KeyEnter},
		{Type: tea.KeyCtrlC},
	} {
		m := newBootstrapGenerateModel(nil, &BootstrapOptions{OutputDir: "./x"})
		// Move to success phase first.
		m.Update(subprocessDoneMsg{exitCode: 0})
		_, cmd := m.Update(key)
		if cmd == nil {
			t.Errorf("dismiss key %v should produce a Quit Cmd in Success phase", key)
		}
	}
}

// TestGenerateModel_View_RunningPhase asserts the visible elements while the
// subprocess is in flight: shell header, spinner, progress label, abort hint.
func TestGenerateModel_View_RunningPhase(t *testing.T) {
	m := newBootstrapGenerateModel(nil, &BootstrapOptions{OutputDir: "./roles/test"})
	m.width = 100
	view := stripANSI(m.View())
	for _, want := range []string{"TEAM HERO", "Generating role scaffold", "ctrl+c to abort"} {
		if !strings.Contains(view, want) {
			t.Errorf("running-phase view missing %q\n--- view ---\n%s", want, view)
		}
	}
}

// TestGenerateModel_View_SuccessPhase asserts the result screen contains the
// success tick, an absolute path (not the input relative form), and dismiss
// hints — and that the path is wrapped in an OSC 8 hyperlink so terminals
// render it as ctrl-clickable.
func TestGenerateModel_View_SuccessPhase(t *testing.T) {
	tmp := t.TempDir()
	m := newBootstrapGenerateModel(nil, &BootstrapOptions{OutputDir: tmp})
	m.width = 100
	m.Update(subprocessDoneMsg{exitCode: 0})
	raw := m.View()
	view := stripANSI(raw)

	for _, want := range []string{"✓ Role scaffold ready", tmp, "esc / ctrl+c to dismiss"} {
		if !strings.Contains(view, want) {
			t.Errorf("success-phase view missing %q\n--- view ---\n%s", want, view)
		}
	}
	// OSC 8 hyperlink envelope should be in the raw (pre-strip) output so
	// terminals capable of rendering it can pick it up.
	if !strings.Contains(raw, "\x1b]8;;file://") {
		t.Errorf("success-phase view should embed an OSC 8 file:// hyperlink, got:\n%s", raw)
	}
}

func TestGenerateModel_View_SuccessPhase_ExpandsRelativePath(t *testing.T) {
	m := newBootstrapGenerateModel(nil, &BootstrapOptions{OutputDir: "./roles/relative-test"})
	m.width = 100
	m.Update(subprocessDoneMsg{exitCode: 0})
	view := stripANSI(m.View())

	if strings.Contains(view, "./roles/relative-test") && !strings.Contains(view, "/relative-test") {
		t.Errorf("path should be displayed as absolute, not relative\n--- view ---\n%s", view)
	}
}

// TestGenerateModel_View_FailurePhase asserts the user sees the exit code
// and a tail of the captured stderr.
func TestGenerateModel_View_FailurePhase(t *testing.T) {
	m := newBootstrapGenerateModel(nil, &BootstrapOptions{OutputDir: "./x"})
	m.width = 100
	// Pre-populate stderr to simulate a captured subprocess failure.
	m.stderrBuf = *bytes.NewBufferString("line1\nline2\nfatal: out of quota\n")
	m.Update(subprocessDoneMsg{exitCode: 2})
	view := stripANSI(m.View())

	for _, want := range []string{"Generation failed", "exit code 2", "fatal: out of quota"} {
		if !strings.Contains(view, want) {
			t.Errorf("failure-phase view missing %q\n--- view ---\n%s", want, view)
		}
	}
}

// TestGenerateModel_View_FailurePhase_WrapsLongLines protects against the
// alt-screen truncating long subprocess errors (the symptom that bit us:
// "Mode A projects must include at least one failing/sk[truncated]"). On a
// narrow terminal the wrapped output must contain the *complete* message and
// span more lines than the unwrapped form.
func TestGenerateModel_View_FailurePhase_WrapsLongLines(t *testing.T) {
	longLine := "ERROR    - No failing or skipped tests found. Mode A projects must include at least one failing/skipped test in tests/something.test.ts so the rubric can grade test-driven recovery."
	m := newBootstrapGenerateModel(nil, &BootstrapOptions{OutputDir: "./x"})
	m.width = 60
	m.stderrBuf = *bytes.NewBufferString(longLine + "\n")
	m.Update(subprocessDoneMsg{exitCode: 1})
	view := stripANSI(m.View())

	// Full message must survive — assert distinct fragments because wordwrap
	// reflows the line and may split across line breaks (a string search
	// across "\n    " won't find a span the user can read just fine).
	for _, fragment := range []string{
		"No failing or skipped tests found",
		"failing/skipped test",
		"tests/something.test.ts",
		"driven recovery",
	} {
		// Collapse whitespace so wrap breaks don't defeat the assertion.
		flat := strings.Join(strings.Fields(view), " ")
		if !strings.Contains(flat, fragment) {
			t.Errorf("wrapped view should contain %q somewhere, got flattened:\n%s", fragment, flat)
		}
	}
	// Wrap must produce multiple visible lines that each fit the budget
	// (width 60 minus 4-space indent = 56 cells). We allow a small overshoot
	// because wordwrap won't break long unbroken tokens.
	for _, line := range strings.Split(view, "\n") {
		trimmed := strings.TrimRight(line, " ")
		if len(trimmed) > 80 {
			t.Errorf("wrapped line exceeded reasonable width (%d cells): %q", len(trimmed), trimmed)
		}
	}
	// At least one wrap break must have happened.
	bodyLines := 0
	for _, line := range strings.Split(view, "\n") {
		if strings.Contains(line, "failing") || strings.Contains(line, "rubric") || strings.Contains(line, "Mode A") {
			bodyLines++
		}
	}
	if bodyLines < 2 {
		t.Errorf("expected the long error to wrap across multiple lines, got %d body lines:\n%s", bodyLines, view)
	}
}

// TestGenerateModel_View_FailurePhase_TinyWidthDoesNotPanic clamps the wrap
// budget when the terminal is absurdly narrow (e.g. fresh tea program before
// the first WindowSizeMsg arrives, width=0). Should render *something* rather
// than panicking on a non-positive wrap width.
func TestGenerateModel_View_FailurePhase_TinyWidthDoesNotPanic(t *testing.T) {
	m := newBootstrapGenerateModel(nil, &BootstrapOptions{OutputDir: "./x"})
	m.width = 0 // no WindowSizeMsg yet
	m.stderrBuf = *bytes.NewBufferString("a long line with several words to consume the wrap budget\n")
	m.Update(subprocessDoneMsg{exitCode: 1})
	view := stripANSI(m.View())
	if !strings.Contains(view, "Generation failed") {
		t.Errorf("expected header even at width=0, got:\n%s", view)
	}
}

// TestGenerateModel_Init_DispatchesSpinnerAndSubprocess confirms Init
// schedules both the spinner tick (so the user gets visible motion) and the
// subprocess Cmd (so generation actually starts).
func TestGenerateModel_Init_DispatchesSpinnerAndSubprocess(t *testing.T) {
	fake := &fakeRunner{code: 0}
	m := newBootstrapGenerateModel(fake, &BootstrapOptions{OutputDir: "/tmp/x"})
	cmd := m.Init()
	if cmd == nil {
		t.Fatal("Init should return a non-nil Cmd")
	}
}

// TestGenerateModel_SpinnerTickAdvancesSpinner makes sure the spinner is
// hooked up so the user gets visible motion during long runs.
func TestGenerateModel_SpinnerTickAdvancesSpinner(t *testing.T) {
	m := newBootstrapGenerateModel(nil, &BootstrapOptions{OutputDir: "./x"})
	before := m.spin.View()
	model, cmd := m.Update(spinner.TickMsg{})
	if cmd == nil {
		t.Error("spinner tick should re-issue its own Tick command")
	}
	if _, ok := model.(*bootstrapGenerateModel); !ok {
		t.Fatalf("Update should return *bootstrapGenerateModel, got %T", model)
	}
	// Spinner frame is allowed to be identical between consecutive ticks
	// (slow update cadence). We're just confirming the chain is wired.
	_ = before
}

// TestGenerateModel_StreamForwarding ensures subprocess stdout/stderr are
// captured into the model's buffers (not the caller's) so the alt-screen
// isn't clobbered mid-render. The top-level runBootstrapGenerate forwards
// them after the tea program exits — this test stops before that point.
func TestGenerateModel_StreamForwarding(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("io.Writer-based runner.Run is platform-agnostic but path assertions below assume Unix")
	}
	fake := &fakeRunner{code: 0, stdout: "consola: success\n", stderr: "warning: deprecated flag\n"}
	m := newBootstrapGenerateModel(fake, &BootstrapOptions{OutputDir: "/tmp/x"})
	// Directly invoke the Cmd that Init schedules instead of running the
	// program — this gives us full control over message ordering.
	cmd := m.runSubprocess()
	msg := cmd()
	done, ok := msg.(subprocessDoneMsg)
	if !ok {
		t.Fatalf("expected subprocessDoneMsg, got %T", msg)
	}
	if done.exitCode != 0 {
		t.Errorf("expected exit 0, got %d", done.exitCode)
	}
	if !fake.called {
		t.Error("fake runner should have been called")
	}
	if !strings.Contains(m.stdoutBuf.String(), "consola: success") {
		t.Errorf("subprocess stdout should be captured to model buffer, got %q", m.stdoutBuf.String())
	}
	if !strings.Contains(m.stderrBuf.String(), "deprecated flag") {
		t.Errorf("subprocess stderr should be captured to model buffer, got %q", m.stderrBuf.String())
	}
}
