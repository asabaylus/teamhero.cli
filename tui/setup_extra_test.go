package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
)

// ---------------------------------------------------------------------------
// validateCredentials tests
// ---------------------------------------------------------------------------

func TestValidateCredentials_AlreadyValid(t *testing.T) {
	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", value: "ghp_token", status: "valid"},
	}
	// Already valid → should not re-validate
	old := githubAPIBaseURL
	t.Cleanup(func() { githubAPIBaseURL = old })
	githubAPIBaseURL = "http://invalid-should-not-be-called"

	validateCredentials(creds)
	if creds[0].status != "valid" {
		t.Errorf("expected status=valid to be preserved, got %q", creds[0].status)
	}
}

func TestValidateCredentials_DelegatesCorrectly(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"testuser"}`))
	}))
	defer ts.Close()

	old := githubAPIBaseURL
	t.Cleanup(func() { githubAPIBaseURL = old })
	githubAPIBaseURL = ts.URL

	oldClient := defaultHTTPClient
	t.Cleanup(func() { defaultHTTPClient = oldClient })
	defaultHTTPClient = &http.Client{}

	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", value: "ghp_test"},
	}
	validateCredentials(creds)
	if creds[0].status != "valid" {
		t.Errorf("expected status=valid, got %q (detail: %q)", creds[0].status, creds[0].detail)
	}
}

// ---------------------------------------------------------------------------
// renderSettingsStatus tests
// ---------------------------------------------------------------------------

func TestRenderSettingsStatus_AllMissing(t *testing.T) {
	existing := map[string]string{}
	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", optional: false, value: ""},
		{envKey: "OPENAI_API_KEY", optional: false, value: ""},
		{envKey: "ASANA_API_TOKEN", optional: true, value: ""},
	}
	status := boardsConfigStatus{}

	content, valid, missing, invalid := renderSettingsStatus(existing, creds, status)

	if valid != 0 {
		t.Errorf("expected valid=0, got %d", valid)
	}
	if missing == 0 {
		t.Errorf("expected missing>0 when required creds not set, got %d", missing)
	}
	_ = invalid
	if content == "" {
		t.Error("expected non-empty content")
	}
}

func TestRenderSettingsStatus_AllValid(t *testing.T) {
	existing := map[string]string{
		"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_test",
		"OPENAI_API_KEY":               "sk-test",
	}
	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", optional: false, value: "ghp_test", status: "valid", detail: "Connected as @alice"},
		{envKey: "OPENAI_API_KEY", optional: false, value: "sk-test", status: "valid", detail: "Validated"},
		{envKey: "ASANA_API_TOKEN", optional: true, value: "", status: "skipped"},
	}
	status := boardsConfigStatus{}

	content, valid, missing, invalid := renderSettingsStatus(existing, creds, status)

	if valid != 2 {
		t.Errorf("expected valid=2, got %d", valid)
	}
	if missing != 0 {
		t.Errorf("expected missing=0, got %d", missing)
	}
	if invalid != 0 {
		t.Errorf("expected invalid=0, got %d", invalid)
	}
	if !strings.Contains(content, "Advanced Tuning") {
		t.Errorf("expected content to mention Advanced Tuning, got: %q", content)
	}
}

func TestRenderSettingsStatus_InvalidCred(t *testing.T) {
	existing := map[string]string{
		"GITHUB_PERSONAL_ACCESS_TOKEN": "bad_token",
	}
	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", optional: false, value: "bad_token", status: "invalid"},
	}
	status := boardsConfigStatus{}

	_, _, _, invalid := renderSettingsStatus(existing, creds, status)

	if invalid != 1 {
		t.Errorf("expected invalid=1, got %d", invalid)
	}
}

// ---------------------------------------------------------------------------
// showSettingsViewer tests
// ---------------------------------------------------------------------------

func TestShowSettingsViewer_TeaProgramRun(t *testing.T) {
	orig := teaProgramRun
	t.Cleanup(func() { teaProgramRun = orig })
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		return settingsViewer{content: "test"}, nil
	}

	err := showSettingsViewer("test content")
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// runSetupHeadless tests
// ---------------------------------------------------------------------------

func TestRunSetupHeadless_MissingRequired(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	// Clear env vars so credentials are missing
	t.Setenv("GITHUB_PERSONAL_ACCESS_TOKEN", "")
	t.Setenv("OPENAI_API_KEY", "")

	err := runSetupHeadless()
	if err == nil {
		t.Fatal("expected error for missing required env vars")
	}
	if !strings.Contains(err.Error(), "missing required") {
		t.Errorf("expected 'missing required' in error, got %q", err.Error())
	}
}

func TestRunSetupHeadless_WithCredentials(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	t.Setenv("GITHUB_PERSONAL_ACCESS_TOKEN", "ghp_headless_test")
	t.Setenv("OPENAI_API_KEY", "sk-headless_test")

	// Mock HTTP to avoid real network calls
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/user") {
			w.WriteHeader(200)
			w.Write([]byte(`{"login":"testuser"}`))
		} else {
			w.WriteHeader(200)
			w.Write([]byte(`{"id":"resp_123"}`))
		}
	}))
	defer ts.Close()

	oldGH := githubAPIBaseURL
	oldOA := openAIAPIBaseURL
	t.Cleanup(func() {
		githubAPIBaseURL = oldGH
		openAIAPIBaseURL = oldOA
	})
	githubAPIBaseURL = ts.URL
	openAIAPIBaseURL = ts.URL

	oldClient := defaultHTTPClient
	t.Cleanup(func() { defaultHTTPClient = oldClient })
	defaultHTTPClient = &http.Client{}

	err := runSetupHeadless()
	if err != nil {
		t.Errorf("expected nil error with valid credentials, got %v", err)
	}

	// .env file should be created
	envPath := filepath.Join(tmpDir, "teamhero", ".env")
	if _, statErr := os.Stat(envPath); statErr != nil {
		t.Errorf("expected .env file to be created, got %v", statErr)
	}
}

func TestRunSetupHeadless_LoadsFromExistingFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)

	// Write credentials to existing .env
	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte(
		"GITHUB_PERSONAL_ACCESS_TOKEN=ghp_existing\nOPENAI_API_KEY=sk-existing\n",
	), 0o600)

	// Clear env vars so it must load from file
	t.Setenv("GITHUB_PERSONAL_ACCESS_TOKEN", "")
	t.Setenv("OPENAI_API_KEY", "")

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"user","id":"r"}`))
	}))
	defer ts.Close()

	oldGH := githubAPIBaseURL
	oldOA := openAIAPIBaseURL
	t.Cleanup(func() {
		githubAPIBaseURL = oldGH
		openAIAPIBaseURL = oldOA
	})
	githubAPIBaseURL = ts.URL
	openAIAPIBaseURL = ts.URL

	oldClient := defaultHTTPClient
	t.Cleanup(func() { defaultHTTPClient = oldClient })
	defaultHTTPClient = &http.Client{}

	err := runSetupHeadless()
	if err != nil {
		t.Errorf("expected nil error loading from existing .env, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// runSetup tests (dispatcher)
// ---------------------------------------------------------------------------

func TestRunSetup_HeadlessPath(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	// Force headless mode
	t.Setenv("TEAMHERO_HEADLESS", "1")

	// No credentials → should error with "missing required"
	t.Setenv("GITHUB_PERSONAL_ACCESS_TOKEN", "")
	t.Setenv("OPENAI_API_KEY", "")

	err := runSetup()
	if err == nil {
		t.Fatal("expected error from headless path with no credentials")
	}
	if !strings.Contains(err.Error(), "missing required") {
		t.Errorf("expected 'missing required' in error, got %q", err.Error())
	}
}

// ---------------------------------------------------------------------------
// runSetupUpdateSingle tests
// ---------------------------------------------------------------------------

func TestRunSetupUpdateSingle_DoneImmediately(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)

	// Write a .env file with a valid-looking token
	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte("GITHUB_PERSONAL_ACCESS_TOKEN=ghp_test\n"), 0o600)

	// Mock HTTP server for validateCredentials (called inside the loop)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"testuser"}`))
	}))
	defer ts.Close()

	oldGH := githubAPIBaseURL
	t.Cleanup(func() { githubAPIBaseURL = oldGH })
	githubAPIBaseURL = ts.URL

	oldClient := defaultHTTPClient
	t.Cleanup(func() { defaultHTTPClient = oldClient })
	defaultHTTPClient = &http.Client{}

	// Mock teaProgramRun to return "@@done" immediately (user pressed q/esc)
	origTPR := teaProgramRun
	t.Cleanup(func() { teaProgramRun = origTPR })
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		return settingsPicker{selected: "@@done"}, nil
	}

	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub Personal Access Token", value: "ghp_test", optional: false},
	}

	err := runSetupUpdateSingle(creds, envPath)
	if err != nil {
		t.Errorf("expected nil error when user selects @@done, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// runSetupInteractive tests
// ---------------------------------------------------------------------------

func TestRunSetupInteractive_NewUserAborts(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)
	// No .env file → hasExisting = false → shows mode-select form

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		return huh.ErrUserAborted
	}

	err := runSetupInteractive()
	if err != huh.ErrUserAborted {
		t.Errorf("expected huh.ErrUserAborted, got %v", err)
	}
}

