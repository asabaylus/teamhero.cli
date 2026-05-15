package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/charmbracelet/huh"
)

// PublishOptions captures the user's answers from the publish form. The
// flow is fully optional — when the user declines or no GitHub token is
// configured, this struct stays zero.
type PublishOptions struct {
	// Owner is either the user's GitHub username (personal repo) or an
	// organization login. Empty defaults to the authenticated user.
	Owner string
	// Repo is the repository name on GitHub.
	Repo string
	// Private toggles repo visibility. Default true — interview material
	// shouldn't be browsable by random GitHub users.
	Private bool
}

// PublishResult is what a successful publish returns. URL is what the
// success screen displays as an OSC 8 hyperlink.
type PublishResult struct {
	URL string
}

// repoNameRe is the GitHub repo-name pattern. GitHub itself is more
// permissive (allows up to 100 chars, dot-prefix forbidden) but this
// pattern catches the common mistakes (spaces, slashes, weird unicode)
// before the API rejects them.
var repoNameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`)

// validateRepoName returns nil for an acceptable GitHub repo name, an
// error otherwise. Kept as a plain function so the wizard's huh.Input
// validator can wire it directly.
func validateRepoName(s string) error {
	t := strings.TrimSpace(s)
	if t == "" {
		return fmt.Errorf("repository name is required")
	}
	if !repoNameRe.MatchString(t) {
		return fmt.Errorf("repo name must start with a letter/digit and contain only letters, digits, '.', '_', '-'")
	}
	return nil
}

// GitHubClient is the minimal surface we need for publish. Tests inject
// a fake doer; production uses defaultHTTPClient.
type GitHubClient struct {
	Token  string
	Client HTTPDoer
}

// CreateRepo POSTs to either /user/repos (personal) or /orgs/{owner}/repos
// (organization) and returns the created repo's URL. The owner-vs-org
// distinction is decided by checking whether the authenticated user's
// login matches `owner`; we call /user once to find that out, then route.
func (g *GitHubClient) CreateRepo(opts PublishOptions) (PublishResult, error) {
	if strings.TrimSpace(g.Token) == "" {
		return PublishResult{}, fmt.Errorf("GITHUB_PERSONAL_ACCESS_TOKEN is empty")
	}
	if err := validateRepoName(opts.Repo); err != nil {
		return PublishResult{}, err
	}

	user, err := g.authenticatedLogin()
	if err != nil {
		return PublishResult{}, err
	}

	endpoint := githubAPIBaseURL + "/user/repos"
	owner := strings.TrimSpace(opts.Owner)
	if owner == "" {
		owner = user
	}
	if owner != "" && !strings.EqualFold(owner, user) {
		endpoint = fmt.Sprintf("%s/orgs/%s/repos", githubAPIBaseURL, owner)
	}

	body, _ := json.Marshal(map[string]any{
		"name":      opts.Repo,
		"private":   opts.Private,
		"auto_init": false,
	})
	req, _ := http.NewRequest("POST", endpoint, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+g.Token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := g.Client.Do(req)
	if err != nil {
		return PublishResult{}, fmt.Errorf("GitHub request failed: %w", err)
	}
	defer resp.Body.Close()
	rawBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode/100 != 2 {
		return PublishResult{}, fmt.Errorf("GitHub returned HTTP %d: %s", resp.StatusCode, truncateForError(string(rawBody)))
	}

	var parsed struct {
		HTMLURL  string `json:"html_url"`
		CloneURL string `json:"clone_url"`
	}
	if err := json.Unmarshal(rawBody, &parsed); err != nil {
		return PublishResult{}, fmt.Errorf("decode GitHub response: %w", err)
	}
	if parsed.HTMLURL == "" {
		return PublishResult{}, fmt.Errorf("GitHub response missing html_url: %s", truncateForError(string(rawBody)))
	}
	return PublishResult{URL: parsed.HTMLURL}, nil
}

// authenticatedLogin asks /user for the token's owner login so we can
// pick the right create-repo endpoint. Cached only within one call —
// publish is a single-shot operation.
func (g *GitHubClient) authenticatedLogin() (string, error) {
	req, _ := http.NewRequest("GET", githubAPIBaseURL+"/user", nil)
	req.Header.Set("Authorization", "Bearer "+g.Token)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := g.Client.Do(req)
	if err != nil {
		return "", fmt.Errorf("GitHub /user failed: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == 401 {
		return "", fmt.Errorf("GitHub token unauthorized — run `teamhero setup` to refresh")
	}
	if resp.StatusCode/100 != 2 {
		return "", fmt.Errorf("GitHub /user returned HTTP %d", resp.StatusCode)
	}
	var u struct {
		Login string `json:"login"`
	}
	if err := json.Unmarshal(body, &u); err != nil {
		return "", fmt.Errorf("decode /user: %w", err)
	}
	return u.Login, nil
}

// gitRunner abstracts the subprocess invocations for testability. The
// production runner shells out to `git`; tests substitute a recorder.
type gitRunner interface {
	Run(dir string, args ...string) (stdout, stderr string, err error)
}

type execGitRunner struct{}

func (execGitRunner) Run(dir string, args ...string) (string, string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	return stdout.String(), stderr.String(), err
}

// InitAndPushParams bundles what we need to populate a fresh GitHub repo
// from a local directory. Token is embedded in the remote URL so git
// pushes without an interactive credential prompt.
type InitAndPushParams struct {
	Dir         string
	RemoteHTTPS string // https://github.com/owner/repo.git — auth injected before use
	Token       string
	CommitMsg   string
}

// initAndPush stages the generated project as a fresh git repo and pushes
// to the freshly-created GitHub remote. Refuses to clobber an existing
// .git/ directory — that would mean the user already has their own git
// state in there.
func initAndPush(g gitRunner, p InitAndPushParams) error {
	if p.Dir == "" {
		return fmt.Errorf("output directory is empty")
	}
	gitDir := filepath.Join(p.Dir, ".git")
	if st, err := os.Stat(gitDir); err == nil && st.IsDir() {
		return fmt.Errorf("refusing to clobber existing .git/ in %s — push it yourself with `git push`", p.Dir)
	}
	steps := [][]string{
		{"init", "-b", "main"},
		{"add", "."},
		{"commit", "-m", p.CommitMsg},
	}
	for _, args := range steps {
		if _, stderr, err := g.Run(p.Dir, args...); err != nil {
			return fmt.Errorf("git %s failed: %v\n%s", strings.Join(args, " "), err, stderr)
		}
	}
	// Inject the token into the remote URL so push doesn't prompt. Strip
	// any existing credentials first to avoid double-auth segments.
	remote := injectToken(p.RemoteHTTPS, p.Token)
	if _, stderr, err := g.Run(p.Dir, "remote", "add", "origin", remote); err != nil {
		return fmt.Errorf("git remote add failed: %v\n%s", err, stderr)
	}
	if _, stderr, err := g.Run(p.Dir, "push", "-u", "origin", "main"); err != nil {
		return fmt.Errorf("git push failed: %v\n%s", err, stderr)
	}
	return nil
}

// injectToken rewrites `https://github.com/...` into
// `https://oauth2:<token>@github.com/...` for one-shot authenticated pushes.
// The token is short-lived in memory and never persisted to git config.
func injectToken(rawURL, token string) string {
	if token == "" {
		return rawURL
	}
	const prefix = "https://"
	if !strings.HasPrefix(rawURL, prefix) {
		return rawURL
	}
	rest := strings.TrimPrefix(rawURL, prefix)
	// If the URL already contains credentials (user:pass@host) strip them.
	if i := strings.Index(rest, "@"); i != -1 {
		rest = rest[i+1:]
	}
	return prefix + "oauth2:" + token + "@" + rest
}

