package main

import (
	"os/exec"
	"strings"
	"testing"
)

// buildTUI compiles the TUI binary into a temp directory for testing.
func buildTUI(t *testing.T) string {
	t.Helper()
	binary := t.TempDir() + "/teamhero-tui"
	cmd := exec.Command("go", "build", "-o", binary, ".")
	cmd.Dir = "."
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("failed to build TUI binary: %v\n%s", err, out)
	}
	return binary
}

func runBinary(t *testing.T, binary string, args ...string) (stdout, stderr string) {
	t.Helper()
	cmd := exec.Command(binary, args...)
	var outBuf, errBuf strings.Builder
	cmd.Stdout = &outBuf
	cmd.Stderr = &errBuf
	_ = cmd.Run() // --help exits 0, don't fail on exit code
	return outBuf.String(), errBuf.String()
}

func TestHelpTopLevel(t *testing.T) {
	binary := buildTUI(t)
	_, stderr := runBinary(t, binary, "--help")

	if !strings.Contains(stderr, "teamhero <command>") {
		t.Error("top-level help should show 'teamhero <command>'")
	}
	if !strings.Contains(stderr, "report") {
		t.Error("top-level help should list 'report' command")
	}
	if !strings.Contains(stderr, "setup") {
		t.Error("top-level help should list 'setup' command")
	}
	if !strings.Contains(stderr, "doctor") {
		t.Error("top-level help should list 'doctor' command")
	}
	// Should NOT contain report-specific flags
	if strings.Contains(stderr, "--headless") {
		t.Error("top-level help should not show report-specific flags")
	}
}

func TestHelpReport(t *testing.T) {
	binary := buildTUI(t)
	_, stderr := runBinary(t, binary, "report", "--help")

	if !strings.Contains(stderr, "teamhero report") {
		t.Error("report help should show 'teamhero report'")
	}
	if !strings.Contains(stderr, "--headless") {
		t.Error("report help should show --headless flag")
	}
	if !strings.Contains(stderr, "--org") {
		t.Error("report help should show --org flag")
	}
	if !strings.Contains(stderr, "--sources") {
		t.Error("report help should show --sources flag")
	}
	if !strings.Contains(stderr, "--output-format") {
		t.Error("report help should show --output-format flag")
	}
	// Should NOT contain doctor or setup flags
	if strings.Contains(stderr, "--format json") {
		t.Error("report help should not show doctor's --format flag")
	}
}

func TestHelpDoctor(t *testing.T) {
	binary := buildTUI(t)
	_, stderr := runBinary(t, binary, "doctor", "--help")

	if !strings.Contains(stderr, "teamhero doctor") {
		t.Error("doctor help should show 'teamhero doctor'")
	}
	if !strings.Contains(stderr, "--format json") {
		t.Error("doctor help should show --format flag")
	}
	// Should NOT contain report-specific flags
	if strings.Contains(stderr, "--headless") {
		t.Error("doctor help should not show report-specific flags")
	}
}

func TestHelpReportShowsAdvancedFlag(t *testing.T) {
	binary := buildTUI(t)
	_, stderr := runBinary(t, binary, "report", "--help")

	if !strings.Contains(stderr, "--advanced") {
		t.Error("report help should show --advanced flag")
	}
}

func TestHelpSetup(t *testing.T) {
	binary := buildTUI(t)
	_, stderr := runBinary(t, binary, "setup", "--help")

	if !strings.Contains(stderr, "teamhero setup") {
		t.Error("setup help should show 'teamhero setup'")
	}
	if !strings.Contains(stderr, "~/.config/teamhero/.env") {
		t.Error("setup help should mention credential location")
	}
	if !strings.Contains(stderr, "GITHUB_PERSONAL_ACCESS_TOKEN") {
		t.Error("setup help should mention GITHUB_PERSONAL_ACCESS_TOKEN")
	}
	// Should NOT contain report-specific flags
	if strings.Contains(stderr, "--headless") {
		t.Error("setup help should not show report-specific flags")
	}
}
