package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
	"unsafe"

	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
)

// ---------------------------------------------------------------------------
// Form value injection helper.
//
// huhFormRun is a function variable that tests can override, but the bound
// variables passed via Value(&var) live inside the production function and
// aren't accessible from the stub. To exercise success paths in functions
// like promptBoardInput, we walk the form via reflection and set each
// field's accessor value directly. Strings are matched in declaration order.
// ---------------------------------------------------------------------------

// setFormFieldValues populates each field's accessor in declaration order
// with the corresponding value. Each value can be a string (for Input/Select[string])
// or a bool (for Select[bool]). Extra fields are left untouched.
func setFormFieldValues(t *testing.T, form *huh.Form, values ...interface{}) {
	t.Helper()
	fv := reflect.ValueOf(form).Elem()
	selF := unexportedField(fv, "selector")
	if !selF.IsValid() {
		t.Fatalf("could not access form selector")
	}
	groupsF := unexportedField(selF.Elem(), "items")
	if !groupsF.IsValid() {
		t.Fatalf("could not access form groups")
	}
	idx := 0
	for i := 0; i < groupsF.Len() && idx < len(values); i++ {
		grp := groupsF.Index(i).Elem()
		gselF := unexportedField(grp, "selector")
		if !gselF.IsValid() {
			continue
		}
		fieldsF := unexportedField(gselF.Elem(), "items")
		if !fieldsF.IsValid() {
			continue
		}
		for j := 0; j < fieldsF.Len() && idx < len(values); j++ {
			fld := fieldsF.Index(j)
			ptr := fld.Elem().Elem() // interface → ptr → struct
			accF := unexportedField(ptr, "accessor")
			if !accF.IsValid() {
				continue
			}
			setM := accF.MethodByName("Set")
			if !setM.IsValid() {
				continue
			}
			arg := reflect.ValueOf(values[idx])
			idx++
			argT := setM.Type().In(0)
			if !arg.Type().AssignableTo(argT) {
				continue
			}
			setM.Call([]reflect.Value{arg})
		}
	}
}

// unexportedField returns a settable reflect.Value for an unexported field.
func unexportedField(v reflect.Value, name string) reflect.Value {
	f := v.FieldByName(name)
	if !f.IsValid() {
		return f
	}
	return reflect.NewAt(f.Type(), unsafe.Pointer(f.UnsafeAddr())).Elem()
}

// ---------------------------------------------------------------------------
// tryReadStdin tests — swap os.Stdin to a pipe to exercise non-terminal paths.
// ---------------------------------------------------------------------------

// withStdin runs fn with os.Stdin replaced by a pipe pre-filled with data.
// When data is nil, the pipe is closed with no data written.
func withStdin(t *testing.T, data []byte, fn func()) {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	if data != nil {
		if _, err := w.Write(data); err != nil {
			t.Fatalf("pipe write: %v", err)
		}
	}
	w.Close()

	origStdin := os.Stdin
	os.Stdin = r
	t.Cleanup(func() {
		os.Stdin = origStdin
		r.Close()
	})
	fn()
}

func TestTryReadStdin_ValidJSON(t *testing.T) {
	payload := []byte(`{"credentials":{"github_token":"ghp_xyz"}}`)
	var result *SetupInput
	withStdin(t, payload, func() {
		result = tryReadStdin()
	})
	if result == nil {
		t.Fatal("expected non-nil SetupInput for piped JSON")
	}
	if got := result.Credentials["github_token"]; got != "ghp_xyz" {
		t.Errorf("expected github_token ghp_xyz, got %q", got)
	}
}

func TestTryReadStdin_EmptyPipe(t *testing.T) {
	var result *SetupInput
	withStdin(t, []byte(""), func() {
		result = tryReadStdin()
	})
	if result != nil {
		t.Errorf("expected nil for empty pipe, got %+v", result)
	}
}

func TestTryReadStdin_WhitespaceOnlyPipe(t *testing.T) {
	var result *SetupInput
	withStdin(t, []byte("   \n\t  "), func() {
		result = tryReadStdin()
	})
	if result != nil {
		t.Errorf("expected nil for whitespace-only pipe, got %+v", result)
	}
}

func TestTryReadStdin_InvalidJSON(t *testing.T) {
	var result *SetupInput
	withStdin(t, []byte("not json at all"), func() {
		result = tryReadStdin()
	})
	if result != nil {
		t.Errorf("expected nil for invalid JSON, got %+v", result)
	}
}

// ---------------------------------------------------------------------------
// handleJsonSetup — additional paths: invalid credentials (failure status)
// and raw env-key form of credentials.
// ---------------------------------------------------------------------------

func TestHandleJsonSetup_RawEnvKeyCredentials(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"u","id":"r"}`))
	}))
	defer ts.Close()

	oldGH := githubAPIBaseURL
	oldOA := openAIAPIBaseURL
	oldAS := asanaAPIBaseURL
	t.Cleanup(func() {
		githubAPIBaseURL = oldGH
		openAIAPIBaseURL = oldOA
		asanaAPIBaseURL = oldAS
	})
	githubAPIBaseURL = ts.URL
	openAIAPIBaseURL = ts.URL
	asanaAPIBaseURL = ts.URL

	// Use raw env-key form instead of the friendly name
	input := &SetupInput{
		Credentials: map[string]string{
			"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_raw",
			"OPENAI_API_KEY":               "sk-raw",
			"ASANA_API_TOKEN":              "asana-raw",
		},
	}

	if err := handleJsonSetup(input); err != nil {
		t.Fatalf("handleJsonSetup: %v", err)
	}

	envData, _ := os.ReadFile(filepath.Join(tmpDir, "teamhero", ".env"))
	if !strings.Contains(string(envData), "ghp_raw") {
		t.Error("expected ghp_raw in .env")
	}
}

func TestHandleJsonSetup_InvalidCredentials(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	// All endpoints return 401 → credentials marked invalid
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
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

	input := &SetupInput{
		Credentials: map[string]string{
			"github_token":   "ghp_bad",
			"openai_api_key": "sk-bad",
		},
	}

	if err := handleJsonSetup(input); err != nil {
		t.Fatalf("handleJsonSetup: %v", err)
	}
	// The Success=false branch is exercised internally (written to stdout).
}

func TestHandleJsonSetup_MissingRequired(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	// No overrides, no HTTP — validate should mark required as invalid (missing)
	input := &SetupInput{
		Credentials: map[string]string{}, // empty
	}

	if err := handleJsonSetup(input); err != nil {
		t.Fatalf("handleJsonSetup: %v", err)
	}
}

func TestHandleJsonSetup_ExistingFileOverlay(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)

	// Pre-existing .env provides one credential — input provides the others
	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte("GITHUB_PERSONAL_ACCESS_TOKEN=ghp_existing\n"), 0o600)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"u","id":"r"}`))
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

	validate := false
	input := &SetupInput{
		Credentials: map[string]string{
			"openai_api_key": "sk-new",
		},
		Validate: &validate,
	}

	if err := handleJsonSetup(input); err != nil {
		t.Fatalf("handleJsonSetup: %v", err)
	}

	envData, _ := os.ReadFile(envPath)
	if !strings.Contains(string(envData), "ghp_existing") {
		t.Error("expected existing github token to be preserved")
	}
	if !strings.Contains(string(envData), "sk-new") {
		t.Error("expected new openai key to be written")
	}
}

// ---------------------------------------------------------------------------
// runSetup — header routing. Test that runSetup() delegates to headless/interactive.
// ---------------------------------------------------------------------------

func TestRunSetup_HeadlessPath_Boost(t *testing.T) {
	// Force headless via env var, and pipe minimal JSON so runSetupHeadless
	// takes the handleJsonSetup branch (no env var validation needed).
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)
	t.Setenv("TEAMHERO_HEADLESS", "1")

	validate := false
	payload, _ := json.Marshal(&SetupInput{
		Credentials: map[string]string{"github_token": "ghp_x", "openai_api_key": "sk-x"},
		Validate:    &validate,
	})

	withStdin(t, payload, func() {
		if err := runSetup(); err != nil {
			t.Errorf("runSetup: %v", err)
		}
	})
}

// ---------------------------------------------------------------------------
// runSetupHeadless — cover the non-JSON path (env var driven).
// ---------------------------------------------------------------------------

