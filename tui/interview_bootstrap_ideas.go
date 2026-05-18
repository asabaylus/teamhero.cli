package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

// ideaFetcherHTTPTimeout is sized for the OpenAI Responses API generating
// structured content, not the cheap auth-probe calls the shared
// defaultHTTPClient (5s) is tuned for. gpt-5-mini routinely takes 15-45s
// to return 5 ideas under strict json_schema.
const ideaFetcherHTTPTimeout = 90 * time.Second

// ProjectIdea is one of N candidate project ideas the AI returns when the
// proctor picks "Suggest ideas" instead of writing a custom prompt.
type ProjectIdea struct {
	Title string `json:"title"`
	Blurb string `json:"blurb"`
}

// IdeaProfile is the subset of the wizard's role-config that conditions the
// idea-generation prompt. Kept narrow so the fetcher contract doesn't have to
// move every time the wizard grows a new field.
type IdeaProfile struct {
	Role           string
	RoleTitle      string
	Stack          string
	Domain         string
	Feature        string
	TimeBoxMinutes int
	ProjectMode    string

	// JobDescription is the raw JD body. Populated only when the
	// hiring manager attached a JD AND opted in to letting it shape
	// the candidate-facing project (the wizard's
	// jdInfluencesProject="yes" branch). When non-empty,
	// buildIdeaPrompt swaps the explicit "Domain:" line for an
	// instruction that tells the model to derive the business domain
	// from the JD's company/about section.
	JobDescription string

	// RejectedTitles carries titles from prior idea batches that the
	// manager declined by picking "Generate a fresh set…". When
	// non-empty, buildIdeaPrompt appends an anti-example clause that
	// names every title and tells the model to vary the sub-problem
	// within the same domain. Accumulates across regenerations — a
	// third re-roll sees titles from the first two batches too — so
	// the model can't drift back into near-duplicates of an already-
	// rejected idea.
	RejectedTitles []string
}

// IdeaFetcher returns a list of project ideas tailored to the role profile.
// Tests substitute a stub so no real OpenAI traffic happens in CI.
type IdeaFetcher interface {
	Fetch(p IdeaProfile) ([]ProjectIdea, error)
}

// openAIIdeaFetcher hits api.openai.com/v1/responses with a structured-output
// schema that returns 3-5 ideas. Bills against the same OPENAI_API_KEY that
// `teamhero setup` writes to ~/.config/teamhero/.env, so no separate auth
// step is needed.
type openAIIdeaFetcher struct {
	apiKey string
	model  string
	client HTTPDoer
}

// newOpenAIIdeaFetcher loads the API key from the persisted credentials file
// (same lookup `populateAIFields` uses for the report wizard). Returns a
// descriptive error when the key is absent so the wizard can surface
// "configure setup first" instead of dropping the user into a confusing
// 401 from OpenAI.
func newOpenAIIdeaFetcher() (*openAIIdeaFetcher, error) {
	creds := loadExistingCredentials(filepath.Join(configDir(), ".env"))
	key := strings.TrimSpace(creds["OPENAI_API_KEY"])
	if key == "" {
		return nil, fmt.Errorf("OPENAI_API_KEY not configured — run `teamhero setup` to add one")
	}
	model := firstNonEmptyStr(creds["AI_MODEL"], "gpt-5-mini")
	return &openAIIdeaFetcher{
		apiKey: key,
		model:  model,
		client: &http.Client{Timeout: ideaFetcherHTTPTimeout},
	}, nil
}

// buildIdeaPrompt is exported (lowercase but referenced by tests in the same
// package) so the prompt text is verifiable without hitting the network.
func buildIdeaPrompt(p IdeaProfile) string {
	roleLabel := p.RoleTitle
	if strings.TrimSpace(roleLabel) == "" {
		roleLabel = p.Role
	}
	var prompt string
	// JD branch: drop the explicit "Domain:" line (the wizard skipped
	// the Domain step) and replace it with an instruction that names
	// the JD's company/about paragraph as the domain anchor. Without
	// this explicit anchor the model drifts to generic SaaS examples
	// even with the JD attached.
	if strings.TrimSpace(p.JobDescription) != "" {
		prompt = fmt.Sprintf(`Generate 5 distinct project ideas suitable for a candidate coding interview.

Role context (this is the candidate's profile as captured by the hiring manager):
- Role: %s
- Stack: %s
- Business domain: derive this from the company/about section at the top of the job description below — that paragraph describes the company's industry and product surface. The ideas must be plausible projects for an engineer at that specific company, not generic SaaS examples.
- Feature focus: %s
- Time-box: %d minutes
- Project mode: %s

Each idea must be completable within the time-box by a single engineer working with an AI assistant. Vary the ideas — different sub-problems within the same domain, not minor reframings of one idea.

Return JSON with an "ideas" array. Each entry has:
- title: short headline (4-8 words)
- blurb: 2-3 sentence description of what the candidate will build and why it tests the role profile above.

--- JOB DESCRIPTION ---
%s
--- END JOB DESCRIPTION ---`, roleLabel, p.Stack, p.Feature, p.TimeBoxMinutes, p.ProjectMode, p.JobDescription)
	} else {
		prompt = fmt.Sprintf(`Generate 5 distinct project ideas suitable for a candidate coding interview.

Role context (this is the candidate's profile as captured by the hiring manager):
- Role: %s
- Stack: %s
- Domain: %s
- Feature focus: %s
- Time-box: %d minutes
- Project mode: %s

Each idea must be completable within the time-box by a single engineer working with an AI assistant. Vary the ideas — different sub-problems within the same domain, not minor reframings of one idea.

Return JSON with an "ideas" array. Each entry has:
- title: short headline (4-8 words)
- blurb: 2-3 sentence description of what the candidate will build and why it tests the role profile above.`, roleLabel, p.Stack, p.Domain, p.Feature, p.TimeBoxMinutes, p.ProjectMode)
	}
	// Anti-example clause: when the manager has rejected one or more
	// prior batches via the regenerate sentinel, name those titles
	// verbatim and tell the model to vary the sub-problem inside the
	// same domain. Listed comma-separated; appended on its own
	// trailing line so the no-rejections prompt is byte-identical to
	// today's no-rejections output (regression-guarded by
	// TestBuildIdeaPrompt_WithoutJD_KeepsExistingShape).
	if len(p.RejectedTitles) > 0 {
		prompt += "\n\nDo not repeat or rephrase any of these previously-shown ideas: " +
			strings.Join(p.RejectedTitles, ", ") +
			". Vary the sub-problem within the same domain."
	}
	return prompt
}

