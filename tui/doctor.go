package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
)

// HTTPDoer is satisfied by *http.Client (and by test mocks).
type HTTPDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

// Package-level API base URLs — overridable in tests via httptest.
var (
	githubAPIBaseURL = "https://api.github.com"
	openAIAPIBaseURL = "https://api.openai.com"
	asanaAPIBaseURL  = "https://app.asana.com/api/1.0"
)

// defaultHTTPClient is the HTTP client used by doctor and setup checks.
// Override in tests to inject a mock.
var defaultHTTPClient HTTPDoer = &http.Client{Timeout: 5 * time.Second}

// DoctorCheck represents a single diagnostic check result.
type DoctorCheck struct {
	Name     string  `json:"name"`
	Category string  `json:"category"`
	Passed   bool    `json:"passed"`
	Warning  bool    `json:"warning,omitempty"`
	Message  string  `json:"message"`
	Detail   *string `json:"detail"`
}

// DoctorResult is the structured JSON output from `teamhero doctor`.
type DoctorResult struct {
	Version string        `json:"version"`
	Healthy bool          `json:"healthy"`
	Checks  []DoctorCheck `json:"checks"`
}

// runDoctor executes all doctor checks and outputs results.
// Returns exit code: 0 = healthy, 1 = unhealthy.
//
// Output modes:
//   - Default: human-readable checklist on stdout.
//   - --format json: structured JSON on stdout (machine-parseable).
//   - Headless: same as --format json (auto-detected).
func runDoctor() int {
	checks := []DoctorCheck{}

	// --- Category: files ---
	checks = append(checks, checkConfigFile())
	checks = append(checks, checkEnvFile()...)
	checks = append(checks, checkEnvPermissions())

	// --- Category: credentials ---
	envCreds := loadExistingCredentials(filepath.Join(configDir(), ".env"))
	checks = append(checks, checkGitHubToken(envCreds))
	checks = append(checks, checkGitHubOrg(envCreds))
	checks = append(checks, checkOpenAIKey(envCreds))
	checks = append(checks, checkAsanaToken(envCreds))
	checks = append(checks, checkGoogleDriveAuth())

	// --- Category: directories ---
	checks = append(checks, checkOutputDirectory())
	// Log directory check removed — TS log writers auto-create ./logs/ via mkdir(recursive).

	// Compute health
	healthy := true
	passed := 0
	failed := 0
	warnings := 0
	for _, c := range checks {
		if c.Warning {
			warnings++
		} else if c.Passed {
			passed++
		} else {
			failed++
			healthy = false
		}
	}

	// Check --format flag (may be in flagFormat if parsed, or in os.Args if after subcommand).
	jsonMode := strings.EqualFold(*flagFormat, "json") || containsArg(os.Args, "--format=json")
	// Also check for "--format json" as two separate args after the subcommand.
	for i, arg := range os.Args {
		if (arg == "--format" || arg == "-format") && i+1 < len(os.Args) && strings.EqualFold(os.Args[i+1], "json") {
			jsonMode = true
			break
		}
	}

	if jsonMode {
		// JSON-only output on stdout for machine consumption.
		result := DoctorResult{
			Version: version,
			Healthy: healthy,
			Checks:  checks,
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		enc.Encode(result)
	} else {
		// Styled human-readable checklist (matches TUI color scheme).
		passStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))  // green
		failStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("9"))   // red
		warnStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("11"))  // yellow
		dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))  // dim

		fmt.Println(renderShellHeader(termWidth()))
		fmt.Println()
		for _, c := range checks {
			var icon string
			if c.Warning {
				icon = warnStyle.Render("⚠")
			} else if c.Passed {
				icon = passStyle.Render("✔")
			} else {
				icon = failStyle.Render("✖")
			}
			fmt.Printf("  %s %s\n", icon, c.Message)
			if c.Detail != nil && !c.Passed {
				fmt.Printf("    %s\n", dimStyle.Render(*c.Detail))
			}
		}
		fmt.Println()
		if healthy {
			fmt.Printf("  %s\n\n", passStyle.Render(fmt.Sprintf("All checks passed. (%d passed, %d warnings)", passed, warnings)))
		} else {
			fmt.Printf("  %s\n\n", failStyle.Render(fmt.Sprintf("%d checks: %d passed, %d failed, %d warnings", len(checks), passed, failed, warnings)))
		}
	}

	if healthy {
		return 0
	}
	return 1
}