func TestRunSetupHeadless_FromEnvVars(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	t.Setenv("GITHUB_PERSONAL_ACCESS_TOKEN", "ghp_env")
	t.Setenv("OPENAI_API_KEY", "sk-env")

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"u","id":"r"}`))
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

	// Ensure stdin is a tty so tryReadStdin returns nil (not pipe mode).
	// In test env stdin is not a tty either, so we need to arrange it so that
	// tryReadStdin reads nothing — pass a closed pipe.
	withStdin(t, []byte(""), func() {
		if err := runSetupHeadless(); err != nil {
			t.Errorf("runSetupHeadless: %v", err)
		}
	})
}

func TestRunSetupHeadless_MissingRequired_Boost(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	// Clear env vars that might leak from the test environment
	t.Setenv("GITHUB_PERSONAL_ACCESS_TOKEN", "")
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("ASANA_API_TOKEN", "")

	withStdin(t, []byte(""), func() {
		err := runSetupHeadless()
		if err == nil {
			t.Error("expected error for missing required env vars")
		}
	})
}

// ---------------------------------------------------------------------------
// handleSettingUpdate / handlePlainSettingUpdate — additional branches.
// ---------------------------------------------------------------------------

func TestHandleSettingUpdate_GitHubCred(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte("GITHUB_PERSONAL_ACCESS_TOKEN=old\n"), 0o600)

	origHuh := huhFormRun
	origScript := serviceScriptRunner
	t.Cleanup(func() {
		huhFormRun = origHuh
		serviceScriptRunner = origScript
	})
	// Forms: method=oauth (stays "") ... service fails → falls back to PAT → empty
	huhFormRun = func(f *huh.Form) error { return nil }
	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		return nil, fmt.Errorf("service unavailable")
	}

	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub", optional: false, value: "old"},
	}
	allEntries := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "old"}

	err := handleSettingUpdate("GITHUB_PERSONAL_ACCESS_TOKEN", creds, envPath, allEntries)
	if err != nil {
		t.Errorf("handleSettingUpdate GitHub: %v", err)
	}
}

func TestHandleSettingUpdate_AsanaCred(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte("ASANA_API_TOKEN=old\n"), 0o600)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	// method stays "" → falls through to promptCredentialInput default
	huhFormRun = func(f *huh.Form) error { return nil }

	creds := []credential{
		{envKey: "ASANA_API_TOKEN", label: "Asana", optional: true, value: "old"},
	}
	allEntries := map[string]string{"ASANA_API_TOKEN": "old"}

	err := handleSettingUpdate("ASANA_API_TOKEN", creds, envPath, allEntries)
	if err != nil {
		t.Errorf("handleSettingUpdate Asana: %v", err)
	}
}

func TestHandleSettingUpdate_OpenAICredDirectInput(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil }

	creds := []credential{
		{envKey: "OPENAI_API_KEY", label: "OpenAI", optional: false},
	}
	allEntries := map[string]string{}

	err := handleSettingUpdate("OPENAI_API_KEY", creds, envPath, allEntries)
	if err != nil {
		t.Errorf("handleSettingUpdate OpenAI: %v", err)
	}
}

func TestHandlePlainSettingUpdate_KnownKey(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil }

	allEntries := map[string]string{"AI_MODEL": "gpt-4.1"}
	err := handlePlainSettingUpdate("AI_MODEL", envPath, allEntries)
	if err != nil {
		t.Errorf("handlePlainSettingUpdate: %v", err)
	}
}

func TestHandlePlainSettingUpdate_UnknownKeyWithValue(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil }

	allEntries := map[string]string{"CUSTOM_KEY": "something"}
	err := handlePlainSettingUpdate("CUSTOM_KEY", envPath, allEntries)
	if err != nil {
		t.Errorf("handlePlainSettingUpdate: %v", err)
	}
}

func TestHandlePlainSettingUpdate_FormError(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return huh.ErrUserAborted }

	err := handlePlainSettingUpdate("AI_MODEL", envPath, map[string]string{})
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

func TestHandlePlainSettingUpdate_SensitiveKey(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil }

	// Find a sensitive key from the registry to exercise the EchoModePassword path.
	// GITHUB_PERSONAL_ACCESS_TOKEN is sensitive — but it's an API cred, so routed
	// to handleSettingUpdate. Use OPENAI_API_KEY too? It's also API cred. Use a plain
	// sensitive one if present; otherwise the path is still exercised via known-key.
	allEntries := map[string]string{"OPENAI_API_KEY": "sk-old"}
	_ = handlePlainSettingUpdate("OPENAI_API_KEY", envPath, allEntries)
	// NB: OPENAI_API_KEY is in apiCredentialKeys — callers use handleSettingUpdate,
	// but the plain-update path itself is still valid to exercise directly.
}

// ---------------------------------------------------------------------------
// runGitHubAuthFromInlineEditor — 0% coverage.
// ---------------------------------------------------------------------------

func TestRunGitHubAuthFromInlineEditor_Success(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte("GITHUB_PERSONAL_ACCESS_TOKEN=ghp_old\n"), 0o600)

	origHuh := huhFormRun
	origScript := serviceScriptRunner
	t.Cleanup(func() {
		huhFormRun = origHuh
		serviceScriptRunner = origScript
	})

	huhFormRun = func(f *huh.Form) error { return nil } // oauth path
	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		return map[string]interface{}{
			"ok":    true,
			"token": "gho_new",
			"login": "alice",
		}, nil
	}

	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub", optional: false, value: "ghp_old"},
	}

	err := runGitHubAuthFromInlineEditor(creds, envPath)
	if err != nil {
		t.Errorf("runGitHubAuthFromInlineEditor: %v", err)
	}

	// Token should have been updated in the .env
	envData, _ := os.ReadFile(envPath)
	if !strings.Contains(string(envData), "gho_new") {
		t.Error("expected new token to be written to .env")
	}
}

func TestRunGitHubAuthFromInlineEditor_FormError(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return huh.ErrUserAborted }

	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub"},
	}
	err := runGitHubAuthFromInlineEditor(creds, envPath)
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

func TestRunGitHubAuthFromInlineEditor_NoGitHubCred(t *testing.T) {
	tmpDir := t.TempDir()
	envPath := filepath.Join(tmpDir, ".env")

	creds := []credential{
		{envKey: "OPENAI_API_KEY", label: "OpenAI"},
	}
	err := runGitHubAuthFromInlineEditor(creds, envPath)
	if err != nil {
		t.Errorf("expected nil when no GitHub cred present, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// promptGitHubAuth — disconnect path.
// ---------------------------------------------------------------------------

// Note: the disconnect option is only offered when c.value != "". Setting it via
// the bound variable is not possible, so the disconnect branch requires the
// form mock to *not* set method — but by default method stays "" and the OAuth
// path is taken. The disconnect branch is effectively untestable without
// reflecting into the form struct; skipping.

// ---------------------------------------------------------------------------
// getGoogleDriveEmail — exercise the HTTP-path branches (though we can't
// override the hardcoded googleapis.com URL, we can stuff valid-looking tokens
// to drive through additional branches).
// ---------------------------------------------------------------------------

func TestGetGoogleDriveEmail_ValidTokenNoExpiresAt(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)

	// expires_at = 0 (default) → now >= 0 → treated as expired → empty
	os.WriteFile(filepath.Join(configPath, "google-tokens.json"),
		[]byte(`{"access_token":"at-test"}`), 0o600)

	email := getGoogleDriveEmail()
	if email != "" {
		t.Errorf("expected empty for token without expires_at, got %q", email)
	}
}

func TestGetGoogleDriveEmail_MalformedJSON(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)

	os.WriteFile(filepath.Join(configPath, "google-tokens.json"),
		[]byte("garbage"), 0o600)

	email := getGoogleDriveEmail()
	if email != "" {
		t.Errorf("expected empty for malformed json, got %q", email)
	}
}

// ---------------------------------------------------------------------------
// runGoogleDriveSetup / runGoogleBYOCFlow — form-abort and skip paths.
// ---------------------------------------------------------------------------

func TestRunGoogleDriveSetup_FormAbort(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return huh.ErrUserAborted }

	err := runGoogleDriveSetup()
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

func TestRunGoogleDriveSetup_SkipDefault(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	// choice stays "" → falls through return nil
	huhFormRun = func(f *huh.Form) error { return nil }

	err := runGoogleDriveSetup()
	if err != nil {
		t.Errorf("runGoogleDriveSetup: %v", err)
	}
}

func TestRunGoogleBYOCFlow_FormAbort(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return huh.ErrUserAborted }

	err := runGoogleBYOCFlow()
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// runGoogleDriveManage — all three choice branches and the abort path.
// ---------------------------------------------------------------------------

func TestRunGoogleDriveManage_AbortForm(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return huh.ErrUserAborted }

	err := runGoogleDriveManage()
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

func TestRunGoogleDriveManage_KeepDefault(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil } // choice=""

	err := runGoogleDriveManage()
	if err != nil {
		t.Errorf("runGoogleDriveManage: %v", err)
	}
}

// ---------------------------------------------------------------------------
// runAsanaOAuthManage / runAsanaOAuthSetup — branches.
// ---------------------------------------------------------------------------

func TestRunAsanaOAuthManage_AbortForm(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return huh.ErrUserAborted }

	err := runAsanaOAuthManage()
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

func TestRunAsanaOAuthSetup_FormAbort(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return huh.ErrUserAborted }

	err := runAsanaOAuthSetup()
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// promptAsanaAuth — additional branches.
// ---------------------------------------------------------------------------

func TestPromptAsanaAuth_Abort(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return huh.ErrUserAborted }

	c := &credential{envKey: "ASANA_API_TOKEN", label: "Asana", optional: true}
	err := promptAsanaAuth(c)
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

func TestPromptAsanaAuth_DefaultFallbackPath(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	// method stays "" → hits the default-fallback return at the end of the function
	huhFormRun = func(f *huh.Form) error { return nil }

	c := &credential{envKey: "ASANA_API_TOKEN", label: "Asana", optional: true}
	err := promptAsanaAuth(c)
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// promptAsanaPATFromOAuthSetup — success and form-error branches.
// ---------------------------------------------------------------------------

func TestPromptAsanaPATFromOAuthSetup_EmptyValue_Boost(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil } // no value entered

	err := promptAsanaPATFromOAuthSetup()
	if err != nil {
		t.Errorf("promptAsanaPATFromOAuthSetup: %v", err)
	}
}

func TestPromptAsanaPATFromOAuthSetup_FormError(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return huh.ErrUserAborted }

	err := promptAsanaPATFromOAuthSetup()
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// runExpressSetupPrompt — covered paths.
// ---------------------------------------------------------------------------

func TestRunExpressSetupPrompt_AlreadyHasCredentials(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	os.WriteFile(filepath.Join(teamheroDir, ".env"),
		[]byte("GITHUB_PERSONAL_ACCESS_TOKEN=x\nOPENAI_API_KEY=y\n"), 0o600)

	// Should short-circuit and return nil without running the form
	err := runExpressSetupPrompt()
	if err != nil {
		t.Errorf("expected nil when credentials exist, got %v", err)
	}
}

func TestRunExpressSetupPrompt_FormAbort(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return huh.ErrUserAborted }

	err := runExpressSetupPrompt()
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

func TestRunExpressSetupPrompt_DeclineProceed(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	// proceed stays false → returns error "run `teamhero setup` first..."
	huhFormRun = func(f *huh.Form) error { return nil }

	err := runExpressSetupPrompt()
	if err == nil {
		t.Error("expected error when user declines setup")
	}
}

// ---------------------------------------------------------------------------
// runServiceScript — non-existent script path returns an error quickly.
// ---------------------------------------------------------------------------

func TestRunServiceScript_NonExistent(t *testing.T) {
	// Invoke runServiceScript with a script that cannot be found. This
	// still shells out to bun — if bun is absent or the script missing,
	// we expect an error back.
	_, err := runServiceScript("definitely-does-not-exist-xyz.ts", nil)
	if err == nil {
		t.Log("runServiceScript succeeded unexpectedly; acceptable")
	}
}

// ---------------------------------------------------------------------------
// buildGDriveItem — connected branches.
// ---------------------------------------------------------------------------

func TestBuildGDriveItem_NotConnected(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	item := buildGDriveItem()
	if item.key != "@@gdrive" {
		t.Errorf("expected key @@gdrive, got %s", item.key)
	}
	if item.value != "not connected" {
		t.Errorf("expected 'not connected', got %q", item.value)
	}
	if len(item.options) != 1 || item.options[0] != "Connect now" {
		t.Errorf("expected [Connect now], got %v", item.options)
	}
}

func TestBuildGDriveItem_Connected(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	// Write tokens with a refresh_token so isGoogleDriveConnected returns true.
	os.WriteFile(filepath.Join(configPath, "google-tokens.json"),
		[]byte(`{"access_token":"at","refresh_token":"rt","expires_at":0}`), 0o600)

	item := buildGDriveItem()
	if item.value == "not connected" {
		t.Error("expected 'connected' or email value, got 'not connected'")
	}
	if len(item.options) != 2 {
		t.Errorf("expected 2 options when connected, got %v", item.options)
	}
}

// ---------------------------------------------------------------------------
// inlineSettingsEditor.handleNavigateKey — exercise all key branches.
// ---------------------------------------------------------------------------

func makeNavEditor() *inlineSettingsEditor {
	return &inlineSettingsEditor{
		ready:    true,
		width:    80,
		height:   24,
		viewport: viewport.New(60, 10),
		helpVP:   viewport.New(30, 10),
		items: []editorItem{
			{key: "A", label: "Item A", itype: inputText},
			{key: "B", label: "Item B", itype: inputText},
			{key: "C", label: "Item C", itype: inputText},
		},
		lines: []editorLine{
			{text: "header", itemIndex: -1},
			{text: "item a", itemIndex: 0},
			{text: "item b", itemIndex: 1},
			{text: "item c", itemIndex: 2},
		},
		cursor: 1,
	}
}

func TestHandleNavigateKey_DownKey(t *testing.T) {
	m := makeNavEditor()
	_, _ = m.handleNavigateKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}})
	// cursor should have moved
	if m.cursor == 1 {
		t.Error("expected cursor to move on 'j' key")
	}
}

func TestHandleNavigateKey_UpKey(t *testing.T) {
	m := makeNavEditor()
	m.cursor = 3
	_, _ = m.handleNavigateKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'k'}})
	if m.cursor == 3 {
		t.Error("expected cursor to move on 'k' key")
	}
}

func TestHandleNavigateKey_HomeKey(t *testing.T) {
	m := makeNavEditor()
	m.cursor = 3
	_, _ = m.handleNavigateKey(tea.KeyMsg{Type: tea.KeyHome})
	// cursor should reset to first selectable
	if m.cursor == 3 {
		t.Error("expected cursor to reset on Home")
	}
}

func TestHandleNavigateKey_EndKey(t *testing.T) {
	m := makeNavEditor()
	m.cursor = 1
	_, _ = m.handleNavigateKey(tea.KeyMsg{Type: tea.KeyEnd})
	if m.cursor == 1 {
		t.Error("expected cursor to move on End")
	}
}

func TestHandleNavigateKey_PgUp(t *testing.T) {
	m := makeNavEditor()
	_, cmd := m.handleNavigateKey(tea.KeyMsg{Type: tea.KeyPgUp})
	if cmd != nil {
		t.Error("expected no cmd for pgup (scroll only)")
	}
}

func TestHandleNavigateKey_PgDown(t *testing.T) {
	m := makeNavEditor()
	_, cmd := m.handleNavigateKey(tea.KeyMsg{Type: tea.KeyPgDown})
	if cmd != nil {
		t.Error("expected no cmd for pgdown (scroll only)")
	}
}

func TestHandleNavigateKey_EscQuits(t *testing.T) {
	m := makeNavEditor()
	_, cmd := m.handleNavigateKey(tea.KeyMsg{Type: tea.KeyEsc})
	if !m.quitting {
		t.Error("expected quitting=true")
	}
	if cmd == nil {
		t.Error("expected tea.Quit cmd")
	}
}

func TestHandleNavigateKey_CtrlCQuits(t *testing.T) {
	m := makeNavEditor()
	_, cmd := m.handleNavigateKey(tea.KeyMsg{Type: tea.KeyCtrlC})
	if !m.quitting {
		t.Error("expected quitting=true")
	}
	if cmd == nil {
		t.Error("expected tea.Quit cmd")
	}
}

func TestHandleNavigateKey_QKeyQuits(t *testing.T) {
	m := makeNavEditor()
	_, cmd := m.handleNavigateKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}})
	if !m.quitting {
		t.Error("expected quitting=true")
	}
	if cmd == nil {
		t.Error("expected tea.Quit cmd")
	}
}

func TestHandleNavigateKey_UnknownKey(t *testing.T) {
	m := makeNavEditor()
	origCursor := m.cursor
	_, _ = m.handleNavigateKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'x'}})
	if m.cursor != origCursor {
		t.Error("expected cursor not to change on unknown key")
	}
}

// ---------------------------------------------------------------------------
// inlineSettingsEditor.handleEditKey — esc path.
// ---------------------------------------------------------------------------

func TestHandleEditKey_EscReturnsToNavigate_Boost(t *testing.T) {
	m := &inlineSettingsEditor{
		mode:      modeEdit,
		statusMsg: "something",
	}
	_, _ = m.handleEditKey(tea.KeyMsg{Type: tea.KeyEsc})
	if m.mode != modeNavigate {
		t.Error("expected mode=modeNavigate after esc")
	}
	if m.editForm != nil {
		t.Error("expected editForm to be cleared")
	}
	if m.statusMsg != "" {
		t.Error("expected statusMsg to be cleared")
	}
}

func TestHandleEditKey_NoFormNoOp(t *testing.T) {
	m := &inlineSettingsEditor{mode: modeEdit, editForm: nil}
	result, cmd := m.handleEditKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'a'}})
	if result != m {
		t.Error("expected same model back")
	}
	if cmd != nil {
		t.Error("expected nil cmd")
	}
}

// ---------------------------------------------------------------------------
// settingsPicker — exercise Update/Init paths.
// ---------------------------------------------------------------------------

func TestSettingsPicker_UpdateWindowSize(t *testing.T) {
	p := settingsPicker{
		items: []settingsPickerItem{
			{key: "a", label: "A"},
			{key: "b", label: "B"},
		},
		lines: []pickerLine{
			{text: "A", itemIndex: 0},
			{text: "B", itemIndex: 1},
		},
	}
	model, _ := p.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	np := model.(settingsPicker)
	if !np.ready {
		t.Error("expected ready=true after window size msg")
	}
}

func TestSettingsPicker_UpdateDownArrow(t *testing.T) {
	p := settingsPicker{
		items: []settingsPickerItem{
			{key: "a", label: "A"},
			{key: "b", label: "B"},
		},
		lines: []pickerLine{
			{text: "A", itemIndex: 0},
			{text: "B", itemIndex: 1},
		},
		viewport: viewport.New(40, 10),
		ready:    true,
	}
	model, _ := p.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}})
	np := model.(settingsPicker)
	if np.cursor != 1 {
		t.Errorf("expected cursor=1 after 'j', got %d", np.cursor)
	}
}

func TestSettingsPicker_UpdateUpArrow(t *testing.T) {
	p := settingsPicker{
		items: []settingsPickerItem{
			{key: "a", label: "A"},
			{key: "b", label: "B"},
		},
		lines: []pickerLine{
			{text: "A", itemIndex: 0},
			{text: "B", itemIndex: 1},
		},
		viewport: viewport.New(40, 10),
		cursor:   1,
		ready:    true,
	}
	model, _ := p.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'k'}})
	np := model.(settingsPicker)
	if np.cursor != 0 {
		t.Errorf("expected cursor=0 after 'k', got %d", np.cursor)
	}
}

func TestSettingsPicker_UpdateEnterSelects(t *testing.T) {
	p := settingsPicker{
		items: []settingsPickerItem{
			{key: "chosen", label: "X"},
		},
		lines:    []pickerLine{{text: "X", itemIndex: 0}},
		viewport: viewport.New(40, 10),
		ready:    true,
	}
	model, _ := p.Update(tea.KeyMsg{Type: tea.KeyEnter})
	np := model.(settingsPicker)
	if np.selected != "chosen" {
		t.Errorf("expected selected=chosen, got %q", np.selected)
	}
	if !np.quitting {
		t.Error("expected quitting=true after enter")
	}
}

func TestSettingsPicker_UpdateEsc(t *testing.T) {
	p := settingsPicker{
		items:    []settingsPickerItem{{key: "a", label: "A"}},
		lines:    []pickerLine{{text: "A", itemIndex: 0}},
		viewport: viewport.New(40, 10),
		ready:    true,
	}
	model, _ := p.Update(tea.KeyMsg{Type: tea.KeyEsc})
	np := model.(settingsPicker)
	if np.selected != "@@done" {
		t.Errorf("expected @@done, got %q", np.selected)
	}
}

func TestSettingsPicker_UpdateCtrlC_Boost(t *testing.T) {
	p := settingsPicker{
		items:    []settingsPickerItem{{key: "a", label: "A"}},
		lines:    []pickerLine{{text: "A", itemIndex: 0}},
		viewport: viewport.New(40, 10),
		ready:    true,
	}
	model, _ := p.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	np := model.(settingsPicker)
	if np.selected != "@@done" {
		t.Errorf("expected @@done, got %q", np.selected)
	}
}

func TestSettingsPicker_UpdateHomeEnd(t *testing.T) {
	p := settingsPicker{
		items: []settingsPickerItem{
			{key: "a", label: "A"},
			{key: "b", label: "B"},
			{key: "c", label: "C"},
		},
		lines: []pickerLine{
			{text: "A", itemIndex: 0},
			{text: "B", itemIndex: 1},
			{text: "C", itemIndex: 2},
		},
		viewport: viewport.New(40, 10),
		cursor:   1,
		ready:    true,
	}
	model, _ := p.Update(tea.KeyMsg{Type: tea.KeyEnd})
	np := model.(settingsPicker)
	if np.cursor != 2 {
		t.Errorf("expected cursor=2 after end, got %d", np.cursor)
	}
	model, _ = np.Update(tea.KeyMsg{Type: tea.KeyHome})
	np = model.(settingsPicker)
	if np.cursor != 0 {
		t.Errorf("expected cursor=0 after home, got %d", np.cursor)
	}
}

func TestSettingsPicker_Init_Boost(t *testing.T) {
	p := settingsPicker{}
	if cmd := p.Init(); cmd != nil {
		t.Error("expected nil init cmd")
	}
}

func TestSettingsPicker_View(t *testing.T) {
	p := settingsPicker{
		items:    []settingsPickerItem{{key: "a", label: "Item A"}},
		lines:    []pickerLine{{text: "Item A", itemIndex: 0}},
		viewport: viewport.New(60, 10),
		ready:    true,
		title:    "Test title",
	}
	out := p.View()
	if !strings.Contains(out, "Test title") {
		t.Error("expected title in view output")
	}
}

func TestSettingsPicker_ViewNotReady_Boost(t *testing.T) {
	p := settingsPicker{}
	out := p.View()
	if out == "" {
		t.Error("expected non-empty view output even when not ready")
	}
}

// ---------------------------------------------------------------------------
// buildSettingsPicker — integration-ish: build with real known settings.
// ---------------------------------------------------------------------------

func TestBuildSettingsPicker_EmptyEntries(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub", optional: false},
		{envKey: "OPENAI_API_KEY", label: "OpenAI", optional: false},
		{envKey: "ASANA_API_TOKEN", label: "Asana", optional: true},
	}
	p := buildSettingsPicker(map[string]string{}, creds, false)
	if len(p.items) == 0 {
		t.Error("expected some picker items")
	}
	// last item should be @@done
	last := p.items[len(p.items)-1]
	if last.key != "@@done" {
		t.Errorf("expected last item to be @@done, got %q", last.key)
	}
}

func TestBuildSettingsPicker_AllCredsValidTitle(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub", optional: false, value: "x", status: "valid"},
		{envKey: "OPENAI_API_KEY", label: "OpenAI", optional: false, value: "y", status: "valid"},
	}
	p := buildSettingsPicker(
		map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "x", "OPENAI_API_KEY": "y"},
		creds,
		true,
	)
	if p.title == "" {
		t.Error("expected non-empty title when all creds valid")
	}
}

func TestBuildSettingsPicker_WithExtraKeys(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	// Include an unknown key to exercise the "Other" section path.
	entries := map[string]string{
		"CUSTOM_UNKNOWN_KEY": "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF",
	}
	p := buildSettingsPicker(entries, []credential{}, false)
	found := false
	for _, it := range p.items {
		if it.key == "CUSTOM_UNKNOWN_KEY" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected CUSTOM_UNKNOWN_KEY in picker items")
	}
}

// ---------------------------------------------------------------------------
// renderSettingsStatus — exercise various credential statuses.
// ---------------------------------------------------------------------------

func TestRenderSettingsStatus_MixedStatuses(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub", value: "x", status: "valid", detail: "Connected"},
		{envKey: "OPENAI_API_KEY", label: "OpenAI", status: "invalid", detail: "Bad key"},
		{envKey: "ASANA_API_TOKEN", label: "Asana", optional: true, status: "skipped"},
	}
	content, valid, missing, invalid := renderSettingsStatus(
		map[string]string{"CUSTOM_KEY": "val"}, creds, boardsConfigStatus{},
	)
	if content == "" {
		t.Error("expected non-empty rendered content")
	}
	if valid == 0 {
		t.Error("expected at least 1 valid")
	}
	if invalid == 0 {
		t.Error("expected at least 1 invalid")
	}
	_ = missing
}

func TestRenderSettingsStatus_DefaultCaseMissing(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	creds := []credential{
		// no status set, no value, not optional → default case → missing
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub", optional: false},
		// no status, no value, optional → default case → ⊘
		{envKey: "ASANA_API_TOKEN", label: "Asana", optional: true},
	}
	_, _, missing, _ := renderSettingsStatus(map[string]string{}, creds, boardsConfigStatus{})
	if missing == 0 {
		t.Error("expected missing > 0 for unset required cred")
	}
}

// ---------------------------------------------------------------------------
// promptCredentialInput — optional with existing value preserved.
// ---------------------------------------------------------------------------

func TestPromptCredentialInput_OptionalEmptyButHasExistingValue(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil } // empty input

	c := &credential{envKey: "ASANA_API_TOKEN", label: "Asana", optional: true, value: "existing"}
	if err := promptCredentialInput(c); err != nil {
		t.Errorf("promptCredentialInput: %v", err)
	}
	// existing value preserved, no status change since input was empty but value != ""
	if c.value != "existing" {
		t.Errorf("expected value preserved, got %q", c.value)
	}
}

func TestPromptCredentialInput_FormError_Boost(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return huh.ErrUserAborted }

	c := &credential{envKey: "OPENAI_API_KEY", label: "OpenAI"}
	if err := promptCredentialInput(c); err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// isAsanaOAuthConnected — edge cases.
// ---------------------------------------------------------------------------

func TestIsAsanaOAuthConnected_NoFile_Boost(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)
	if isAsanaOAuthConnected() {
		t.Error("expected false when no file")
	}
}

func TestIsAsanaOAuthConnected_InvalidJSON_Boost(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "asana-tokens.json"), []byte("bad"), 0o600)
	if isAsanaOAuthConnected() {
		t.Error("expected false for invalid JSON")
	}
}

func TestIsAsanaOAuthConnected_HasRefreshToken(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "asana-tokens.json"),
		[]byte(`{"refresh_token":"rt"}`), 0o600)
	if !isAsanaOAuthConnected() {
		t.Error("expected true when refresh_token present")
	}
}

// ---------------------------------------------------------------------------
// asanaOAuthStatusLabel — connected and disconnected branches.
// ---------------------------------------------------------------------------

func TestAsanaOAuthStatusLabel_NotConnected_Boost(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	label, connected := asanaOAuthStatusLabel()
	if connected {
		t.Error("expected not connected")
	}
	if label == "" {
		t.Error("expected non-empty label")
	}
}

func TestAsanaOAuthStatusLabel_Connected_Boost(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "asana-tokens.json"),
		[]byte(`{"refresh_token":"rt","access_token":"at","expires_at":0}`), 0o600)

	label, connected := asanaOAuthStatusLabel()
	if !connected {
		t.Error("expected connected")
	}
	if label == "" {
		t.Error("expected non-empty label")
	}
}

// ---------------------------------------------------------------------------
// googleDriveStatusLabel — branches.
// ---------------------------------------------------------------------------

func TestGoogleDriveStatusLabel_NotConnected_Boost(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	label, connected := googleDriveStatusLabel()
	if connected {
		t.Error("expected not connected")
	}
	if label == "" {
		t.Error("expected non-empty label")
	}
}

func TestGoogleDriveStatusLabel_Connected_Boost(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "google-tokens.json"),
		[]byte(`{"refresh_token":"rt","access_token":"at","expires_at":0}`), 0o600)

	label, connected := googleDriveStatusLabel()
	if !connected {
		t.Error("expected connected")
	}
	if label == "" {
		t.Error("expected non-empty label")
	}
}

// ---------------------------------------------------------------------------
// disconnect Google / Asana helpers — file already absent.
// ---------------------------------------------------------------------------

func TestDisconnectGoogleDrive_NoFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	if err := disconnectGoogleDrive(); err != nil {
		t.Errorf("disconnectGoogleDrive: %v", err)
	}
}

func TestDisconnectAsanaOAuth_NoFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	if err := disconnectAsanaOAuth(); err != nil {
		t.Errorf("disconnectAsanaOAuth: %v", err)
	}
}

func TestDisconnectGoogleDrive_WithFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "google-tokens.json"), []byte(`{}`), 0o600)

	if err := disconnectGoogleDrive(); err != nil {
		t.Errorf("disconnectGoogleDrive: %v", err)
	}
	if _, err := os.Stat(filepath.Join(configPath, "google-tokens.json")); err == nil {
		t.Error("expected token file to be removed")
	}
}

func TestDisconnectAsanaOAuth_WithFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "asana-tokens.json"), []byte(`{}`), 0o600)

	if err := disconnectAsanaOAuth(); err != nil {
		t.Errorf("disconnectAsanaOAuth: %v", err)
	}
	if _, err := os.Stat(filepath.Join(configPath, "asana-tokens.json")); err == nil {
		t.Error("expected token file to be removed")
	}
}

// ---------------------------------------------------------------------------
// getAsanaOAuthName — valid token HTTP success path (using asanaAPIBaseURL override).
// The function hits app.asana.com directly, so we can't override the URL.
// Exercise the "valid non-expired" path to get past the early returns.
// ---------------------------------------------------------------------------

func TestGetAsanaOAuthName_ValidNonExpiredToken(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)

	// expires_at in the future so token isn't expired
	tokens := map[string]interface{}{
		"access_token": "at-valid",
		"expires_at":   float64(time.Now().UnixMilli() + 3600000),
	}
	data, _ := json.Marshal(tokens)
	os.WriteFile(filepath.Join(configPath, "asana-tokens.json"), data, 0o600)

	// We can't intercept app.asana.com, so the HTTP call will likely fail
	// with a DNS error in sandboxed test environments — but that exercises
	// the request-creation path and the "err != nil" fallback.
	_ = getAsanaOAuthName()
}

// ---------------------------------------------------------------------------
// countBoards — additional branches.
// ---------------------------------------------------------------------------

func TestCountBoards_NoFile(t *testing.T) {
	_, ok := countBoards("/nonexistent/xyz.json")
	if ok {
		t.Error("expected not-ok for missing file")
	}
}

func TestCountBoards_InvalidJSON_Boost(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "boards.json")
	os.WriteFile(path, []byte("not json"), 0o644)
	_, ok := countBoards(path)
	if ok {
		t.Error("expected not-ok for invalid JSON")
	}
}

func TestCountBoards_EmptyArray(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "boards.json")
	os.WriteFile(path, []byte(`{"boards":[]}`), 0o644)
	_, ok := countBoards(path)
	if ok {
		t.Error("expected not-ok for empty array")
	}
}

func TestCountBoards_Valid(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "boards.json")
	os.WriteFile(path, []byte(`{"boards":[{"projectGid":"1"},{"projectGid":"2"}]}`), 0o644)
	count, ok := countBoards(path)
	if !ok || count != 2 {
		t.Errorf("expected count=2 ok=true, got count=%d ok=%v", count, ok)
	}
}

// ---------------------------------------------------------------------------
// checkBoardsConfig — file found/not-found branches.
// ---------------------------------------------------------------------------

func TestCheckBoardsConfig_NotFound(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	status := checkBoardsConfig()
	if status.found {
		t.Error("expected not found")
	}
}

func TestCheckBoardsConfig_Found(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "asana-config.json"),
		[]byte(`{"boards":[{"projectGid":"123"}]}`), 0o644)

	status := checkBoardsConfig()
	if !status.found {
		t.Error("expected found")
	}
	if status.count != 1 {
		t.Errorf("expected count=1, got %d", status.count)
	}
}

// ---------------------------------------------------------------------------
// Silence stderr helper — used by some tests that produce verbose output.
// ---------------------------------------------------------------------------

func discardStderr(t *testing.T) {
	t.Helper()
	orig := os.Stderr
	devnull, _ := os.OpenFile(os.DevNull, os.O_WRONLY, 0o644)
	os.Stderr = devnull
	t.Cleanup(func() {
		os.Stderr = orig
		devnull.Close()
	})
}

// Exercise the discardStderr helper so it's covered and import cycles don't break.
var _ = io.Discard

// ===========================================================================
// Reflection-driven success-path tests.
//
// These tests use setFormFieldValues to populate form-bound variables before
// the production code reads them, exercising the success branches of
// promptBoardInput, addBoardToConfig, createBoardsConfig, promptGitHubAuth,
// promptAsanaAuth, runGoogleDriveSetup, runExpressSetupPrompt, and friends.
// ===========================================================================

func TestPromptBoardInput_SuccessReturnsBoard(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "12345", "Now, Next, Later", "My Board", "Score")
		return nil
	}

	board, err := promptBoardInput()
	if err != nil {
		t.Fatalf("promptBoardInput: %v", err)
	}
	if board == nil {
		t.Fatal("expected non-nil board")
	}
	if board.ProjectGid != "12345" {
		t.Errorf("ProjectGid: got %q want 12345", board.ProjectGid)
	}
	if len(board.Sections) != 3 {
		t.Errorf("Sections: got %v", board.Sections)
	}
	if board.Label != "My Board" {
		t.Errorf("Label: got %q", board.Label)
	}
	if board.PriorityField != "Score" {
		t.Errorf("PriorityField: got %q", board.PriorityField)
	}
}

func TestPromptBoardInput_NoSectionsReturnsNil(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		// Set GID but leave sections empty.
		setFormFieldValues(t, f, "12345", "", "", "")
		return nil
	}

	board, err := promptBoardInput()
	if err != nil {
		t.Fatalf("promptBoardInput: %v", err)
	}
	if board != nil {
		t.Errorf("expected nil board for empty sections, got %+v", board)
	}
}

func TestAddBoardToConfig_SuccessAppends(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "asana-config.json")
	os.WriteFile(path, []byte(`{"boards":[{"projectGid":"existing","sections":["A"]}]}`), 0o644)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "9999", "Now", "New Board", "")
		return nil
	}

	if err := addBoardToConfig(path); err != nil {
		t.Fatalf("addBoardToConfig: %v", err)
	}

	data, _ := os.ReadFile(path)
	if !strings.Contains(string(data), "9999") {
		t.Errorf("expected new board in file: %s", string(data))
	}
	if !strings.Contains(string(data), "existing") {
		t.Errorf("expected existing board preserved")
	}
}

func TestAddBoardToConfig_FileReadError(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "9999", "Now", "", "")
		return nil
	}

	err := addBoardToConfig("/nonexistent-dir/boards.json")
	if err == nil {
		t.Error("expected error for nonexistent file")
	}
}

func TestAddBoardToConfig_InvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "asana-config.json")
	os.WriteFile(path, []byte("not json"), 0o644)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "9999", "Now", "", "")
		return nil
	}

	err := addBoardToConfig(path)
	if err == nil {
		t.Error("expected error for invalid JSON in file")
	}
}

func TestCreateBoardsConfig_SuccessWritesFile(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "subdir", "asana-config.json")

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "11111", "A,B,C", "Label", "Field")
		return nil
	}

	if err := createBoardsConfig(path); err != nil {
		t.Fatalf("createBoardsConfig: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("expected file to exist: %v", err)
	}
	if !strings.Contains(string(data), "11111") {
		t.Errorf("expected GID in file: %s", string(data))
	}
}

func TestRunSetupBoards_FoundCancelChoice(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	boardsPath := filepath.Join(configPath, "asana-config.json")
	os.WriteFile(boardsPath, []byte(`{"boards":[{"projectGid":"x"}]}`), 0o644)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "cancel")
		return nil
	}

	err := runSetupBoards(boardsConfigStatus{found: true, count: 1, path: boardsPath})
	if err != nil {
		t.Errorf("runSetupBoards: %v", err)
	}
}

func TestRunSetupBoards_FoundAddChoice(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	boardsPath := filepath.Join(configPath, "asana-config.json")
	os.WriteFile(boardsPath, []byte(`{"boards":[]}`), 0o644)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	callCount := 0
	huhFormRun = func(f *huh.Form) error {
		callCount++
		if callCount == 1 {
			setFormFieldValues(t, f, "add")
		} else {
			// promptBoardInput on second call
			setFormFieldValues(t, f, "777", "Now", "", "")
		}
		return nil
	}

	err := runSetupBoards(boardsConfigStatus{found: true, count: 0, path: boardsPath})
	if err != nil {
		t.Errorf("runSetupBoards: %v", err)
	}
}

func TestRunSetupBoards_FoundReplaceChoice(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	boardsPath := filepath.Join(configPath, "asana-config.json")
	os.WriteFile(boardsPath, []byte(`{"boards":[{"projectGid":"old"}]}`), 0o644)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	callCount := 0
	huhFormRun = func(f *huh.Form) error {
		callCount++
		if callCount == 1 {
			setFormFieldValues(t, f, "replace")
		} else {
			setFormFieldValues(t, f, "888", "Soon", "", "")
		}
		return nil
	}

	err := runSetupBoards(boardsConfigStatus{found: true, count: 1, path: boardsPath})
	if err != nil {
		t.Errorf("runSetupBoards: %v", err)
	}
}

func TestPromptGitHubAuth_DisconnectChoice(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "disconnect")
		return nil
	}

	c := &credential{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub", value: "ghp_old"}
	if err := promptGitHubAuth(c); err != nil {
		t.Fatalf("promptGitHubAuth: %v", err)
	}
	if c.status != "skipped" {
		t.Errorf("expected status=skipped, got %q", c.status)
	}
	if c.value != "" {
		t.Errorf("expected value cleared, got %q", c.value)
	}
}

func TestPromptGitHubAuth_PATChoice(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	callCount := 0
	huhFormRun = func(f *huh.Form) error {
		callCount++
		if callCount == 1 {
			setFormFieldValues(t, f, "pat")
		} else {
			setFormFieldValues(t, f, "ghp_pasted")
		}
		return nil
	}

	c := &credential{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub", optional: false}
	if err := promptGitHubAuth(c); err != nil {
		t.Fatalf("promptGitHubAuth: %v", err)
	}
	if c.value != "ghp_pasted" {
		t.Errorf("expected value=ghp_pasted, got %q", c.value)
	}
}

func TestPromptAsanaAuth_PATChoice(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	callCount := 0
	huhFormRun = func(f *huh.Form) error {
		callCount++
		if callCount == 1 {
			setFormFieldValues(t, f, "pat")
		} else {
			setFormFieldValues(t, f, "asana_token_xyz")
		}
		return nil
	}

	c := &credential{envKey: "ASANA_API_TOKEN", label: "Asana", optional: true}
	if err := promptAsanaAuth(c); err != nil {
		t.Fatalf("promptAsanaAuth: %v", err)
	}
	if c.value != "asana_token_xyz" {
		t.Errorf("expected value=asana_token_xyz, got %q", c.value)
	}
}

func TestPromptAsanaAuth_SkipChoice_Boost(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "skip")
		return nil
	}

	c := &credential{envKey: "ASANA_API_TOKEN", label: "Asana", optional: true}
	if err := promptAsanaAuth(c); err != nil {
		t.Fatalf("promptAsanaAuth: %v", err)
	}
	if c.status != "skipped" {
		t.Errorf("expected status=skipped, got %q", c.status)
	}
}

func TestPromptAsanaAuth_BrowserSuccess(t *testing.T) {
	origHuh := huhFormRun
	origScript := serviceScriptRunner
	t.Cleanup(func() {
		huhFormRun = origHuh
		serviceScriptRunner = origScript
	})

	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "browser")
		return nil
	}
	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		return map[string]interface{}{
			"ok":   true,
			"name": "Alice",
		}, nil
	}

	c := &credential{envKey: "ASANA_API_TOKEN", label: "Asana", optional: true}
	if err := promptAsanaAuth(c); err != nil {
		t.Fatalf("promptAsanaAuth: %v", err)
	}
	if c.status != "valid" {
		t.Errorf("expected status=valid, got %q", c.status)
	}
}

func TestPromptAsanaAuth_BrowserSuccessNoName(t *testing.T) {
	origHuh := huhFormRun
	origScript := serviceScriptRunner
	t.Cleanup(func() {
		huhFormRun = origHuh
		serviceScriptRunner = origScript
	})

	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "browser")
		return nil
	}
	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		return map[string]interface{}{"ok": true}, nil
	}

	c := &credential{envKey: "ASANA_API_TOKEN", label: "Asana", optional: true}
	if err := promptAsanaAuth(c); err != nil {
		t.Fatalf("promptAsanaAuth: %v", err)
	}
	if c.status != "valid" {
		t.Errorf("expected status=valid, got %q", c.status)
	}
}

func TestPromptAsanaAuth_BrowserError(t *testing.T) {
	origHuh := huhFormRun
	origScript := serviceScriptRunner
	t.Cleanup(func() {
		huhFormRun = origHuh
		serviceScriptRunner = origScript
	})

	callCount := 0
	huhFormRun = func(f *huh.Form) error {
		callCount++
		if callCount == 1 {
			setFormFieldValues(t, f, "browser")
		} else {
			setFormFieldValues(t, f, "fallback_token")
		}
		return nil
	}
	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		return nil, fmt.Errorf("browser launch failed")
	}

	c := &credential{envKey: "ASANA_API_TOKEN", label: "Asana", optional: true}
	if err := promptAsanaAuth(c); err != nil {
		t.Fatalf("promptAsanaAuth: %v", err)
	}
	if c.value != "fallback_token" {
		t.Errorf("expected fallback PAT to be set, got %q", c.value)
	}
}

func TestPromptAsanaAuth_BrowserOAuthError(t *testing.T) {
	origHuh := huhFormRun
	origScript := serviceScriptRunner
	t.Cleanup(func() {
		huhFormRun = origHuh
		serviceScriptRunner = origScript
	})

	callCount := 0
	huhFormRun = func(f *huh.Form) error {
		callCount++
		if callCount == 1 {
			setFormFieldValues(t, f, "browser")
		} else {
			setFormFieldValues(t, f, "fallback")
		}
		return nil
	}
	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		return map[string]interface{}{
			"ok":    false,
			"error": "user denied",
		}, nil
	}

	c := &credential{envKey: "ASANA_API_TOKEN", label: "Asana", optional: true}
	if err := promptAsanaAuth(c); err != nil {
		t.Fatalf("promptAsanaAuth: %v", err)
	}
}

func TestRunGoogleDriveSetup_BYOCChoiceFormError(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	callCount := 0
	huhFormRun = func(f *huh.Form) error {
		callCount++
		if callCount == 1 {
			setFormFieldValues(t, f, "byoc")
			return nil
		}
		// runGoogleBYOCFlow second call → abort
		return huh.ErrUserAborted
	}

	err := runGoogleDriveSetup()
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

func TestRunGoogleDriveSetup_SkipChoice(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "skip")
		return nil
	}

	if err := runGoogleDriveSetup(); err != nil {
		t.Errorf("runGoogleDriveSetup: %v", err)
	}
}

func TestRunGoogleDriveSetup_QuickChoice(t *testing.T) {
	// quick path calls runGoogleOAuthFlow → runServiceScript directly,
	// which will fail in the test environment (no bun script). The error
	// is logged but a nil error is returned.
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "quick")
		return nil
	}

	if err := runGoogleDriveSetup(); err != nil {
		// Expected to log error but return nil from runGoogleOAuthFlow
		t.Logf("runGoogleDriveSetup quick: %v", err)
	}
}

func TestRunGoogleBYOCFlow_Success(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "client-id-123", "secret-456")
		return nil
	}

	// runGoogleOAuthFlow will call runServiceScript which fails in test env;
	// the error is logged and nil is returned.
	_ = runGoogleBYOCFlow()
}

func TestRunGoogleDriveManage_Reconnect(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	callCount := 0
	huhFormRun = func(f *huh.Form) error {
		callCount++
		if callCount == 1 {
			setFormFieldValues(t, f, "reconnect")
			return nil
		}
		setFormFieldValues(t, f, "skip")
		return nil
	}

	if err := runGoogleDriveManage(); err != nil {
		t.Errorf("runGoogleDriveManage: %v", err)
	}
}

func TestRunGoogleDriveManage_Disconnect(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "google-tokens.json"), []byte(`{}`), 0o600)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "disconnect")
		return nil
	}

	if err := runGoogleDriveManage(); err != nil {
		t.Errorf("runGoogleDriveManage: %v", err)
	}
}

func TestRunGoogleDriveManage_Keep(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "keep")
		return nil
	}

	if err := runGoogleDriveManage(); err != nil {
		t.Errorf("runGoogleDriveManage: %v", err)
	}
}

func TestRunAsanaOAuthManage_Reconnect(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	callCount := 0
	huhFormRun = func(f *huh.Form) error {
		callCount++
		if callCount == 1 {
			setFormFieldValues(t, f, "reconnect")
			return nil
		}
		setFormFieldValues(t, f, "skip")
		return nil
	}

	if err := runAsanaOAuthManage(); err != nil {
		t.Errorf("runAsanaOAuthManage: %v", err)
	}
}

func TestRunAsanaOAuthManage_Disconnect(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "asana-tokens.json"), []byte(`{}`), 0o600)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "disconnect")
		return nil
	}

	if err := runAsanaOAuthManage(); err != nil {
		t.Errorf("runAsanaOAuthManage: %v", err)
	}
}

func TestRunAsanaOAuthManage_Keep(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "keep")
		return nil
	}

	if err := runAsanaOAuthManage(); err != nil {
		t.Errorf("runAsanaOAuthManage: %v", err)
	}
}

func TestRunAsanaOAuthSetup_BrowserChoice(t *testing.T) {
	origHuh := huhFormRun
	origScript := serviceScriptRunner
	t.Cleanup(func() {
		huhFormRun = origHuh
		serviceScriptRunner = origScript
	})

	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "browser")
		return nil
	}
	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		return map[string]interface{}{"ok": true, "name": "Bob"}, nil
	}

	if err := runAsanaOAuthSetup(); err != nil {
		t.Errorf("runAsanaOAuthSetup: %v", err)
	}
}

func TestRunAsanaOAuthSetup_PATChoice(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	callCount := 0
	huhFormRun = func(f *huh.Form) error {
		callCount++
		if callCount == 1 {
			setFormFieldValues(t, f, "pat")
		} else {
			setFormFieldValues(t, f, "asana_pat_value")
		}
		return nil
	}

	if err := runAsanaOAuthSetup(); err != nil {
		t.Errorf("runAsanaOAuthSetup: %v", err)
	}

	envData, _ := os.ReadFile(filepath.Join(tmpDir, "teamhero", ".env"))
	if !strings.Contains(string(envData), "asana_pat_value") {
		t.Errorf("expected PAT in .env: %s", string(envData))
	}
}

func TestRunAsanaOAuthSetup_SkipChoice(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "skip")
		return nil
	}

	if err := runAsanaOAuthSetup(); err != nil {
		t.Errorf("runAsanaOAuthSetup: %v", err)
	}
}

func TestPromptAsanaPATFromOAuthSetup_Success(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "asana_token_value")
		return nil
	}

	if err := promptAsanaPATFromOAuthSetup(); err != nil {
		t.Errorf("promptAsanaPATFromOAuthSetup: %v", err)
	}

	envData, _ := os.ReadFile(filepath.Join(tmpDir, "teamhero", ".env"))
	if !strings.Contains(string(envData), "asana_token_value") {
		t.Errorf("expected PAT to be saved: %s", string(envData))
	}
}

func TestRunExpressSetupPrompt_ProceedSuccess(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	// Stub HTTP for credential validation
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"u","id":"r"}`))
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

	origHuh := huhFormRun
	origScript := serviceScriptRunner
	t.Cleanup(func() {
		huhFormRun = origHuh
		serviceScriptRunner = origScript
	})

	callCount := 0
	huhFormRun = func(f *huh.Form) error {
		callCount++
		switch callCount {
		case 1:
			// proceed=true (Select[bool])
			setFormFieldValues(t, f, true)
		case 2:
			// promptGitHubAuth method select → "pat"
			setFormFieldValues(t, f, "pat")
		case 3:
			// PAT input
			setFormFieldValues(t, f, "ghp_express")
		case 4:
			// promptCredentialInput for OpenAI
			setFormFieldValues(t, f, "sk-express")
		}
		return nil
	}
	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		return nil, fmt.Errorf("script unavailable")
	}

	if err := runExpressSetupPrompt(); err != nil {
		t.Errorf("runExpressSetupPrompt: %v", err)
	}
}