func TestRunSetupInteractive_NewUserFullModeSuccess(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)
	// No .env file → hasExisting = false

	// All HTTP calls return 200 (though credentials are empty, so validateCredentials
	// will set status="skipped" for empty values — no HTTP calls made)
	oldGH := githubAPIBaseURL
	oldOA := openAIAPIBaseURL
	t.Cleanup(func() {
		githubAPIBaseURL = oldGH
		openAIAPIBaseURL = oldOA
	})

	oldClient := defaultHTTPClient
	t.Cleanup(func() { defaultHTTPClient = oldClient })
	defaultHTTPClient = &http.Client{}

	// huhFormRun: first call = mode select (returns nil, setupMode stays "" → not express).
	// Subsequent calls = promptCredentialInput for each cred (returns nil, input stays "").
	// For non-optional creds with empty value and empty c.value, the validator would
	// return an error, but huhFormRun is mocked to skip running the form, so input=""
	// and c.value stays "" → status="skipped" after promptCredentialInput.
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		return nil
	}

	err := runSetupInteractive()
	if err != nil {
		t.Errorf("expected nil error for new-user full-mode flow, got %v", err)
	}

	// .env should have been written
	envPath := filepath.Join(tmpDir, "teamhero", ".env")
	if _, statErr := os.Stat(envPath); statErr != nil {
		t.Errorf("expected .env file to be created, got %v", statErr)
	}
}

