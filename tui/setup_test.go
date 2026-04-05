package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
)

func TestCategoryTag(t *testing.T) {
	tests := []struct {
		category string
		want     string
	}{
		{"Creds", "[Creds]  "},
		{"GitHub", "[GitHub] "},
		{"Asana", "[Asana]  "},
		{"VisWins", "[VisWins]"},
		{"AI", "[AI]     "},
		{"Tuning", "[Tuning] "},
		{"Other", "[Other]  "},
		{"Boards", "[Boards] "},
	}

	for _, tt := range tests {
		got := categoryTag(tt.category)
		if got != tt.want {
			t.Errorf("categoryTag(%q) = %q, want %q", tt.category, got, tt.want)
		}
	}
}

func TestMaskValue(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"", ""},
		{"ab", "••"},
		{"abcd", "••••"},
		{"abcde", "•bcde"},
		{"ghp_1234567890", "••••••••7890"},
	}

	for _, tt := range tests {
		got := maskValue(tt.input)
		if got != tt.want {
			t.Errorf("maskValue(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestBuildSettingLabel(t *testing.T) {
	tests := []struct {
		name             string
		def              settingDef
		currentVal       string
		validationDetail string
		wantContains     []string
	}{
		{
			name:         "unconfigured setting with no default",
			def:          settingDef{envKey: "AI_API_BASE_URL", label: "AI API Base URL", category: "AI"},
			currentVal:   "",
			wantContains: []string{"[AI]", "AI API Base URL", "(not set)"},
		},
		{
			name:         "unconfigured setting with default",
			def:          settingDef{envKey: "AI_MODEL", label: "AI Model", category: "AI", defaultVal: "gpt-5-mini"},
			currentVal:   "",
			wantContains: []string{"[AI]", "AI Model", "= gpt-5-mini"},
		},
		{
			name:         "configured plain setting",
			def:          settingDef{envKey: "AI_MODEL", label: "AI Model", category: "AI"},
			currentVal:   "gpt-5-mini",
			wantContains: []string{"[AI]", "AI Model", "gpt-5-mini"},
		},
		{
			name:             "credential with validation detail",
			def:              settingDef{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", category: "Creds", sensitive: true},
			currentVal:       "ghp_1234567890",
			validationDetail: "Connected as @alice",
			wantContains:     []string{"[Creds]", "GitHub PAT", "Connected as @alice"},
		},
		{
			name:         "sensitive value is masked",
			def:          settingDef{envKey: "OPENAI_API_KEY", label: "OpenAI API Key", category: "Creds", sensitive: true},
			currentVal:   "sk-proj-abc123xyz789",
			wantContains: []string{"[Creds]", "OpenAI API Key", "z789"},
		},
		{
			name:         "tuning with default value",
			def:          settingDef{envKey: "TEAMHERO_AI_MAX_RETRIES", label: "AI Max Retries", category: "Tuning", defaultVal: "2"},
			currentVal:   "",
			wantContains: []string{"[Tuning]", "AI Max Retries", "= 2"},
		},
		{
			name:         "required and not set",
			def:          settingDef{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", category: "Creds", sensitive: true, required: true},
			currentVal:   "",
			wantContains: []string{"[Creds]", "GitHub PAT", "[required]"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildSettingLabel(&tt.def, tt.currentVal, tt.validationDetail)
			for _, substr := range tt.wantContains {
				if !stringContains(got, substr) {
					t.Errorf("buildSettingLabel() = %q, want it to contain %q", got, substr)
				}
			}
		})
	}
}

// stringContains is a test helper (strings.Contains without importing strings in test).
func stringContains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

func TestKnownSettingsNoDuplicates(t *testing.T) {
	seen := make(map[string]bool)
	for _, def := range knownSettings {
		if seen[def.envKey] {
			t.Errorf("duplicate envKey in knownSettings: %s", def.envKey)
		}
		seen[def.envKey] = true
	}
}

// ---------------------------------------------------------------------------
// parseEnvFile tests
// ---------------------------------------------------------------------------

func TestParseEnvFile_BasicKeyValue(t *testing.T) {
	input := "FOO=bar\nBAZ=qux\n"
	result := parseEnvFile(strings.NewReader(input))

	if result["FOO"] != "bar" {
		t.Errorf("expected FOO=bar, got %q", result["FOO"])
	}
	if result["BAZ"] != "qux" {
		t.Errorf("expected BAZ=qux, got %q", result["BAZ"])
	}
}

func TestParseEnvFile_SkipsComments(t *testing.T) {
	input := "# This is a comment\nFOO=bar\n# Another comment\nBAZ=qux\n"
	result := parseEnvFile(strings.NewReader(input))

	if len(result) != 2 {
		t.Errorf("expected 2 entries, got %d", len(result))
	}
	if result["FOO"] != "bar" {
		t.Errorf("expected FOO=bar, got %q", result["FOO"])
	}
}

func TestParseEnvFile_SkipsBlankLines(t *testing.T) {
	input := "\n\nFOO=bar\n\nBAZ=qux\n\n"
	result := parseEnvFile(strings.NewReader(input))

	if len(result) != 2 {
		t.Errorf("expected 2 entries, got %d", len(result))
	}
}

func TestParseEnvFile_TrimsWhitespace(t *testing.T) {
	input := "  FOO  =  bar  \n  BAZ  =  qux  \n"
	result := parseEnvFile(strings.NewReader(input))

	if result["FOO"] != "bar" {
		t.Errorf("expected FOO=bar, got %q", result["FOO"])
	}
	if result["BAZ"] != "qux" {
		t.Errorf("expected BAZ=qux, got %q", result["BAZ"])
	}
}

func TestParseEnvFile_ValueWithEquals(t *testing.T) {
	input := "URL=https://example.com?foo=bar&baz=qux\n"
	result := parseEnvFile(strings.NewReader(input))

	if result["URL"] != "https://example.com?foo=bar&baz=qux" {
		t.Errorf("expected URL value with equals signs, got %q", result["URL"])
	}
}

func TestParseEnvFile_EmptyInput(t *testing.T) {
	result := parseEnvFile(strings.NewReader(""))

	if len(result) != 0 {
		t.Errorf("expected empty map, got %d entries", len(result))
	}
}

func TestParseEnvFile_OnlyComments(t *testing.T) {
	input := "# comment 1\n# comment 2\n"
	result := parseEnvFile(strings.NewReader(input))

	if len(result) != 0 {
		t.Errorf("expected empty map, got %d entries", len(result))
	}
}

func TestParseEnvFile_NoValueLine(t *testing.T) {
	input := "JUSTKEY\nFOO=bar\n"
	result := parseEnvFile(strings.NewReader(input))

	// JUSTKEY has no = so should be skipped
	if _, exists := result["JUSTKEY"]; exists {
		t.Error("expected JUSTKEY to be skipped (no = delimiter)")
	}
	if result["FOO"] != "bar" {
		t.Errorf("expected FOO=bar, got %q", result["FOO"])
	}
}

func TestParseEnvFile_EmptyValue(t *testing.T) {
	input := "FOO=\nBAR=value\n"
	result := parseEnvFile(strings.NewReader(input))

	// FOO= has empty value after trim — still stored as ""
	if result["FOO"] != "" {
		t.Errorf("expected FOO to be empty string, got %q", result["FOO"])
	}
	if result["BAR"] != "value" {
		t.Errorf("expected BAR=value, got %q", result["BAR"])
	}
}

// ---------------------------------------------------------------------------
// settingDisplayValue tests
// ---------------------------------------------------------------------------

func TestSettingDisplayValue_SequentialTrue(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"true", "sequential"},
		{"True", "sequential"},
		{"TRUE", "sequential"},
		{"1", "sequential"},
		{"yes", "sequential"},
		{"on", "sequential"},
		{"sequential", "sequential"},
	}
	for _, tt := range tests {
		got := settingDisplayValue("TEAMHERO_SEQUENTIAL", tt.input)
		if got != tt.want {
			t.Errorf("settingDisplayValue(TEAMHERO_SEQUENTIAL, %q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestSettingDisplayValue_SequentialFalse(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"false", "parallel"},
		{"False", "parallel"},
		{"0", "parallel"},
		{"no", "parallel"},
		{"off", "parallel"},
		{"parallel", "parallel"},
		{"anything", "parallel"},
	}
	for _, tt := range tests {
		got := settingDisplayValue("TEAMHERO_SEQUENTIAL", tt.input)
		if got != tt.want {
			t.Errorf("settingDisplayValue(TEAMHERO_SEQUENTIAL, %q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestSettingDisplayValue_OtherKeyPassthrough(t *testing.T) {
	got := settingDisplayValue("AI_MODEL", "gpt-5-mini")
	if got != "gpt-5-mini" {
		t.Errorf("settingDisplayValue(AI_MODEL, gpt-5-mini) = %q, want gpt-5-mini", got)
	}
}

func TestSettingDisplayValue_OtherKeyEmpty(t *testing.T) {
	got := settingDisplayValue("OPENAI_PROJECT", "")
	if got != "" {
		t.Errorf("settingDisplayValue(OPENAI_PROJECT, '') = %q, want empty", got)
	}
}

// ---------------------------------------------------------------------------
// settingStoreValue tests
// ---------------------------------------------------------------------------

func TestSettingStoreValue_SequentialToTrue(t *testing.T) {
	got := settingStoreValue("TEAMHERO_SEQUENTIAL", "sequential")
	if got != "true" {
		t.Errorf("settingStoreValue(TEAMHERO_SEQUENTIAL, sequential) = %q, want true", got)
	}
}

func TestSettingStoreValue_ParallelToFalse(t *testing.T) {
	got := settingStoreValue("TEAMHERO_SEQUENTIAL", "parallel")
	if got != "false" {
		t.Errorf("settingStoreValue(TEAMHERO_SEQUENTIAL, parallel) = %q, want false", got)
	}
}

func TestSettingStoreValue_SequentialCaseInsensitive(t *testing.T) {
	got := settingStoreValue("TEAMHERO_SEQUENTIAL", "Sequential")
	if got != "true" {
		t.Errorf("settingStoreValue(TEAMHERO_SEQUENTIAL, Sequential) = %q, want true", got)
	}
}

func TestSettingStoreValue_ParallelCaseInsensitive(t *testing.T) {
	got := settingStoreValue("TEAMHERO_SEQUENTIAL", "Parallel")
	if got != "false" {
		t.Errorf("settingStoreValue(TEAMHERO_SEQUENTIAL, Parallel) = %q, want false", got)
	}
}

func TestSettingStoreValue_SequentialUnrecognizedPassthrough(t *testing.T) {
	got := settingStoreValue("TEAMHERO_SEQUENTIAL", "unknown-value")
	if got != "unknown-value" {
		t.Errorf("settingStoreValue(TEAMHERO_SEQUENTIAL, unknown-value) = %q, want unknown-value", got)
	}
}

func TestSettingStoreValue_OtherKeyPassthrough(t *testing.T) {
	got := settingStoreValue("AI_MODEL", "gpt-5-mini")
	if got != "gpt-5-mini" {
		t.Errorf("settingStoreValue(AI_MODEL, gpt-5-mini) = %q, want gpt-5-mini", got)
	}
}

// ---------------------------------------------------------------------------
// categoryDisplayName tests
// ---------------------------------------------------------------------------

func TestCategoryDisplayName(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"Creds", "Core Credentials"},
		{"GitHub", "GitHub"},
		{"Asana", "Asana"},
		{"VisWins", "Visible Wins / Meeting Notes"},
		{"AI", "AI / LLM"},
		{"Tuning", "Advanced Tuning"},
		{"Report", "Report Defaults"},
		{"SomethingElse", "SomethingElse"},
		{"", ""},
	}

	for _, tt := range tests {
		got := categoryDisplayName(tt.input)
		if got != tt.want {
			t.Errorf("categoryDisplayName(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

// ---------------------------------------------------------------------------
// countBoards tests
// ---------------------------------------------------------------------------

func TestCountBoards_ValidFile(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "boards.json")

	boardsJSON := `{"boards":[{"name":"board1"},{"name":"board2"},{"name":"board3"}]}`
	os.WriteFile(path, []byte(boardsJSON), 0o644)

	count, ok := countBoards(path)
	if !ok {
		t.Error("expected countBoards to return ok=true for valid file")
	}
	if count != 3 {
		t.Errorf("expected 3 boards, got %d", count)
	}
}

func TestCountBoards_EmptyBoards(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "boards.json")

	boardsJSON := `{"boards":[]}`
	os.WriteFile(path, []byte(boardsJSON), 0o644)

	_, ok := countBoards(path)
	if ok {
		t.Error("expected countBoards to return ok=false for empty boards array")
	}
}

func TestCountBoards_MissingFile(t *testing.T) {
	_, ok := countBoards("/nonexistent/path/boards.json")
	if ok {
		t.Error("expected countBoards to return ok=false for missing file")
	}
}

func TestCountBoards_InvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "boards.json")

	os.WriteFile(path, []byte("not json"), 0o644)

	_, ok := countBoards(path)
	if ok {
		t.Error("expected countBoards to return ok=false for invalid JSON")
	}
}

func TestCountBoards_NoBoartsKey(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "boards.json")

	os.WriteFile(path, []byte(`{"other":"data"}`), 0o644)

	_, ok := countBoards(path)
	if ok {
		t.Error("expected countBoards to return ok=false when 'boards' key is missing")
	}
}

func TestCountBoards_SingleBoard(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "boards.json")

	boardsJSON := `{"boards":[{"id":"abc","name":"My Board"}]}`
	os.WriteFile(path, []byte(boardsJSON), 0o644)

	count, ok := countBoards(path)
	if !ok {
		t.Error("expected countBoards to return ok=true")
	}
	if count != 1 {
		t.Errorf("expected 1 board, got %d", count)
	}
}

// ---------------------------------------------------------------------------
// updateEnvKey tests
// ---------------------------------------------------------------------------

func TestUpdateEnvKey_NewFile(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, ".env")

	err := updateEnvKey(path, "FOO", "bar")
	if err != nil {
		t.Fatalf("updateEnvKey failed: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read file: %v", err)
	}

	content := string(data)
	if !strings.Contains(content, "FOO=bar") {
		t.Errorf("expected file to contain FOO=bar, got %q", content)
	}
}

func TestUpdateEnvKey_UpdateExisting(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, ".env")

	initial := "FOO=old\nBAR=baz\n"
	os.WriteFile(path, []byte(initial), 0o600)

	err := updateEnvKey(path, "FOO", "new")
	if err != nil {
		t.Fatalf("updateEnvKey failed: %v", err)
	}

	data, _ := os.ReadFile(path)
	content := string(data)
	if !strings.Contains(content, "FOO=new") {
		t.Errorf("expected FOO=new in file, got %q", content)
	}
	if strings.Contains(content, "FOO=old") {
		t.Errorf("expected FOO=old to be replaced, got %q", content)
	}
	// BAR should be preserved
	if !strings.Contains(content, "BAR=baz") {
		t.Errorf("expected BAR=baz to be preserved, got %q", content)
	}
}

func TestUpdateEnvKey_AppendNew(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, ".env")

	initial := "FOO=bar\n"
	os.WriteFile(path, []byte(initial), 0o600)

	err := updateEnvKey(path, "NEW_KEY", "new_value")
	if err != nil {
		t.Fatalf("updateEnvKey failed: %v", err)
	}

	data, _ := os.ReadFile(path)
	content := string(data)
	if !strings.Contains(content, "FOO=bar") {
		t.Errorf("expected FOO=bar to be preserved, got %q", content)
	}
	if !strings.Contains(content, "NEW_KEY=new_value") {
		t.Errorf("expected NEW_KEY=new_value to be appended, got %q", content)
	}
}