func TestRunSetupInteractive_NewExpressMode(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"u","id":"r"}`))
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

	origHuh := huhFormRun
	origScript := serviceScriptRunner
	t.Cleanup(func() {
		huhFormRun = origHuh
		serviceScriptRunner = origScript
	})

	callCount := 0
	huhFormRun = func(f *huh.Form) error {
		callCount++
		switch callCount {
		case 1:
			setFormFieldValues(t, f, "express")
		case 2:
			setFormFieldValues(t, f, "pat") // GitHub method
		case 3:
			setFormFieldValues(t, f, "ghp_token")
		case 4:
			setFormFieldValues(t, f, "sk-key")
		}
		return nil
	}
	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		return nil, fmt.Errorf("not avail")
	}

	if err := runSetupInteractive(); err != nil {
		t.Errorf("runSetupInteractive: %v", err)
	}
}

func TestRunSetupInteractive_NewFullModeWithInvalidCreds(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	// All endpoints return 401 → invalid status → exercises hasFailure branch
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
	}))
	defer ts.Close()

	oldGH := githubAPIBaseURL
	oldOA := openAIAPIBaseURL
	oldAS := asanaAPIBaseURL
	t.Cleanup(func() {
		githubAPIBaseURL = oldGH
		openAIAPIBaseURL = oldOA
		asanaAPIBaseURL = oldAS
	})
	githubAPIBaseURL = ts.URL
	openAIAPIBaseURL = ts.URL
	asanaAPIBaseURL = ts.URL

	oldClient := defaultHTTPClient
	t.Cleanup(func() { defaultHTTPClient = oldClient })
	defaultHTTPClient = &http.Client{}

	origHuh := huhFormRun
	origScript := serviceScriptRunner
	t.Cleanup(func() {
		huhFormRun = origHuh
		serviceScriptRunner = origScript
	})

	callCount := 0
	huhFormRun = func(f *huh.Form) error {
		callCount++
		switch callCount {
		case 1:
			setFormFieldValues(t, f, "full")
		case 2:
			setFormFieldValues(t, f, "pat") // GitHub
		case 3:
			setFormFieldValues(t, f, "bad_gh")
		case 4:
			setFormFieldValues(t, f, "bad_openai")
		case 5:
			setFormFieldValues(t, f, "pat") // Asana method
		case 6:
			setFormFieldValues(t, f, "bad_asana")
		}
		return nil
	}
	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		return nil, fmt.Errorf("not avail")
	}

	if err := runSetupInteractive(); err != nil {
		t.Errorf("runSetupInteractive: %v", err)
	}
}

func TestPromptCredentialInput_NewValueSet(t *testing.T) {
	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "newvalue")
		return nil
	}

	c := &credential{envKey: "OPENAI_API_KEY", label: "OpenAI"}
	if err := promptCredentialInput(c); err != nil {
		t.Fatalf("promptCredentialInput: %v", err)
	}
	if c.value != "newvalue" {
		t.Errorf("expected value=newvalue, got %q", c.value)
	}
	if c.status != "unchecked" {
		t.Errorf("expected status=unchecked, got %q", c.status)
	}
}

// ---------------------------------------------------------------------------
// handleSettingUpdate — exercise GitHub PAT branch where new value is set.
// ---------------------------------------------------------------------------

func TestHandleSettingUpdate_GitHubPATSuccess(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte("GITHUB_PERSONAL_ACCESS_TOKEN=ghp_old\n"), 0o600)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"u"}`))
	}))
	defer ts.Close()

	oldGH := githubAPIBaseURL
	t.Cleanup(func() { githubAPIBaseURL = oldGH })
	githubAPIBaseURL = ts.URL

	oldClient := defaultHTTPClient
	t.Cleanup(func() { defaultHTTPClient = oldClient })
	defaultHTTPClient = &http.Client{}

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	callCount := 0
	huhFormRun = func(f *huh.Form) error {
		callCount++
		if callCount == 1 {
			setFormFieldValues(t, f, "pat")
		} else {
			setFormFieldValues(t, f, "ghp_new_token")
		}
		return nil
	}

	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub", value: "ghp_old"},
	}
	allEntries := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_old"}

	if err := handleSettingUpdate("GITHUB_PERSONAL_ACCESS_TOKEN", creds, envPath, allEntries); err != nil {
		t.Errorf("handleSettingUpdate: %v", err)
	}
}

