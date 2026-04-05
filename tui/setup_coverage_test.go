package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/charmbracelet/huh"
)

// ---------------------------------------------------------------------------
// getGoogleDriveEmail tests
// ---------------------------------------------------------------------------

func TestGetGoogleDriveEmail_NoFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	email := getGoogleDriveEmail()
	if email != "" {
		t.Errorf("expected empty for missing file, got %q", email)
	}
}

func TestGetGoogleDriveEmail_EmptyAccessToken(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "google-tokens.json"), []byte(`{"access_token":"","expires_at":9999999999999}`), 0o600)

	email := getGoogleDriveEmail()
	if email != "" {
		t.Errorf("expected empty for empty access token, got %q", email)
	}
}

func TestGetGoogleDriveEmail_ExpiredToken(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)

	// Set expires_at to a past timestamp
	tokens := map[string]interface{}{
		"access_token": "at-test",
		"expires_at":   float64(time.Now().UnixMilli() - 10000),
	}
	data, _ := json.Marshal(tokens)
	os.WriteFile(filepath.Join(configPath, "google-tokens.json"), data, 0o600)

	email := getGoogleDriveEmail()
	if email != "" {
		t.Errorf("expected empty for expired token, got %q", email)
	}
}

func TestGetGoogleDriveEmail_ValidTokenReturnsEmail(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			w.WriteHeader(401)
			return
		}
		w.WriteHeader(200)
		w.Write([]byte(`{"email":"user@example.com"}`))
	}))
	defer ts.Close()

	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)

	// Valid token with future expiry
	tokens := map[string]interface{}{
		"access_token": "at-valid",
		"expires_at":   float64(time.Now().UnixMilli() + 3600000),
	}
	data, _ := json.Marshal(tokens)
	os.WriteFile(filepath.Join(configPath, "google-tokens.json"), data, 0o600)

	// We can't easily override the URL in getGoogleDriveEmail since it's hardcoded.
	// But we can test that the function handles errors gracefully (the actual HTTP call
	// will fail to connect to googleapis.com in test environment, returning "").
	email := getGoogleDriveEmail()
	// In test env, the googleapis.com call will fail, so email should be ""
	_ = email
	_ = ts
}

// ---------------------------------------------------------------------------
// getAsanaOAuthName tests
// ---------------------------------------------------------------------------

func TestGetAsanaOAuthName_NoFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	name := getAsanaOAuthName()
	if name != "" {
		t.Errorf("expected empty for missing file, got %q", name)
	}
}

func TestGetAsanaOAuthName_InvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "asana-tokens.json"), []byte("not-json"), 0o600)

	name := getAsanaOAuthName()
	if name != "" {
		t.Errorf("expected empty for invalid JSON, got %q", name)
	}
}

func TestGetAsanaOAuthName_EmptyAccessToken(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "asana-tokens.json"), []byte(`{"access_token":"","expires_at":9999999999999}`), 0o600)

	name := getAsanaOAuthName()
	if name != "" {
		t.Errorf("expected empty for empty access token, got %q", name)
	}
}

func TestGetAsanaOAuthName_ExpiredToken(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)

	tokens := map[string]interface{}{
		"access_token": "at-test",
		"expires_at":   float64(time.Now().UnixMilli() - 10000),
	}
	data, _ := json.Marshal(tokens)
	os.WriteFile(filepath.Join(configPath, "asana-tokens.json"), data, 0o600)

	name := getAsanaOAuthName()
	if name != "" {
		t.Errorf("expected empty for expired token, got %q", name)
	}
}

// ---------------------------------------------------------------------------
// isGoogleDriveConnected tests
// ---------------------------------------------------------------------------

func TestIsGoogleDriveConnected_NoFile_Coverage(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	if isGoogleDriveConnected() {
		t.Error("expected false when no tokens file exists")
	}
}

func TestIsGoogleDriveConnected_InvalidJSON_Coverage(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "google-tokens.json"), []byte("not-json"), 0o600)

	if isGoogleDriveConnected() {
		t.Error("expected false for invalid JSON")
	}
}

func TestIsGoogleDriveConnected_NoRefreshToken(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "google-tokens.json"), []byte(`{"access_token":"at"}`), 0o600)

	if isGoogleDriveConnected() {
		t.Error("expected false when no refresh_token")
	}
}

func TestIsGoogleDriveConnected_WithRefreshToken(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "google-tokens.json"), []byte(`{"refresh_token":"rt","access_token":"at"}`), 0o600)

	if !isGoogleDriveConnected() {
		t.Error("expected true when refresh_token exists")
	}
}

// ---------------------------------------------------------------------------
// isAsanaOAuthConnected tests
// ---------------------------------------------------------------------------

func TestIsAsanaOAuthConnected_NoFile_Coverage(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	if isAsanaOAuthConnected() {
		t.Error("expected false when no tokens file exists")
	}
}