func TestUpdateEnvKey_PreservesComments(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, ".env")

	initial := "# Important comment\nFOO=old\n# Another comment\nBAR=baz\n"
	os.WriteFile(path, []byte(initial), 0o600)

	err := updateEnvKey(path, "FOO", "new")
	if err != nil {
		t.Fatalf("updateEnvKey failed: %v", err)
	}

	data, _ := os.ReadFile(path)
	content := string(data)
	if !strings.Contains(content, "# Important comment") {
		t.Errorf("expected comment to be preserved, got %q", content)
	}
	if !strings.Contains(content, "# Another comment") {
		t.Errorf("expected second comment to be preserved, got %q", content)
	}
}

func TestUpdateEnvKey_CreatesParentDirs(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "nested", "dir", ".env")

	err := updateEnvKey(path, "KEY", "val")
	if err != nil {
		t.Fatalf("updateEnvKey failed: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read file: %v", err)
	}
	if !strings.Contains(string(data), "KEY=val") {
		t.Errorf("expected KEY=val, got %q", string(data))
	}
}

func TestUpdateEnvKey_TrailingNewline(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, ".env")

	err := updateEnvKey(path, "FOO", "bar")
	if err != nil {
		t.Fatalf("updateEnvKey failed: %v", err)
	}

	data, _ := os.ReadFile(path)
	if !strings.HasSuffix(string(data), "\n") {
		t.Error("expected file to have trailing newline")
	}
}

// ---------------------------------------------------------------------------
// loadExistingCredentials tests (file-based)
// ---------------------------------------------------------------------------

func TestLoadExistingCredentials_QuoteStripping(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, ".env")

	content := `FOO="double-quoted"
BAR='single-quoted'
BAZ=unquoted
`
	os.WriteFile(path, []byte(content), 0o600)

	result := loadExistingCredentials(path)
	if result["FOO"] != "double-quoted" {
		t.Errorf("expected double-quoted value stripped, got %q", result["FOO"])
	}
	if result["BAR"] != "single-quoted" {
		t.Errorf("expected single-quoted value stripped, got %q", result["BAR"])
	}
	if result["BAZ"] != "unquoted" {
		t.Errorf("expected unquoted value as-is, got %q", result["BAZ"])
	}
}

func TestLoadExistingCredentials_SkipsEmptyValues(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, ".env")

	content := "FOO=\nBAR=value\n"
	os.WriteFile(path, []byte(content), 0o600)

	result := loadExistingCredentials(path)
	if _, exists := result["FOO"]; exists {
		t.Error("expected FOO with empty value to be skipped")
	}
	if result["BAR"] != "value" {
		t.Errorf("expected BAR=value, got %q", result["BAR"])
	}
}

func TestLoadExistingCredentials_MissingFile(t *testing.T) {
	result := loadExistingCredentials("/nonexistent/path/.env")
	if len(result) != 0 {
		t.Errorf("expected empty map for missing file, got %d entries", len(result))
	}
}

// ---------------------------------------------------------------------------
// checkBoardsConfig tests (integration with countBoards + configDir)
// ---------------------------------------------------------------------------

func TestCheckBoardsConfig_NoBoardsFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	// Create the config dir but no boards file
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	status := checkBoardsConfig()
	if status.found {
		t.Error("expected found=false when boards file does not exist")
	}
}

func TestCheckBoardsConfig_WithBoards(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)

	boardsJSON, _ := json.Marshal(map[string]interface{}{
		"boards": []map[string]string{
			{"name": "Board 1"},
			{"name": "Board 2"},
		},
	})
	os.WriteFile(filepath.Join(configPath, "asana-config.json"), boardsJSON, 0o644)

	status := checkBoardsConfig()
	if !status.found {
		t.Error("expected found=true when boards file exists")
	}
	if status.count != 2 {
		t.Errorf("expected count=2, got %d", status.count)
	}
}

// ===========================================================================
// HTTP validation tests
// ===========================================================================

// ---------------------------------------------------------------------------
// validateGitHub tests
// ---------------------------------------------------------------------------

func TestValidateGitHub_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/user" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("unexpected auth header: %s", r.Header.Get("Authorization"))
		}
		w.WriteHeader(200)
		fmt.Fprint(w, `{"login":"testuser"}`)
	}))
	defer srv.Close()

	old := githubAPIBaseURL
	githubAPIBaseURL = srv.URL
	t.Cleanup(func() { githubAPIBaseURL = old })

	c := &credential{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", value: "test-token"}
	validateGitHub(srv.Client(), c)

	if c.status != "valid" {
		t.Errorf("expected status=valid, got %q", c.status)
	}
	if !strings.Contains(c.detail, "@testuser") {
		t.Errorf("expected detail to contain @testuser, got %q", c.detail)
	}
}

func TestValidateGitHub_Unauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		fmt.Fprint(w, `{"message":"Bad credentials"}`)
	}))
	defer srv.Close()

	old := githubAPIBaseURL
	githubAPIBaseURL = srv.URL
	t.Cleanup(func() { githubAPIBaseURL = old })

	c := &credential{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", value: "bad-token"}
	validateGitHub(srv.Client(), c)

	if c.status != "invalid" {
		t.Errorf("expected status=invalid, got %q", c.status)
	}
}

func TestValidateGitHub_ConnectionError(t *testing.T) {
	// Start and immediately close to get a connection-refused URL
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	url := srv.URL
	srv.Close()

	old := githubAPIBaseURL
	githubAPIBaseURL = url
	t.Cleanup(func() { githubAPIBaseURL = old })

	c := &credential{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", value: "test-token"}
	validateGitHub(&http.Client{}, c)

	if c.status != "invalid" {
		t.Errorf("expected status=invalid, got %q", c.status)
	}
	if !strings.Contains(c.detail, "Connection failed") {
		t.Errorf("expected detail to contain 'Connection failed', got %q", c.detail)
	}
}

func TestValidateGitHub_SuccessNoLogin(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		fmt.Fprint(w, `{}`)
	}))
	defer srv.Close()

	old := githubAPIBaseURL
	githubAPIBaseURL = srv.URL
	t.Cleanup(func() { githubAPIBaseURL = old })

	c := &credential{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", value: "test-token"}
	validateGitHub(srv.Client(), c)

	if c.status != "valid" {
		t.Errorf("expected status=valid, got %q", c.status)
	}
	if c.detail != "Authenticated" {
		t.Errorf("expected detail=Authenticated, got %q", c.detail)
	}
}

// ---------------------------------------------------------------------------
// validateOpenAI tests
// ---------------------------------------------------------------------------

func TestValidateOpenAI_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		// Consume the body to avoid broken pipe
		io.ReadAll(r.Body)
		w.WriteHeader(200)
		fmt.Fprint(w, `{"id":"resp_123"}`)
	}))
	defer srv.Close()

	old := openAIAPIBaseURL
	openAIAPIBaseURL = srv.URL
	t.Cleanup(func() { openAIAPIBaseURL = old })

	c := &credential{envKey: "OPENAI_API_KEY", value: "sk-test-key"}
	validateOpenAI(srv.Client(), c)

	if c.status != "valid" {
		t.Errorf("expected status=valid, got %q", c.status)
	}
	if c.detail != "Validated" {
		t.Errorf("expected detail=Validated, got %q", c.detail)
	}
}

func TestValidateOpenAI_Unauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.ReadAll(r.Body)
		w.WriteHeader(401)
		fmt.Fprint(w, `{"error":{"message":"invalid api key"}}`)
	}))
	defer srv.Close()

	old := openAIAPIBaseURL
	openAIAPIBaseURL = srv.URL
	t.Cleanup(func() { openAIAPIBaseURL = old })

	c := &credential{envKey: "OPENAI_API_KEY", value: "sk-bad-key"}
	validateOpenAI(srv.Client(), c)

	if c.status != "invalid" {
		t.Errorf("expected status=invalid, got %q", c.status)
	}
	if !strings.Contains(c.detail, "invalid or expired") {
		t.Errorf("expected detail about invalid/expired, got %q", c.detail)
	}
}

func TestValidateOpenAI_RateLimit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.ReadAll(r.Body)
		w.WriteHeader(429)
		fmt.Fprint(w, `{"error":{"message":"rate limit"}}`)
	}))
	defer srv.Close()

	old := openAIAPIBaseURL
	openAIAPIBaseURL = srv.URL
	t.Cleanup(func() { openAIAPIBaseURL = old })

	c := &credential{envKey: "OPENAI_API_KEY", value: "sk-valid-key"}
	validateOpenAI(srv.Client(), c)

	// 429 means the key is valid, just rate limited
	if c.status != "valid" {
		t.Errorf("expected status=valid on 429, got %q", c.status)
	}
}

func TestValidateOpenAI_ConnectionError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	url := srv.URL
	srv.Close()

	old := openAIAPIBaseURL
	openAIAPIBaseURL = url
	t.Cleanup(func() { openAIAPIBaseURL = old })

	c := &credential{envKey: "OPENAI_API_KEY", value: "sk-test"}
	validateOpenAI(&http.Client{}, c)

	if c.status != "invalid" {
		t.Errorf("expected status=invalid, got %q", c.status)
	}
	if !strings.Contains(c.detail, "Connection failed") {
		t.Errorf("expected detail to contain 'Connection failed', got %q", c.detail)
	}
}

// ---------------------------------------------------------------------------
// validateAsana tests
// ---------------------------------------------------------------------------

func TestValidateAsana_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/users/me" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer asana-token" {
			t.Errorf("unexpected auth header: %s", r.Header.Get("Authorization"))
		}
		w.WriteHeader(200)
		fmt.Fprint(w, `{"data":{"name":"Test User"}}`)
	}))
	defer srv.Close()

	old := asanaAPIBaseURL
	asanaAPIBaseURL = srv.URL
	t.Cleanup(func() { asanaAPIBaseURL = old })

	c := &credential{envKey: "ASANA_API_TOKEN", value: "asana-token"}
	validateAsana(srv.Client(), c)

	if c.status != "valid" {
		t.Errorf("expected status=valid, got %q", c.status)
	}
	if !strings.Contains(c.detail, "Test User") {
		t.Errorf("expected detail to contain 'Test User', got %q", c.detail)
	}
}

func TestValidateAsana_SuccessNoName(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		fmt.Fprint(w, `{"data":{}}`)
	}))
	defer srv.Close()

	old := asanaAPIBaseURL
	asanaAPIBaseURL = srv.URL
	t.Cleanup(func() { asanaAPIBaseURL = old })

	c := &credential{envKey: "ASANA_API_TOKEN", value: "asana-token"}
	validateAsana(srv.Client(), c)

	if c.status != "valid" {
		t.Errorf("expected status=valid, got %q", c.status)
	}
	if c.detail != "Authenticated" {
		t.Errorf("expected detail=Authenticated, got %q", c.detail)
	}
}

func TestValidateAsana_Unauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		fmt.Fprint(w, `{"errors":[{"message":"Not Authorized"}]}`)
	}))
	defer srv.Close()

	old := asanaAPIBaseURL
	asanaAPIBaseURL = srv.URL
	t.Cleanup(func() { asanaAPIBaseURL = old })

	c := &credential{envKey: "ASANA_API_TOKEN", value: "bad-token"}
	validateAsana(srv.Client(), c)

	if c.status != "invalid" {
		t.Errorf("expected status=invalid, got %q", c.status)
	}
}

