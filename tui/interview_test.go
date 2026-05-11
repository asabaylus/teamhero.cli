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
	// bootstrap is implemented in Slice 2; with no flags it should reject
	// (only --headless mode is supported at this stage).
	var out bytes.Buffer
	code := runInterview([]string{"bootstrap"}, &out)
	if code == 0 {
		t.Errorf("bootstrap without flags should return non-zero, got %d", code)
	}
}

func TestRunInterview_GradeVerb_RequiresFlags(t *testing.T) {
	// grade is implemented in Slice 4; with no flags it should reject
	// (--candidate and either --repo or --local-repo-path are required).
	var out bytes.Buffer
	code := runInterview([]string{"grade"}, &out)
	if code == 0 {
		t.Errorf("grade without flags should return non-zero, got %d", code)
	}
}

func TestRunInterview_CohortVerb_NotYetImplemented(t *testing.T) {
	var out bytes.Buffer
	code := runInterview([]string{"cohort"}, &out)
	if code == 0 {
		t.Errorf("cohort stub should return non-zero, got %d", code)
	}
	if !strings.Contains(out.String(), "not yet implemented") {
		t.Errorf("expected 'not yet implemented' in output, got %q", out.String())
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
	for _, verb := range []string{"bootstrap", "grade", "cohort"} {
		if !strings.Contains(got, verb) {
			t.Errorf("interview usage should list verb %q; got: %s", verb, got)
		}
	}
}