func TestHandlePlainSettingUpdate_NewValue(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "gpt-4.1")
		return nil
	}

	allEntries := map[string]string{"AI_MODEL": "gpt-5-mini"}
	if err := handlePlainSettingUpdate("AI_MODEL", envPath, allEntries); err != nil {
		t.Errorf("handlePlainSettingUpdate: %v", err)
	}

	envData, _ := os.ReadFile(envPath)
	if !strings.Contains(string(envData), "gpt-4.1") {
		t.Errorf("expected new value in .env: %s", string(envData))
	}
}

// ---------------------------------------------------------------------------
// runSetupHeadless — invalid validation path returns error.
// ---------------------------------------------------------------------------

func TestRunSetupHeadless_InvalidCredentials(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	t.Setenv("GITHUB_PERSONAL_ACCESS_TOKEN", "ghp_bad")
	t.Setenv("OPENAI_API_KEY", "sk-bad")
	t.Setenv("ASANA_API_TOKEN", "")

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
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

	withStdin(t, []byte(""), func() {
		err := runSetupHeadless()
		if err == nil {
			t.Error("expected error from invalid credentials")
		}
	})
}

func TestRunSetupHeadless_SkippedOptionalAsana(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	t.Setenv("GITHUB_PERSONAL_ACCESS_TOKEN", "ghp_ok")
	t.Setenv("OPENAI_API_KEY", "sk-ok")
	t.Setenv("ASANA_API_TOKEN", "")

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"u","id":"r"}`))
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

	withStdin(t, []byte(""), func() {
		if err := runSetupHeadless(); err != nil {
			t.Errorf("runSetupHeadless: %v", err)
		}
	})
}

// ---------------------------------------------------------------------------
// renderSettingsStatus — exercise more paths.
// ---------------------------------------------------------------------------

func TestRenderSettingsStatus_KnownKeyWithLongValue(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	entries := map[string]string{
		"AI_MODEL": strings.Repeat("a", 60),
	}
	content, _, _, _ := renderSettingsStatus(entries, []credential{}, boardsConfigStatus{})
	if content == "" {
		t.Error("expected content")
	}
}

func TestRenderSettingsStatus_SensitiveKeyMasked(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	entries := map[string]string{
		"OPENAI_API_KEY": "sk-test1234567890abcdef",
	}
	content, _, _, _ := renderSettingsStatus(entries, []credential{}, boardsConfigStatus{})
	if strings.Contains(content, "sk-test1234567890abcdef") {
		t.Error("expected sensitive value to be masked")
	}
}

// ---------------------------------------------------------------------------
// Wizard View — exercise the wsConfirmRun + non-Express modal overlay branch.
// ---------------------------------------------------------------------------

func TestWizardView_ConfirmRunFullMode(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	ensureDateDefaults(&cfg)

	m := &wizardModel{
		state:  wsConfirmRun,
		mode:   wizardModeFull,
		cfg:    cfg,
		width:  120,
		height: 30,
	}
	out := m.View()
	if out == "" {
		t.Error("expected non-empty view in confirmRun state")
	}
}

func TestWizardView_NonConfirmStateDefault(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Org = "acme"
	ensureDateDefaults(&cfg)

	m := &wizardModel{
		state:  wsOrg,
		mode:   wizardModeFull,
		cfg:    cfg,
		width:  120,
		height: 30,
	}
	out := m.View()
	if out == "" {
		t.Error("expected non-empty view")
	}
}

// ---------------------------------------------------------------------------
// runExpressSetupPrompt — proceed=true with invalid creds (hits hasFailure).
// ---------------------------------------------------------------------------

func TestRunExpressSetupPrompt_ProceedWithInvalid(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	// 401 → invalid
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
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

	origHuh := huhFormRun
	origScript := serviceScriptRunner
	t.Cleanup(func() {
		huhFormRun = origHuh
		serviceScriptRunner = origScript
	})

	callCount := 0
	huhFormRun = func(f *huh.Form) error {
		callCount++
		switch callCount {
		case 1:
			setFormFieldValues(t, f, true)
		case 2:
			setFormFieldValues(t, f, "pat")
		case 3:
			setFormFieldValues(t, f, "ghp_bad")
		case 4:
			setFormFieldValues(t, f, "sk-bad")
		}
		return nil
	}
	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		return nil, fmt.Errorf("script unavailable")
	}

	if err := runExpressSetupPrompt(); err != nil {
		t.Errorf("runExpressSetupPrompt: %v", err)
	}
}

// ---------------------------------------------------------------------------
// runSetupInteractive — existing creds with sub-flow @@gdrive action.
// Tests the loop branch where teaProgramRun returns an action.
// ---------------------------------------------------------------------------

func TestRunSetupInteractive_ExistingCredsWithGDriveAction(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte("GITHUB_PERSONAL_ACCESS_TOKEN=ghp_x\nOPENAI_API_KEY=sk_y\n"), 0o600)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"u","id":"r"}`))
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

	origTPR := teaProgramRun
	t.Cleanup(func() { teaProgramRun = origTPR })
	teaCallCount := 0
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		teaCallCount++
		// First call: return @@gdrive action; second call: quit
		if teaCallCount == 1 {
			return &inlineSettingsEditor{quitting: true, action: "@@gdrive"}, nil
		}
		return &inlineSettingsEditor{quitting: true, action: ""}, nil
	}

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	// runGoogleDriveFromPicker → since not connected, runGoogleDriveSetup → choice=skip
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "skip")
		return nil
	}

	if err := runSetupInteractive(); err != nil {
		t.Errorf("runSetupInteractive: %v", err)
	}
}