func strPtr(s string) *string {
	return &s
}

// --- File checks ---

func checkConfigFile() DoctorCheck {
	path := filepath.Join(configDir(), "config.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return DoctorCheck{
			Name:     "config_file",
			Category: "files",
			Passed:   false,
			Message:  "Config file: not found",
			Detail:   strPtr("Run `teamhero report` interactively to create config.json"),
		}
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return DoctorCheck{
			Name:     "config_file",
			Category: "files",
			Passed:   false,
			Message:  "Config file: invalid JSON",
			Detail:   strPtr(err.Error()),
		}
	}

	return DoctorCheck{
		Name:     "config_file",
		Category: "files",
		Passed:   true,
		Message:  "Config file: found and valid",
		Detail:   nil,
	}
}

func checkEnvFile() []DoctorCheck {
	path := filepath.Join(configDir(), ".env")
	checks := []DoctorCheck{}

	if _, err := os.Stat(path); os.IsNotExist(err) {
		checks = append(checks, DoctorCheck{
			Name:     "env_file",
			Category: "files",
			Passed:   false,
			Message:  "Credential file: not found",
			Detail:   strPtr("Run `teamhero setup` to create credentials"),
		})
		return checks
	}

	checks = append(checks, DoctorCheck{
		Name:     "env_file",
		Category: "files",
		Passed:   true,
		Message:  fmt.Sprintf("Credential file: %s", path),
		Detail:   nil,
	})

	creds := loadExistingCredentials(path)

	// Check required keys
	requiredKeys := []string{"GITHUB_PERSONAL_ACCESS_TOKEN", "OPENAI_API_KEY"}
	for _, key := range requiredKeys {
		if val, ok := creds[key]; ok && val != "" {
			checks = append(checks, DoctorCheck{
				Name:     "env_key_" + key,
				Category: "files",
				Passed:   true,
				Message:  fmt.Sprintf("Credential key %s: present", key),
				Detail:   nil,
			})
		} else {
			checks = append(checks, DoctorCheck{
				Name:     "env_key_" + key,
				Category: "files",
				Passed:   false,
				Message:  fmt.Sprintf("Credential key %s: missing", key),
				Detail:   strPtr("Run `teamhero setup` to configure"),
			})
		}
	}

	return checks
}

func checkEnvPermissions() DoctorCheck {
	if runtime.GOOS == "windows" {
		return DoctorCheck{
			Name:     "env_permissions",
			Category: "files",
			Passed:   true,
			Warning:  true,
			Message:  "Permissions check: skipped (Windows)",
			Detail:   nil,
		}
	}

	path := filepath.Join(configDir(), ".env")
	info, err := os.Stat(path)
	if err != nil {
		return DoctorCheck{
			Name:     "env_permissions",
			Category: "files",
			Passed:   true,
			Warning:  true,
			Message:  "Permissions check: skipped (file not found)",
			Detail:   nil,
		}
	}

	mode := info.Mode().Perm()
	if mode == 0o600 {
		return DoctorCheck{
			Name:     "env_permissions",
			Category: "files",
			Passed:   true,
			Message:  "Credential file permissions: 600 (secure)",
			Detail:   nil,
		}
	}

	return DoctorCheck{
		Name:     "env_permissions",
		Category: "files",
		Passed:   false,
		Message:  fmt.Sprintf("Credential file permissions: %o (should be 600)", mode),
		Detail:   strPtr(fmt.Sprintf("Run: chmod 600 %s", path)),
	}
}

// --- Credential checks ---

func checkGitHubToken(creds map[string]string) DoctorCheck {
	return checkGitHubTokenWith(creds, defaultHTTPClient)
}

