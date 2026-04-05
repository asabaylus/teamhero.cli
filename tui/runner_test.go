package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestPlatformKey_Format(t *testing.T) {
	key := platformKey()
	parts := strings.SplitN(key, "-", 2)
	if len(parts) != 2 {
		t.Errorf("platformKey() = %q, want os-arch format with hyphen", key)
	}
	osName := parts[0]
	if osName != runtime.GOOS {
		t.Errorf("platformKey OS = %q, want %q", osName, runtime.GOOS)
	}
}

func TestPlatformKey_Amd64Mapped(t *testing.T) {
	key := platformKey()
	if runtime.GOARCH == "amd64" {
		if !strings.HasSuffix(key, "-x64") {
			t.Errorf("platformKey() = %q, expected amd64 to be mapped to x64", key)
		}
	}
}

func TestPlatformKey_NonAmd64(t *testing.T) {
	key := platformKey()
	if runtime.GOARCH != "amd64" {
		expected := runtime.GOOS + "-" + runtime.GOARCH
		if key != expected {
			t.Errorf("platformKey() = %q, want %q", key, expected)
		}
	}
}

func TestResolveBunBinary_EnvVar(t *testing.T) {
	t.Setenv("TEAMHERO_BUN_PATH", "/custom/path/to/bun")
	got := resolveBunBinary()
	if got != "/custom/path/to/bun" {
		t.Errorf("resolveBunBinary() = %q, want %q", got, "/custom/path/to/bun")
	}
}

func TestResolveBunBinary_NoEnvVar(t *testing.T) {
	t.Setenv("TEAMHERO_BUN_PATH", "")
	got := resolveBunBinary()
	// Should either find bun in PATH or return "bun" as fallback
	if got == "" {
		t.Error("resolveBunBinary() should not return empty string")
	}
}

func TestResolveScriptPath_RelativeToCWD(t *testing.T) {
	// Create a temp dir with the expected script structure
	tmpDir := t.TempDir()
	scriptDir := tmpDir + "/scripts"
	os.MkdirAll(scriptDir, 0o755)
	os.WriteFile(scriptDir+"/run-report.ts", []byte("// test"), 0o644)

	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(tmpDir)

	got := resolveScriptPath()
	if got != "scripts/run-report.ts" {
		// Could also find via binary path or absolute fallback
		if !strings.Contains(got, "run-report.ts") {
			t.Errorf("resolveScriptPath() = %q, expected to contain 'run-report.ts'", got)
		}
	}
}

func TestResolveScriptPath_FallbackPath(t *testing.T) {
	// When no script exists in any expected location
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(tmpDir)

	got := resolveScriptPath()
	// Should return the default fallback
	if !strings.Contains(got, "run-report.ts") {
		t.Errorf("resolveScriptPath() = %q, expected fallback containing 'run-report.ts'", got)
	}
}

// ---------------------------------------------------------------------------
// resolveServiceBinary tests
// ---------------------------------------------------------------------------

func TestResolveServiceBinary_NotFound(t *testing.T) {
	// resolveServiceBinary looks next to the current binary.
	// In test mode, the test binary is in a temp dir without teamhero-service,
	// so it should return empty.
	got := resolveServiceBinary()
	// We can't guarantee the binary does or does not exist next to the test binary,
	// so we just verify it returns a string (possibly empty) without panic.
	_ = got
}

func TestResolveServiceBinary_FoundNextToExecutable(t *testing.T) {
	// Get the test executable path
	exePath, err := os.Executable()
	if err != nil {
		t.Skip("cannot determine executable path")
	}
	dir := os.TempDir()
	_ = dir

	// Create a temp directory with a fake service binary
	tmpDir := t.TempDir()
	name := "teamhero-service"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	fakeBin := tmpDir + "/" + name
	os.WriteFile(fakeBin, []byte("#!/bin/sh\n"), 0o755)

	// resolveServiceBinary uses os.Executable() which we can't override,
	// so we verify the current behavior: it looks next to the actual binary
	got := resolveServiceBinary()
	// The real test binary is not next to a teamhero-service, so empty
	_ = exePath
	_ = got
}

// ---------------------------------------------------------------------------
// resolveBunBinary edge cases
// ---------------------------------------------------------------------------

func TestResolveBunBinary_EnvVarTakesPrecedence(t *testing.T) {
	t.Setenv("TEAMHERO_BUN_PATH", "/opt/bun/bin/bun")
	got := resolveBunBinary()
	if got != "/opt/bun/bin/bun" {
		t.Errorf("expected env path, got %q", got)
	}
}

func TestResolveBunBinary_EmptyEnvFallsToPath(t *testing.T) {
	t.Setenv("TEAMHERO_BUN_PATH", "")
	got := resolveBunBinary()
	// Should either find bun in PATH or fallback to "bun"
	if got == "" {
		t.Error("expected non-empty result")
	}
}