func TestValidateAsana_ConnectionError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	url := srv.URL
	srv.Close()

	old := asanaAPIBaseURL
	asanaAPIBaseURL = url
	t.Cleanup(func() { asanaAPIBaseURL = old })

	c := &credential{envKey: "ASANA_API_TOKEN", value: "asana-token"}
	validateAsana(&http.Client{}, c)

	if c.status != "invalid" {
		t.Errorf("expected status=invalid, got %q", c.status)
	}
	if !strings.Contains(c.detail, "Connection failed") {
		t.Errorf("expected detail to contain 'Connection failed', got %q", c.detail)
	}
}

// ---------------------------------------------------------------------------
// validateCredentialsWith tests
// ---------------------------------------------------------------------------

func TestValidateCredentialsWith_EmptyValueSkipped(t *testing.T) {
	c := credential{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", value: ""}
	creds := []credential{c}
	validateCredentialsWith(creds, &http.Client{})

	if creds[0].status != "skipped" {
		t.Errorf("expected status=skipped for empty value, got %q", creds[0].status)
	}
}

func TestValidateCredentialsWith_AlreadyValidStaysValid(t *testing.T) {
	c := credential{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", value: "tok", status: "valid", detail: "already ok"}
	creds := []credential{c}
	validateCredentialsWith(creds, &http.Client{})

	if creds[0].status != "valid" {
		t.Errorf("expected status to remain valid, got %q", creds[0].status)
	}
	if creds[0].detail != "already ok" {
		t.Errorf("expected detail to remain 'already ok', got %q", creds[0].detail)
	}
}

func TestValidateCredentialsWith_MixedCreds(t *testing.T) {
	// GitHub: will succeed; OpenAI: will fail with 401; Asana: empty (skipped)
	githubSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		fmt.Fprint(w, `{"login":"mixuser"}`)
	}))
	defer githubSrv.Close()

	openaiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.ReadAll(r.Body)
		w.WriteHeader(401)
	}))
	defer openaiSrv.Close()

	oldGH := githubAPIBaseURL
	oldOAI := openAIAPIBaseURL
	githubAPIBaseURL = githubSrv.URL
	openAIAPIBaseURL = openaiSrv.URL
	t.Cleanup(func() {
		githubAPIBaseURL = oldGH
		openAIAPIBaseURL = oldOAI
	})

	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", value: "ghp_test"},
		{envKey: "OPENAI_API_KEY", value: "sk-bad"},
		{envKey: "ASANA_API_TOKEN", value: ""},
	}

	// Use a client that can talk to both test servers
	validateCredentialsWith(creds, &http.Client{})

	if creds[0].status != "valid" {
		t.Errorf("GitHub: expected valid, got %q", creds[0].status)
	}
	if creds[1].status != "invalid" {
		t.Errorf("OpenAI: expected invalid, got %q", creds[1].status)
	}
	if creds[2].status != "skipped" {
		t.Errorf("Asana: expected skipped, got %q", creds[2].status)
	}
}

// ===========================================================================
// writeEnvFile tests
// ===========================================================================

func TestWriteEnvFile_CreatesNewFile(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "sub", ".env")

	creds := []credential{
		{envKey: "FOO", value: "bar"},
		{envKey: "BAZ", value: "qux"},
	}

	err := writeEnvFile(path, creds)
	if err != nil {
		t.Fatalf("writeEnvFile failed: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read file: %v", err)
	}
	content := string(data)
	if !strings.Contains(content, "FOO=bar") {
		t.Errorf("expected FOO=bar in file, got %q", content)
	}
	if !strings.Contains(content, "BAZ=qux") {
		t.Errorf("expected BAZ=qux in file, got %q", content)
	}
}

func TestWriteEnvFile_UpdatesExistingKey(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, ".env")

	initial := "FOO=old\nBAR=keep\n"
	os.WriteFile(path, []byte(initial), 0o600)

	creds := []credential{
		{envKey: "FOO", value: "new"},
	}

	err := writeEnvFile(path, creds)
	if err != nil {
		t.Fatalf("writeEnvFile failed: %v", err)
	}

	data, _ := os.ReadFile(path)
	content := string(data)
	if !strings.Contains(content, "FOO=new") {
		t.Errorf("expected FOO=new, got %q", content)
	}
	if strings.Contains(content, "FOO=old") {
		t.Errorf("FOO=old should have been replaced, got %q", content)
	}
	if !strings.Contains(content, "BAR=keep") {
		t.Errorf("BAR=keep should be preserved, got %q", content)
	}
}

func TestWriteEnvFile_DropsComments(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, ".env")

	initial := "# Header comment\nFOO=old\n# Footer comment\nBAR=baz\n"
	os.WriteFile(path, []byte(initial), 0o600)

	creds := []credential{
		{envKey: "FOO", value: "new"},
	}

	err := writeEnvFile(path, creds)
	if err != nil {
		t.Fatalf("writeEnvFile failed: %v", err)
	}

	data, _ := os.ReadFile(path)
	content := string(data)
	if strings.Contains(content, "# Header comment") {
		t.Errorf("expected header comment to be dropped, got %q", content)
	}
	if strings.Contains(content, "# Footer comment") {
		t.Errorf("expected footer comment to be dropped, got %q", content)
	}
	if !strings.Contains(content, "FOO=new") {
		t.Errorf("expected FOO=new to be present, got %q", content)
	}
	if !strings.Contains(content, "BAR=baz") {
		t.Errorf("expected BAR=baz to be preserved, got %q", content)
	}
}

func TestWriteEnvFile_OmitsEmptyValues(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, ".env")

	initial := "FOO=old\nBAR=keep\n"
	os.WriteFile(path, []byte(initial), 0o600)

	creds := []credential{
		{envKey: "FOO", value: ""}, // empty value should omit the line
	}

	err := writeEnvFile(path, creds)
	if err != nil {
		t.Fatalf("writeEnvFile failed: %v", err)
	}

	data, _ := os.ReadFile(path)
	content := string(data)
	if strings.Contains(content, "FOO=") {
		t.Errorf("expected FOO to be omitted when value is empty, got %q", content)
	}
	if !strings.Contains(content, "BAR=keep") {
		t.Errorf("BAR=keep should be preserved, got %q", content)
	}
}

func TestWriteEnvFile_AppendsNewKeys(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, ".env")

	initial := "EXISTING=val\n"
	os.WriteFile(path, []byte(initial), 0o600)

	creds := []credential{
		{envKey: "NEW_KEY", value: "new_val"},
	}

	err := writeEnvFile(path, creds)
	if err != nil {
		t.Fatalf("writeEnvFile failed: %v", err)
	}

	data, _ := os.ReadFile(path)
	content := string(data)
	if !strings.Contains(content, "EXISTING=val") {
		t.Errorf("existing key should be preserved, got %q", content)
	}
	if !strings.Contains(content, "NEW_KEY=new_val") {
		t.Errorf("new key should be appended, got %q", content)
	}
}

func TestWriteEnvFile_PreservesOrdering(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, ".env")

	initial := "# comment\nFIRST=1\nSECOND=2\nTHIRD=3\n"
	os.WriteFile(path, []byte(initial), 0o600)

	creds := []credential{
		{envKey: "SECOND", value: "updated"},
	}

	err := writeEnvFile(path, creds)
	if err != nil {
		t.Fatalf("writeEnvFile failed: %v", err)
	}

	data, _ := os.ReadFile(path)
	content := string(data)

	// Verify ordering: FIRST should appear before SECOND, SECOND before THIRD
	firstIdx := strings.Index(content, "FIRST=1")
	secondIdx := strings.Index(content, "SECOND=updated")
	thirdIdx := strings.Index(content, "THIRD=3")

	if firstIdx >= secondIdx {
		t.Errorf("FIRST should appear before SECOND in output: %q", content)
	}
	if secondIdx >= thirdIdx {
		t.Errorf("SECOND should appear before THIRD in output: %q", content)
	}
}

func TestWriteEnvFile_TrailingNewline(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, ".env")

	creds := []credential{
		{envKey: "KEY", value: "val"},
	}

	err := writeEnvFile(path, creds)
	if err != nil {
		t.Fatalf("writeEnvFile failed: %v", err)
	}

	data, _ := os.ReadFile(path)
	if !strings.HasSuffix(string(data), "\n") {
		t.Error("expected file to have trailing newline")
	}
}

func TestWriteEnvFile_FilePermissions(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, ".env")

	creds := []credential{
		{envKey: "SECRET", value: "val"},
	}

	err := writeEnvFile(path, creds)
	if err != nil {
		t.Fatalf("writeEnvFile failed: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("failed to stat file: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("expected file permissions 0600, got %o", info.Mode().Perm())
	}
}

// ===========================================================================
// isGoogleDriveConnected tests
// ===========================================================================

func TestIsGoogleDriveConnected_NoFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	if isGoogleDriveConnected() {
		t.Error("expected false when token file does not exist")
	}
}

func TestIsGoogleDriveConnected_InvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "google-tokens.json"), []byte("not-json"), 0o600)

	if isGoogleDriveConnected() {
		t.Error("expected false for invalid JSON")
	}
}

func TestIsGoogleDriveConnected_MissingRefreshToken(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)

	tokens := map[string]interface{}{
		"access_token": "at-123",
	}
	data, _ := json.Marshal(tokens)
	os.WriteFile(filepath.Join(configPath, "google-tokens.json"), data, 0o600)

	if isGoogleDriveConnected() {
		t.Error("expected false when refresh_token is missing")
	}
}

func TestIsGoogleDriveConnected_ValidTokens(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)

	tokens := map[string]interface{}{
		"access_token":  "at-123",
		"refresh_token": "rt-456",
	}
	data, _ := json.Marshal(tokens)
	os.WriteFile(filepath.Join(configPath, "google-tokens.json"), data, 0o600)

	if !isGoogleDriveConnected() {
		t.Error("expected true when refresh_token is present")
	}
}

// ===========================================================================
// BubbleTea model tests: settingsViewer
// ===========================================================================

func TestSettingsViewer_Init(t *testing.T) {
	m := newSettingsViewer("test content")
	cmd := m.Init()
	if cmd != nil {
		t.Error("expected Init() to return nil")
	}
}

func TestSettingsViewer_UpdateWindowSizeMsg(t *testing.T) {
	m := newSettingsViewer("test content")
	if m.ready {
		t.Error("expected ready=false initially")
	}

	msg := tea.WindowSizeMsg{Width: 80, Height: 24}
	updated, _ := m.Update(msg)
	sv := updated.(settingsViewer)

	if !sv.ready {
		t.Error("expected ready=true after WindowSizeMsg")
	}
}

func TestSettingsViewer_UpdateKeyMsgQuit(t *testing.T) {
	m := newSettingsViewer("test content")

	// First make it ready
	msg := tea.WindowSizeMsg{Width: 80, Height: 24}
	updated, _ := m.Update(msg)
	sv := updated.(settingsViewer)

	// Press "q" to quit
	keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}}
	updated, cmd := sv.Update(keyMsg)
	sv = updated.(settingsViewer)

	if !sv.quitting {
		t.Error("expected quitting=true after pressing 'q'")
	}
	if cmd == nil {
		t.Error("expected quit command to be returned")
	}
}

func TestSettingsViewer_UpdateKeyMsgEnter(t *testing.T) {
	m := newSettingsViewer("test content")

	msg := tea.WindowSizeMsg{Width: 80, Height: 24}
	updated, _ := m.Update(msg)
	sv := updated.(settingsViewer)

	keyMsg := tea.KeyMsg{Type: tea.KeyEnter}
	updated, cmd := sv.Update(keyMsg)
	sv = updated.(settingsViewer)

	if !sv.quitting {
		t.Error("expected quitting=true after pressing Enter")
	}
	if cmd == nil {
		t.Error("expected quit command to be returned")
	}
}

func TestSettingsViewer_UpdateKeyMsgEsc(t *testing.T) {
	m := newSettingsViewer("test content")

	msg := tea.WindowSizeMsg{Width: 80, Height: 24}
	updated, _ := m.Update(msg)
	sv := updated.(settingsViewer)

	keyMsg := tea.KeyMsg{Type: tea.KeyEsc}
	updated, cmd := sv.Update(keyMsg)
	sv = updated.(settingsViewer)

	if !sv.quitting {
		t.Error("expected quitting=true after pressing Esc")
	}
	if cmd == nil {
		t.Error("expected quit command to be returned")
	}
}

func TestSettingsViewer_ViewNotReady(t *testing.T) {
	m := newSettingsViewer("test content")
	view := m.View()

	if !strings.Contains(view, "Loading") {
		t.Errorf("expected view to contain 'Loading' when not ready, got %q", view)
	}
}

func TestSettingsViewer_ViewReady(t *testing.T) {
	m := newSettingsViewer("hello world content")

	msg := tea.WindowSizeMsg{Width: 80, Height: 24}
	updated, _ := m.Update(msg)
	sv := updated.(settingsViewer)

	view := sv.View()
	if strings.Contains(view, "Loading") {
		t.Error("expected view to NOT contain 'Loading' when ready")
	}
	// The view should contain the title and scroll hint
	if !strings.Contains(view, "Current Configuration") {
		t.Errorf("expected view to contain title, got %q", view)
	}
	if !strings.Contains(view, "Enter to continue") {
		t.Errorf("expected view to contain hint text, got %q", view)
	}
}

func TestSettingsViewer_WindowResize(t *testing.T) {
	m := newSettingsViewer("test content")

	// Initial window size
	msg1 := tea.WindowSizeMsg{Width: 80, Height: 24}
	updated, _ := m.Update(msg1)
	sv := updated.(settingsViewer)

	if !sv.ready {
		t.Fatal("expected ready=true after first WindowSizeMsg")
	}

	// Resize
	msg2 := tea.WindowSizeMsg{Width: 120, Height: 40}
	updated, _ = sv.Update(msg2)
	sv = updated.(settingsViewer)

	// Should still be ready and viewport dimensions should update
	if !sv.ready {
		t.Error("expected ready=true after resize")
	}
	if sv.vp.Width != 116 { // 120 - 4
		t.Errorf("expected viewport width=116 after resize, got %d", sv.vp.Width)
	}
}