// ideasResponseSchema is the JSON Schema body we hand to OpenAI's
// Responses API. `strict: true` forces the model to comply or fail loudly,
// rather than returning malformed output that we'd have to parse defensively.
var ideasResponseSchema = map[string]any{
	"type":                 "object",
	"additionalProperties": false,
	"required":             []string{"ideas"},
	"properties": map[string]any{
		"ideas": map[string]any{
			"type":     "array",
			"minItems": 3,
			"maxItems": 5,
			"items": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"title", "blurb"},
				"properties": map[string]any{
					"title": map[string]any{"type": "string"},
					"blurb": map[string]any{"type": "string"},
				},
			},
		},
	},
}

func (f *openAIIdeaFetcher) Fetch(p IdeaProfile) ([]ProjectIdea, error) {
	prompt := buildIdeaPrompt(p)
	payload := map[string]any{
		"model": f.model,
		"input": prompt,
		"text": map[string]any{
			"format": map[string]any{
				"type":   "json_schema",
				"name":   "interview_project_ideas",
				"strict": true,
				"schema": ideasResponseSchema,
			},
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}
	req, _ := http.NewRequest("POST", openAIAPIBaseURL+"/v1/responses", strings.NewReader(string(body)))
	req.Header.Set("Authorization", "Bearer "+f.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := f.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("OpenAI request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("OpenAI returned HTTP %d: %s", resp.StatusCode, truncateForError(string(respBody)))
	}
	return parseIdeasResponse(respBody)
}

// parseIdeasResponse extracts the ideas list from the Responses-API envelope.
// The API may surface the JSON either as `output_text` (top-level
// convenience field) or as the first content block of `output[0]`; handle
// both so a future API revision that drops the convenience field doesn't
// silently break us.
func parseIdeasResponse(raw []byte) ([]ProjectIdea, error) {
	var envelope struct {
		OutputText string `json:"output_text"`
		Output     []struct {
			Content []struct {
				Text string `json:"text"`
			} `json:"content"`
		} `json:"output"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, fmt.Errorf("decode OpenAI envelope: %w", err)
	}
	text := envelope.OutputText
	if text == "" && len(envelope.Output) > 0 && len(envelope.Output[0].Content) > 0 {
		text = envelope.Output[0].Content[0].Text
	}
	if strings.TrimSpace(text) == "" {
		return nil, fmt.Errorf("OpenAI returned no text payload (envelope: %s)", truncateForError(string(raw)))
	}
	var parsed struct {
		Ideas []ProjectIdea `json:"ideas"`
	}
	if err := json.Unmarshal([]byte(text), &parsed); err != nil {
		return nil, fmt.Errorf("parse ideas JSON: %w", err)
	}
	if len(parsed.Ideas) == 0 {
		return nil, fmt.Errorf("OpenAI returned an empty ideas array")
	}
	return parsed.Ideas, nil
}

// truncateForError trims an HTTP body for inclusion in an error message —
// long bodies (especially 5xx HTML pages) make the wizard's error screen
// unreadable. 200 chars is enough to identify the failure shape.
func truncateForError(s string) string {
	const max = 200
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

// stubIdeaFetcher is exposed so tea-level tests can drive the wizard without
// real network IO. Production code never references it.
type stubIdeaFetcher struct {
	Ideas []ProjectIdea
	Err   error
}

func (s stubIdeaFetcher) Fetch(_ IdeaProfile) ([]ProjectIdea, error) {
	if s.Err != nil {
		return nil, s.Err
	}
	return s.Ideas, nil
}