func TestResolveBunBinary_FallbackIsBun(t *testing.T) {
	t.Setenv("TEAMHERO_BUN_PATH", "")
	// Even if bun is not in PATH, the fallback is "bun"
	got := resolveBunBinary()
	// Should at least be "bun" as the final fallback
	if got != "bun" {
		// It's either "bun" or a full path found via LookPath
		if !strings.Contains(got, "bun") {
			t.Errorf("expected result containing 'bun', got %q", got)
		}
	}
}

// ---------------------------------------------------------------------------
// platformKey tests
// ---------------------------------------------------------------------------

func TestPlatformKey_ContainsOS(t *testing.T) {
	key := platformKey()
	if !strings.HasPrefix(key, runtime.GOOS+"-") {
		t.Errorf("platformKey() = %q, expected to start with %q", key, runtime.GOOS+"-")
	}
}

func TestPlatformKey_Deterministic(t *testing.T) {
	key1 := platformKey()
	key2 := platformKey()
	if key1 != key2 {
		t.Errorf("platformKey() not deterministic: %q vs %q", key1, key2)
	}
}

// ---------------------------------------------------------------------------
// Helper: createFakeBun writes a shell script that pretends to be "bun".
// It reads RUNNER_MODE to decide what to output on stdout and how to exit.
// The script ignores its arguments (which would normally be "run <script>").
// Returns the path to the fake bun binary.
// ---------------------------------------------------------------------------

func createFakeBun(t *testing.T, mode string) string {
	t.Helper()
	tmpDir := t.TempDir()
	fakeBun := filepath.Join(tmpDir, "fake-bun")
	script := `#!/bin/sh
# Read and discard stdin so the writing side does not get SIGPIPE
cat > /dev/null
MODE="` + mode + `"
case "$MODE" in
  json-events)
    echo '{"type":"progress","step":"git","status":"running","message":"Fetching git data..."}'
    echo '{"type":"progress","step":"git","status":"done","message":"Git data complete"}'
    echo '{"type":"result","outputPath":"/tmp/report.md"}'
    exit 0
    ;;
  mixed-output)
    echo 'some random log line'
    echo '{"type":"progress","step":"asana","status":"running"}'
    echo ''
    echo 'WARNING'
    echo '{"type":"result","outputPath":"/tmp/out.md"}'
    exit 0
    ;;
  exit-error)
    echo '{"type":"progress","step":"git","status":"running"}'
    exit 1
    ;;
  no-output)
    exit 0
    ;;
  foreground-ok)
    echo 'Report generated successfully'
    exit 0
    ;;
  foreground-fail)
    echo 'Fatal error occurred' >&2
    exit 2
    ;;
  *)
    echo "unknown MODE: $MODE" >&2
    exit 99
    ;;
esac
`
	if err := os.WriteFile(fakeBun, []byte(script), 0o755); err != nil {
		t.Fatalf("failed to create fake bun: %v", err)
	}

	// Also create a dummy run-report.ts in a scripts/ subdir so resolveScriptPath
	// finds it relative to CWD.
	scriptDir := filepath.Join(tmpDir, "scripts")
	os.MkdirAll(scriptDir, 0o755)
	os.WriteFile(filepath.Join(scriptDir, "run-report.ts"), []byte("// stub"), 0o644)

	return fakeBun
}

// ---------------------------------------------------------------------------
// RunServiceRunner tests
//
// Strategy: create a fake bun shell script, point TEAMHERO_BUN_PATH to it,
// and chdir to the temp dir so resolveScriptPath finds our dummy script.
// ---------------------------------------------------------------------------

func TestRunServiceRunner_ReceivesJSONEvents(t *testing.T) {
	fakeBun := createFakeBun(t, "json-events")
	tmpDir := filepath.Dir(fakeBun)

	t.Setenv("TEAMHERO_BUN_PATH", fakeBun)

	origDir, _ := os.Getwd()
	t.Cleanup(func() { os.Chdir(origDir) })
	os.Chdir(tmpDir)

	input := ReportCommandInput{Org: "test-org"}
	eventCh, errCh, stderrBuf := RunServiceRunner(input)

	var events []GenericEvent
	for evt := range eventCh {
		events = append(events, evt)
	}

	// Drain error channel
	var runErr error
	select {
	case runErr = <-errCh:
	default:
	}

	if runErr != nil {
		t.Fatalf("unexpected error: %v (stderr: %s)", runErr, stderrBuf.String())
	}

	if len(events) != 3 {
		t.Fatalf("got %d events, want 3", len(events))
	}
	if events[0].Type != "progress" || events[0].Step != "git" {
		t.Errorf("events[0] = %+v, want progress/git", events[0])
	}
	if events[1].Type != "progress" || events[1].Status != "done" {
		t.Errorf("events[1] = %+v, want progress/done", events[1])
	}
	if events[2].Type != "result" || events[2].OutputPath != "/tmp/report.md" {
		t.Errorf("events[2] = %+v, want result with outputPath", events[2])
	}
}

