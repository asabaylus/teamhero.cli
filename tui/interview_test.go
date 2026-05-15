package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestRunInterview_NoVerb_NoTTY_PrintsUsageAndReturnsNonZero(t *testing.T) {
	// Pin stdin-is-TTY to false so the non-interactive fallback path is
	// exercised regardless of whether the developer runs `go test` from a
	// terminal or from CI. Without this pin a TTY developer's run would
	// drop into the huh picker and hang.
	origTTY := isStdinTTY
	t.Cleanup(func() { isStdinTTY = origTTY })
	isStdinTTY = func() bool { return false }

	var out bytes.Buffer
	code := runInterview(nil, &out)
	if code == 0 {
		t.Errorf("expected non-zero exit code, got %d", code)
	}
	if out.Len() == 0 {
		t.Errorf("expected usage output, got empty buffer")
	}
}

func TestRunInterview_NoVerb_TTY_DispatchesPickedVerb(t *testing.T) {
	// Stub the picker so the dispatcher runs without touching a real TTY,
	// then assert that the chosen verb actually reached its handler. The
	// "cohort" verb without flags hits ValidateCohortOptions and returns
	// the "missing required flag" path — that's our proof of dispatch.
	origTTY := isStdinTTY
	origPicker := interviewVerbPicker
	t.Cleanup(func() {
		isStdinTTY = origTTY
		interviewVerbPicker = origPicker
	})
	isStdinTTY = func() bool { return true }
	interviewVerbPicker = func() (string, error) { return "cohort", nil }

	var out bytes.Buffer
	code := runInterview(nil, &out)
	if code == 0 {
		t.Errorf("picked verb with no flags should return non-zero, got %d", code)
	}
	if out.Len() == 0 {
		t.Errorf("expected dispatch to write something to the output buffer")
	}
}

func TestRunInterview_NoVerb_TTY_CancelReturnsZero(t *testing.T) {
	// Picker returning an empty verb == user picked "Cancel" or aborted.
	// That's not a failure, just nothing-to-do. Exit 0 with no error noise.
	origTTY := isStdinTTY
	origPicker := interviewVerbPicker
	t.Cleanup(func() {
		isStdinTTY = origTTY
		interviewVerbPicker = origPicker
	})
	isStdinTTY = func() bool { return true }
	interviewVerbPicker = func() (string, error) { return "", nil }

	var out bytes.Buffer
	code := runInterview(nil, &out)
	if code != 0 {
		t.Errorf("cancel should exit 0, got %d", code)
	}
	if out.Len() != 0 {
		t.Errorf("cancel should not write to output, got %q", out.String())
	}
}

func TestRunInterview_NoVerb_TTY_PickerErrorReturnsNonZero(t *testing.T) {
	origTTY := isStdinTTY
	origPicker := interviewVerbPicker
	t.Cleanup(func() {
		isStdinTTY = origTTY
		interviewVerbPicker = origPicker
	})
	isStdinTTY = func() bool { return true }
	interviewVerbPicker = func() (string, error) {
		return "", &pickerErr{msg: "boom"}
	}

	var out bytes.Buffer
	code := runInterview(nil, &out)
	if code == 0 {
		t.Errorf("picker error should return non-zero, got %d", code)
	}
	if !strings.Contains(out.String(), "boom") {
		t.Errorf("expected picker error in output, got %q", out.String())
	}
}

type pickerErr struct{ msg string }

func (e *pickerErr) Error() string { return e.msg }

func TestRunInterview_BootstrapVerb_RequiresFlags(t *testing.T) {
	// `bootstrap` with no flags drops into the interactive wizard on a TTY
	// or exits non-zero otherwise. Pin stdin-is-TTY to false so the test
	// exercises the "no TTY → reject" path deterministically rather than
	// inheriting whichever stdin the developer's `go test` session has —
	// without this pin, an interactive go-test invocation would launch the
	// real bubbletea program and hang.
	origTTY := isStdinTTY
	t.Cleanup(func() { isStdinTTY = origTTY })
	isStdinTTY = func() bool { return false }

	var out bytes.Buffer
	code := runInterview([]string{"bootstrap"}, &out)
	if code == 0 {
		t.Errorf("bootstrap without flags and no TTY should return non-zero, got %d", code)
	}
}

func TestRunInterview_ReviewVerb_RequiresFlags(t *testing.T) {
	// review is implemented in Slice 4; with no flags it should reject
	// (--candidate and either --repo or --local-repo-path are required).
	var out bytes.Buffer
	code := runInterview([]string{"review"}, &out)
	if code == 0 {
		t.Errorf("review without flags should return non-zero, got %d", code)
	}
}

func TestRunInterview_CohortVerb_RequiresFlags(t *testing.T) {
	// cohort is implemented in Slice 5; with no flags it should reject
	// (--role is required).
	var out bytes.Buffer
	code := runInterview([]string{"cohort"}, &out)
	if code == 0 {
		t.Errorf("cohort without flags should return non-zero, got %d", code)
	}
}

func TestRunInterview_UnknownVerb_ReturnsNonZero(t *testing.T) {
	var out bytes.Buffer
	code := runInterview([]string{"not-a-real-verb"}, &out)
	if code == 0 {
		t.Errorf("unknown verb should return non-zero, got %d", code)
	}
}

func TestPrintInterviewUsage_ListsAllThreeVerbs(t *testing.T) {
	var out bytes.Buffer
	printInterviewUsage(&out)
	got := out.String()
	for _, verb := range []string{"bootstrap", "review", "cohort"} {
		if !strings.Contains(got, verb) {
			t.Errorf("interview usage should list verb %q; got: %s", verb, got)
		}
	}
}