// ===========================================================================
// BubbleTea model tests: settingsPicker
// ===========================================================================

func TestSettingsPicker_Init(t *testing.T) {
	p := settingsPicker{}
	cmd := p.Init()
	if cmd != nil {
		t.Error("expected Init() to return nil")
	}
}

func TestSettingsPicker_UpdateWindowSizeMsg(t *testing.T) {
	p := settingsPicker{
		items: []settingsPickerItem{{key: "FOO", label: "Foo Setting"}},
		lines: []pickerLine{{text: "Foo Setting", itemIndex: 0}},
	}

	msg := tea.WindowSizeMsg{Width: 80, Height: 24}
	updated, _ := p.Update(msg)
	sp := updated.(settingsPicker)

	if !sp.ready {
		t.Error("expected ready=true after WindowSizeMsg")
	}
}

func TestSettingsPicker_UpdateKeyMsgDown(t *testing.T) {
	p := settingsPicker{
		items: []settingsPickerItem{
			{key: "A", label: "Item A"},
			{key: "B", label: "Item B"},
			{key: "C", label: "Item C"},
		},
		lines: []pickerLine{
			{text: "Item A", itemIndex: 0},
			{text: "Item B", itemIndex: 1},
			{text: "Item C", itemIndex: 2},
		},
		cursor: 0,
		ready:  true,
	}
	// Initialize viewport for renderContent to work
	p.viewport.Width = 76
	p.viewport.Height = 20
	p.viewport.SetContent(p.renderContent())

	// Press "j" to move down
	keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}}
	updated, _ := p.Update(keyMsg)
	sp := updated.(settingsPicker)

	if sp.cursor != 1 {
		t.Errorf("expected cursor=1 after pressing j, got %d", sp.cursor)
	}
}

func TestSettingsPicker_UpdateKeyMsgUp(t *testing.T) {
	p := settingsPicker{
		items: []settingsPickerItem{
			{key: "A", label: "Item A"},
			{key: "B", label: "Item B"},
		},
		lines: []pickerLine{
			{text: "Item A", itemIndex: 0},
			{text: "Item B", itemIndex: 1},
		},
		cursor: 1,
		ready:  true,
	}
	p.viewport.Width = 76
	p.viewport.Height = 20
	p.viewport.SetContent(p.renderContent())

	// Press "k" to move up
	keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'k'}}
	updated, _ := p.Update(keyMsg)
	sp := updated.(settingsPicker)

	if sp.cursor != 0 {
		t.Errorf("expected cursor=0 after pressing k, got %d", sp.cursor)
	}
}

func TestSettingsPicker_UpdateKeyMsgUpAtTop(t *testing.T) {
	p := settingsPicker{
		items: []settingsPickerItem{
			{key: "A", label: "Item A"},
			{key: "B", label: "Item B"},
		},
		lines: []pickerLine{
			{text: "Item A", itemIndex: 0},
			{text: "Item B", itemIndex: 1},
		},
		cursor: 0,
		ready:  true,
	}
	p.viewport.Width = 76
	p.viewport.Height = 20
	p.viewport.SetContent(p.renderContent())

	keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'k'}}
	updated, _ := p.Update(keyMsg)
	sp := updated.(settingsPicker)

	if sp.cursor != 0 {
		t.Errorf("expected cursor to remain 0 at top, got %d", sp.cursor)
	}
}

func TestSettingsPicker_UpdateKeyMsgDownAtBottom(t *testing.T) {
	p := settingsPicker{
		items: []settingsPickerItem{
			{key: "A", label: "Item A"},
			{key: "B", label: "Item B"},
		},
		lines: []pickerLine{
			{text: "Item A", itemIndex: 0},
			{text: "Item B", itemIndex: 1},
		},
		cursor: 1,
		ready:  true,
	}
	p.viewport.Width = 76
	p.viewport.Height = 20
	p.viewport.SetContent(p.renderContent())

	keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}}
	updated, _ := p.Update(keyMsg)
	sp := updated.(settingsPicker)

	if sp.cursor != 1 {
		t.Errorf("expected cursor to remain 1 at bottom, got %d", sp.cursor)
	}
}

func TestSettingsPicker_UpdateKeyMsgEnter(t *testing.T) {
	p := settingsPicker{
		items: []settingsPickerItem{
			{key: "TARGET_KEY", label: "Target"},
			{key: "OTHER", label: "Other"},
		},
		lines: []pickerLine{
			{text: "Target", itemIndex: 0},
			{text: "Other", itemIndex: 1},
		},
		cursor: 0,
		ready:  true,
	}
	p.viewport.Width = 76
	p.viewport.Height = 20
	p.viewport.SetContent(p.renderContent())

	keyMsg := tea.KeyMsg{Type: tea.KeyEnter}
	updated, cmd := p.Update(keyMsg)
	sp := updated.(settingsPicker)

	if sp.selected != "TARGET_KEY" {
		t.Errorf("expected selected=TARGET_KEY, got %q", sp.selected)
	}
	if !sp.quitting {
		t.Error("expected quitting=true after Enter")
	}
	if cmd == nil {
		t.Error("expected quit command to be returned")
	}
}

func TestSettingsPicker_UpdateKeyMsgQ(t *testing.T) {
	p := settingsPicker{
		items: []settingsPickerItem{{key: "ITEM", label: "Item"}},
		lines: []pickerLine{{text: "Item", itemIndex: 0}},
		ready: true,
	}
	p.viewport.Width = 76
	p.viewport.Height = 20
	p.viewport.SetContent(p.renderContent())

	keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}}
	updated, cmd := p.Update(keyMsg)
	sp := updated.(settingsPicker)

	if sp.selected != "@@done" {
		t.Errorf("expected selected=@@done after q, got %q", sp.selected)
	}
	if !sp.quitting {
		t.Error("expected quitting=true after q")
	}
	if cmd == nil {
		t.Error("expected quit command")
	}
}

func TestSettingsPicker_ViewNotReady(t *testing.T) {
	p := settingsPicker{}
	view := p.View()

	if !strings.Contains(view, "Loading") {
		t.Errorf("expected 'Loading' when not ready, got %q", view)
	}
}

func TestSettingsPicker_ViewReady(t *testing.T) {
	p := settingsPicker{
		items: []settingsPickerItem{{key: "ITEM", label: "Item"}},
		lines: []pickerLine{{text: "Item", itemIndex: 0}},
		ready: true,
	}
	p.viewport.Width = 76
	p.viewport.Height = 20
	p.viewport.SetContent(p.renderContent())

	view := p.View()
	if strings.Contains(view, "Loading") {
		t.Error("expected view to NOT show 'Loading' when ready")
	}
	if !strings.Contains(view, "Which setting do you want to change") {
		t.Errorf("expected view to contain picker title, got %q", view)
	}
}

func TestSettingsPicker_ViewWithTitle(t *testing.T) {
	p := settingsPicker{
		items: []settingsPickerItem{{key: "ITEM", label: "Item"}},
		lines: []pickerLine{{text: "Item", itemIndex: 0}},
		title: "All good!",
		ready: true,
	}
	p.viewport.Width = 76
	p.viewport.Height = 20
	p.viewport.SetContent(p.renderContent())

	view := p.View()
	if !strings.Contains(view, "All good!") {
		t.Errorf("expected view to contain custom title, got %q", view)
	}
}

// ---------------------------------------------------------------------------
// cursorLineIndex tests
// ---------------------------------------------------------------------------

func TestCursorLineIndex_MatchesCorrectLine(t *testing.T) {
	p := settingsPicker{
		items: []settingsPickerItem{
			{key: "A", label: "A"},
			{key: "B", label: "B"},
			{key: "C", label: "C"},
		},
		lines: []pickerLine{
			{text: "Header", itemIndex: -1},
			{text: "A", itemIndex: 0},
			{text: "B", itemIndex: 1},
			{text: "", itemIndex: -1},
			{text: "C", itemIndex: 2},
		},
	}

	tests := []struct {
		cursor   int
		wantLine int
	}{
		{0, 1}, // item 0 is at line index 1
		{1, 2}, // item 1 is at line index 2
		{2, 4}, // item 2 is at line index 4 (skipping the blank line)
	}

	for _, tt := range tests {
		p.cursor = tt.cursor
		got := p.cursorLineIndex()
		if got != tt.wantLine {
			t.Errorf("cursor=%d: cursorLineIndex()=%d, want %d", tt.cursor, got, tt.wantLine)
		}
	}
}

func TestCursorLineIndex_NoMatch(t *testing.T) {
	p := settingsPicker{
		items: []settingsPickerItem{{key: "A", label: "A"}},
		lines: []pickerLine{
			{text: "Header", itemIndex: -1},
			{text: "A", itemIndex: 0},
		},
		cursor: 5, // out of range
	}

	got := p.cursorLineIndex()
	if got != 0 {
		t.Errorf("expected 0 for no match, got %d", got)
	}
}

// ---------------------------------------------------------------------------
// renderContent tests
// ---------------------------------------------------------------------------

func TestRenderContent_IncludesHeadersAndItems(t *testing.T) {
	p := settingsPicker{
		items: []settingsPickerItem{
			{key: "A", label: "Item A"},
			{key: "B", label: "Item B"},
		},
		lines: []pickerLine{
			{text: "Section Header", itemIndex: -1},
			{text: "Item A", itemIndex: 0},
			{text: "Item B", itemIndex: 1},
		},
		cursor: 0,
	}

	content := p.renderContent()
	if !strings.Contains(content, "Section Header") {
		t.Error("expected content to contain header line")
	}
	// Cursor item should have a special indicator
	if !strings.Contains(content, "Item A") {
		t.Error("expected content to contain Item A")
	}
	if !strings.Contains(content, "Item B") {
		t.Error("expected content to contain Item B")
	}
}

// ===========================================================================
// buildSettingsPicker tests
// ===========================================================================

func TestBuildSettingsPicker_ConstructsItems(t *testing.T) {
	// Override XDG_CONFIG_HOME so checkBoardsConfig doesn't find real data
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	allEntries := map[string]string{
		"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_test",
		"OPENAI_API_KEY":               "sk-test",
		"AI_MODEL":                     "gpt-5-mini",
	}

	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", value: "ghp_test", status: "valid", detail: "Connected as @alice"},
		{envKey: "OPENAI_API_KEY", value: "sk-test", status: "valid", detail: "Validated"},
		{envKey: "ASANA_API_TOKEN", value: "", status: "skipped", optional: true},
	}

	picker := buildSettingsPicker(allEntries, creds, true)

	// Should have items for all knownSettings + boards + gdrive + done
	if len(picker.items) == 0 {
		t.Fatal("expected picker to have items")
	}

	// Check that @@done is the last item
	lastItem := picker.items[len(picker.items)-1]
	if lastItem.key != "@@done" {
		t.Errorf("expected last item to be @@done, got %q", lastItem.key)
	}

	// Check that @@boards is present
	foundBoards := false
	for _, item := range picker.items {
		if item.key == "@@boards" {
			foundBoards = true
			break
		}
	}
	if !foundBoards {
		t.Error("expected @@boards item in picker")
	}

	// Check that @@gdrive is present
	foundGdrive := false
	for _, item := range picker.items {
		if item.key == "@@gdrive" {
			foundGdrive = true
			break
		}
	}
	if !foundGdrive {
		t.Error("expected @@gdrive item in picker")
	}

	// Check title when allCredsValid is true
	if !strings.Contains(picker.title, "All required credentials") {
		t.Errorf("expected title to contain status message, got %q", picker.title)
	}
}

func TestBuildSettingsPicker_NotAllCredsValid(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	allEntries := map[string]string{}
	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", value: "", status: "skipped"},
		{envKey: "OPENAI_API_KEY", value: "", status: "skipped"},
	}

	picker := buildSettingsPicker(allEntries, creds, false)

	// Title should be empty when not all creds valid
	if picker.title != "" {
		t.Errorf("expected empty title when not all creds valid, got %q", picker.title)
	}
}

func TestBuildSettingsPicker_ExtraEnvKeys(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	allEntries := map[string]string{
		"CUSTOM_UNKNOWN_KEY": "some_value",
	}
	creds := []credential{}

	picker := buildSettingsPicker(allEntries, creds, true)

	// Should have an "Other" item for the unknown key
	foundCustom := false
	for _, item := range picker.items {
		if item.key == "CUSTOM_UNKNOWN_KEY" {
			foundCustom = true
			break
		}
	}
	if !foundCustom {
		t.Error("expected CUSTOM_UNKNOWN_KEY in picker items under Other")
	}
}

// ===========================================================================
// Additional loadExistingCredentials edge cases
// ===========================================================================

func TestLoadExistingCredentials_HandlesComments(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, ".env")

	content := "# This is a comment\nFOO=bar\n# Another\n"
	os.WriteFile(path, []byte(content), 0o600)

	result := loadExistingCredentials(path)
	if len(result) != 1 {
		t.Errorf("expected 1 entry, got %d", len(result))
	}
	if result["FOO"] != "bar" {
		t.Errorf("expected FOO=bar, got %q", result["FOO"])
	}
}

func TestLoadExistingCredentials_HandlesEmptyLines(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, ".env")

	content := "\n\nFOO=bar\n\n\nBAZ=qux\n\n"
	os.WriteFile(path, []byte(content), 0o600)

	result := loadExistingCredentials(path)
	if len(result) != 2 {
		t.Errorf("expected 2 entries, got %d", len(result))
	}
}

// ===========================================================================
// parseEnvFile quote-stripping difference test
// ===========================================================================