func TestRunSetupInteractive_ExistingCredsAllValid(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)

	// Write .env with both required creds
	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte(
		"GITHUB_PERSONAL_ACCESS_TOKEN=ghp_test\nOPENAI_API_KEY=sk_test\n",
	), 0o600)

	// HTTP mock: GitHub returns 200 with login; OpenAI POST returns 200
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/user") {
			w.WriteHeader(200)
			w.Write([]byte(`{"login":"testuser"}`))
		} else {
			w.WriteHeader(200)
			w.Write([]byte(`{"id":"resp_123"}`))
		}
	}))
	defer ts.Close()

	oldGH := githubAPIBaseURL
	oldOA := openAIAPIBaseURL
	t.Cleanup(func() {
		githubAPIBaseURL = oldGH
		openAIAPIBaseURL = oldOA
	})
	githubAPIBaseURL = ts.URL
	openAIAPIBaseURL = ts.URL

	oldClient := defaultHTTPClient
	t.Cleanup(func() { defaultHTTPClient = oldClient })
	defaultHTTPClient = &http.Client{}

	// teaProgramRun → inline editor returns with no action (user quit)
	origTPR := teaProgramRun
	t.Cleanup(func() { teaProgramRun = origTPR })
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		return &inlineSettingsEditor{quitting: true, action: ""}, nil
	}

	err := runSetupInteractive()
	if err != nil {
		t.Errorf("expected nil error when all required creds are valid, got %v", err)
	}
}