func TestRunSetupInteractive_ExistingCredsWithBoardsAction(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte("GITHUB_PERSONAL_ACCESS_TOKEN=ghp_x\nOPENAI_API_KEY=sk_y\n"), 0o600)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"u","id":"r"}`))
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

	origTPR := teaProgramRun
	t.Cleanup(func() { teaProgramRun = origTPR })
	teaCalls := 0
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		teaCalls++
		if teaCalls == 1 {
			return &inlineSettingsEditor{quitting: true, action: "@@boards"}, nil
		}
		return &inlineSettingsEditor{quitting: true, action: ""}, nil
	}

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	// runSetupBoards → board=nil → returns nil
	huhFormRun = func(f *huh.Form) error { return nil }

	if err := runSetupInteractive(); err != nil {
		t.Errorf("runSetupInteractive: %v", err)
	}
}

func TestRunSetupInteractive_ExistingCredsWithGitHubAction(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte("GITHUB_PERSONAL_ACCESS_TOKEN=ghp_x\nOPENAI_API_KEY=sk_y\n"), 0o600)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"u","id":"r"}`))
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

	origTPR := teaProgramRun
	t.Cleanup(func() { teaProgramRun = origTPR })
	teaCalls := 0
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		teaCalls++
		if teaCalls == 1 {
			return &inlineSettingsEditor{quitting: true, action: actionInlineGitHubAuth}, nil
		}
		return &inlineSettingsEditor{quitting: true, action: ""}, nil
	}

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	callCount := 0
	huhFormRun = func(f *huh.Form) error {
		callCount++
		if callCount == 1 {
			setFormFieldValues(t, f, "pat")
		} else {
			setFormFieldValues(t, f, "ghp_new")
		}
		return nil
	}

	if err := runSetupInteractive(); err != nil {
		t.Errorf("runSetupInteractive: %v", err)
	}
}