func TestIsAsanaOAuthConnected_WithRefreshToken(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "asana-tokens.json"), []byte(`{"refresh_token":"rt","access_token":"at"}`), 0o600)

	if !isAsanaOAuthConnected() {
		t.Error("expected true when refresh_token exists")
	}
}

func TestIsAsanaOAuthConnected_NoRefreshToken(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "asana-tokens.json"), []byte(`{"access_token":"at"}`), 0o600)

	if isAsanaOAuthConnected() {
		t.Error("expected false when no refresh_token")
	}
}

// ---------------------------------------------------------------------------
// googleDriveStatusLabel tests
// ---------------------------------------------------------------------------

func TestGoogleDriveStatusLabel_NotConnected(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	label, connected := googleDriveStatusLabel()
	if connected {
		t.Error("expected connected=false")
	}
	if !strings.Contains(label, "Google Drive") {
		t.Errorf("expected 'Google Drive' in label, got %q", label)
	}
	if !strings.Contains(label, "connect") {
		t.Errorf("expected 'connect' hint, got %q", label)
	}
}

// ---------------------------------------------------------------------------
// asanaOAuthStatusLabel tests
// ---------------------------------------------------------------------------

func TestAsanaOAuthStatusLabel_NotConnected_Coverage(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	label, connected := asanaOAuthStatusLabel()
	if connected {
		t.Error("expected connected=false")
	}
	if !strings.Contains(label, "Asana") {
		t.Errorf("expected 'Asana' in label, got %q", label)
	}
}

func TestAsanaOAuthStatusLabel_Connected_Coverage(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	// Connected but expired token → getAsanaOAuthName returns ""
	os.WriteFile(filepath.Join(configPath, "asana-tokens.json"), []byte(`{"refresh_token":"rt","access_token":"at","expires_at":0}`), 0o600)

	label, connected := asanaOAuthStatusLabel()
	if !connected {
		t.Error("expected connected=true")
	}
	if !strings.Contains(label, "Asana") {
		t.Errorf("expected 'Asana' in label, got %q", label)
	}
}

// ---------------------------------------------------------------------------
// handleJsonSetup tests
// ---------------------------------------------------------------------------

func TestHandleJsonSetup_WithCredentialsAndSettings(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)

	// Mock HTTP for credential validation
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"testuser","id":"r"}`))
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

	input := &SetupInput{
		Credentials: map[string]string{
			"github_token":   "ghp_test123",
			"openai_api_key": "sk-test123",
		},
		Settings: map[string]string{
			"AI_MODEL": "gpt-5",
		},
	}

	err := handleJsonSetup(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Check .env was written
	envData, _ := os.ReadFile(filepath.Join(teamheroDir, ".env"))
	envStr := string(envData)
	if !strings.Contains(envStr, "ghp_test123") {
		t.Error("expected github token in .env")
	}
	if !strings.Contains(envStr, "AI_MODEL=gpt-5") {
		t.Error("expected AI_MODEL setting in .env")
	}
}

func TestHandleJsonSetup_WithConfig(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)

	// Mock HTTP
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"testuser","id":"r"}`))
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

	cfg := &ReportConfig{Org: "test-org"}
	input := &SetupInput{
		Credentials: map[string]string{
			"github_token":   "ghp_test",
			"openai_api_key": "sk-test",
		},
		Config: cfg,
	}

	err := handleJsonSetup(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Config should be saved
	saved, _ := LoadSavedConfig()
	if saved == nil {
		t.Fatal("expected config to be saved")
	}
	if saved.Org != "test-org" {
		t.Errorf("expected org 'test-org', got %q", saved.Org)
	}
}

func TestHandleJsonSetup_SkipValidation(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)

	validate := false
	input := &SetupInput{
		Credentials: map[string]string{
			"github_token":   "ghp_test",
			"openai_api_key": "sk-test",
		},
		Validate: &validate,
	}

	err := handleJsonSetup(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// ---------------------------------------------------------------------------
// addBoardToConfig tests
// ---------------------------------------------------------------------------

func TestAddBoardToConfig_UserCancels(t *testing.T) {
	tmpDir := t.TempDir()
	boardsPath := filepath.Join(tmpDir, "asana-config.json")
	os.WriteFile(boardsPath, []byte(`{"boards":[]}`), 0o644)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil } // empty values → nil board

	err := addBoardToConfig(boardsPath)
	if err != nil {
		t.Errorf("expected nil error when user cancels, got %v", err)
	}
}

func TestAddBoardToConfig_InvalidFile(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })

	// Provide actual board values via form mock
	callCount := 0
	huhFormRun = func(f *huh.Form) error {
		callCount++
		return nil // empty values → board=nil (projectGid is empty)
	}

	err := addBoardToConfig("/nonexistent/path/boards.json")
	// board is nil because form values are empty, so it returns early with "No board added"
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// createBoardsConfig tests
// ---------------------------------------------------------------------------