func TestRunSetupInteractive_ExistingCredsWithGapsUsesInlineEditor(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)

	// Write .env with only GitHub (OpenAI missing → will be "skipped" but required → counts as gap)
	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte("GITHUB_PERSONAL_ACCESS_TOKEN=ghp_test\n"), 0o600)

	// HTTP mock: GitHub returns 200
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"testuser"}`))
	}))
	defer ts.Close()

	oldGH := githubAPIBaseURL
	t.Cleanup(func() { githubAPIBaseURL = oldGH })
	githubAPIBaseURL = ts.URL

	oldClient := defaultHTTPClient
	t.Cleanup(func() { defaultHTTPClient = oldClient })
	defaultHTTPClient = &http.Client{}

	// teaProgramRun → inline editor returns with no action (user quit)
	origTPR := teaProgramRun
	t.Cleanup(func() { teaProgramRun = origTPR })
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		// Return an inlineSettingsEditor with no action → user quit normally
		return &inlineSettingsEditor{quitting: true, action: ""}, nil
	}

	err := runSetupInteractive()
	if err != nil {
		t.Errorf("expected nil when user quits inline editor, got %v", err)
	}
}

// ===========================================================================
// handleSettingUpdate: API credential success path
// ===========================================================================

func TestHandleSettingUpdate_ApiCredKeySuccess(t *testing.T) {
	tmpDir := t.TempDir()
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte("GITHUB_PERSONAL_ACCESS_TOKEN=ghp_old\n"), 0o600)

	// HTTP mock — validateCredentials will call githubAPIBaseURL/user
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"testuser"}`))
	}))
	defer ts.Close()

	oldGH := githubAPIBaseURL
	t.Cleanup(func() { githubAPIBaseURL = oldGH })
	githubAPIBaseURL = ts.URL

	oldClient := defaultHTTPClient
	t.Cleanup(func() { defaultHTTPClient = oldClient })
	defaultHTTPClient = &http.Client{}

	// huhFormRun → nil (empty input → value stays "")
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil }

	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false, value: "ghp_old"},
	}
	allEntries := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_old"}

	err := handleSettingUpdate("GITHUB_PERSONAL_ACCESS_TOKEN", creds, envPath, allEntries)
	if err != nil {
		t.Errorf("expected nil error from handleSettingUpdate, got %v", err)
	}
}

// ===========================================================================
// googleDriveStatusLabel: connected path
// ===========================================================================

func TestGoogleDriveStatusLabel_Connected(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)

	// Write tokens with refresh_token (isGoogleDriveConnected=true)
	// access_token is set but expires_at=0 → getGoogleDriveEmail returns ""
	tokens := `{"refresh_token":"rt-123","access_token":"at-abc"}`
	os.WriteFile(filepath.Join(configPath, "google-tokens.json"), []byte(tokens), 0o600)

	label, connected := googleDriveStatusLabel()
	if !connected {
		t.Errorf("expected connected=true when google-tokens.json has refresh_token")
	}
	if !strings.Contains(label, "Google Drive") {
		t.Errorf("expected label to contain 'Google Drive', got %q", label)
	}
}

// ===========================================================================
// getGoogleDriveEmail: invalid JSON path
// ===========================================================================

func TestGetGoogleDriveEmail_InvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "google-tokens.json"), []byte("not-valid-json"), 0o600)

	email := getGoogleDriveEmail()
	if email != "" {
		t.Errorf("expected empty email for invalid JSON, got %q", email)
	}
}

// ===========================================================================
// handlePlainSettingUpdate: additional branches
// ===========================================================================

func TestHandlePlainSettingUpdate_SensitiveCurrentVal(t *testing.T) {
	tmpDir := t.TempDir()
	envPath := filepath.Join(tmpDir, ".env")
	os.WriteFile(envPath, []byte("GITHUB_PERSONAL_ACCESS_TOKEN=ghp_secret\n"), 0o600)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil } // newVal stays "", no changes

	allEntries := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_secret"}
	// GITHUB_PERSONAL_ACCESS_TOKEN is sensitive → desc includes "Current: <masked>"
	// EchoMode is also set (isSensitive=true) → line 1177
	err := handlePlainSettingUpdate("GITHUB_PERSONAL_ACCESS_TOKEN", envPath, allEntries)
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