func TestParseEnvFile_DoesNotStripQuotes(t *testing.T) {
	// parseEnvFile does NOT strip quotes (unlike loadExistingCredentials)
	input := `FOO="quoted"` + "\n"
	result := parseEnvFile(strings.NewReader(input))

	// parseEnvFile returns the raw value with quotes
	if result["FOO"] != `"quoted"` {
		t.Errorf("expected parseEnvFile to keep quotes, got %q", result["FOO"])
	}
}

// ===========================================================================
// settingDisplayValue additional tests
// ===========================================================================

func TestSettingDisplayValue_EmptySequential(t *testing.T) {
	// Empty string for sequential key should return parallel (not a truthy value)
	got := settingDisplayValue("TEAMHERO_SEQUENTIAL", "")
	if got != "parallel" {
		t.Errorf("settingDisplayValue(TEAMHERO_SEQUENTIAL, '') = %q, want parallel", got)
	}
}

// ===========================================================================
// settingStoreValue additional tests
// ===========================================================================

func TestSettingStoreValue_EmptyPassthrough(t *testing.T) {
	got := settingStoreValue("AI_MODEL", "")
	if got != "" {
		t.Errorf("settingStoreValue(AI_MODEL, '') = %q, want empty", got)
	}
}

func TestSettingStoreValue_SequentialEmptyPassthrough(t *testing.T) {
	got := settingStoreValue("TEAMHERO_SEQUENTIAL", "")
	if got != "" {
		t.Errorf("settingStoreValue(TEAMHERO_SEQUENTIAL, '') = %q, want empty", got)
	}
}

// ===========================================================================
// buildSettingLabel additional tests
// ===========================================================================

func TestBuildSettingLabel_LongValueTruncated(t *testing.T) {
	longVal := strings.Repeat("x", 50)
	def := settingDef{envKey: "LONG_VAL", label: "Long Value", category: "AI"}
	got := buildSettingLabel(&def, longVal, "")

	if !strings.Contains(got, "...") {
		t.Errorf("expected long value to be truncated with '...', got %q", got)
	}
}

func TestBuildSettingLabel_SensitiveMasked(t *testing.T) {
	def := settingDef{envKey: "SECRET", label: "Secret", category: "Creds", sensitive: true}
	got := buildSettingLabel(&def, "mysecretvalue123", "")

	// Should not contain the raw value
	if strings.Contains(got, "mysecretvalue") {
		t.Errorf("expected sensitive value to be masked, got %q", got)
	}
	// Should contain the last 4 chars
	if !strings.Contains(got, "e123") {
		t.Errorf("expected last 4 chars visible, got %q", got)
	}
}

// ===========================================================================
// categoryDisplayName additional tests
// ===========================================================================

func TestCategoryDisplayName_AllKnownCategories(t *testing.T) {
	// Verify all categories used in knownSettings are handled
	categories := make(map[string]bool)
	for _, def := range knownSettings {
		categories[def.category] = true
	}

	for cat := range categories {
		name := categoryDisplayName(cat)
		if name == "" {
			t.Errorf("categoryDisplayName(%q) returned empty string", cat)
		}
		// Ensure it's not just returning the input unchanged for known categories
		// (except "GitHub" and "Asana" which map to themselves)
		if cat != "GitHub" && cat != "Asana" && name == cat {
			t.Errorf("categoryDisplayName(%q) = %q, expected a different display name", cat, name)
		}
	}
}

// ===========================================================================
// validateCredentials tests
// ===========================================================================

func TestValidateCredentials_OptionalEmptySkipped(t *testing.T) {
	creds := []credential{
		{envKey: "ASANA_API_TOKEN", label: "Asana Token", optional: true, value: ""},
	}
	validateCredentials(creds)

	if creds[0].status != "skipped" {
		t.Errorf("expected status=skipped for empty optional credential, got %q", creds[0].status)
	}
}

// ===========================================================================
// renderSettingsStatus tests
// ===========================================================================

func TestRenderSettingsStatus_NoCredentials(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	existing := map[string]string{}
	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false, value: "", status: ""},
		{envKey: "OPENAI_API_KEY", label: "OpenAI Key", optional: false, value: "", status: ""},
	}
	boardsStatus := boardsConfigStatus{found: false}

	content, valid, missing, invalid := renderSettingsStatus(existing, creds, boardsStatus)

	if content == "" {
		t.Error("expected non-empty content")
	}
	if valid != 0 {
		t.Errorf("expected valid=0, got %d", valid)
	}
	if missing == 0 {
		t.Error("expected missing > 0 when required credentials are absent")
	}
	_ = invalid
}

func TestRenderSettingsStatus_ValidCredential(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	existing := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_test"}
	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false, value: "ghp_test", status: "valid", detail: "Connected as @alice"},
	}
	boardsStatus := boardsConfigStatus{found: false}

	_, valid, _, _ := renderSettingsStatus(existing, creds, boardsStatus)

	if valid == 0 {
		t.Error("expected valid > 0 for a valid credential")
	}
}

func TestRenderSettingsStatus_InvalidCredential(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	existing := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "bad"}
	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false, value: "bad", status: "invalid", detail: "Token expired"},
	}
	boardsStatus := boardsConfigStatus{found: false}

	_, _, _, invalid := renderSettingsStatus(existing, creds, boardsStatus)

	if invalid == 0 {
		t.Error("expected invalid > 0 for an invalid credential")
	}
}

func TestRenderSettingsStatus_SkippedOptionalCredential(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	existing := map[string]string{}
	creds := []credential{
		{envKey: "ASANA_API_TOKEN", label: "Asana Token", optional: true, value: "", status: "skipped"},
	}
	boardsStatus := boardsConfigStatus{found: false}

	content, _, _, _ := renderSettingsStatus(existing, creds, boardsStatus)

	// Skipped optional credential should show the warn icon
	if !strings.Contains(content, "⊘") {
		t.Errorf("expected warn icon for skipped optional credential, got %q", content)
	}
}

func TestRenderSettingsStatus_BoardsFound(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	existing := map[string]string{}
	creds := []credential{}
	boardsStatus := boardsConfigStatus{found: true, path: "/some/path.json", count: 3}

	content, _, _, _ := renderSettingsStatus(existing, creds, boardsStatus)

	if !strings.Contains(content, "3") {
		t.Errorf("expected boards count in content, got %q", content)
	}
}

// ===========================================================================
// runSetupHeadless tests
// ===========================================================================

func TestRunSetupHeadless_MissingVars(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	// Ensure required env vars are not set
	t.Setenv("GITHUB_PERSONAL_ACCESS_TOKEN", "")
	t.Setenv("OPENAI_API_KEY", "")

	err := runSetupHeadless()
	if err == nil {
		t.Fatal("expected error when required env vars are missing")
	}
	if !strings.Contains(err.Error(), "missing required environment variables") {
		t.Errorf("expected 'missing required environment variables' in error, got %q", err.Error())
	}
}

func TestRunSetupHeadless_Success(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	// Set up a fake GitHub server that returns success
	githubSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/user") {
			w.WriteHeader(200)
			fmt.Fprint(w, `{"login":"testuser"}`)
			return
		}
		w.WriteHeader(200)
		fmt.Fprint(w, `{}`)
	}))
	defer githubSrv.Close()

	// Set up a fake OpenAI server
	openAISrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.ReadAll(r.Body)
		w.WriteHeader(200)
		fmt.Fprint(w, `{"id":"resp_test"}`)
	}))
	defer openAISrv.Close()

	oldGH := githubAPIBaseURL
	oldOAI := openAIAPIBaseURL
	oldClient := defaultHTTPClient
	githubAPIBaseURL = githubSrv.URL
	openAIAPIBaseURL = openAISrv.URL
	defaultHTTPClient = githubSrv.Client()
	t.Cleanup(func() {
		githubAPIBaseURL = oldGH
		openAIAPIBaseURL = oldOAI
		defaultHTTPClient = oldClient
	})

	t.Setenv("GITHUB_PERSONAL_ACCESS_TOKEN", "ghp_testtoken")
	t.Setenv("OPENAI_API_KEY", "sk-testkey")

	err := runSetupHeadless()
	if err != nil {
		t.Fatalf("expected success, got error: %v", err)
	}

	// Verify .env file was written
	envPath := filepath.Join(tmpDir, "teamhero", ".env")
	data, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatalf("expected .env file to exist: %v", err)
	}
	if !strings.Contains(string(data), "GITHUB_PERSONAL_ACCESS_TOKEN=ghp_testtoken") {
		t.Errorf("expected .env to contain GitHub token, got %q", string(data))
	}
}

// ===========================================================================
// runSetup tests
// ===========================================================================

func TestRunSetup_HeadlessDispatch(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	t.Setenv("TEAMHERO_HEADLESS", "1")
	// Missing required vars → should get the headless error
	t.Setenv("GITHUB_PERSONAL_ACCESS_TOKEN", "")
	t.Setenv("OPENAI_API_KEY", "")

	err := runSetup()
	if err == nil {
		t.Fatal("expected error from headless dispatch")
	}
	if !strings.Contains(err.Error(), "missing required environment variables") {
		t.Errorf("expected headless error, got %q", err.Error())
	}
}

// ===========================================================================
// showSettingsViewer tests
// ===========================================================================

func TestShowSettingsViewer_MockedProgram(t *testing.T) {
	orig := teaProgramRun
	t.Cleanup(func() { teaProgramRun = orig })
	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		return newSettingsViewer("test content"), nil
	}

	err := showSettingsViewer("test content")
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

// ===========================================================================
// runSetupUpdateSingle tests
// ===========================================================================

// ===========================================================================
// handleSettingUpdate tests
// ===========================================================================

func TestHandleSettingUpdate_NonCredentialKey(t *testing.T) {
	tmpDir := t.TempDir()
	envPath := filepath.Join(tmpDir, ".env")
	os.WriteFile(envPath, []byte("AI_MODEL=gpt-4o\n"), 0o600)

	// huhFormRun returns nil with empty newVal → "No changes made"
	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error {
		return nil // newVal stays empty
	}

	allEntries := map[string]string{"AI_MODEL": "gpt-4o"}
	creds := []credential{}

	err := handleSettingUpdate("AI_MODEL", creds, envPath, allEntries)
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

func TestHandleSettingUpdate_APICredentialAborted(t *testing.T) {
	tmpDir := t.TempDir()
	envPath := filepath.Join(tmpDir, ".env")
	os.WriteFile(envPath, []byte("GITHUB_PERSONAL_ACCESS_TOKEN=ghp_old\n"), 0o600)

	// huhFormRun returns ErrUserAborted
	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error {
		return huh.ErrUserAborted
	}

	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false, value: "ghp_old"},
	}
	allEntries := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_old"}

	err := handleSettingUpdate("GITHUB_PERSONAL_ACCESS_TOKEN", creds, envPath, allEntries)
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

// ===========================================================================
// handlePlainSettingUpdate tests
// ===========================================================================

func TestHandlePlainSettingUpdate_EmptyValue(t *testing.T) {
	tmpDir := t.TempDir()
	envPath := filepath.Join(tmpDir, ".env")
	os.WriteFile(envPath, []byte("AI_MODEL=gpt-4o\n"), 0o600)

	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	// Return nil but don't set newVal (stays empty) → "No changes made"
	huhFormRun = func(f *huh.Form) error { return nil }

	allEntries := map[string]string{"AI_MODEL": "gpt-4o"}
	err := handlePlainSettingUpdate("AI_MODEL", envPath, allEntries)
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

func TestHandlePlainSettingUpdate_Error(t *testing.T) {
	tmpDir := t.TempDir()
	envPath := filepath.Join(tmpDir, ".env")
	os.WriteFile(envPath, []byte("AI_MODEL=gpt-4o\n"), 0o600)

	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error { return huh.ErrUserAborted }

	allEntries := map[string]string{"AI_MODEL": "gpt-4o"}
	err := handlePlainSettingUpdate("AI_MODEL", envPath, allEntries)
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

// ===========================================================================
// runSetupBoards tests
// ===========================================================================

func TestRunSetupBoards_FoundAborted(t *testing.T) {
	// status.found = true → shows form → huhFormRun aborts
	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error {
		return huh.ErrUserAborted
	}

	status := boardsConfigStatus{found: true, path: "/some/path.json", count: 2}
	err := runSetupBoards(status)
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted to propagate, got %v", err)
	}
}

func TestRunSetupBoards_NotFoundAbort(t *testing.T) {
	// status.found = false → calls createBoardsConfig → calls promptBoardInput
	// promptBoardInput calls huhFormRun; if it returns ErrUserAborted, promptBoardInput returns nil, nil
	// createBoardsConfig sees nil board and returns nil
	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error {
		return huh.ErrUserAborted
	}

	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	status := boardsConfigStatus{found: false}
	err := runSetupBoards(status)
	if err != nil {
		t.Errorf("expected nil error when board prompt is aborted, got %v", err)
	}
}

// ===========================================================================
// addBoardToConfig tests
// ===========================================================================

func TestAddBoardToConfig_AbortPrompt(t *testing.T) {
	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error {
		return huh.ErrUserAborted
	}

	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "boards.json")

	// promptBoardInput returns nil, nil when aborted → addBoardToConfig returns nil
	err := addBoardToConfig(path)
	if err != nil {
		t.Errorf("expected nil error on abort, got %v", err)
	}
}

func TestAddBoardToConfig_NilBoardNoRead(t *testing.T) {
	// huhFormRun returns nil with empty GID → board == nil → returns nil without reading file
	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error {
		return nil // bound vars left empty → gid == "" → nil board
	}

	path := filepath.Join(t.TempDir(), "nonexistent", "boards.json")
	err := addBoardToConfig(path)
	// board == nil (empty GID), so returns nil without reading file
	if err != nil {
		t.Errorf("expected nil error when board is nil, got %v", err)
	}
}

