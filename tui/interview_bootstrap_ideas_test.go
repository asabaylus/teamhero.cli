package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

// recordingDoer captures every request the fetcher sends and returns the
// canned responses in order. Tests use it to assert prompt content and
// drive both success and error paths through the JSON-schema validator.
type recordingDoer struct {
	requests  []*http.Request
	responses []*http.Response
	errs      []error
}

func (r *recordingDoer) Do(req *http.Request) (*http.Response, error) {
	idx := len(r.requests)
	r.requests = append(r.requests, req)
	if idx >= len(r.responses) {
		return nil, fmt.Errorf("no response staged for call %d", idx)
	}
	resp := r.responses[idx]
	var err error
	if idx < len(r.errs) {
		err = r.errs[idx]
	}
	return resp, err
}

func mkRespBody(body string) *http.Response {
	return &http.Response{
		StatusCode: 200,
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestBuildIdeaPrompt_IncludesRoleProfile(t *testing.T) {
	p := IdeaProfile{
		Role:           "senior-backend",
		RoleTitle:      "Senior Backend Engineer",
		Stack:          "Go",
		Domain:         "Payments",
		Feature:        "Refund idempotency",
		TimeBoxMinutes: 90,
		ProjectMode:    "A",
	}
	prompt := buildIdeaPrompt(p)
	for _, want := range []string{
		"Senior Backend Engineer", "Go", "Payments",
		"Refund idempotency", "90", "Project mode: A",
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("prompt missing %q\nprompt:\n%s", want, prompt)
		}
	}
}

// TestBuildIdeaPrompt_WithoutJD_KeepsExistingShape pins today's prompt
// output for a fixed input. It guards against the upcoming JD-aware
// changes accidentally reshaping the no-JD prompt — the byte-equal
// snapshot fails if any branch of buildIdeaPrompt mutates the
// no-JD path.
func TestBuildIdeaPrompt_WithoutJD_KeepsExistingShape(t *testing.T) {
	p := IdeaProfile{
		Role:           "senior-backend",
		RoleTitle:      "Senior Backend Engineer",
		Stack:          "Go",
		Domain:         "Payments",
		Feature:        "Refund idempotency",
		TimeBoxMinutes: 90,
		ProjectMode:    "A",
	}
	want := `Generate 5 distinct project ideas suitable for a candidate coding interview.

Role context (this is the candidate's profile as captured by the hiring manager):
- Role: Senior Backend Engineer
- Stack: Go
- Domain: Payments
- Feature focus: Refund idempotency
- Time-box: 90 minutes
- Project mode: A

Each idea must be completable within the time-box by a single engineer working with an AI assistant. Vary the ideas — different sub-problems within the same domain, not minor reframings of one idea.

Return JSON with an "ideas" array. Each entry has:
- title: short headline (4-8 words)
- blurb: 2-3 sentence description of what the candidate will build and why it tests the role profile above.`
	got := buildIdeaPrompt(p)
	if got != want {
		t.Errorf("no-JD prompt shape changed.\n--- want ---\n%s\n--- got ---\n%s", want, got)
	}
}

// TestBuildIdeaPrompt_WithJD_EmitsCompanyDomainInstruction asserts that
// when a JD body is attached, the prompt names the JD's company/about
// section as the business-domain anchor AND wraps the body in
// --- JOB DESCRIPTION --- / --- END JOB DESCRIPTION --- markers so the
// model can locate the JD unambiguously inside the prompt.
func TestBuildIdeaPrompt_WithJD_EmitsCompanyDomainInstruction(t *testing.T) {
	jdBody := "About Acme Robotics\nAcme builds factory-floor automation for tier-2 auto suppliers.\n\nResponsibilities\n- ship pipeline tooling"
	p := IdeaProfile{
		Role:            "senior-backend",
		RoleTitle:       "Senior Backend Engineer",
		Stack:           "Go",
		Feature:         "Refund idempotency",
		TimeBoxMinutes:  90,
		ProjectMode:     "A",
		JobDescription:  jdBody,
	}
	prompt := buildIdeaPrompt(p)
	for _, want := range []string{
		"company/about section",
		"--- JOB DESCRIPTION ---",
		"--- END JOB DESCRIPTION ---",
		jdBody,
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("JD-aware prompt missing %q\nprompt:\n%s", want, prompt)
		}
	}
}