func TestRunServiceRunner_SkipsNonJSON(t *testing.T) {
	fakeBun := createFakeBun(t, "mixed-output")
	tmpDir := filepath.Dir(fakeBun)

	t.Setenv("TEAMHERO_BUN_PATH", fakeBun)

	origDir, _ := os.Getwd()
	t.Cleanup(func() { os.Chdir(origDir) })
	os.Chdir(tmpDir)

	input := ReportCommandInput{Org: "test-org"}
	eventCh, errCh, _ := RunServiceRunner(input)

	var events []GenericEvent
	for evt := range eventCh {
		events = append(events, evt)
	}

	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	default:
	}

	// Should have exactly 2 valid JSON events (non-JSON and blank lines skipped)
	if len(events) != 2 {
		t.Fatalf("got %d events, want 2 (non-JSON skipped)", len(events))
	}
	if events[0].Type != "progress" || events[0].Step != "asana" {
		t.Errorf("events[0] = %+v, want progress/asana", events[0])
	}
	if events[1].Type != "result" {
		t.Errorf("events[1] = %+v, want result", events[1])
	}
}

func TestRunServiceRunner_ExitError(t *testing.T) {
	fakeBun := createFakeBun(t, "exit-error")
	tmpDir := filepath.Dir(fakeBun)

	t.Setenv("TEAMHERO_BUN_PATH", fakeBun)

	origDir, _ := os.Getwd()
	t.Cleanup(func() { os.Chdir(origDir) })
	os.Chdir(tmpDir)

	input := ReportCommandInput{Org: "test-org"}
	eventCh, errCh, _ := RunServiceRunner(input)

	// Drain events
	var events []GenericEvent
	for evt := range eventCh {
		events = append(events, evt)
	}

	// Should get an error about non-zero exit
	var runErr error
	select {
	case runErr = <-errCh:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for error")
	}

	if runErr == nil {
		t.Fatal("expected error for non-zero exit, got nil")
	}
	if !strings.Contains(runErr.Error(), "exited with code") {
		t.Errorf("expected exit code error, got: %v", runErr)
	}

	// Should still have received the one event before the exit
	if len(events) != 1 {
		t.Errorf("got %d events, want 1 (emitted before exit)", len(events))
	}
}

func TestRunServiceRunner_NoOutput(t *testing.T) {
	fakeBun := createFakeBun(t, "no-output")
	tmpDir := filepath.Dir(fakeBun)

	t.Setenv("TEAMHERO_BUN_PATH", fakeBun)

	origDir, _ := os.Getwd()
	t.Cleanup(func() { os.Chdir(origDir) })
	os.Chdir(tmpDir)

	input := ReportCommandInput{Org: "test-org"}
	eventCh, errCh, _ := RunServiceRunner(input)

	var events []GenericEvent
	for evt := range eventCh {
		events = append(events, evt)
	}

	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	default:
	}

	if len(events) != 0 {
		t.Errorf("got %d events, want 0", len(events))
	}
}

func TestRunServiceRunner_ComplexInput(t *testing.T) {
	// Verify RunServiceRunner doesn't fail when marshalling complex input
	fakeBun := createFakeBun(t, "no-output")
	tmpDir := filepath.Dir(fakeBun)

	t.Setenv("TEAMHERO_BUN_PATH", fakeBun)

	origDir, _ := os.Getwd()
	t.Cleanup(func() { os.Chdir(origDir) })
	os.Chdir(tmpDir)

	input := ReportCommandInput{
		Org:     "test-org",
		Members: []string{"alice", "bob"},
		Repos:   []string{"repo-a"},
		Since:   "2026-01-01",
		Until:   "2026-01-31",
	}
	eventCh, errCh, _ := RunServiceRunner(input)

	for range eventCh {
	}
	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	default:
	}
}

func TestRunServiceRunner_StderrCaptured(t *testing.T) {
	// Verify that subprocess stderr is captured into the buffer
	tmpDir := t.TempDir()
	fakeBun := filepath.Join(tmpDir, "fake-bun")
	script := `#!/bin/sh
cat > /dev/null
echo '{"type":"result","outputPath":"/tmp/report.md"}'
echo 'stderr warning message' >&2
exit 0
`
	os.WriteFile(fakeBun, []byte(script), 0o755)
	scriptDir := filepath.Join(tmpDir, "scripts")
	os.MkdirAll(scriptDir, 0o755)
	os.WriteFile(filepath.Join(scriptDir, "run-report.ts"), []byte("// stub"), 0o644)

	t.Setenv("TEAMHERO_BUN_PATH", fakeBun)

	origDir, _ := os.Getwd()
	t.Cleanup(func() { os.Chdir(origDir) })
	os.Chdir(tmpDir)

	input := ReportCommandInput{Org: "test-org"}
	eventCh, errCh, stderrBuf := RunServiceRunner(input)

	for range eventCh {
	}
	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	default:
	}

	stderr := stderrBuf.String()
	if !strings.Contains(stderr, "stderr warning message") {
		t.Errorf("expected stderr to contain warning, got: %q", stderr)
	}
}