func TestHandlePlainSettingUpdate_DefaultNoCurrentVal(t *testing.T) {
	tmpDir := t.TempDir()
	envPath := filepath.Join(tmpDir, ".env")
	os.WriteFile(envPath, []byte(""), 0o600)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil }

	// GITHUB_MAX_REPOSITORIES has defaultVal="100" and no current value
	allEntries := map[string]string{}
	err := handlePlainSettingUpdate("GITHUB_MAX_REPOSITORIES", envPath, allEntries)
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

func TestHandlePlainSettingUpdate_UnknownKeyWithCurrentVal(t *testing.T) {
	tmpDir := t.TempDir()
	envPath := filepath.Join(tmpDir, ".env")
	os.WriteFile(envPath, []byte("UNKNOWN_CUSTOM_KEY=some-value\n"), 0o600)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil }

	allEntries := map[string]string{"UNKNOWN_CUSTOM_KEY": "some-value"}
	err := handlePlainSettingUpdate("UNKNOWN_CUSTOM_KEY", envPath, allEntries)
	if err != nil {
		t.Errorf("expected nil error for unknown key, got %v", err)
	}
}

// ===========================================================================
// runSetupUpdateSingle: additional loop paths
// ===========================================================================

func TestRunSetupUpdateSingle_BoardsSuccess(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte("GITHUB_PERSONAL_ACCESS_TOKEN=ghp_test\n"), 0o600)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"testuser"}`))
	}))
	defer ts.Close()
	oldGH := githubAPIBaseURL
	t.Cleanup(func() { githubAPIBaseURL = oldGH })
	githubAPIBaseURL = ts.URL
	oldClient := defaultHTTPClient
	t.Cleanup(func() { defaultHTTPClient = oldClient })
	defaultHTTPClient = &http.Client{}

	// teaProgramRun: iteration 1 → @@boards, iteration 2 → @@done
	callCount := 0
	origTPR := teaProgramRun
	t.Cleanup(func() { teaProgramRun = origTPR })
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		callCount++
		if callCount == 1 {
			return settingsPicker{selected: "@@boards"}, nil
		}
		return settingsPicker{selected: "@@done"}, nil
	}

	// huhFormRun for runSetupBoards → nil (choice="" → createBoardsConfig → board=nil)
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil }

	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false},
	}
	err := runSetupUpdateSingle(creds, envPath)
	if err != nil {
		t.Errorf("expected nil error for @@boards success path, got %v", err)
	}
}

func TestRunSetupUpdateSingle_GdriveSuccess(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte("GITHUB_PERSONAL_ACCESS_TOKEN=ghp_test\n"), 0o600)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"testuser"}`))
	}))
	defer ts.Close()
	oldGH := githubAPIBaseURL
	t.Cleanup(func() { githubAPIBaseURL = oldGH })
	githubAPIBaseURL = ts.URL
	oldClient := defaultHTTPClient
	t.Cleanup(func() { defaultHTTPClient = oldClient })
	defaultHTTPClient = &http.Client{}

	// teaProgramRun: iteration 1 → @@gdrive, iteration 2 → @@done
	callCount := 0
	origTPR := teaProgramRun
	t.Cleanup(func() { teaProgramRun = origTPR })
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		callCount++
		if callCount == 1 {
			return settingsPicker{selected: "@@gdrive"}, nil
		}
		return settingsPicker{selected: "@@done"}, nil
	}

	// huhFormRun for runGoogleDriveSetup → nil (choice="" → no case → nil)
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil }

	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false},
	}
	err := runSetupUpdateSingle(creds, envPath)
	if err != nil {
		t.Errorf("expected nil error for @@gdrive success path, got %v", err)
	}
}