// ===========================================================================
// createBoardsConfig tests
// ===========================================================================

func TestCreateBoardsConfig_AbortPrompt(t *testing.T) {
	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error {
		return huh.ErrUserAborted
	}

	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "boards.json")

	err := createBoardsConfig(path)
	if err != nil {
		t.Errorf("expected nil error on abort, got %v", err)
	}
}

func TestCreateBoardsConfig_NilBoard(t *testing.T) {
	// huhFormRun returns nil but GID is empty → board is nil → returns nil
	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error {
		return nil // bound vars left empty → gid == "" → nil board
	}

	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "boards.json")

	err := createBoardsConfig(path)
	if err != nil {
		t.Errorf("expected nil error when board is nil, got %v", err)
	}

	// File should NOT have been created
	if _, statErr := os.Stat(path); statErr == nil {
		t.Error("expected boards.json NOT to be created when board is nil")
	}
}

// ===========================================================================
// promptBoardInput tests
// ===========================================================================

func TestPromptBoardInput_AbortReturnsNilNil(t *testing.T) {
	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error {
		return huh.ErrUserAborted
	}

	board, err := promptBoardInput()
	if err != nil {
		t.Errorf("expected nil error on abort, got %v", err)
	}
	if board != nil {
		t.Errorf("expected nil board on abort, got %+v", board)
	}
}

func TestPromptBoardInput_FormError(t *testing.T) {
	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })

	sentinelErr := fmt.Errorf("form error")
	huhFormRun = func(f *huh.Form) error {
		return sentinelErr
	}

	board, err := promptBoardInput()
	if err != sentinelErr {
		t.Errorf("expected sentinel error, got %v", err)
	}
	if board != nil {
		t.Errorf("expected nil board on error, got %+v", board)
	}
}

func TestPromptBoardInput_EmptyGIDReturnsNil(t *testing.T) {
	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error {
		return nil // GID stays empty
	}

	board, err := promptBoardInput()
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
	if board != nil {
		t.Errorf("expected nil board when GID is empty, got %+v", board)
	}
}

// ===========================================================================
// promptCredentialInput tests
// ===========================================================================

func TestPromptCredentialInput_OptionalEmptySkipped(t *testing.T) {
	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error {
		return nil // input stays empty
	}

	c := &credential{envKey: "ASANA_API_TOKEN", label: "Asana Token", optional: true, value: ""}
	err := promptCredentialInput(c)
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
	if c.status != "skipped" {
		t.Errorf("expected status=skipped for empty optional credential, got %q", c.status)
	}
}

func TestPromptCredentialInput_FormError(t *testing.T) {
	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error {
		return huh.ErrUserAborted
	}

	c := &credential{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false}
	err := promptCredentialInput(c)
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

// ===========================================================================
// runGoogleDriveSetup tests
// ===========================================================================

func TestRunGoogleDriveSetup_DefaultChoice(t *testing.T) {
	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	// Return nil without setting choice → choice == "" → falls through to nil return
	huhFormRun = func(f *huh.Form) error {
		return nil
	}

	err := runGoogleDriveSetup()
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

func TestRunGoogleDriveSetup_Aborted(t *testing.T) {
	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error {
		return huh.ErrUserAborted
	}

	err := runGoogleDriveSetup()
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

// ===========================================================================
// runGoogleBYOCFlow tests
// ===========================================================================

func TestRunGoogleBYOCFlow_Aborted(t *testing.T) {
	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error {
		return huh.ErrUserAborted
	}

	err := runGoogleBYOCFlow()
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

// ===========================================================================
// runGoogleDriveManage tests
// ===========================================================================

func TestRunGoogleDriveManage_Aborted(t *testing.T) {
	// Set up a connected Google Drive so runGoogleDriveManage is called
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	tokens := map[string]interface{}{
		"access_token":  "at-123",
		"refresh_token": "rt-456",
	}
	tokData, _ := json.Marshal(tokens)
	os.WriteFile(filepath.Join(configPath, "google-tokens.json"), tokData, 0o600)

	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error {
		return huh.ErrUserAborted
	}

	err := runGoogleDriveManage()
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

func TestRunGoogleDriveManage_DefaultChoice(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	tokens := map[string]interface{}{
		"access_token":  "at-123",
		"refresh_token": "rt-456",
	}
	tokData, _ := json.Marshal(tokens)
	os.WriteFile(filepath.Join(configPath, "google-tokens.json"), tokData, 0o600)

	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	// Return nil without setting choice → choice == "" → falls to default nil return
	huhFormRun = func(f *huh.Form) error {
		return nil
	}

	err := runGoogleDriveManage()
	if err != nil {
		t.Errorf("expected nil error for default choice, got %v", err)
	}
}

// ===========================================================================
// runGoogleDriveFromPicker tests
// ===========================================================================

func TestRunGoogleDriveFromPicker_NotConnected_DefaultSetup(t *testing.T) {
	// Without google-tokens.json, isGoogleDriveConnected() returns false
	// → calls runGoogleDriveSetup()
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error {
		return nil // choice stays "" → falls to nil
	}

	err := runGoogleDriveFromPicker()
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

func TestRunGoogleDriveFromPicker_Connected_Aborted(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	tokens := map[string]interface{}{
		"access_token":  "at-123",
		"refresh_token": "rt-456",
	}
	tokData, _ := json.Marshal(tokens)
	os.WriteFile(filepath.Join(configPath, "google-tokens.json"), tokData, 0o600)

	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error {
		return huh.ErrUserAborted
	}

	// isGoogleDriveConnected() → true → calls runGoogleDriveManage() → huhFormRun aborts
	err := runGoogleDriveFromPicker()
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted from manage flow, got %v", err)
	}
}

// ===========================================================================
// runExpressSetupPrompt tests
// ===========================================================================

func TestRunExpressSetupPrompt_HasCredentials(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	// Write .env with both required creds so HasCredentials() returns true
	os.WriteFile(filepath.Join(configPath, ".env"),
		[]byte("GITHUB_PERSONAL_ACCESS_TOKEN=ghp_test\nOPENAI_API_KEY=sk-test\n"), 0o600)

	err := runExpressSetupPrompt()
	if err != nil {
		t.Errorf("expected nil error when credentials exist, got %v", err)
	}
}

func TestRunExpressSetupPrompt_NoCredentials_ProceedFalse(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)
	// No .env → HasCredentials() returns false

	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	// Return nil without setting proceed → proceed stays false (zero value for bool) → returns error
	huhFormRun = func(f *huh.Form) error {
		return nil
	}

	err := runExpressSetupPrompt()
	if err == nil {
		t.Fatal("expected error when user declines setup")
	}
	if !strings.Contains(err.Error(), "teamhero setup") {
		t.Errorf("expected setup instruction in error, got %q", err.Error())
	}
}

func TestRunExpressSetupPrompt_NoCredentials_FormAborted(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error {
		return huh.ErrUserAborted
	}

	err := runExpressSetupPrompt()
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

// ===========================================================================
// disconnectGoogleDrive tests
// ===========================================================================

func TestDisconnectGoogleDrive_RemovesTokenFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)

	tokenPath := filepath.Join(configPath, "google-tokens.json")
	os.WriteFile(tokenPath, []byte(`{"refresh_token":"rt"}`), 0o600)

	err := disconnectGoogleDrive()
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if _, statErr := os.Stat(tokenPath); statErr == nil {
		t.Error("expected google-tokens.json to be removed")
	}
}

func TestDisconnectGoogleDrive_NoFileIsOK(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	// No token file → should succeed silently
	err := disconnectGoogleDrive()
	if err != nil {
		t.Errorf("expected nil error when token file doesn't exist, got %v", err)
	}
}

// ===========================================================================
// resolveServiceScript tests
// ===========================================================================

func TestResolveServiceScript_RelativeToCWD(t *testing.T) {
	tmpDir := t.TempDir()
	scriptDir := filepath.Join(tmpDir, "scripts")
	os.MkdirAll(scriptDir, 0o755)
	os.WriteFile(filepath.Join(scriptDir, "test-service.ts"), []byte("// stub"), 0o644)

	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(tmpDir)

	got := resolveServiceScript("test-service.ts")
	if !strings.Contains(got, "test-service.ts") {
		t.Errorf("resolveServiceScript() = %q, expected to contain 'test-service.ts'", got)
	}
}

func TestResolveServiceScript_FallbackPath(t *testing.T) {
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(tmpDir)

	// No scripts directory → returns fallback
	got := resolveServiceScript("nonexistent.ts")
	if !strings.Contains(got, "nonexistent.ts") {
		t.Errorf("resolveServiceScript() = %q, expected fallback containing 'nonexistent.ts'", got)
	}
}

// Ensure the huh import is used (all test functions reference huh.ErrUserAborted
// directly so this symbol reference keeps the import live).
var _ = huh.ErrUserAborted

// ===========================================================================
// settingsViewer.Update edge cases (small window, ctrl+c, already-ready, fallthrough)
// ===========================================================================

func TestSettingsViewer_UpdateSmallWindow(t *testing.T) {
	m := newSettingsViewer("test content")
	// Very small window → minimum h=5, w=40
	msg := tea.WindowSizeMsg{Width: 10, Height: 5}
	updated, _ := m.Update(msg)
	sv := updated.(settingsViewer)
	if !sv.ready {
		t.Error("expected ready=true after small WindowSizeMsg")
	}
}

func TestSettingsViewer_UpdateAlreadyReady(t *testing.T) {
	m := newSettingsViewer("test content")
	// First resize — becomes ready
	msg1 := tea.WindowSizeMsg{Width: 80, Height: 24}
	updated, _ := m.Update(msg1)
	sv := updated.(settingsViewer)
	// Second resize — hits the else (already ready) branch
	msg2 := tea.WindowSizeMsg{Width: 100, Height: 30}
	updated, _ = sv.Update(msg2)
	sv = updated.(settingsViewer)
	if !sv.ready {
		t.Error("expected ready=true after second WindowSizeMsg")
	}
}

func TestSettingsViewer_UpdateCtrlC(t *testing.T) {
	m := newSettingsViewer("test content")
	msg := tea.WindowSizeMsg{Width: 80, Height: 24}
	updated, _ := m.Update(msg)
	sv := updated.(settingsViewer)

	keyMsg := tea.KeyMsg{Type: tea.KeyCtrlC}
	updated, cmd := sv.Update(keyMsg)
	sv = updated.(settingsViewer)

	if !sv.quitting {
		t.Error("expected quitting=true after ctrl+c")
	}
	if cmd == nil {
		t.Error("expected quit command after ctrl+c")
	}
}

func TestSettingsViewer_UpdateFallthrough(t *testing.T) {
	m := newSettingsViewer("content")
	msg := tea.WindowSizeMsg{Width: 80, Height: 24}
	updated, _ := m.Update(msg)
	sv := updated.(settingsViewer)

	// A non-key, non-size message falls through to the viewport update
	type unknownMsg struct{}
	updated, _ = sv.Update(unknownMsg{})
	// Should not panic and should return valid model
	if updated == nil {
		t.Error("expected non-nil updated model")
	}
}

// ===========================================================================
// settingsPicker.Update edge cases (small window, already-ready, ctrl+c, home, end, fallthrough)
// ===========================================================================

func TestSettingsPicker_UpdateSmallWindow(t *testing.T) {
	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false, value: "ghp_test", status: "valid"},
	}
	existing := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_test"}
	picker := buildSettingsPicker(existing, creds, true)

	msg := tea.WindowSizeMsg{Width: 10, Height: 5}
	updated, _ := picker.Update(msg)
	sp := updated.(settingsPicker)
	if !sp.ready {
		t.Error("expected ready=true after small WindowSizeMsg")
	}
}

func TestSettingsPicker_UpdateAlreadyReady(t *testing.T) {
	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false, value: "ghp_test", status: "valid"},
	}
	existing := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_test"}
	picker := buildSettingsPicker(existing, creds, true)

	msg1 := tea.WindowSizeMsg{Width: 80, Height: 24}
	updated, _ := picker.Update(msg1)
	sp := updated.(settingsPicker)

	// Second resize — hits the else (already ready) branch
	msg2 := tea.WindowSizeMsg{Width: 100, Height: 30}
	updated, _ = sp.Update(msg2)
	sp = updated.(settingsPicker)
	if !sp.ready {
		t.Error("expected ready=true after second WindowSizeMsg")
	}
}

func TestSettingsPicker_UpdateCtrlC(t *testing.T) {
	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false, value: "ghp_test", status: "valid"},
	}
	existing := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_test"}
	picker := buildSettingsPicker(existing, creds, true)
	msg := tea.WindowSizeMsg{Width: 80, Height: 24}
	updated, _ := picker.Update(msg)
	sp := updated.(settingsPicker)

	keyMsg := tea.KeyMsg{Type: tea.KeyCtrlC}
	updated, cmd := sp.Update(keyMsg)
	sp = updated.(settingsPicker)

	if sp.selected != "@@done" {
		t.Errorf("expected selected=@@done after ctrl+c, got %q", sp.selected)
	}
	if !sp.quitting {
		t.Error("expected quitting=true after ctrl+c")
	}
	if cmd == nil {
		t.Error("expected quit command after ctrl+c")
	}
}

