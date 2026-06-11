package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// setupTokenEnv writes a minimal .env with a fake token into a temp configDir
// and returns a cleanup function that restores the original XDG_CONFIG_HOME.
func setupTokenEnv(t *testing.T) {
	t.Helper()
	tmpDir := t.TempDir()
	cfgDir := filepath.Join(tmpDir, "teamhero")
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cfgDir, ".env"), []byte("GITHUB_PERSONAL_ACCESS_TOKEN=test-token\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	orig := os.Getenv("XDG_CONFIG_HOME")
	os.Setenv("XDG_CONFIG_HOME", tmpDir)
	t.Cleanup(func() { os.Setenv("XDG_CONFIG_HOME", orig) })
}

// servePages returns an httptest.Server that serves pages of JSON arrays.
// Each call to pages() is served for one page; subsequent requests get [].
func mockServer(t *testing.T, pages []string) *httptest.Server {
	t.Helper()
	call := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if call < len(pages) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(pages[call]))
		} else {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("[]"))
		}
		call++
	}))
	t.Cleanup(srv.Close)
	return srv
}

// patchAPIRoot temporarily overrides the GitHub API root to point at srv.
func patchAPIRoot(t *testing.T, srv *httptest.Server) {
	t.Helper()
	orig := githubAPIRoot
	// package-level const can't be reassigned; use a var shadow via the
	// existing package variable instead. We'll override httpClient with a
	// transport that rewrites the host.
	transport := &rewriteTransport{base: srv.URL}
	origClient := httpClient
	httpClient = &http.Client{Transport: transport}
	t.Cleanup(func() {
		httpClient = origClient
		_ = orig
	})
}

// rewriteTransport replaces the scheme+host of every request with base.
type rewriteTransport struct{ base string }

func (rt *rewriteTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	clone.URL.Scheme = "http"
	clone.URL.Host = strings.TrimPrefix(rt.base, "http://")
	return http.DefaultTransport.RoundTrip(clone)
}

// ---------------------------------------------------------------------------
// DiscoverRepos
// ---------------------------------------------------------------------------