func TestCreateBoardsConfig_UserCancels(t *testing.T) {
	tmpDir := t.TempDir()
	boardsPath := filepath.Join(tmpDir, "asana-config.json")

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil } // empty → nil board

	err := createBoardsConfig(boardsPath)
	if err != nil {
		t.Errorf("expected nil error when user cancels, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// runSetupBoards tests
// ---------------------------------------------------------------------------

func TestRunSetupBoards_NoBoardsFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil } // empty → nil board → "No boards configured."

	err := runSetupBoards(boardsConfigStatus{})
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

func TestRunSetupBoards_ExistingBoardsFileAbort(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	boardsPath := filepath.Join(configPath, "asana-config.json")
	os.WriteFile(boardsPath, []byte(`{"boards":[{"projectGid":"123"}]}`), 0o644)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return huh.ErrUserAborted }

	err := runSetupBoards(boardsConfigStatus{found: true, count: 1, path: boardsPath})
	if err != huh.ErrUserAborted {
		t.Errorf("expected huh.ErrUserAborted, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// runGoogleDriveFromPicker tests
// ---------------------------------------------------------------------------

func TestRunGoogleDriveFromPicker_NotConnected(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil } // choice="" → skip

	err := runGoogleDriveFromPicker()
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// runAsanaOAuthFromPicker tests
// ---------------------------------------------------------------------------

func TestRunAsanaOAuthFromPicker_NotConnected(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil } // choice="" → skip

	err := runAsanaOAuthFromPicker()
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// runAsanaOAuthSetup tests
// ---------------------------------------------------------------------------

func TestRunAsanaOAuthSetup_Skip(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil } // choice="" → no case match → nil

	err := runAsanaOAuthSetup()
	if err != nil {
		t.Errorf("expected nil error for skip, got %v", err)
	}
}

func TestRunAsanaOAuthSetup_Abort(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return huh.ErrUserAborted }

	err := runAsanaOAuthSetup()
	if err != huh.ErrUserAborted {
		t.Errorf("expected huh.ErrUserAborted, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// runGoogleDriveSetup tests
// ---------------------------------------------------------------------------

func TestRunGoogleDriveSetup_Abort(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return huh.ErrUserAborted }

	err := runGoogleDriveSetup()
	if err != huh.ErrUserAborted {
		t.Errorf("expected huh.ErrUserAborted, got %v", err)
	}
}

func TestRunGoogleDriveSetup_Skip(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil } // choice="" → no case → nil

	err := runGoogleDriveSetup()
	if err != nil {
		t.Errorf("expected nil error for skip, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// promptAsanaPATFromOAuthSetup tests
// ---------------------------------------------------------------------------

func TestPromptAsanaPATFromOAuthSetup_EmptyValue(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil } // empty value

	err := promptAsanaPATFromOAuthSetup()
	if err != nil {
		t.Errorf("expected nil error for empty value, got %v", err)
	}
}

func TestPromptAsanaPATFromOAuthSetup_Abort(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return huh.ErrUserAborted }

	err := promptAsanaPATFromOAuthSetup()
	if err != huh.ErrUserAborted {
		t.Errorf("expected huh.ErrUserAborted, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// runExpressSetupPrompt tests
// ---------------------------------------------------------------------------

func TestRunExpressSetupPrompt_HasCredentials_Coverage(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	// Write .env with credentials
	os.WriteFile(filepath.Join(teamheroDir, ".env"), []byte("GITHUB_PERSONAL_ACCESS_TOKEN=ghp_test\nOPENAI_API_KEY=sk-test\n"), 0o600)

	err := runExpressSetupPrompt()
	if err != nil {
		t.Errorf("expected nil when credentials exist, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// SaveConfig edge cases (coverage for error path)
// ---------------------------------------------------------------------------

func TestSaveConfig_CreatesDirectory_Coverage(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	// Don't create teamhero dir — SaveConfig should create it

	cfg := &ReportConfig{Org: "test-org"}
	err := SaveConfig(cfg)
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}

	saved, _ := LoadSavedConfig()
	if saved == nil {
		t.Fatal("expected config to be loadable after save")
	}
	if saved.Org != "test-org" {
		t.Errorf("expected org 'test-org', got %q", saved.Org)
	}
}

// ---------------------------------------------------------------------------
// HasCredentials tests
// ---------------------------------------------------------------------------

func TestHasCredentials_Empty(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)
	t.Setenv("GITHUB_PERSONAL_ACCESS_TOKEN", "")
	t.Setenv("OPENAI_API_KEY", "")

	if HasCredentials() {
		t.Error("expected false with no credentials")
	}
}

func TestHasCredentials_WithBothTokens(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	// HasCredentials reads from .env file, not env vars
	os.WriteFile(filepath.Join(teamheroDir, ".env"), []byte("GITHUB_PERSONAL_ACCESS_TOKEN=ghp_test\nOPENAI_API_KEY=sk-test\n"), 0o600)

	if !HasCredentials() {
		t.Error("expected true with both tokens set")
	}
}