// loadGitHubToken reads the persisted token from the same credentials
// file the report wizard and doctor use. Returns "" when no token is set.
func loadGitHubToken() string {
	creds := loadExistingCredentials(filepath.Join(configDir(), ".env"))
	return strings.TrimSpace(creds["GITHUB_PERSONAL_ACCESS_TOKEN"])
}

// promptForPublish renders the post-generation publish form. Returns
// (opts, true) on confirm, (zero, false) on cancel/abort.
func promptForPublish(defaultRepo, defaultOwner string) (PublishOptions, bool) {
	opts := PublishOptions{
		Owner:   defaultOwner,
		Repo:    defaultRepo,
		Private: true,
	}
	var publish bool
	confirm := huh.NewForm(huh.NewGroup(
		huh.NewConfirm().
			Title("Publish this interview project to GitHub?").
			Description("The generated repository can be pushed to a new private GitHub repo. You can always do this later by hand.").
			Affirmative("Yes, publish").
			Negative("Skip").
			Value(&publish),
	)).WithTheme(huh.ThemeCharm())
	if err := confirm.Run(); err != nil || !publish {
		return PublishOptions{}, false
	}
	details := huh.NewForm(huh.NewGroup(
		huh.NewInput().
			Title("Repository name").
			Description("e.g. interview-senior-backend").
			Value(&opts.Repo).
			Validate(validateRepoName),
		huh.NewInput().
			Title("Owner").
			Description("Your GitHub username for a personal repo, or an organization login.").
			Value(&opts.Owner),
		huh.NewSelect[bool]().
			Title("Visibility").
			Options(
				huh.NewOption("Private (recommended)", true),
				huh.NewOption("Public", false),
			).
			Value(&opts.Private),
	)).WithTheme(huh.ThemeCharm())
	if err := details.Run(); err != nil {
		return PublishOptions{}, false
	}
	return opts, true
}

