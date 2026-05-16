package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The manual test script lives at scripts/manual-test-interview.sh under the
// repo root. From the tui/ test cwd that's "../scripts/manual-test-interview.sh".
const manualTestScriptPath = "../scripts/manual-test-interview.sh"

func TestManualTestScript_Exists(t *testing.T) {
	info, err := os.Stat(manualTestScriptPath)
	if err != nil {
		t.Fatalf("manual test script not found at %s: %v", manualTestScriptPath, err)
	}
	mode := info.Mode().Perm()
	if mode&0o100 == 0 {
		t.Errorf("manual test script must be executable, mode=%o", mode)
	}
}

func TestManualTestScript_CoversAllRequiredSteps(t *testing.T) {
	body := readScript(t, manualTestScriptPath)
	required := []string{
		"interview bootstrap", // wizard step
		"--headless",          // headless bootstrap step
		"interview review",    // review step
		"interview cohort",    // cohort step
		"sign-off",            // sign-off gating step
	}
	for _, kw := range required {
		if !strings.Contains(body, kw) {
			t.Errorf("script must mention %q step, missing", kw)
		}
	}
}

func TestManualTestScript_PausesBetweenSteps(t *testing.T) {
	body := readScript(t, manualTestScriptPath)
	if !strings.Contains(strings.ToLower(body), "press") {
		t.Errorf("script should pause with a press-Enter prompt for human verification")
	}
}

func TestManualTestScript_DoesNotRequireOpenAIKey(t *testing.T) {
	body := readScript(t, manualTestScriptPath)
	// The review step must use --mode-analysis human-only (or an explicit
	// stub observer flag) so the operator doesn't need an API key.
	hasHumanOnly := strings.Contains(body, "human-only")
	if !hasHumanOnly {
		t.Errorf("script must invoke review with human-only analysis to avoid OpenAI costs; body did not mention 'human-only'")
	}
}

func readScript(t *testing.T, p string) string {
	t.Helper()
	abs, _ := filepath.Abs(p)
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("could not read script at %s (abs=%s): %v", p, abs, err)
	}
	return string(b)
}