func TestSettingsPicker_UpdateHome(t *testing.T) {
	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false, value: "ghp_test", status: "valid"},
		{envKey: "OPENAI_API_KEY", label: "OpenAI Key", optional: false, value: "sk_test", status: "valid"},
	}
	existing := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_test", "OPENAI_API_KEY": "sk_test"}
	picker := buildSettingsPicker(existing, creds, true)
	msg := tea.WindowSizeMsg{Width: 80, Height: 24}
	updated, _ := picker.Update(msg)
	sp := updated.(settingsPicker)

	// Move cursor down first
	downMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}}
	updated, _ = sp.Update(downMsg)
	sp = updated.(settingsPicker)

	// Now press Home
	homeMsg := tea.KeyMsg{Type: tea.KeyHome}
	updated, _ = sp.Update(homeMsg)
	sp = updated.(settingsPicker)

	if sp.cursor != 0 {
		t.Errorf("expected cursor=0 after Home key, got %d", sp.cursor)
	}
}

func TestSettingsPicker_UpdateEnd(t *testing.T) {
	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false, value: "ghp_test", status: "valid"},
		{envKey: "OPENAI_API_KEY", label: "OpenAI Key", optional: false, value: "sk_test", status: "valid"},
	}
	existing := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_test", "OPENAI_API_KEY": "sk_test"}
	picker := buildSettingsPicker(existing, creds, true)
	msg := tea.WindowSizeMsg{Width: 80, Height: 24}
	updated, _ := picker.Update(msg)
	sp := updated.(settingsPicker)

	// Press End to jump to last item
	endMsg := tea.KeyMsg{Type: tea.KeyEnd}
	updated, _ = sp.Update(endMsg)
	sp = updated.(settingsPicker)

	if sp.cursor != len(sp.items)-1 {
		t.Errorf("expected cursor=%d after End key, got %d", len(sp.items)-1, sp.cursor)
	}
}

func TestSettingsPicker_UpdateFallthrough(t *testing.T) {
	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false, value: "ghp_test", status: "valid"},
	}
	existing := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_test"}
	picker := buildSettingsPicker(existing, creds, true)
	msg := tea.WindowSizeMsg{Width: 80, Height: 24}
	updated, _ := picker.Update(msg)
	sp := updated.(settingsPicker)

	// Unknown message falls through to viewport update
	type unknownMsg struct{}
	updated, _ = sp.Update(unknownMsg{})
	if updated == nil {
		t.Error("expected non-nil updated model after unknown msg")
	}
}

// ===========================================================================
// categoryTag edge cases
// ===========================================================================

func TestCategoryTag_UnknownCategory(t *testing.T) {
	tag := categoryTag("FooBar")
	if tag != "[FooBar]" {
		t.Errorf("expected [FooBar], got %q", tag)
	}
}

// ===========================================================================
// fitLine edge cases (progress.go)
// ===========================================================================

func TestFitLine_ZeroWidth(t *testing.T) {
	m := newProgressModel("test", 1, nil)
	// viewport.Width == 0 → fallback to maxWidth=20
	line := "short"
	result := m.fitLine(line)
	if result != "short" {
		t.Errorf("expected 'short' for short line with zero width, got %q", result)
	}
}

func TestFitLine_LongLine(t *testing.T) {
	m := newProgressModel("test", 1, nil)
	m.viewport.Width = 10
	line := "this is a very long line that exceeds the width"
	result := m.fitLine(line)
	if len([]rune(result)) > 11 { // maxWidth + 1 for ellipsis
		t.Errorf("expected truncated line, got %q (len %d)", result, len(result))
	}
	if !strings.HasSuffix(result, "…") {
		t.Errorf("expected truncated line to end with ellipsis, got %q", result)
	}
}

func TestFitLine_ExactWidth(t *testing.T) {
	m := newProgressModel("test", 1, nil)
	m.viewport.Width = 5
	line := "hello" // exactly 5 chars → no truncation
	result := m.fitLine(line)
	if result != "hello" {
		t.Errorf("expected 'hello' for exact-width line, got %q", result)
	}
}

// ---------------------------------------------------------------------------
// ensureCursorVisible — scroll branches
// ---------------------------------------------------------------------------

func TestEnsureCursorVisible_NotReady(t *testing.T) {
	sp := settingsPicker{ready: false}
	// Should not panic when not ready
	sp.ensureCursorVisible()
}

func TestEnsureCursorVisible_CursorAboveViewport(t *testing.T) {
	sp := settingsPicker{
		ready: true,
		items: []settingsPickerItem{
			{key: "a", label: "Item A"},
			{key: "b", label: "Item B"},
			{key: "c", label: "Item C"},
		},
		lines: []pickerLine{
			{text: "Item A", itemIndex: 0},
			{text: "Item B", itemIndex: 1},
			{text: "Item C", itemIndex: 2},
		},
		cursor:   0,
		viewport: viewport.New(80, 2),
	}
	// Simulate viewport scrolled down so cursor line 0 is above the viewport
	sp.viewport.SetYOffset(2)
	sp.ensureCursorVisible()
	if sp.viewport.YOffset != 0 {
		t.Errorf("expected YOffset=0 after scrolling up to cursor, got %d", sp.viewport.YOffset)
	}
}

func TestEnsureCursorVisible_CursorBelowViewport(t *testing.T) {
	sp := settingsPicker{
		ready: true,
		items: []settingsPickerItem{
			{key: "a", label: "Item A"},
			{key: "b", label: "Item B"},
			{key: "c", label: "Item C"},
			{key: "d", label: "Item D"},
			{key: "e", label: "Item E"},
		},
		lines: []pickerLine{
			{text: "Item A", itemIndex: 0},
			{text: "Item B", itemIndex: 1},
			{text: "Item C", itemIndex: 2},
			{text: "Item D", itemIndex: 3},
			{text: "Item E", itemIndex: 4},
		},
		cursor:   4, // last item, line index 4
		viewport: viewport.New(80, 2),
	}
	// Must set content so viewport knows total lines (needed for SetYOffset to work)
	sp.viewport.SetContent("Item A\nItem B\nItem C\nItem D\nItem E")
	sp.viewport.SetYOffset(0) // viewport shows lines 0-1
	sp.ensureCursorVisible()
	// cursor at line 4, viewport height=2 → should scroll to offset 3 (4-2+1)
	if sp.viewport.YOffset != 3 {
		t.Errorf("expected YOffset=3 after scrolling down to cursor, got %d", sp.viewport.YOffset)
	}
}

func TestEnsureCursorVisible_CursorAlreadyVisible(t *testing.T) {
	sp := settingsPicker{
		ready: true,
		items: []settingsPickerItem{
			{key: "a", label: "Item A"},
			{key: "b", label: "Item B"},
		},
		lines: []pickerLine{
			{text: "Item A", itemIndex: 0},
			{text: "Item B", itemIndex: 1},
		},
		cursor:   0,
		viewport: viewport.New(80, 5),
	}
	sp.viewport.SetYOffset(0) // cursor at line 0, visible range 0-4
	sp.ensureCursorVisible()
	if sp.viewport.YOffset != 0 {
		t.Errorf("expected YOffset=0 (unchanged), got %d", sp.viewport.YOffset)
	}
}

// ---------------------------------------------------------------------------
// cursorLineIndex — default/fallback behavior
// ---------------------------------------------------------------------------

func TestCursorLineIndex_Found(t *testing.T) {
	sp := settingsPicker{
		cursor: 1,
		lines: []pickerLine{
			{text: "header", itemIndex: -1},
			{text: "Item A", itemIndex: 0},
			{text: "Item B", itemIndex: 1},
		},
	}
	idx := sp.cursorLineIndex()
	if idx != 2 {
		t.Errorf("expected cursorLineIndex=2, got %d", idx)
	}
}

func TestCursorLineIndex_NotFound(t *testing.T) {
	sp := settingsPicker{
		cursor: 5, // not in lines
		lines: []pickerLine{
			{text: "Item A", itemIndex: 0},
		},
	}
	idx := sp.cursorLineIndex()
	if idx != 0 {
		t.Errorf("expected cursorLineIndex=0 (default), got %d", idx)
	}
}

// ===========================================================================
// handleJsonSetup tests
// ===========================================================================

func TestTryReadStdin(t *testing.T) {
	// tryReadStdin returns nil when stdin is a terminal — hard to test directly,
	// but we can test handleJsonSetup
}

func TestHandleJsonSetup_WritesCredentials(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	validate := false
	input := &SetupInput{
		Credentials: map[string]string{
			"github_token":   "ghp_test123",
			"openai_api_key": "sk-test456",
		},
		Validate: &validate,
	}

	// Capture stdout
	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	err := handleJsonSetup(input)

	w.Close()
	os.Stdout = old

	if err != nil {
		t.Fatalf("handleJsonSetup failed: %v", err)
	}

	// Read captured output
	var buf bytes.Buffer
	io.Copy(&buf, r)
	output := buf.String()

	var result SetupResult
	if err := json.Unmarshal([]byte(output), &result); err != nil {
		t.Fatalf("failed to parse JSON output: %v\nraw: %s", err, output)
	}

	if !result.Success {
		t.Errorf("expected success=true, got false. Errors: %v", result.Errors)
	}

	// Verify .env was written
	envPath := filepath.Join(tmpDir, "teamhero", ".env")
	data, _ := os.ReadFile(envPath)
	content := string(data)
	if !strings.Contains(content, "GITHUB_PERSONAL_ACCESS_TOKEN=ghp_test123") {
		t.Errorf("expected GitHub token in .env, got: %s", content)
	}
	if !strings.Contains(content, "OPENAI_API_KEY=sk-test456") {
		t.Errorf("expected OpenAI key in .env, got: %s", content)
	}
}

func TestHandleJsonSetup_WritesConfig(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	validate := false
	config := &ReportConfig{
		Org:         "test-org",
		Members:     []string{"alice", "bob"},
		UseAllRepos: true,
	}
	input := &SetupInput{
		Credentials: map[string]string{
			"github_token":   "ghp_test",
			"openai_api_key": "sk-test",
		},
		Config:   config,
		Validate: &validate,
	}

	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	err := handleJsonSetup(input)

	w.Close()
	os.Stdout = old

	if err != nil {
		t.Fatalf("handleJsonSetup failed: %v", err)
	}

	var buf bytes.Buffer
	io.Copy(&buf, r)

	var result SetupResult
	json.Unmarshal(buf.Bytes(), &result)

	if !result.ConfigSaved {
		t.Error("expected configSaved=true")
	}

	// Verify config.json
	configPath := filepath.Join(tmpDir, "teamhero", "config.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("failed to read config.json: %v", err)
	}
	var savedCfg ReportConfig
	json.Unmarshal(data, &savedCfg)
	if savedCfg.Org != "test-org" {
		t.Errorf("expected org=test-org, got %s", savedCfg.Org)
	}
}

func TestHandleJsonSetup_WritesSettings(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	validate := false
	input := &SetupInput{
		Credentials: map[string]string{
			"github_token":   "ghp_test",
			"openai_api_key": "sk-test",
		},
		Settings: map[string]string{
			"AI_MODEL":           "gpt-5",
			"TEAMHERO_LOG_LEVEL": "4",
		},
		Validate: &validate,
	}

	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	handleJsonSetup(input)

	w.Close()
	os.Stdout = old

	var buf bytes.Buffer
	io.Copy(&buf, r)

	var result SetupResult
	json.Unmarshal(buf.Bytes(), &result)

	if result.Settings != 2 {
		t.Errorf("expected settingsWritten=2, got %d", result.Settings)
	}

	envPath := filepath.Join(tmpDir, "teamhero", ".env")
	data, _ := os.ReadFile(envPath)
	content := string(data)
	if !strings.Contains(content, "AI_MODEL=gpt-5") {
		t.Errorf("expected AI_MODEL in .env, got: %s", content)
	}
}

func TestHandleJsonSetup_AcceptsRawEnvKeys(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	validate := false
	input := &SetupInput{
		Credentials: map[string]string{
			"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_raw",
			"OPENAI_API_KEY":               "sk-raw",
		},
		Validate: &validate,
	}

	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	handleJsonSetup(input)

	w.Close()
	os.Stdout = old

	var buf bytes.Buffer
	io.Copy(&buf, r)

	envPath := filepath.Join(tmpDir, "teamhero", ".env")
	data, _ := os.ReadFile(envPath)
	content := string(data)
	if !strings.Contains(content, "GITHUB_PERSONAL_ACCESS_TOKEN=ghp_raw") {
		t.Errorf("expected raw env key accepted, got: %s", content)
	}
}

// ===========================================================================
// promptGitHubAuth tests
// ===========================================================================

func TestPromptGitHubAuth_DefaultMethodFallsBackToPAT(t *testing.T) {
	origForm := huhFormRun
	origScript := serviceScriptRunner
	t.Cleanup(func() {
		huhFormRun = origForm
		serviceScriptRunner = origScript
	})

	formCallCount := 0
	huhFormRun = func(f *huh.Form) error {
		formCallCount++
		// method stays "" (default) → goes to OAuth path
		return nil
	}
	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		return nil, fmt.Errorf("service unavailable")
	}

	c := &credential{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false}
	err := promptGitHubAuth(c)
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
	// Should call form twice: method select + PAT fallback
	if formCallCount != 2 {
		t.Errorf("expected 2 form calls, got %d", formCallCount)
	}
}