// defaultRepoName builds the suggested repo name from the role slug.
// Falls back to "interview-project" when the slug is missing.
func defaultRepoName(roleSlug string) string {
	s := strings.TrimSpace(roleSlug)
	if s == "" {
		return "interview-project"
	}
	return "interview-" + s
}

// offerPublishToGitHub is the entry point called by the wizard after
// generation succeeds. Silent no-op when no token is configured —
// callers who haven't run `teamhero setup` for GitHub shouldn't see
// an offer they can't use.
//
// Test seam: tests substitute `publishFlow` to avoid network IO. The
// production implementation drives a confirm form, hits the GitHub API,
// and runs git locally to push the generated tree.
var offerPublishToGitHub = func(opts *BootstrapOptions, stdout, stderr io.Writer) {
	token := loadGitHubToken()
	if token == "" {
		fmt.Fprintln(stderr, "(Tip: run `teamhero setup` to configure GitHub for one-click publishing.)")
		return
	}
	repoName := defaultRepoName(opts.Role)
	pubOpts, ok := promptForPublish(repoName, "")
	if !ok {
		return
	}
	client := &GitHubClient{Token: token, Client: defaultHTTPClient}
	result, err := client.CreateRepo(pubOpts)
	if err != nil {
		fmt.Fprintf(stderr, "GitHub repo creation failed: %v\n", err)
		return
	}
	// Build https URL for git push. GitHub returns html_url like
	// "https://github.com/owner/repo"; the clone URL we want is the
	// same path with ".git" appended.
	remote := strings.TrimRight(result.URL, "/") + ".git"
	err = initAndPush(execGitRunner{}, InitAndPushParams{
		Dir:         opts.OutputDir,
		RemoteHTTPS: remote,
		Token:       token,
		CommitMsg:   "Initial commit: teamhero interview scaffold",
	})
	if err != nil {
		fmt.Fprintf(stderr, "git push failed: %v\nThe GitHub repository was created at %s but no commits were pushed. You can push manually from %s.\n", err, result.URL, opts.OutputDir)
		return
	}
	fmt.Fprintf(stdout, "✓ Published to %s\n", result.URL)
}