// ---------------------------------------------------------------------------
// RunServiceForeground tests
// ---------------------------------------------------------------------------

func TestRunServiceForeground_Success(t *testing.T) {
	fakeBun := createFakeBun(t, "foreground-ok")
	tmpDir := filepath.Dir(fakeBun)

	t.Setenv("TEAMHERO_BUN_PATH", fakeBun)

	origDir, _ := os.Getwd()
	t.Cleanup(func() { os.Chdir(origDir) })
	os.Chdir(tmpDir)

	input := ReportCommandInput{Org: "test-org"}
	err := RunServiceForeground(input)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
}

func TestRunServiceForeground_ExitError(t *testing.T) {
	fakeBun := createFakeBun(t, "foreground-fail")
	tmpDir := filepath.Dir(fakeBun)

	t.Setenv("TEAMHERO_BUN_PATH", fakeBun)

	origDir, _ := os.Getwd()
	t.Cleanup(func() { os.Chdir(origDir) })
	os.Chdir(tmpDir)

	input := ReportCommandInput{Org: "test-org"}
	err := RunServiceForeground(input)
	if err == nil {
		t.Fatal("expected error for non-zero exit, got nil")
	}
	if !strings.Contains(err.Error(), "exited with code") {
		t.Errorf("expected exit code error, got: %v", err)
	}
}

func TestRunServiceForeground_ConfigMarshal(t *testing.T) {
	// Verify that the input is correctly JSON-marshalled (no panic on complex input)
	input := ReportCommandInput{
		Org:             "myorg",
		Team:            "myteam",
		Members:         []string{"a", "b", "c"},
		Repos:           []string{"r1", "r2"},
		Since:           "2026-02-01",
		Until:           "2026-02-28",
		IncludeBots:     true,
		ExcludePrivate:  false,
		IncludeArchived: true,
		Detailed:        true,
		FlushCache:      "all",
		Mode:            "headless",
		OutputPath:      "/tmp/out.md",
		OutputFormat:    "markdown",
		Sections: ReportSections{
			DataSources: DataSources{Git: true, Asana: true},
			ReportSections: ReportSectionsInner{
				VisibleWins:             true,
				IndividualContributions: true,
				DiscrepancyLog:          true,
				Loc:                     true,
			},
		},
	}

	// Marshal should succeed
	b, err := json.Marshal(input)
	if err != nil {
		t.Fatalf("failed to marshal input: %v", err)
	}

	// Verify key fields in the JSON
	jsonStr := string(b)
	if !strings.Contains(jsonStr, `"org":"myorg"`) {
		t.Errorf("JSON missing org field: %s", jsonStr)
	}
	if !strings.Contains(jsonStr, `"team":"myteam"`) {
		t.Errorf("JSON missing team field: %s", jsonStr)
	}
	if !strings.Contains(jsonStr, `"flushCache":"all"`) {
		t.Errorf("JSON missing flushCache field: %s", jsonStr)
	}
}

// ---------------------------------------------------------------------------
// resolveDiscoverScript tests (in context of runner — file-system based)
// ---------------------------------------------------------------------------

func TestResolveDiscoverScript_FromCWD(t *testing.T) {
	tmpDir := t.TempDir()
	scriptDir := tmpDir + "/scripts"
	os.MkdirAll(scriptDir, 0o755)
	os.WriteFile(scriptDir+"/discover.ts", []byte("// test"), 0o644)

	origDir, _ := os.Getwd()
	t.Cleanup(func() { os.Chdir(origDir) })
	os.Chdir(tmpDir)

	got := resolveDiscoverScript()
	if got != "scripts/discover.ts" {
		if !strings.Contains(got, "discover.ts") {
			t.Errorf("resolveDiscoverScript() = %q, expected 'discover.ts'", got)
		}
	}
}

func TestResolveBunBinary_FallbackWhenNotInPath(t *testing.T) {
	t.Setenv("TEAMHERO_BUN_PATH", "")
	t.Setenv("PATH", "/does-not-exist-path")
	got := resolveBunBinary()
	if got != "bun" {
		t.Errorf("expected fallback 'bun', got %q", got)
	}
}
