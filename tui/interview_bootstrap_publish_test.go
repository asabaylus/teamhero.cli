package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
)

func TestValidateRepoName(t *testing.T) {
	cases := []struct {
		name  string
		valid bool
	}{
		{"interview-senior-backend", true},
		{"my.project_v2", true},
		{"a", true},
		{"  trimmed-leading-space", true}, // trim() makes leading whitespace acceptable
		{"", false},
		{".dotstart", false},
		{"slash/inside", false},
		{"has space", false},
		{strings.Repeat("a", 101), false}, // > 100
	}
	for _, tc := range cases {
		err := validateRepoName(tc.name)
		if (err == nil) != tc.valid {
			t.Errorf("validateRepoName(%q): valid=%v but got err=%v", tc.name, tc.valid, err)
		}
	}
}

func TestDefaultRepoName(t *testing.T) {
	if got := defaultRepoName("senior-backend"); got != "interview-senior-backend" {
		t.Errorf("default: got %q", got)
	}
	if got := defaultRepoName(""); got != "interview-project" {
		t.Errorf("fallback: got %q", got)
	}
}

func TestInjectToken_BasicURL(t *testing.T) {
	got := injectToken("https://github.com/asa/foo.git", "ghp_abc")
	want := "https://oauth2:ghp_abc@github.com/asa/foo.git"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestInjectToken_StripsExistingCredentials(t *testing.T) {
	got := injectToken("https://olduser:oldpass@github.com/asa/foo.git", "ghp_new")
	if !strings.Contains(got, "oauth2:ghp_new@") {
		t.Errorf("expected fresh token to replace old credentials: %s", got)
	}
	if strings.Contains(got, "oldpass") {
		t.Errorf("old password leaked into rewritten URL: %s", got)
	}
}

func TestInjectToken_NoTokenReturnsInputUnchanged(t *testing.T) {
	in := "https://github.com/asa/foo.git"
	if got := injectToken(in, ""); got != in {
		t.Errorf("empty token should not rewrite URL")
	}
}

// stagedDoer is a tiny http.RoundTripper-like recorder. Each Do() pops
// the first request expectation; if exhausted it errors. Keeps test
// assertions terse and explicit about call order.
type stagedDoer struct {
	t      *testing.T
	queue  []func(*http.Request) (*http.Response, error)
	called int
}

func (s *stagedDoer) Do(req *http.Request) (*http.Response, error) {
	if s.called >= len(s.queue) {
		return nil, fmt.Errorf("unexpected call %d to GitHub API: %s %s", s.called, req.Method, req.URL.Path)
	}
	resp, err := s.queue[s.called](req)
	s.called++
	return resp, err
}

func TestGitHubClient_CreateRepo_PersonalAccount(t *testing.T) {
	doer := &stagedDoer{
		t: t,
		queue: []func(*http.Request) (*http.Response, error){
			func(r *http.Request) (*http.Response, error) {
				if r.URL.Path != "/user" {
					t.Errorf("first call should be GET /user, got %s", r.URL.Path)
				}
				body := `{"login":"asa"}`
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
			},
			func(r *http.Request) (*http.Response, error) {
				if r.URL.Path != "/user/repos" {
					t.Errorf("personal repo create should hit /user/repos, got %s", r.URL.Path)
				}
				// Verify the payload uses the user-supplied repo name.
				var body map[string]any
				_ = json.NewDecoder(r.Body).Decode(&body)
				if body["name"] != "interview-x" || body["private"] != true {
					t.Errorf("payload not as expected: %+v", body)
				}
				return &http.Response{
					StatusCode: 201,
					Body:       io.NopCloser(strings.NewReader(`{"html_url":"https://github.com/asa/interview-x","clone_url":"https://github.com/asa/interview-x.git"}`)),
				}, nil
			},
		},
	}
	gh := &GitHubClient{Token: "ghp_test", Client: doer}
	res, err := gh.CreateRepo(PublishOptions{Owner: "asa", Repo: "interview-x", Private: true})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if res.URL != "https://github.com/asa/interview-x" {
		t.Errorf("URL: got %q", res.URL)
	}
}

func TestGitHubClient_CreateRepo_OrgOwner(t *testing.T) {
	doer := &stagedDoer{
		t: t,
		queue: []func(*http.Request) (*http.Response, error){
			func(r *http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"login":"asa"}`))}, nil
			},
			func(r *http.Request) (*http.Response, error) {
				want := "/orgs/teamhero/repos"
				if r.URL.Path != want {
					t.Errorf("org repo create path: got %s want %s", r.URL.Path, want)
				}
				return &http.Response{
					StatusCode: 201,
					Body:       io.NopCloser(strings.NewReader(`{"html_url":"https://github.com/teamhero/repo"}`)),
				}, nil
			},
		},
	}
	gh := &GitHubClient{Token: "ghp_test", Client: doer}
	_, err := gh.CreateRepo(PublishOptions{Owner: "teamhero", Repo: "repo", Private: true})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
}

func TestGitHubClient_CreateRepo_SurfacesUnauthorized(t *testing.T) {
	doer := &stagedDoer{
		t: t,
		queue: []func(*http.Request) (*http.Response, error){
			func(r *http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: 401, Body: io.NopCloser(strings.NewReader(`{"message":"Bad credentials"}`))}, nil
			},
		},
	}
	gh := &GitHubClient{Token: "ghp_bad", Client: doer}
	_, err := gh.CreateRepo(PublishOptions{Repo: "anything"})
	if err == nil {
		t.Fatalf("expected error on 401")
	}
	if !strings.Contains(err.Error(), "unauthorized") && !strings.Contains(err.Error(), "401") {
		t.Errorf("expected unauthorized error: %v", err)
	}
}

func TestGitHubClient_CreateRepo_ValidatesRepoName(t *testing.T) {
	gh := &GitHubClient{Token: "ghp_test", Client: nil}
	_, err := gh.CreateRepo(PublishOptions{Repo: ""})
	if err == nil {
		t.Errorf("expected validation error on empty repo")
	}
}

// fakeGit records the commands that initAndPush issues so we can assert
// the order without actually running git.
type fakeGit struct {
	calls  [][]string
	failOn string // substring match against args[0]; "" never fails
	stderr string
}

func (g *fakeGit) Run(_ string, args ...string) (string, string, error) {
	g.calls = append(g.calls, args)
	if g.failOn != "" && len(args) > 0 && strings.Contains(args[0], g.failOn) {
		return "", g.stderr, fmt.Errorf("simulated failure on %v", args)
	}
	return "", "", nil
}

func TestInitAndPush_HappyPath(t *testing.T) {
	dir := t.TempDir()
	g := &fakeGit{}
	err := initAndPush(g, InitAndPushParams{
		Dir:         dir,
		RemoteHTTPS: "https://github.com/asa/foo.git",
		Token:       "ghp_test",
		CommitMsg:   "x",
	})
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	// Expect: init, add, commit, remote add (with token injected), push
	if len(g.calls) != 5 {
		t.Fatalf("expected 5 git calls, got %d: %v", len(g.calls), g.calls)
	}
	if g.calls[0][0] != "init" || g.calls[1][0] != "add" || g.calls[2][0] != "commit" {
		t.Errorf("git command order wrong: %v", g.calls)
	}
	if g.calls[3][0] != "remote" || g.calls[3][1] != "add" {
		t.Errorf("remote add not at position 4: %v", g.calls[3])
	}
	remoteURL := g.calls[3][3]
	if !strings.Contains(remoteURL, "oauth2:ghp_test@github.com") {
		t.Errorf("remote URL missing injected token: %s", remoteURL)
	}
	if g.calls[4][0] != "push" {
		t.Errorf("push not at last position: %v", g.calls)
	}
}

func TestInitAndPush_RefusesExistingGitDir(t *testing.T) {
	dir := t.TempDir()
	if err := makeEmptyDir(dir + "/.git"); err != nil {
		t.Fatalf("setup .git: %v", err)
	}
	g := &fakeGit{}
	err := initAndPush(g, InitAndPushParams{
		Dir:         dir,
		RemoteHTTPS: "https://github.com/x/y.git",
		Token:       "t",
		CommitMsg:   "m",
	})
	if err == nil {
		t.Fatalf("expected refusal when .git/ already exists")
	}
	if !strings.Contains(err.Error(), ".git") {
		t.Errorf("error should mention .git: %v", err)
	}
	if len(g.calls) > 0 {
		t.Errorf("should not have invoked git when refusing: %v", g.calls)
	}
}

func TestInitAndPush_SurfacesPushFailure(t *testing.T) {
	dir := t.TempDir()
	g := &fakeGit{failOn: "push", stderr: "remote unreachable"}
	err := initAndPush(g, InitAndPushParams{
		Dir:         dir,
		RemoteHTTPS: "https://github.com/x/y.git",
		Token:       "t",
		CommitMsg:   "m",
	})
	if err == nil {
		t.Fatalf("expected push failure")
	}
	if !strings.Contains(err.Error(), "remote unreachable") {
		t.Errorf("error should include captured stderr: %v", err)
	}
}

func makeEmptyDir(p string) error {
	return os.MkdirAll(p, 0o755)
}