func TestDiscoverRepos_Success(t *testing.T) {
	setupTokenEnv(t)
	repos := []map[string]interface{}{
		{"full_name": "org/repo1", "archived": false, "is_template": false, "private": false},
		{"full_name": "org/repo2", "archived": false, "is_template": false, "private": false},
	}
	body, _ := json.Marshal(repos)
	srv := mockServer(t, []string{string(body)})
	patchAPIRoot(t, srv)

	got, err := DiscoverRepos("org", false, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 || got[0] != "repo1" || got[1] != "repo2" {
		t.Errorf("got %v, want [repo1 repo2]", got)
	}
}

func TestDiscoverRepos_FiltersArchivedByDefault(t *testing.T) {
	setupTokenEnv(t)
	repos := []map[string]interface{}{
		{"full_name": "org/active", "archived": false, "is_template": false, "private": false},
		{"full_name": "org/archived", "archived": true, "is_template": false, "private": false},
	}
	body, _ := json.Marshal(repos)
	srv := mockServer(t, []string{string(body)})
	patchAPIRoot(t, srv)

	got, err := DiscoverRepos("org", false, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0] != "active" {
		t.Errorf("got %v, want [active]", got)
	}
}

func TestDiscoverRepos_IncludeArchived(t *testing.T) {
	setupTokenEnv(t)
	repos := []map[string]interface{}{
		{"full_name": "org/active", "archived": false, "is_template": false, "private": false},
		{"full_name": "org/archived", "archived": true, "is_template": false, "private": false},
	}
	body, _ := json.Marshal(repos)
	srv := mockServer(t, []string{string(body)})
	patchAPIRoot(t, srv)

	got, err := DiscoverRepos("org", false, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 {
		t.Errorf("got %v, want 2 repos", got)
	}
}

func TestDiscoverRepos_FiltersTemplates(t *testing.T) {
	setupTokenEnv(t)
	repos := []map[string]interface{}{
		{"full_name": "org/normal", "archived": false, "is_template": false, "private": false},
		{"full_name": "org/template", "archived": false, "is_template": true, "private": false},
	}
	body, _ := json.Marshal(repos)
	srv := mockServer(t, []string{string(body)})
	patchAPIRoot(t, srv)

	got, err := DiscoverRepos("org", false, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0] != "normal" {
		t.Errorf("got %v, want [normal]", got)
	}
}

func TestDiscoverRepos_EmptyArray(t *testing.T) {
	setupTokenEnv(t)
	srv := mockServer(t, []string{"[]"})
	patchAPIRoot(t, srv)

	got, err := DiscoverRepos("org", false, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %v, want empty slice", got)
	}
}

func TestDiscoverRepos_APIError(t *testing.T) {
	setupTokenEnv(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"message":"Resource protected by organization SAML enforcement."}`))
	}))
	t.Cleanup(srv.Close)
	patchAPIRoot(t, srv)

	_, err := DiscoverRepos("org", false, false)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "failed to discover repos") {
		t.Errorf("expected discover repos error, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// DiscoverTeams
// ---------------------------------------------------------------------------

func TestDiscoverTeams_Success(t *testing.T) {
	setupTokenEnv(t)
	teams := []map[string]interface{}{
		{"name": "Team1", "slug": "team1"},
		{"name": "Team2", "slug": "team2"},
	}
	body, _ := json.Marshal(teams)
	srv := mockServer(t, []string{string(body)})
	patchAPIRoot(t, srv)

	got, err := DiscoverTeams("org")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d teams, want 2", len(got))
	}
	if got[0].Name != "Team1" || got[0].Slug != "team1" {
		t.Errorf("teams[0] = %+v, want {Name:Team1 Slug:team1}", got[0])
	}
	if got[1].Name != "Team2" || got[1].Slug != "team2" {
		t.Errorf("teams[1] = %+v, want {Name:Team2 Slug:team2}", got[1])
	}
}

func TestDiscoverTeams_EmptyArray(t *testing.T) {
	setupTokenEnv(t)
	srv := mockServer(t, []string{"[]"})
	patchAPIRoot(t, srv)

	got, err := DiscoverTeams("org")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %v, want empty slice", got)
	}
}

func TestDiscoverTeams_APIError(t *testing.T) {
	setupTokenEnv(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"message":"Bad credentials"}`))
	}))
	t.Cleanup(srv.Close)
	patchAPIRoot(t, srv)

	_, err := DiscoverTeams("org")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "failed to discover teams") {
		t.Errorf("expected discover teams error, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// DiscoverMembers
// ---------------------------------------------------------------------------

func TestDiscoverMembers_Success(t *testing.T) {
	setupTokenEnv(t)
	members := []map[string]interface{}{
		{"login": "user1"},
		{"login": "user2"},
		{"login": "user3"},
	}
	body, _ := json.Marshal(members)
	srv := mockServer(t, []string{string(body)})
	patchAPIRoot(t, srv)

	got, err := DiscoverMembers("org")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 3 || got[0] != "user1" || got[1] != "user2" || got[2] != "user3" {
		t.Errorf("got %v, want [user1 user2 user3]", got)
	}
}

func TestDiscoverMembers_EmptyArray(t *testing.T) {
	setupTokenEnv(t)
	srv := mockServer(t, []string{"[]"})
	patchAPIRoot(t, srv)

	got, err := DiscoverMembers("org")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %v, want empty slice", got)
	}
}

func TestDiscoverMembers_APIError(t *testing.T) {
	setupTokenEnv(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"message":"Forbidden"}`))
	}))
	t.Cleanup(srv.Close)
	patchAPIRoot(t, srv)

	_, err := DiscoverMembers("org")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "failed to discover members") {
		t.Errorf("expected discover members error, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// TeamInfo JSON round-trip
// ---------------------------------------------------------------------------

func TestTeamInfo_JSONTags(t *testing.T) {
	info := TeamInfo{Name: "Alpha Team", Slug: "alpha-team"}
	if info.Name != "Alpha Team" || info.Slug != "alpha-team" {
		t.Errorf("TeamInfo fields incorrect: %+v", info)
	}
}

// ---------------------------------------------------------------------------
// loadGitHubToken
// ---------------------------------------------------------------------------

func TestLoadGitHubToken_MissingToken(t *testing.T) {
	tmpDir := t.TempDir()
	cfgDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(cfgDir, 0o755)
	os.WriteFile(filepath.Join(cfgDir, ".env"), []byte("OPENAI_API_KEY=sk-test\n"), 0o600)
	orig := os.Getenv("XDG_CONFIG_HOME")
	os.Setenv("XDG_CONFIG_HOME", tmpDir)
	t.Cleanup(func() { os.Setenv("XDG_CONFIG_HOME", orig) })

	token := loadGitHubToken()
	if token != "" {
		t.Errorf("expected empty token, got %q", token)
	}
}