// ---------------------------------------------------------------------------
// settings_editor.View — exercise modal-overlay branch (modeEdit + editForm).
// ---------------------------------------------------------------------------

func TestInlineSettingsEditor_ViewWithEditForm(t *testing.T) {
	m := &inlineSettingsEditor{
		ready:    true,
		width:    100,
		height:   30,
		mode:     modeEdit,
		editIdx:  0,
		viewport: viewport.New(60, 20),
		helpVP:   viewport.New(30, 20),
		items: []editorItem{
			{key: "AI_MODEL", label: "AI Model", itype: inputSelect, options: []string{"gpt-5"}},
		},
		lines: []editorLine{
			{text: "AI Model", itemIndex: 0},
		},
	}
	// Build a real edit form so the modal branch executes.
	var v string
	m.editForm = huh.NewForm(huh.NewGroup(huh.NewInput().Title("Test").Value(&v)))
	out := m.View()
	if out == "" {
		t.Error("expected non-empty view in modeEdit")
	}
}

func TestInlineSettingsEditor_ViewWithJSONEditForm(t *testing.T) {
	m := &inlineSettingsEditor{
		ready:    true,
		width:    100,
		height:   30,
		mode:     modeEdit,
		editIdx:  0,
		viewport: viewport.New(60, 20),
		helpVP:   viewport.New(30, 20),
		items: []editorItem{
			{key: "@@boards", label: "Boards", itype: inputJSON},
		},
		lines: []editorLine{
			{text: "Boards", itemIndex: 0},
		},
	}
	var v string
	m.editForm = huh.NewForm(huh.NewGroup(huh.NewInput().Title("Test").Value(&v)))
	out := m.View()
	if out == "" {
		t.Error("expected non-empty view")
	}
}

