package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestRunInterview_NoVerb_PrintsUsageAndReturnsNonZero(t *testing.T) {
	var out bytes.Buffer
	code := runInterview(nil, &out)
	if code == 0 {
		t.Errorf("expected non-zero exit code, got %d", code)
	}
	if out.Len() == 0 {
		t.Errorf("expected usage output, got empty buffer")
	}
}

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