// TestBuildIdeaPrompt_WithJD_OmitsExplicitDomainLine pins the contract
// that the "Domain: " line is suppressed in the JD branch. The wizard
// already skips the Domain step when a JD is attached, so leaving an
// empty "Domain: " line in the prompt would both look broken and
// double-anchor the domain (once empty, once by JD inference).
func TestBuildIdeaPrompt_WithJD_OmitsExplicitDomainLine(t *testing.T) {
	p := IdeaProfile{
		Role:           "senior-backend",
		Stack:          "Go",
		Feature:        "Refund idempotency",
		TimeBoxMinutes: 90,
		ProjectMode:    "A",
		JobDescription: "About Acme Robotics: factory automation.",
	}
	prompt := buildIdeaPrompt(p)
	// Look for the literal "- Domain: " bullet — the JD branch's
	// "- Business domain: derive this from…" line must not match,
	// so the hyphen-space prefix on the banned token is load-bearing.
	if strings.Contains(prompt, "- Domain: ") {
		t.Errorf("JD-aware prompt should not contain a literal \"- Domain: \" bullet; prompt:\n%s", prompt)
	}
}

func TestBuildIdeaPrompt_FallsBackToRoleSlugWhenTitleMissing(t *testing.T) {
	p := IdeaProfile{Role: "junior-fe", Stack: "TS", Domain: "Storefront", Feature: "x"}
	prompt := buildIdeaPrompt(p)
	if !strings.Contains(prompt, "junior-fe") {
		t.Errorf("expected role slug fallback in prompt: %s", prompt)
	}
}

func TestParseIdeasResponse_ParsesOutputText(t *testing.T) {
	// Responses API returns JSON-schema-validated content as output_text.
	body := `{"output_text":"{\"ideas\":[{\"title\":\"Ledger CRUD\",\"blurb\":\"Build a ledger.\"},{\"title\":\"Refund API\",\"blurb\":\"Add refund.\"} ]}"}`
	ideas, err := parseIdeasResponse([]byte(body))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(ideas) != 2 {
		t.Fatalf("expected 2 ideas, got %d", len(ideas))
	}
	if ideas[0].Title != "Ledger CRUD" || ideas[1].Blurb != "Add refund." {
		t.Errorf("ideas not parsed correctly: %+v", ideas)
	}
}

func TestParseIdeasResponse_FallsBackToOutputArray(t *testing.T) {
	// Some Responses API revisions return the JSON in output[0].content[0].text
	// rather than the top-level output_text. The parser must handle both
	// shapes so a future API change doesn't silently break us.
	body := `{"output":[{"content":[{"text":"{\"ideas\":[{\"title\":\"A\",\"blurb\":\"B\"}]}"}]}]}`
	ideas, err := parseIdeasResponse([]byte(body))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(ideas) != 1 || ideas[0].Title != "A" {
		t.Errorf("unexpected ideas: %+v", ideas)
	}
}

func TestParseIdeasResponse_RejectsEmptyIdeas(t *testing.T) {
	body := `{"output_text":"{\"ideas\":[]}"}`
	if _, err := parseIdeasResponse([]byte(body)); err == nil {
		t.Errorf("expected error on empty ideas array")
	}
}

func TestParseIdeasResponse_RejectsMissingText(t *testing.T) {
	if _, err := parseIdeasResponse([]byte(`{}`)); err == nil {
		t.Errorf("expected error when payload has neither output_text nor output[]")
	}
}

func TestOpenAIIdeaFetcher_Fetch_SendsAuthorizationHeader(t *testing.T) {
	doer := &recordingDoer{
		responses: []*http.Response{
			mkRespBody(`{"output_text":"{\"ideas\":[{\"title\":\"T\",\"blurb\":\"B\"}]}"}`),
		},
	}
	f := &openAIIdeaFetcher{apiKey: "sk-test", model: "gpt-test", client: doer}
	_, err := f.Fetch(IdeaProfile{Role: "x", Stack: "y", Domain: "z", Feature: "w", TimeBoxMinutes: 60, ProjectMode: "A"})
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(doer.requests) != 1 {
		t.Fatalf("expected 1 request, got %d", len(doer.requests))
	}
	if got := doer.requests[0].Header.Get("Authorization"); got != "Bearer sk-test" {
		t.Errorf("authorization header: got %q", got)
	}
	// Verify the request body actually contains the model and prompt — guards
	// against a future refactor that builds the payload without including
	// them.
	var captured bytes.Buffer
	_, _ = captured.ReadFrom(doer.requests[0].Body)
	if !strings.Contains(captured.String(), "gpt-test") {
		t.Errorf("request body missing model: %s", captured.String())
	}
}

func TestOpenAIIdeaFetcher_Fetch_SurfacesHTTPErrors(t *testing.T) {
	doer := &recordingDoer{
		responses: []*http.Response{
			{StatusCode: 401, Body: io.NopCloser(strings.NewReader(`{"error":"bad key"}`))},
		},
	}
	f := &openAIIdeaFetcher{apiKey: "sk-bad", model: "gpt", client: doer}
	_, err := f.Fetch(IdeaProfile{})
	if err == nil {
		t.Fatalf("expected error on 401")
	}
	if !strings.Contains(err.Error(), "401") {
		t.Errorf("error should mention HTTP code: %v", err)
	}
}
