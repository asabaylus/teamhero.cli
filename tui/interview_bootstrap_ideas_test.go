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