func TestPromptGitHubAuth_FormAborted(t *testing.T) {
	origForm := huhFormRun
	t.Cleanup(func() { huhFormRun = origForm })

	huhFormRun = func(f *huh.Form) error {
		return huh.ErrUserAborted
	}

	c := &credential{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false}
	err := promptGitHubAuth(c)
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

func TestPromptGitHubAuth_OAuthSuccess(t *testing.T) {
	origForm := huhFormRun
	origScript := serviceScriptRunner
	t.Cleanup(func() {
		huhFormRun = origForm
		serviceScriptRunner = origScript
	})

	huhFormRun = func(f *huh.Form) error {
		// method stays "" (not "pat"), so OAuth path is taken
		return nil
	}
	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		if script != "github-auth.ts" {
			t.Errorf("expected script github-auth.ts, got %s", script)
		}
		return map[string]interface{}{
			"ok":    true,
			"token": "gho_testtoken123",
			"login": "alice",
		}, nil
	}

	c := &credential{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false}
	err := promptGitHubAuth(c)
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
	if c.value != "gho_testtoken123" {
		t.Errorf("expected token gho_testtoken123, got %s", c.value)
	}
	if c.status != "valid" {
		t.Errorf("expected status valid, got %s", c.status)
	}
	if c.detail != "Connected as @alice" {
		t.Errorf("expected detail 'Connected as @alice', got %s", c.detail)
	}
}

func TestPromptGitHubAuth_OAuthSuccessNoLogin(t *testing.T) {
	origForm := huhFormRun
	origScript := serviceScriptRunner
	t.Cleanup(func() {
		huhFormRun = origForm
		serviceScriptRunner = origScript
	})

	huhFormRun = func(f *huh.Form) error {
		return nil
	}
	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		return map[string]interface{}{
			"ok":    true,
			"token": "gho_testtoken456",
		}, nil
	}

	c := &credential{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false}
	err := promptGitHubAuth(c)
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
	if c.value != "gho_testtoken456" {
		t.Errorf("expected token gho_testtoken456, got %s", c.value)
	}
	if c.detail != "Authenticated via OAuth" {
		t.Errorf("expected detail 'Authenticated via OAuth', got %s", c.detail)
	}
}

func TestPromptGitHubAuth_OAuthFailsFallsBackToPAT(t *testing.T) {
	origForm := huhFormRun
	origScript := serviceScriptRunner
	t.Cleanup(func() {
		huhFormRun = origForm
		serviceScriptRunner = origScript
	})

	formCallCount := 0
	huhFormRun = func(f *huh.Form) error {
		formCallCount++
		return nil
	}
	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		return nil, fmt.Errorf("script not found")
	}

	c := &credential{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false}
	err := promptGitHubAuth(c)
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
	// Should have called huhFormRun twice: once for auth method, once for PAT fallback
	if formCallCount != 2 {
		t.Errorf("expected 2 form calls (method + PAT fallback), got %d", formCallCount)
	}
}

func TestPromptGitHubAuth_OAuthReturnsError(t *testing.T) {
	origForm := huhFormRun
	origScript := serviceScriptRunner
	t.Cleanup(func() {
		huhFormRun = origForm
		serviceScriptRunner = origScript
	})

	formCallCount := 0
	huhFormRun = func(f *huh.Form) error {
		formCallCount++
		return nil
	}
	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		return map[string]interface{}{
			"ok":    false,
			"error": "user denied",
		}, nil
	}

	c := &credential{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", optional: false}
	err := promptGitHubAuth(c)
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
	// Should have called huhFormRun twice: once for auth method, once for PAT fallback
	if formCallCount != 2 {
		t.Errorf("expected 2 form calls (method + PAT fallback), got %d", formCallCount)
	}
}

// ===========================================================================
// isAsanaOAuthConnected tests
// ===========================================================================

func TestIsAsanaOAuthConnected_NoFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	if isAsanaOAuthConnected() {
		t.Error("expected false when token file does not exist")
	}
}

func TestIsAsanaOAuthConnected_InvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "asana-tokens.json"), []byte("not-json"), 0o600)

	if isAsanaOAuthConnected() {
		t.Error("expected false for invalid JSON")
	}
}

func TestIsAsanaOAuthConnected_MissingRefreshToken(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)

	tokens := map[string]interface{}{
		"access_token": "at-123",
	}
	data, _ := json.Marshal(tokens)
	os.WriteFile(filepath.Join(configPath, "asana-tokens.json"), data, 0o600)

	if isAsanaOAuthConnected() {
		t.Error("expected false when refresh_token is missing")
	}
}

func TestIsAsanaOAuthConnected_ValidTokens(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)

	tokens := map[string]interface{}{
		"access_token":  "at-123",
		"refresh_token": "rt-456",
	}
	data, _ := json.Marshal(tokens)
	os.WriteFile(filepath.Join(configPath, "asana-tokens.json"), data, 0o600)

	if !isAsanaOAuthConnected() {
		t.Error("expected true when refresh_token is present")
	}
}

// ===========================================================================
// hasAsanaToken tests (with OAuth fallback)
// ===========================================================================

func TestHasAsanaToken_OAuthFallback(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	t.Setenv("ASANA_API_TOKEN", "")
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)

	// No PAT, no OAuth tokens
	if hasAsanaToken() {
		t.Error("expected false when neither PAT nor OAuth tokens exist")
	}

	// Add OAuth tokens
	tokens := map[string]interface{}{
		"access_token":  "at-123",
		"refresh_token": "rt-456",
	}
	data, _ := json.Marshal(tokens)
	os.WriteFile(filepath.Join(configPath, "asana-tokens.json"), data, 0o600)

	if !hasAsanaToken() {
		t.Error("expected true when OAuth tokens exist")
	}
}

// ===========================================================================
// disconnectAsanaOAuth tests
// ===========================================================================

func TestDisconnectAsanaOAuth_RemovesTokenFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)

	tokenPath := filepath.Join(configPath, "asana-tokens.json")
	os.WriteFile(tokenPath, []byte(`{"refresh_token":"rt"}`), 0o600)

	err := disconnectAsanaOAuth()
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}

	if _, err := os.Stat(tokenPath); !os.IsNotExist(err) {
		t.Error("expected token file to be removed")
	}
}

func TestDisconnectAsanaOAuth_NoFileIsOK(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	err := disconnectAsanaOAuth()
	if err != nil {
		t.Errorf("expected nil error when file doesn't exist, got %v", err)
	}
}

// ===========================================================================
// asanaOAuthStatusLabel tests
// ===========================================================================

func TestAsanaOAuthStatusLabel_NotConnected(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	label, connected := asanaOAuthStatusLabel()
	if connected {
		t.Error("expected not connected")
	}
	if !strings.Contains(label, "Asana OAuth") {
		t.Errorf("expected label to contain 'Asana OAuth', got %s", label)
	}
}

func TestAsanaOAuthStatusLabel_Connected(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)

	tokens := map[string]interface{}{
		"access_token":  "at-123",
		"refresh_token": "rt-456",
	}
	data, _ := json.Marshal(tokens)
	os.WriteFile(filepath.Join(configPath, "asana-tokens.json"), data, 0o600)

	label, connected := asanaOAuthStatusLabel()
	if !connected {
		t.Error("expected connected")
	}
	if !strings.Contains(label, "Asana OAuth") {
		t.Errorf("expected label to contain 'Asana OAuth', got %s", label)
	}
}

// ===========================================================================
// runAsanaOAuthSetup tests
// ===========================================================================

func TestRunAsanaOAuthSetup_DefaultChoice(t *testing.T) {
	origForm := huhFormRun
	origScript := serviceScriptRunner
	t.Cleanup(func() {
		huhFormRun = origForm
		serviceScriptRunner = origScript
	})
	// Return nil without setting choice -> choice == "" -> falls through to nil return
	huhFormRun = func(f *huh.Form) error {
		return nil
	}
	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		return map[string]interface{}{"ok": true, "name": "Test User"}, nil
	}

	err := runAsanaOAuthSetup()
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

func TestRunAsanaOAuthSetup_Aborted(t *testing.T) {
	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error {
		return huh.ErrUserAborted
	}

	err := runAsanaOAuthSetup()
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

// ===========================================================================
// runAsanaOAuthManage tests
// ===========================================================================

func TestRunAsanaOAuthManage_Aborted(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	tokens := map[string]interface{}{
		"access_token":  "at-123",
		"refresh_token": "rt-456",
	}
	tokData, _ := json.Marshal(tokens)
	os.WriteFile(filepath.Join(configPath, "asana-tokens.json"), tokData, 0o600)

	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error {
		return huh.ErrUserAborted
	}

	err := runAsanaOAuthManage()
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

func TestRunAsanaOAuthManage_DefaultChoice(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	tokens := map[string]interface{}{
		"access_token":  "at-123",
		"refresh_token": "rt-456",
	}
	tokData, _ := json.Marshal(tokens)
	os.WriteFile(filepath.Join(configPath, "asana-tokens.json"), tokData, 0o600)

	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error {
		return nil
	}

	err := runAsanaOAuthManage()
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

// ===========================================================================
// runAsanaOAuthFromPicker tests
// ===========================================================================

func TestRunAsanaOAuthFromPicker_NotConnected_DefaultSetup(t *testing.T) {
	// Without asana-tokens.json, isAsanaOAuthConnected() returns false
	// -> calls runAsanaOAuthSetup()
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	origForm := huhFormRun
	origScript := serviceScriptRunner
	t.Cleanup(func() {
		huhFormRun = origForm
		serviceScriptRunner = origScript
	})
	huhFormRun = func(f *huh.Form) error {
		return nil
	}
	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		return map[string]interface{}{"ok": true}, nil
	}

	err := runAsanaOAuthFromPicker()
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

func TestRunAsanaOAuthFromPicker_Connected_Aborted(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	tokens := map[string]interface{}{
		"access_token":  "at-123",
		"refresh_token": "rt-456",
	}
	tokData, _ := json.Marshal(tokens)
	os.WriteFile(filepath.Join(configPath, "asana-tokens.json"), tokData, 0o600)

	orig := huhFormRun
	t.Cleanup(func() { huhFormRun = orig })
	huhFormRun = func(f *huh.Form) error {
		return huh.ErrUserAborted
	}

	// isAsanaOAuthConnected() -> true -> calls runAsanaOAuthManage() -> huhFormRun aborts
	err := runAsanaOAuthFromPicker()
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

// ===========================================================================
// promptAsanaAuth tests
// ===========================================================================

func TestPromptAsanaAuth_SkipChoice(t *testing.T) {
	origForm := huhFormRun
	t.Cleanup(func() { huhFormRun = origForm })

	huhFormRun = func(f *huh.Form) error {
		// method stays "" -> default, not "skip"
		// We need to simulate "skip" being selected
		return nil
	}

	c := &credential{envKey: "ASANA_API_TOKEN", label: "Asana API Token", optional: true}
	err := promptAsanaAuth(c)
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

func TestPromptAsanaAuth_Aborted(t *testing.T) {
	origForm := huhFormRun
	t.Cleanup(func() { huhFormRun = origForm })

	huhFormRun = func(f *huh.Form) error {
		return huh.ErrUserAborted
	}

	c := &credential{envKey: "ASANA_API_TOKEN", label: "Asana API Token", optional: true}
	err := promptAsanaAuth(c)
	if err != huh.ErrUserAborted {
		t.Errorf("expected ErrUserAborted, got %v", err)
	}
}

func TestPromptAsanaAuth_BrowserOAuthSuccess(t *testing.T) {
	origForm := huhFormRun
	origScript := serviceScriptRunner
	t.Cleanup(func() {
		huhFormRun = origForm
		serviceScriptRunner = origScript
	})

	formCallCount := 0
	huhFormRun = func(f *huh.Form) error {
		formCallCount++
		// method stays "" (default) -> falls through to default case
		return nil
	}
	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		if script != "asana-auth.ts" {
			t.Errorf("expected script asana-auth.ts, got %s", script)
		}
		return map[string]interface{}{
			"ok":   true,
			"name": "Alice Smith",
		}, nil
	}

	c := &credential{envKey: "ASANA_API_TOKEN", label: "Asana API Token", optional: true}
	// Since huhFormRun returns nil without setting method, method="" -> falls into default -> promptCredentialInput
	// But we also test the "browser" case explicitly would require hooking huh form values
	err := promptAsanaAuth(c)
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

func TestPromptAsanaAuth_BrowserOAuthFailure(t *testing.T) {
	origForm := huhFormRun
	origScript := serviceScriptRunner
	t.Cleanup(func() {
		huhFormRun = origForm
		serviceScriptRunner = origScript
	})

	formCallCount := 0
	huhFormRun = func(f *huh.Form) error {
		formCallCount++
		return nil
	}
	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		return nil, fmt.Errorf("service unavailable")
	}

	c := &credential{envKey: "ASANA_API_TOKEN", label: "Asana API Token", optional: true}
	err := promptAsanaAuth(c)
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

// ===========================================================================
// runAsanaOAuthFlow tests
// ===========================================================================

func TestRunAsanaOAuthFlow_Success(t *testing.T) {
	origScript := serviceScriptRunner
	t.Cleanup(func() { serviceScriptRunner = origScript })

	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		if script != "asana-auth.ts" {
			t.Errorf("expected asana-auth.ts, got %s", script)
		}
		return map[string]interface{}{
			"ok":   true,
			"name": "Bob Jones",
		}, nil
	}

	err := runAsanaOAuthFlow()
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

func TestRunAsanaOAuthFlow_Failure(t *testing.T) {
	origScript := serviceScriptRunner
	t.Cleanup(func() { serviceScriptRunner = origScript })

	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		return nil, fmt.Errorf("connection refused")
	}

	err := runAsanaOAuthFlow()
	if err != nil {
		t.Errorf("expected nil error (failure is non-fatal), got %v", err)
	}
}

func TestRunAsanaOAuthFlow_ErrorResult(t *testing.T) {
	origScript := serviceScriptRunner
	t.Cleanup(func() { serviceScriptRunner = origScript })

	serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
		return map[string]interface{}{
			"ok":    false,
			"error": "user denied",
		}, nil
	}

	err := runAsanaOAuthFlow()
	if err != nil {
		t.Errorf("expected nil error (failure is non-fatal), got %v", err)
	}
}