func checkGitHubTokenWith(creds map[string]string, client HTTPDoer) DoctorCheck {
	token := creds["GITHUB_PERSONAL_ACCESS_TOKEN"]
	if token == "" {
		return DoctorCheck{
			Name:     "github_token",
			Category: "credentials",
			Passed:   false,
			Message:  "GitHub: token not configured",
			Detail:   strPtr("Run `teamhero setup` to add your GitHub token"),
		}
	}

	req, _ := http.NewRequest("GET", githubAPIBaseURL+"/user", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := client.Do(req)
	if err != nil {
		return DoctorCheck{
			Name:     "github_token",
			Category: "credentials",
			Passed:   false,
			Message:  "GitHub: connection failed",
			Detail:   strPtr("Check your network connection"),
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return DoctorCheck{
			Name:     "github_token",
			Category: "credentials",
			Passed:   false,
			Message:  "GitHub: token invalid or expired",
			Detail:   strPtr("Run `teamhero setup` to update your GitHub token"),
		}
	}

	var user struct {
		Login string `json:"login"`
	}
	json.NewDecoder(resp.Body).Decode(&user)

	msg := "GitHub: authenticated"
	if user.Login != "" {
		msg = fmt.Sprintf("GitHub: Connected as @%s", user.Login)
	}

	return DoctorCheck{
		Name:     "github_token",
		Category: "credentials",
		Passed:   true,
		Message:  msg,
		Detail:   nil,
	}
}

func checkGitHubOrg(creds map[string]string) DoctorCheck {
	cfg, err := LoadSavedConfig()
	org := ""
	if err == nil && cfg != nil {
		org = cfg.Org
	}
	return checkGitHubOrgWith(creds, org, defaultHTTPClient)
}

func checkGitHubOrgWith(creds map[string]string, org string, client HTTPDoer) DoctorCheck {
	if org == "" {
		return DoctorCheck{
			Name:     "github_org",
			Category: "credentials",
			Passed:   true,
			Warning:  true,
			Message:  "GitHub org: no org configured (run report interactively first)",
			Detail:   nil,
		}
	}

	token := creds["GITHUB_PERSONAL_ACCESS_TOKEN"]
	if token == "" {
		return DoctorCheck{
			Name:     "github_org",
			Category: "credentials",
			Passed:   true,
			Warning:  true,
			Message:  "GitHub org: skipped (no token)",
			Detail:   nil,
		}
	}

	req, _ := http.NewRequest("GET", fmt.Sprintf(githubAPIBaseURL+"/orgs/%s", org), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := client.Do(req)
	if err != nil {
		return DoctorCheck{
			Name:     "github_org",
			Category: "credentials",
			Passed:   false,
			Message:  fmt.Sprintf("GitHub org: connection failed for %s", org),
			Detail:   strPtr("Check your network connection"),
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return DoctorCheck{
			Name:     "github_org",
			Category: "credentials",
			Passed:   false,
			Message:  fmt.Sprintf("GitHub org: cannot access %s", org),
			Detail:   strPtr("Check PAT scopes — needs read:org permission"),
		}
	}

	return DoctorCheck{
		Name:     "github_org",
		Category: "credentials",
		Passed:   true,
		Message:  fmt.Sprintf("GitHub org: %s accessible", org),
		Detail:   nil,
	}
}

func checkOpenAIKey(creds map[string]string) DoctorCheck {
	return checkOpenAIKeyWith(creds, defaultHTTPClient)
}

func checkOpenAIKeyWith(creds map[string]string, client HTTPDoer) DoctorCheck {
	key := creds["OPENAI_API_KEY"]
	if key == "" {
		return DoctorCheck{
			Name:     "openai_key",
			Category: "credentials",
			Passed:   false,
			Message:  "OpenAI: API key not configured",
			Detail:   strPtr("Run `teamhero setup` to add your OpenAI key"),
		}
	}

	body := `{"model":"gpt-4o-mini","input":"test","max_output_tokens":1}`
	req, _ := http.NewRequest("POST", openAIAPIBaseURL+"/v1/responses", nil)
	req.Body = nopCloser{strings.NewReader(body)}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return DoctorCheck{
			Name:     "openai_key",
			Category: "credentials",
			Passed:   false,
			Message:  "OpenAI: connection failed",
			Detail:   strPtr("Check your network connection"),
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode == 401 {
		return DoctorCheck{
			Name:     "openai_key",
			Category: "credentials",
			Passed:   false,
			Message:  "OpenAI: API key invalid or expired",
			Detail:   strPtr("Run `teamhero setup` to update your OpenAI key"),
		}
	}

	return DoctorCheck{
		Name:     "openai_key",
		Category: "credentials",
		Passed:   true,
		Message:  "OpenAI: API key valid",
		Detail:   nil,
	}
}

func checkAsanaToken(creds map[string]string) DoctorCheck {
	return checkAsanaTokenWith(creds, defaultHTTPClient)
}

func checkAsanaTokenWith(creds map[string]string, client HTTPDoer) DoctorCheck {
	token := creds["ASANA_API_TOKEN"]
	if token == "" {
		return DoctorCheck{
			Name:     "asana_token",
			Category: "credentials",
			Passed:   true,
			Warning:  true,
			Message:  "Asana: not configured (optional)",
			Detail:   nil,
		}
	}

	req, _ := http.NewRequest("GET", asanaAPIBaseURL+"/users/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := client.Do(req)
	if err != nil {
		return DoctorCheck{
			Name:     "asana_token",
			Category: "credentials",
			Passed:   false,
			Message:  "Asana: connection failed",
			Detail:   strPtr("Check your network connection"),
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return DoctorCheck{
			Name:     "asana_token",
			Category: "credentials",
			Passed:   false,
			Message:  "Asana: token invalid or expired",
			Detail:   strPtr("Run `teamhero setup` to update your Asana token"),
		}
	}

	var result struct {
		Data struct {
			Name string `json:"name"`
		} `json:"data"`
	}
	json.NewDecoder(resp.Body).Decode(&result)

	msg := "Asana: authenticated"
	if result.Data.Name != "" {
		msg = fmt.Sprintf("Asana: Connected as %s", result.Data.Name)
	}

	return DoctorCheck{
		Name:     "asana_token",
		Category: "credentials",
		Passed:   true,
		Message:  msg,
		Detail:   nil,
	}
}

func checkGoogleDriveAuth() DoctorCheck {
	tokenPath := filepath.Join(configDir(), "google-tokens.json")
	if _, err := os.Stat(tokenPath); os.IsNotExist(err) {
		return DoctorCheck{
			Name:     "google_drive",
			Category: "credentials",
			Passed:   true,
			Warning:  true,
			Message:  "Google Drive: not configured (optional)",
			Detail:   strPtr("Run `teamhero setup` to connect Google Drive for meeting notes"),
		}
	}

	// Token file exists — basic validation
	data, err := os.ReadFile(tokenPath)
	if err != nil {
		return DoctorCheck{
			Name:     "google_drive",
			Category: "credentials",
			Passed:   false,
			Message:  "Google Drive: token file unreadable",
			Detail:   strPtr(err.Error()),
		}
	}

	var tokens map[string]interface{}
	if err := json.Unmarshal(data, &tokens); err != nil {
		return DoctorCheck{
			Name:     "google_drive",
			Category: "credentials",
			Passed:   false,
			Message:  "Google Drive: invalid token file",
			Detail:   strPtr("Run `teamhero setup` to reconnect Google Drive"),
		}
	}

	if _, ok := tokens["refresh_token"]; !ok {
		return DoctorCheck{
			Name:     "google_drive",
			Category: "credentials",
			Passed:   false,
			Message:  "Google Drive: missing refresh token",
			Detail:   strPtr("Run `teamhero setup` to reconnect Google Drive"),
		}
	}

	return DoctorCheck{
		Name:     "google_drive",
		Category: "credentials",
		Passed:   true,
		Message:  "Google Drive: configured",
		Detail:   nil,
	}
}

// --- Directory checks ---

func checkOutputDirectory() DoctorCheck {
	cwd, _ := os.Getwd()
	testFile := filepath.Join(cwd, ".teamhero-doctor-test")

	f, err := os.Create(testFile)
	if err != nil {
		return DoctorCheck{
			Name:     "output_directory",
			Category: "directories",
			Passed:   false,
			Message:  "Output directory: not writable",
			Detail:   strPtr(fmt.Sprintf("Cannot write to %s", cwd)),
		}
	}
	f.Close()
	os.Remove(testFile)

	return DoctorCheck{
		Name:     "output_directory",
		Category: "directories",
		Passed:   true,
		Message:  "Output directory: writable",
		Detail:   nil,
	}
}


// nopCloser wraps a strings.Reader to implement io.ReadCloser.
type nopCloser struct {
	*strings.Reader
}

func (nopCloser) Close() error { return nil }