func TestRunSetupUpdateSingle_TeaProgramError(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte("GITHUB_PERSONAL_ACCESS_TOKEN=ghp_test\n"), 0o600)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"testuser"}`))
	}))
	defer ts.Close()
	oldGH := githubAPIBaseURL
	t.Cleanup(func() { githubAPIBaseURL = oldGH })
	githubAPIBaseURL = ts.URL
	oldClient := defaultHTTPClient
	t.Cleanup(func() { defaultHTTPClient = oldClient })
	defaultHTTPClient = &http.Client{}

	origTPR := teaProgramRun
	t.Cleanup(func() { teaProgramRun = origTPR })
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		return nil, fmt.Errorf("program error")
	}

	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false},
	}
	err := runSetupUpdateSingle(creds, envPath)
	if err == nil {
		t.Error("expected error from teaProgramRun, got nil")
	}
}

func TestRunSetupUpdateSingle_AllCredsInvalid(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte("GITHUB_PERSONAL_ACCESS_TOKEN=ghp_bad\n"), 0o600)

	// HTTP mock returns 401 → validateGitHub sets status="invalid" → allCredsValid=false
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		w.Write([]byte(`{"message":"Bad credentials"}`))
	}))
	defer ts.Close()
	oldGH := githubAPIBaseURL
	t.Cleanup(func() { githubAPIBaseURL = oldGH })
	githubAPIBaseURL = ts.URL
	oldClient := defaultHTTPClient
	t.Cleanup(func() { defaultHTTPClient = oldClient })
	defaultHTTPClient = &http.Client{}

	origTPR := teaProgramRun
	t.Cleanup(func() { teaProgramRun = origTPR })
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		return settingsPicker{selected: "@@done"}, nil
	}

	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false},
	}
	err := runSetupUpdateSingle(creds, envPath)
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

func TestRunSetupUpdateSingle_SettingUpdateError(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte("GITHUB_PERSONAL_ACCESS_TOKEN=ghp_test\n"), 0o600)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"testuser"}`))
	}))
	defer ts.Close()
	oldGH := githubAPIBaseURL
	t.Cleanup(func() { githubAPIBaseURL = oldGH })
	githubAPIBaseURL = ts.URL
	oldClient := defaultHTTPClient
	t.Cleanup(func() { defaultHTTPClient = oldClient })
	defaultHTTPClient = &http.Client{}

	// teaProgramRun: returns an apiCredentialKey selection
	origTPR := teaProgramRun
	t.Cleanup(func() { teaProgramRun = origTPR })
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		return settingsPicker{selected: "GITHUB_PERSONAL_ACCESS_TOKEN"}, nil
	}

	// huhFormRun aborts from promptCredentialInput → handleSettingUpdate returns error
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return huh.ErrUserAborted }

	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false},
	}
	err := runSetupUpdateSingle(creds, envPath)
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

func TestRunSetupUpdateSingle_SettingUpdateSuccess(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte("GITHUB_PERSONAL_ACCESS_TOKEN=ghp_test\n"), 0o600)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"testuser"}`))
	}))
	defer ts.Close()
	oldGH := githubAPIBaseURL
	t.Cleanup(func() { githubAPIBaseURL = oldGH })
	githubAPIBaseURL = ts.URL
	oldClient := defaultHTTPClient
	t.Cleanup(func() { defaultHTTPClient = oldClient })
	defaultHTTPClient = &http.Client{}

	// teaProgramRun: call 1 → non-credential setting, call 2 → @@done
	callCount := 0
	origTPR := teaProgramRun
	t.Cleanup(func() { teaProgramRun = origTPR })
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		callCount++
		if callCount == 1 {
			return settingsPicker{selected: "AI_MODEL"}, nil
		}
		return settingsPicker{selected: "@@done"}, nil
	}

	// huhFormRun → nil (handlePlainSettingUpdate: newVal="" → "No changes made.")
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil }

	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false},
	}
	err := runSetupUpdateSingle(creds, envPath)
	if err != nil {
		t.Errorf("expected nil error for setting update success, got %v", err)
	}
}