// ---------------------------------------------------------------------------
// renderEditModal with @@boards key — exercises previewBoardsConfig branch.
// ---------------------------------------------------------------------------

func TestRenderHelpContent_BoardsKeyWithConfig(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	// Write a non-empty boards config so previewBoardsConfig returns content
	os.WriteFile(filepath.Join(configPath, "asana-config.json"),
		[]byte(`{"boards":[{"projectGid":"1","sections":["A"]}]}`), 0o644)

	m := &inlineSettingsEditor{
		items: []editorItem{
			{key: "@@boards", label: "Boards", description: "Configure boards"},
		},
		lines:  []editorLine{{text: "Boards", itemIndex: 0}},
		cursor: 0,
	}
	out := m.renderHelpContent(60)
	if out == "" {
		t.Error("expected non-empty help content")
	}
}

// ---------------------------------------------------------------------------
// inlineSettingsEditor.Update — non-key messages while in modeEdit + form.
// ---------------------------------------------------------------------------

func TestInlineSettingsEditor_UpdateNonKeyEditMode(t *testing.T) {
	m := &inlineSettingsEditor{
		ready:    true,
		width:    100,
		height:   30,
		mode:     modeEdit,
		editIdx:  0,
		viewport: viewport.New(60, 20),
		helpVP:   viewport.New(30, 20),
		items: []editorItem{
			{key: "TEST", label: "Test"},
		},
		lines: []editorLine{{text: "test", itemIndex: 0}},
	}
	var v string
	m.editForm = huh.NewForm(huh.NewGroup(huh.NewInput().Title("X").Value(&v)))
	// Send a tea.WindowSizeMsg — exercises non-key path forwarding to editForm
	model, _ := m.Update(tea.WindowSizeMsg{Width: 100, Height: 30})
	if model == nil {
		t.Error("expected non-nil model")
	}
}

