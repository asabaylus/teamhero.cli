package main

import (
	"bytes"
	"io"
	"testing"
)

func TestParseCohortFlags(t *testing.T) {
	opts, parseErr := ParseCohortFlags([]string{"--role", "senior-backend", "--order", "chronological"})
	if parseErr != "" {
		t.Fatalf("parse error: %s", parseErr)
	}
	if opts.Role != "senior-backend" || opts.Order != "chronological" {
		t.Errorf("unexpected opts: %+v", opts)
	}
}

func TestValidateCohortOptions_RequiresRole(t *testing.T) {
	if msg := ValidateCohortOptions(&CohortOptions{}); msg == "" {
		t.Fatal("expected validation error on missing --role")
	}
}

func TestValidateCohortOptions_RejectsBadOrder(t *testing.T) {
	if msg := ValidateCohortOptions(&CohortOptions{Role: "x", Order: "scored"}); msg == "" {
		t.Fatal("expected validation error on bad order")
	}
}

type stubCohortRunner struct {
	gotOpts *CohortOptions
	code    int
}

func (s *stubCohortRunner) Run(opts *CohortOptions, _, _ io.Writer) int {
	s.gotOpts = opts
	return s.code
}

func TestRunInterviewCohort_DelegatesAndForwardsExit(t *testing.T) {
	var out, errBuf bytes.Buffer
	stub := &stubCohortRunner{code: 3}
	code := runInterviewCohort([]string{"--role", "senior-backend"}, stub, &out, &errBuf)
	if code != 3 {
		t.Errorf("expected exit 3, got %d", code)
	}
	if stub.gotOpts == nil || stub.gotOpts.Role != "senior-backend" {
		t.Errorf("runner not called with role")
	}
}