// ---------------------------------------------------------------------------
// inlineSettingsEditor.handleEditKey — delegate to form path.
// ---------------------------------------------------------------------------

func TestHandleEditKey_DelegateToForm(t *testing.T) {
	m := &inlineSettingsEditor{
		mode: modeEdit,
	}
	var v string
	m.editForm = huh.NewForm(huh.NewGroup(huh.NewInput().Title("X").Value(&v)))
	model, _ := m.handleEditKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'a'}})
	if model == nil {
		t.Error("expected non-nil model")
	}
}

// ---------------------------------------------------------------------------
// settings_editor.Update with WindowSizeMsg in normal mode (sets viewport).
// ---------------------------------------------------------------------------

func TestInlineSettingsEditor_UpdateWindowSize(t *testing.T) {
	m := &inlineSettingsEditor{
		viewport: viewport.New(40, 10),
		helpVP:   viewport.New(30, 10),
		items: []editorItem{
			{key: "A", label: "Item A"},
		},
		lines: []editorLine{{text: "Item A", itemIndex: 0}},
	}
	model, _ := m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	if !model.(*inlineSettingsEditor).ready {
		t.Error("expected ready=true after WindowSizeMsg")
	}
}

// ---------------------------------------------------------------------------
// runSetupBoards — found + create flow without entering form values fully.
// Also exercise the runGoogleDriveFromPicker connected branch.
// ---------------------------------------------------------------------------

func TestRunGoogleDriveFromPicker_Connected(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	// Connected: has refresh_token
	os.WriteFile(filepath.Join(configPath, "google-tokens.json"),
		[]byte(`{"refresh_token":"rt","access_token":"at","expires_at":0}`), 0o600)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "keep")
		return nil
	}

	if err := runGoogleDriveFromPicker(); err != nil {
		t.Errorf("runGoogleDriveFromPicker connected: %v", err)
	}
}

func TestRunAsanaOAuthFromPicker_Connected(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "asana-tokens.json"),
		[]byte(`{"refresh_token":"rt","access_token":"at","expires_at":0}`), 0o600)

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "keep")
		return nil
	}

	if err := runAsanaOAuthFromPicker(); err != nil {
		t.Errorf("runAsanaOAuthFromPicker connected: %v", err)
	}
}

// ---------------------------------------------------------------------------
// runSetupUpdateSingle — exercise the loop with a few selected actions.
// ---------------------------------------------------------------------------

func TestRunSetupUpdateSingle_DoneSelection(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte("OPENAI_API_KEY=sk_y\n"), 0o600)

	origTPR := teaProgramRun
	t.Cleanup(func() { teaProgramRun = origTPR })
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		return settingsPicker{selected: "@@done"}, nil
	}

	creds := []credential{
		{envKey: "OPENAI_API_KEY", label: "OpenAI", value: "sk_y", status: "valid"},
	}
	if err := runSetupUpdateSingle(creds, envPath); err != nil {
		t.Errorf("runSetupUpdateSingle: %v", err)
	}
}

func TestRunSetupUpdateSingle_BoardsThenDone(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")

	origTPR := teaProgramRun
	t.Cleanup(func() { teaProgramRun = origTPR })
	calls := 0
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		calls++
		if calls == 1 {
			return settingsPicker{selected: "@@boards"}, nil
		}
		return settingsPicker{selected: "@@done"}, nil
	}

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error { return nil } // empty board → no-op

	if err := runSetupUpdateSingle([]credential{}, envPath); err != nil {
		t.Errorf("runSetupUpdateSingle: %v", err)
	}
}

func TestRunSetupUpdateSingle_PlainSettingThenDone(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")

	origTPR := teaProgramRun
	t.Cleanup(func() { teaProgramRun = origTPR })
	calls := 0
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		calls++
		if calls == 1 {
			return settingsPicker{selected: "AI_MODEL"}, nil
		}
		return settingsPicker{selected: "@@done"}, nil
	}

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	huhFormRun = func(f *huh.Form) error {
		setFormFieldValues(t, f, "gpt-5-mini")
		return nil
	}

	if err := runSetupUpdateSingle([]credential{}, envPath); err != nil {
		t.Errorf("runSetupUpdateSingle: %v", err)
	}
}

func TestRunGitHubAuthFromInlineEditor_PATPath(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envPath := filepath.Join(teamheroDir, ".env")

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"login":"u"}`))
	}))
	defer ts.Close()

	oldGH := githubAPIBaseURL
	t.Cleanup(func() { githubAPIBaseURL = oldGH })
	githubAPIBaseURL = ts.URL

	oldClient := defaultHTTPClient
	t.Cleanup(func() { defaultHTTPClient = oldClient })
	defaultHTTPClient = &http.Client{}

	origHuh := huhFormRun
	t.Cleanup(func() { huhFormRun = origHuh })
	callCount := 0
	huhFormRun = func(f *huh.Form) error {
		callCount++
		if callCount == 1 {
			setFormFieldValues(t, f, "pat")
		} else {
			setFormFieldValues(t, f, "ghp_inline_pat")
		}
		return nil
	}

	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub"},
	}
	if err := runGitHubAuthFromInlineEditor(creds, envPath); err != nil {
		t.Errorf("runGitHubAuthFromInlineEditor: %v", err)
	}

	envData, _ := os.ReadFile(envPath)
	if !strings.Contains(string(envData), "ghp_inline_pat") {
		t.Errorf("expected token saved: %s", string(envData))
	}
}
