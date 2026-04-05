package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
)

// credential holds a single API credential with its validation state.
type credential struct {
	envKey   string
	label    string
	value    string
	optional bool
	status   string // "valid", "invalid", "unchecked", "skipped"
	detail   string // e.g., "Connected as @username"
}

// runSetup handles the `teamhero setup` command.
// In interactive mode, prompts for each credential with Huh? forms.
// In headless mode, reads credentials from environment variables.
func runSetup() error {
	if isHeadless() {
		return runSetupHeadless()
	}
	return runSetupInteractive()
}

// SetupInput is the JSON schema for headless setup via stdin.
type SetupInput struct {
	Credentials map[string]string `json:"credentials,omitempty"`
	Settings    map[string]string `json:"settings,omitempty"`
	Config      *ReportConfig     `json:"config,omitempty"`
	Validate    *bool             `json:"validate,omitempty"`
}

// SetupResult is the structured JSON output for headless setup.
type SetupResult struct {
	Success     bool               `json:"success"`
	Credentials []CredentialResult `json:"credentials"`
	Settings    int                `json:"settingsWritten,omitempty"`
	ConfigSaved bool               `json:"configSaved,omitempty"`
	Errors      []string           `json:"errors,omitempty"`
}

// CredentialResult reports the validation status of a single credential.
type CredentialResult struct {
	Key    string `json:"key"`
	Status string `json:"status"` // "valid", "invalid", "skipped", "unchecked"
	Detail string `json:"detail,omitempty"`
}

// tryReadStdin checks whether stdin has piped JSON data and parses it.
// Returns nil if stdin is a terminal or contains no valid JSON.
func tryReadStdin() *SetupInput {
	stat, _ := os.Stdin.Stat()
	if (stat.Mode() & os.ModeCharDevice) != 0 {
		return nil // stdin is a terminal, no piped data
	}
	data, err := io.ReadAll(os.Stdin)
	if err != nil || len(bytes.TrimSpace(data)) == 0 {
		return nil
	}
	var input SetupInput
	if err := json.Unmarshal(data, &input); err != nil {
		return nil
	}
	return &input
}

// handleJsonSetup processes a SetupInput from stdin, writes credentials/settings/config,
// and outputs a structured SetupResult as JSON to stdout.
func handleJsonSetup(input *SetupInput) error {
	envPath := filepath.Join(configDir(), ".env")
	existing := loadExistingCredentials(envPath)

	// Map friendly credential names to env keys
	credKeyMap := map[string]string{
		"github_token":    "GITHUB_PERSONAL_ACCESS_TOKEN",
		"openai_api_key":  "OPENAI_API_KEY",
		"asana_api_token": "ASANA_API_TOKEN",
	}

	// Build credential list
	var creds []credential
	for inputKey, envKey := range credKeyMap {
		val := ""
		if input.Credentials != nil {
			val = input.Credentials[inputKey]
		}
		// Also accept the raw env key name
		if val == "" && input.Credentials != nil {
			val = input.Credentials[envKey]
		}
		// Overlay on existing
		if val == "" {
			val = existing[envKey]
		}
		// Also check env vars
		if val == "" {
			val = os.Getenv(envKey)
		}
		optional := envKey == "ASANA_API_TOKEN"
		creds = append(creds, credential{envKey: envKey, label: envKey, value: val, optional: optional})
	}

	// Validate if requested (default: true)
	shouldValidate := input.Validate == nil || *input.Validate
	if shouldValidate {
		client := &http.Client{Timeout: 15 * time.Second}
		for i := range creds {
			if creds[i].value == "" {
				if creds[i].optional {
					creds[i].status = "skipped"
				} else {
					creds[i].status = "invalid"
					creds[i].detail = "missing"
				}
				continue
			}
			switch creds[i].envKey {
			case "GITHUB_PERSONAL_ACCESS_TOKEN":
				validateGitHub(client, &creds[i])
			case "OPENAI_API_KEY":
				validateOpenAI(client, &creds[i])
			case "ASANA_API_TOKEN":
				validateAsana(client, &creds[i])
			}
		}
	} else {
		for i := range creds {
			if creds[i].value != "" {
				creds[i].status = "unchecked"
			} else if creds[i].optional {
				creds[i].status = "skipped"
			}
		}
	}

	// Write credentials
	writeEnvFile(envPath, creds)

	// Write additional settings
	settingsWritten := 0
	if input.Settings != nil {
		for key, value := range input.Settings {
			if err := updateEnvKey(envPath, key, value); err == nil {
				settingsWritten++
			}
		}
	}

	// Write config.json if provided
	configSaved := false
	if input.Config != nil {
		if err := SaveConfig(input.Config); err == nil {
			configSaved = true
		}
	}

	// Build result
	result := SetupResult{
		Success:     true,
		Settings:    settingsWritten,
		ConfigSaved: configSaved,
	}
	for _, c := range creds {
		cr := CredentialResult{Key: c.envKey, Status: c.status, Detail: c.detail}
		result.Credentials = append(result.Credentials, cr)
		if c.status == "invalid" && !c.optional {
			result.Success = false
		}
	}
	if !result.Success {
		var missing []string
		for _, c := range creds {
			if c.status == "invalid" && !c.optional {
				missing = append(missing, c.envKey)
			}
		}
		result.Errors = append(result.Errors, "missing or invalid: "+strings.Join(missing, ", "))
	}

	// Output structured JSON to stdout
	out, _ := json.MarshalIndent(result, "", "  ")
	fmt.Println(string(out))
	return nil
}

// runSetupHeadless reads credentials from environment variables and writes them
// to the credential file. This enables CI/automation provisioning.
// If JSON is piped to stdin, it uses the structured JSON input instead.
//
// Environment variables checked (fallback when no JSON on stdin):
//
//	GITHUB_TOKEN (or GITHUB_PERSONAL_ACCESS_TOKEN)
//	OPENAI_API_KEY
//	ASANA_API_TOKEN (optional)
//	ASANA_WORKSPACE_GID (optional)
func runSetupHeadless() error {
	stdinInput := tryReadStdin()
	if stdinInput != nil {
		return handleJsonSetup(stdinInput)
	}

	envPath := filepath.Join(configDir(), ".env")
	existing := loadExistingCredentials(envPath)

	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub Personal Access Token", optional: false},
		{envKey: "OPENAI_API_KEY", label: "OpenAI API Key", optional: false},
		{envKey: "ASANA_API_TOKEN", label: "Asana API Token", optional: true},
	}

	// Read from existing file first, then overlay from env vars
	for i := range creds {
		if val, ok := existing[creds[i].envKey]; ok && val != "" {
			creds[i].value = val
		}
		if envVal := os.Getenv(creds[i].envKey); envVal != "" {
			creds[i].value = envVal
		}
	}

	// Check required credentials are present
	missing := []string{}
	for _, c := range creds {
		if !c.optional && c.value == "" {
			missing = append(missing, c.envKey)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing required environment variables: %s", strings.Join(missing, ", "))
	}

	// Validate
	fmt.Fprintln(os.Stderr, "Validating credentials...")
	validateCredentials(creds)

	hasFailure := false
	for _, c := range creds {
		if c.status == "invalid" {
			hasFailure = true
			fmt.Fprintf(os.Stderr, "✗ %s: %s\n", c.label, c.detail)
		} else if c.status == "skipped" {
			fmt.Fprintf(os.Stderr, "⊘ %s: skipped\n", c.label)
		} else {
			fmt.Fprintf(os.Stderr, "✓ %s: %s\n", c.label, c.detail)
		}
	}

	// Write .env file even if some validation fails (user may fix network later)
	if err := writeEnvFile(envPath, creds); err != nil {
		return fmt.Errorf("failed to write credentials: %w", err)
	}

	if hasFailure {
		fmt.Fprintln(os.Stderr, "\n⚠ Some credentials failed validation. They were saved but may not work.")
		return fmt.Errorf("credential validation failed")
	}

	fmt.Fprintln(os.Stderr, "✓ Setup complete.")
	fmt.Fprintln(os.Stderr, "ℹ Google Drive integration is available via `teamhero setup` in interactive mode.")
	return nil
}

// runSetupInteractive runs the interactive credential setup wizard.
// It analyzes existing configuration, shows current status, then asks
// the user whether to fill gaps or start fresh.
func runSetupInteractive() error {
	envPath := filepath.Join(configDir(), ".env")
	existing := loadExistingCredentials(envPath)

	passStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))  // green
	failStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("9"))   // red
	warnStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("11"))  // yellow
	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))  // dim

	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub Personal Access Token", optional: false},
		{envKey: "OPENAI_API_KEY", label: "OpenAI API Key", optional: false},
		{envKey: "ASANA_API_TOKEN", label: "Asana API Token", optional: true},
	}

	// Pre-fill from existing values (check alias names too)
	for i := range creds {
		if val, ok := existing[creds[i].envKey]; ok && val != "" {
			creds[i].value = val
			creds[i].status = "unchecked"
		}
	}

	// Check for Asana boards config (visible wins integration)
	boardsStatus := checkBoardsConfig()

	// For first-time users with no existing credentials, offer express vs full setup
	hasExisting := len(existing) > 0
	expressSetup := false
	if !hasExisting {
		var setupMode string
		form := huh.NewForm(huh.NewGroup(
			huh.NewSelect[string]().
				Title("Welcome to TeamHero! Choose a setup mode:").
				Options(
					huh.NewOption("Express (GitHub + OpenAI — get a report in 90 seconds)", "express"),
					huh.NewOption("Full (also configure Asana, Visible Wins, and more)", "full"),
				).
				Value(&setupMode),
		)).WithTheme(huh.ThemeCharm())

		if err := huhFormRun(form); err != nil {
			return err
		}

		if setupMode == "express" {
			expressSetup = true
			creds = creds[:2] // GitHub + OpenAI only, drop Asana
		}
	}

	// Always validate what we have
	if hasExisting {
		fmt.Fprintln(os.Stderr, "  Checking existing credentials…")
		fmt.Fprintln(os.Stderr)
		validateCredentials(creds)

		// Launch the unified inline settings editor loop
		for {
			action, err := showInlineSettingsEditor(existing, creds, boardsStatus)
			if err != nil {
				return err
			}
			if action == "" {
				// User quit the editor normally
				break
			}
			// Handle special actions
			switch action {
			case "@@gdrive":
				runGoogleDriveFromPicker()
			case "@@boards":
				runSetupBoards(checkBoardsConfig())
			}
			// Reload state after sub-flow
			existing = loadExistingCredentials(envPath)
			for i := range creds {
				if val, ok := existing[creds[i].envKey]; ok && val != "" {
					creds[i].value = val
				}
			}
			validateCredentials(creds)
			boardsStatus = checkBoardsConfig()
		}

		fmt.Fprintln(os.Stderr, "\n  "+passStyle.Render("✔")+" Done.")
		return nil
	}

	// Prompt for credentials that need input
	for i := range creds {
		c := &creds[i]
		if c.status == "valid" {
			continue // already validated, skip
		}
		if c.optional && c.value == "" && hasExisting {
			continue // optional and user didn't have it before, skip in gap-fill mode
		}
		if c.envKey == "GITHUB_PERSONAL_ACCESS_TOKEN" {
			if err := promptGitHubAuth(c); err != nil {
				return err
			}
		} else if c.envKey == "ASANA_API_TOKEN" {
			if err := promptAsanaAuth(c); err != nil {
				return err
			}
		} else {
			if err := promptCredentialInput(c); err != nil {
				return err
			}
		}
	}

	// Final validation
	fmt.Fprintln(os.Stderr, "\n  Validating credentials…")
	fmt.Fprintln(os.Stderr)
	validateCredentials(creds)

	// Show final results
	hasFailure := false
	for _, c := range creds {
		var icon string
		switch c.status {
		case "valid":
			icon = passStyle.Render("✔")
		case "invalid":
			icon = failStyle.Render("✖")
			hasFailure = true
		case "skipped":
			icon = warnStyle.Render("⊘")
		default:
			icon = dimStyle.Render("?")
		}
		msg := c.label
		if c.detail != "" {
			msg += dimStyle.Render(": "+c.detail)
		}
		fmt.Fprintf(os.Stderr, "  %s %s\n", icon, msg)
	}

	if hasFailure {
		fmt.Fprintln(os.Stderr, "\n  "+warnStyle.Render("⚠ Some credentials failed validation. They were saved but may not work."))
	}

	// Write .env file
	if err := writeEnvFile(envPath, creds); err != nil {
		return fmt.Errorf("failed to write credentials: %w", err)
	}

	if expressSetup {
		fmt.Fprintln(os.Stderr, "\n  "+passStyle.Render("✔")+" Express setup complete.")
		fmt.Fprintln(os.Stderr, "  Run `teamhero report` to generate your first report.")
		fmt.Fprintln(os.Stderr, "  Later, run `teamhero setup` again to add Asana integration.")
		return nil
	}

	fmt.Fprintln(os.Stderr, "\n  "+passStyle.Render("✔")+" Setup complete. Run `teamhero report` to generate your first report.")
	return nil
}

// apiCredentialKeys are the env keys that get validated against external APIs.
var apiCredentialKeys = map[string]bool{
	"GITHUB_PERSONAL_ACCESS_TOKEN": true,
	"OPENAI_API_KEY":               true,
	"ASANA_API_TOKEN":              true,
}

// ---------------------------------------------------------------------------
// Known-settings registry
// ---------------------------------------------------------------------------

// settingDef describes a single environment variable the tool uses.
type settingDef struct {
	envKey      string
	label       string
	description string
	category    string // "Creds", "Asana", "AI", "Tuning"
	sensitive   bool   // mask value in display
	defaultVal  string // shown when env var is not set ("" = no default)
	required    bool   // must be set for the tool to work
	hidden      bool   // hide from settings viewer/picker when auto-configured
	itype       inputType // how this setting is edited in the settings editor
	options     []string  // valid options for inputSelect type
}

// aiModelOptions is the canonical list of model choices for all AI model selectors.
var aiModelOptions = []string{
	"gpt-5-mini", "gpt-5", "gpt-5-nano",
	"o4-mini", "o3-mini", "o3",
	"gpt-4.1-mini", "gpt-4.1", "gpt-4.1-nano",
	"custom...",
}

// aiSectionModelOptions returns model choices for per-section overrides,
// prepending an inherit option that clears the override.
func aiSectionModelOptions() []string {
	out := make([]string, 0, 1+len(aiModelOptions))
	out = append(out, "(use primary model)")
	out = append(out, aiModelOptions...)
	return out
}

// perSectionModelKeys identifies env keys that are per-section AI model overrides.
var perSectionModelKeys = map[string]bool{
	"AI_TEAM_HIGHLIGHT_MODEL":       true,
	"AI_MEMBER_HIGHLIGHTS_MODEL":    true,
	"AI_INDIVIDUAL_SUMMARIES_MODEL": true,
	"VISIBLE_WINS_AI_MODEL":         true,
	"AI_DISCREPANCY_ANALYSIS_MODEL": true,
}

// knownSettings lists env vars an end user would configure.
// Internal constants (ASANA_API_BASE_URL, ASANA_USER_AGENT, legacy
// single-board fallback vars, internal batch/delay tuning) are omitted —
// they still appear under [Other] if present in .env.
var knownSettings = []settingDef{
	// Core Credentials
	{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub Personal Access Token", category: "Creds", sensitive: true, required: true},
	{envKey: "OPENAI_API_KEY", label: "OpenAI API Key", category: "Creds", sensitive: true, required: true},
	{envKey: "ASANA_API_TOKEN", label: "Asana API Token", category: "Creds", sensitive: true},
	// Asana User Matching — how GitHub users are paired to Asana users
	{envKey: "USER_MAP", label: "User Map", description: "JSON mapping of GitHub logins → Asana identities", category: "Asana", defaultVal: "{}", itype: inputJSON},
	{envKey: "ASANA_WORKSPACE_GID", label: "Workspace GIDs", description: "Limit search to these workspaces (auto-discovered if empty)", category: "Asana", defaultVal: "auto-discover"},
	{envKey: "ASANA_DEFAULT_EMAIL_DOMAIN", label: "Email Domain Fallback", description: "Try login@domain when no USER_MAP match exists", category: "Asana"},
	// Visible Wins / Meeting Notes
	{envKey: "MEETING_NOTES_DIR", label: "Meeting Notes Directory", description: "Path to meeting notes (Obsidian vault, etc.)", category: "VisWins"},
	{envKey: "MEETING_NOTES_PROVIDER", label: "Meeting Notes Provider", description: "Meeting platform for notes parsing", category: "VisWins", defaultVal: "google-meet", hidden: true},
	{envKey: "GOOGLE_DRIVE_FOLDER_IDS", label: "Google Drive Folder IDs", description: "Comma-separated folder IDs (auto-discovers Meet Notes if empty)", category: "VisWins"},
	{envKey: "GOOGLE_DRIVE_INCLUDE_TRANSCRIPTS", label: "Include Transcripts", description: "Include meeting transcripts from Google Drive", category: "VisWins", defaultVal: "true", hidden: true},
	// AI / LLM
	{envKey: "AI_MODEL", label: "AI Model", description: "Primary model for AI features", category: "AI", defaultVal: "gpt-5-mini", itype: inputSelect, options: aiModelOptions},
	{envKey: "AI_TEAM_HIGHLIGHT_MODEL", label: "Team Highlight Model", description: "Model for team summary highlights", category: "AI", defaultVal: "(use primary model)", itype: inputSelect, options: aiSectionModelOptions()},
	{envKey: "AI_MEMBER_HIGHLIGHTS_MODEL", label: "Member Highlights Model", description: "Model for per-member highlights", category: "AI", defaultVal: "(use primary model)", itype: inputSelect, options: aiSectionModelOptions()},
	{envKey: "AI_INDIVIDUAL_SUMMARIES_MODEL", label: "Individual Summaries Model", description: "Model for individual contributor summaries", category: "AI", defaultVal: "gpt-5-nano", itype: inputSelect, options: aiSectionModelOptions()},
	{envKey: "VISIBLE_WINS_AI_MODEL", label: "Visible Wins Model", description: "Model for visible wins extraction", category: "AI", defaultVal: "(use primary model)", itype: inputSelect, options: aiSectionModelOptions()},
	{envKey: "AI_DISCREPANCY_ANALYSIS_MODEL", label: "Discrepancy Analysis Model", description: "Model for discrepancy detection", category: "AI", defaultVal: "(use primary model)", itype: inputSelect, options: aiSectionModelOptions()},
	{envKey: "OPENAI_PROJECT", label: "OpenAI Project", description: "OpenAI project ID for billing", category: "AI"},
	{envKey: "OPENAI_SERVICE_TIER", label: "OpenAI Service Tier", description: "Set to \"flex\" for lower API costs (slower responses)", category: "AI", defaultVal: "", itype: inputSelect, options: []string{"", "flex"}},
	// Advanced Tuning
	{envKey: "TEAMHERO_LOG_LEVEL", label: "Log Level", description: "Log verbosity (0=silent, 3=info, 4=debug, 5=trace)", category: "Tuning", defaultVal: "3", itype: inputSelect, options: []string{"0", "1", "2", "3", "4", "5"}},
	{envKey: "TEAMHERO_AI_DEBUG", label: "AI Debug Mode", description: "Enable verbose AI logging", category: "Tuning", defaultVal: "false", itype: inputBool},
	{envKey: "TEAMHERO_AI_MAX_RETRIES", label: "AI Max Retries", description: "Maximum retry attempts for AI calls", category: "Tuning", defaultVal: "2", itype: inputNumber},
	{envKey: "TEAMHERO_ENABLE_PERIOD_DELTAS", label: "Enable Period Deltas", description: "Compare current vs previous period", category: "Tuning", defaultVal: "false", itype: inputBool},
	{envKey: "TEAMHERO_SEQUENTIAL", label: "Processing Mode", description: "API request processing mode", category: "Tuning", defaultVal: "parallel", itype: inputSelect, options: []string{"parallel", "sequential"}},
	{envKey: "TEAMHERO_DISCREPANCY_CONFIDENCE_THRESHOLD", label: "Discrepancy Report Threshold", description: "Only discrepancies with confidence >= this value appear in the report (0-100). The Discrepancy Log always shows all.", category: "Tuning", defaultVal: "30", itype: inputNumber},
	{envKey: "GITHUB_MAX_REPOSITORIES", label: "Max Repositories", description: "Maximum repos to fetch from the org (blank = unlimited)", category: "Tuning", defaultVal: "", itype: inputNumber},
	{envKey: "TEAMHERO_MAX_PR_PAGES", label: "Max PR Pages", description: "Maximum pages of PRs to fetch per repo (blank = unlimited)", category: "Tuning", defaultVal: "", itype: inputNumber},
}

// knownSettingsIndex provides fast lookup of envKey → settingDef.
var knownSettingsIndex = func() map[string]*settingDef {
	idx := make(map[string]*settingDef, len(knownSettings))
	for i := range knownSettings {
		idx[knownSettings[i].envKey] = &knownSettings[i]
	}
	return idx
}()

// categoryTag maps a category name to a short bracket prefix for display.
func categoryTag(category string) string {
	switch category {
	case "Creds":
		return "[Creds]  "
	case "GitHub":
		return "[GitHub] "
	case "Asana":
		return "[Asana]  "
	case "VisWins":
		return "[VisWins]"
	case "AI":
		return "[AI]     "
	case "Tuning":
		return "[Tuning] "
	case "Other":
		return "[Other]  "
	case "Boards":
		return "[Boards] "
	default:
		return "[" + category + "]"
	}
}

// maskValue masks a sensitive value, showing only the last 4 characters.
// The masked portion is capped at 8 dots to avoid line wrapping on long tokens.
func maskValue(val string) string {
	if len(val) <= 4 {
		return strings.Repeat("•", len(val))
	}
	dots := len(val) - 4
	if dots > 8 {
		dots = 8
	}
	return strings.Repeat("•", dots) + val[len(val)-4:]
}

// settingDisplayValue translates a raw stored value to a user-friendly display value.
// For example, TEAMHERO_SEQUENTIAL stores "true"/"false" but displays "sequential"/"parallel".
// Per-section model keys display "(use primary model)" when the stored value is empty.
func settingDisplayValue(envKey, rawVal string) string {
	if envKey == "TEAMHERO_SEQUENTIAL" {
		lower := strings.ToLower(rawVal)
		if lower == "true" || lower == "1" || lower == "yes" || lower == "on" || lower == "sequential" {
			return "sequential"
		}
		return "parallel"
	}
	if perSectionModelKeys[envKey] && rawVal == "" {
		return "(use primary model)"
	}
	return rawVal
}

// settingStoreValue translates a user-entered display value back to the stored form.
// Per-section model keys store "" when the user selects "(use primary model)".
func settingStoreValue(envKey, displayVal string) string {
	if envKey == "TEAMHERO_SEQUENTIAL" {
		lower := strings.ToLower(displayVal)
		if lower == "sequential" {
			return "true"
		}
		if lower == "parallel" {
			return "false"
		}
	}
	if perSectionModelKeys[envKey] && displayVal == "(use primary model)" {
		return ""
	}
	return displayVal
}

// buildSettingLabel constructs a display label with category tag, name, and current value.
func buildSettingLabel(def *settingDef, currentVal string, validationDetail string) string {
	tag := categoryTag(def.category)

	// For API credentials with validation detail (e.g., "Connected as @user")
	if validationDetail != "" {
		return fmt.Sprintf("%s %s (%s)", tag, def.label, validationDetail)
	}

	if currentVal == "" {
		reqTag := ""
		if def.required {
			reqTag = " [required]"
		}
		if def.defaultVal != "" {
			return fmt.Sprintf("%s %s = %s", tag, def.label, def.defaultVal)
		}
		return fmt.Sprintf("%s %s (not set)%s", tag, def.label, reqTag)
	}

	if def.sensitive {
		return fmt.Sprintf("%s %s = %s", tag, def.label, maskValue(currentVal))
	}

	preview := currentVal
	if len(preview) > 40 {
		preview = preview[:37] + "..."
	}
	return fmt.Sprintf("%s %s = %s", tag, def.label, preview)
}

// ---------------------------------------------------------------------------
// Settings status viewer (scrollable viewport)
// ---------------------------------------------------------------------------

// renderSettingsStatus builds a styled string showing the status of all known
// settings, grouped by category.
func renderSettingsStatus(existing map[string]string, creds []credential, boardsStatus boardsConfigStatus) (content string, valid, missing, invalid int) {
	passStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))
	failStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("9"))
	warnStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("11"))
	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	headerStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("12"))

	credsMap := make(map[string]*credential)
	for i := range creds {
		credsMap[creds[i].envKey] = &creds[i]
	}

	var b strings.Builder
	lastCategory := ""

	for _, def := range knownSettings {
		if def.hidden {
			continue
		}
		if def.category != lastCategory {
			if lastCategory != "" {
				b.WriteString("\n")
			}
			b.WriteString("  " + headerStyle.Render(categoryDisplayName(def.category)) + "\n")
			lastCategory = def.category
		}

		val := existing[def.envKey]
		var icon string

		if c, isCred := credsMap[def.envKey]; isCred {
			switch c.status {
			case "valid":
				icon = passStyle.Render("✔")
				valid++
			case "invalid":
				icon = failStyle.Render("✖")
				invalid++
			case "skipped":
				if c.optional {
					icon = warnStyle.Render("⊘")
				} else {
					icon = failStyle.Render("✖")
					missing++
				}
			default:
				if c.value == "" && !c.optional {
					icon = failStyle.Render("✖")
					missing++
				} else if c.value == "" {
					icon = warnStyle.Render("⊘")
				} else {
					icon = dimStyle.Render("?")
				}
			}
			msg := c.label
			if c.detail != "" {
				msg += dimStyle.Render(": "+c.detail)
			} else if c.value == "" && c.optional {
				msg += dimStyle.Render(": not configured (optional)")
			} else if c.value == "" {
				msg += dimStyle.Render(": missing")
			}
			fmt.Fprintf(&b, "    %s %s\n", icon, msg)
		} else {
			if val != "" {
				icon = passStyle.Render("✔")
				preview := settingDisplayValue(def.envKey, val)
				if def.sensitive {
					preview = maskValue(val)
				} else if len(preview) > 40 {
					preview = preview[:37] + "..."
				}
				fmt.Fprintf(&b, "    %s %s%s\n", icon, def.label, dimStyle.Render(" = "+preview))
			} else if def.defaultVal != "" {
				icon = dimStyle.Render("·")
				fmt.Fprintf(&b, "    %s %s\n", icon, def.label+dimStyle.Render(" = "+def.defaultVal))
			} else if def.required {
				icon = failStyle.Render("✖")
				fmt.Fprintf(&b, "    %s %s%s\n", icon, def.label, failStyle.Render(" [required]"))
				missing++
			} else {
				icon = dimStyle.Render("·")
				fmt.Fprintf(&b, "    %s %s%s\n", icon, def.label+dimStyle.Render(": not set"), dimStyle.Render(" (optional)"))
			}
		}
	}

	// Boards
	b.WriteString("\n  " + headerStyle.Render("Boards") + "\n")
	if boardsStatus.found {
		fmt.Fprintf(&b, "    %s %s\n", passStyle.Render("✔"),
			fmt.Sprintf("Visible Wins boards: %d configured", boardsStatus.count)+dimStyle.Render(" ("+boardsStatus.path+")"))
	} else {
		fmt.Fprintf(&b, "    %s %s\n", dimStyle.Render("·"),
			"Visible Wins boards"+dimStyle.Render(": not set"))
	}

	// Google Drive
	b.WriteString("\n  " + headerStyle.Render("Google Drive") + "\n")
	gdLabel, _ := googleDriveStatusLabel()
	fmt.Fprintf(&b, "    %s\n", gdLabel)

	// Asana OAuth
	b.WriteString("\n  " + headerStyle.Render("Asana OAuth") + "\n")
	aoLabel, _ := asanaOAuthStatusLabel()
	fmt.Fprintf(&b, "    %s\n", aoLabel)

	// Status summary at the bottom
	gaps := missing + invalid
	b.WriteString("\n")
	if gaps == 0 && valid > 0 {
		b.WriteString("  " + passStyle.Render("✔ All required credentials are configured.") + "\n")
	} else if gaps > 0 {
		b.WriteString("  " + warnStyle.Render(fmt.Sprintf("⚠ %d credential(s) need attention.", gaps)) + "\n")
	}

	return b.String(), valid, missing, invalid
}

// categoryDisplayName returns a human-readable category header.
func categoryDisplayName(cat string) string {
	switch cat {
	case "Creds":
		return "Core Credentials"
	case "GitHub":
		return "GitHub"
	case "Asana":
		return "Asana"
	case "VisWins":
		return "Visible Wins / Meeting Notes"
	case "AI":
		return "AI / LLM"
	case "Tuning":
		return "Advanced Tuning"
	case "Report":
		return "Report Defaults"
	default:
		return cat
	}
}

// settingsViewer is a Bubble Tea model that shows settings in a scrollable viewport.
type settingsViewer struct {
	vp       viewport.Model
	content  string
	ready    bool
	quitting bool
}

func newSettingsViewer(content string) settingsViewer {
	return settingsViewer{content: content}
}

func (m settingsViewer) Init() tea.Cmd {
	return nil
}

func (m settingsViewer) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		headerHeight := 3 // title + blank line + border
		footerHeight := 2 // hint + border
		h := msg.Height - headerHeight - footerHeight
		if h < 5 {
			h = 5
		}
		w := msg.Width - 4
		if w < 40 {
			w = 40
		}
		if !m.ready {
			m.vp = viewport.New(w, h)
			m.vp.SetContent(m.content)
			m.ready = true
		} else {
			m.vp.Width = w
			m.vp.Height = h
		}
		return m, nil

	case tea.KeyMsg:
		switch msg.String() {
		case "q", "enter", "esc":
			m.quitting = true
			return m, tea.Quit
		case "ctrl+c":
			m.quitting = true
			return m, tea.Quit
		}
	}

	var cmd tea.Cmd
	m.vp, cmd = m.vp.Update(msg)
	return m, cmd
}

func (m settingsViewer) View() string {
	if !m.ready {
		return "\n  Loading…"
	}

	titleStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("15"))
	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	borderStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("240")).
		Padding(0, 1)

	title := "  " + titleStyle.Render("Current Configuration")
	body := borderStyle.Render(m.vp.View())

	pct := int(m.vp.ScrollPercent() * 100)
	hint := dimStyle.Render(fmt.Sprintf("  ↑/↓ scroll • %d%% • Enter to continue", pct))

	return fmt.Sprintf("\n%s\n%s\n%s", title, body, hint)
}

// showSettingsViewer runs the scrollable settings viewer as a Bubble Tea program.
func showSettingsViewer(content string) error {
	m := newSettingsViewer(content)
	p := tea.NewProgram(m, tea.WithOutput(os.Stderr), tea.WithAltScreen())
	_, err := teaProgramRun(p)
	return err
}

// ---------------------------------------------------------------------------
// Settings picker (interactive Bubble Tea model for setting selection)
// ---------------------------------------------------------------------------

// settingsPickerItem represents a selectable item in the settings picker.
type settingsPickerItem struct {
	key   string // envKey, "@@boards", "@@gdrive", or "@@done"
	label string // rendered display line (without cursor prefix)
}

// pickerLine represents a single rendered line in the viewport.
type pickerLine struct {
	text      string // raw styled text (without cursor indicator)
	itemIndex int    // -1 for headers/blank lines; index into items[] for selectable lines
}

// settingsPicker is a Bubble Tea model that shows settings in a scrollable
// viewport with an interactive cursor that only lands on selectable items.
type settingsPicker struct {
	items    []settingsPickerItem // selectable items only
	lines    []pickerLine         // all rendered lines (headers + items)
	cursor   int                  // index into items[]
	selected string               // result key after selection
	viewport viewport.Model
	ready    bool
	quitting bool
	title    string // status title rendered above viewport
}

func (m settingsPicker) Init() tea.Cmd {
	return nil
}

func (m settingsPicker) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		headerHeight := 3 // title + blank line + border top
		footerHeight := 2 // hint + border bottom
		h := msg.Height - headerHeight - footerHeight
		if h < 5 {
			h = 5
		}
		w := msg.Width - 4
		if w < 40 {
			w = 40
		}
		if !m.ready {
			m.viewport = viewport.New(w, h)
			m.viewport.SetContent(m.renderContent())
			m.ready = true
		} else {
			m.viewport.Width = w
			m.viewport.Height = h
			m.viewport.SetContent(m.renderContent())
		}
		m.ensureCursorVisible()
		return m, nil

	case tea.KeyMsg:
		switch msg.String() {
		case "q", "esc":
			m.selected = "@@done"
			m.quitting = true
			return m, tea.Quit
		case "ctrl+c":
			m.selected = "@@done"
			m.quitting = true
			return m, tea.Quit
		case "enter":
			if len(m.items) > 0 {
				m.selected = m.items[m.cursor].key
			}
			m.quitting = true
			return m, tea.Quit
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
				m.viewport.SetContent(m.renderContent())
				m.ensureCursorVisible()
			}
			return m, nil
		case "down", "j":
			if m.cursor < len(m.items)-1 {
				m.cursor++
				m.viewport.SetContent(m.renderContent())
				m.ensureCursorVisible()
			}
			return m, nil
		case "home":
			m.cursor = 0
			m.viewport.SetContent(m.renderContent())
			m.viewport.GotoTop()
			return m, nil
		case "end":
			m.cursor = len(m.items) - 1
			m.viewport.SetContent(m.renderContent())
			m.viewport.GotoBottom()
			return m, nil
		}
	}

	var cmd tea.Cmd
	m.viewport, cmd = m.viewport.Update(msg)
	return m, cmd
}

// cursorLineIndex returns the line index in m.lines that corresponds to the current cursor item.
func (m settingsPicker) cursorLineIndex() int {
	for i, l := range m.lines {
		if l.itemIndex == m.cursor {
			return i
		}
	}
	return 0
}

// ensureCursorVisible scrolls the viewport so the cursor line is visible.
func (m *settingsPicker) ensureCursorVisible() {
	if !m.ready {
		return
	}
	lineIdx := m.cursorLineIndex()
	top := m.viewport.YOffset
	bottom := top + m.viewport.Height - 1
	if lineIdx < top {
		m.viewport.SetYOffset(lineIdx)
	} else if lineIdx > bottom {
		m.viewport.SetYOffset(lineIdx - m.viewport.Height + 1)
	}
}

// renderContent builds the viewport content string with cursor indicators.
func (m settingsPicker) renderContent() string {
	cursorStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("12")).Bold(true)
	selectedBg := lipgloss.NewStyle().Foreground(lipgloss.Color("15")).Bold(true)

	var b strings.Builder
	for _, line := range m.lines {
		if line.itemIndex < 0 {
			// Non-selectable line (header or blank)
			b.WriteString(line.text)
			b.WriteString("\n")
		} else if line.itemIndex == m.cursor {
			// Current cursor position — highlight
			b.WriteString("  " + cursorStyle.Render("▸") + " " + selectedBg.Render(m.items[line.itemIndex].label))
			b.WriteString("\n")
		} else {
			b.WriteString("    " + line.text)
			b.WriteString("\n")
		}
	}
	return b.String()
}

func (m settingsPicker) View() string {
	if !m.ready {
		return "\n  Loading…"
	}

	titleStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("15"))
	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	borderStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("240")).
		Padding(0, 1)

	title := "  " + titleStyle.Render("Which setting do you want to change?")
	if m.title != "" {
		title += "\n  " + m.title
	}
	body := borderStyle.Render(m.viewport.View())

	pct := int(m.viewport.ScrollPercent() * 100)
	hint := dimStyle.Render(fmt.Sprintf("  ↑/↓ navigate • Enter to edit • q done • %d%%", pct))

	return fmt.Sprintf("\n%s\n%s\n%s", title, body, hint)
}

// buildSettingsPicker constructs a settingsPicker from current state.
func buildSettingsPicker(allEntries map[string]string, creds []credential, allCredsValid bool) settingsPicker {
	passStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))
	failStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("9"))
	warnStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("11"))
	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	headerStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("12"))

	credsMap := make(map[string]*credential)
	for i := range creds {
		credsMap[creds[i].envKey] = &creds[i]
	}

	var items []settingsPickerItem
	var lines []pickerLine
	seen := make(map[string]bool)
	lastCategory := ""

	for _, def := range knownSettings {
		if def.hidden {
			continue
		}
		if def.category != lastCategory {
			// Inject Visible Wins boards right after Asana settings
			if lastCategory == "Asana" {
				boardsStatus := checkBoardsConfig()
				var boardsLabel string
				if boardsStatus.found {
					boardsLabel = passStyle.Render("✔") + " " + fmt.Sprintf("Visible Wins boards: %d configured", boardsStatus.count) +
						dimStyle.Render(" ("+boardsStatus.path+")")
				} else {
					boardsLabel = dimStyle.Render("·") + " Visible Wins boards" + dimStyle.Render(": not set")
				}
				boardsIdx := len(items)
				items = append(items, settingsPickerItem{key: "@@boards", label: boardsLabel})
				lines = append(lines, pickerLine{text: boardsLabel, itemIndex: boardsIdx})
			}

			// Inject Google Drive and Asana OAuth right after Core Credentials
			if lastCategory == "Creds" {
				gdLabel, _ := googleDriveStatusLabel()
				gdIdx := len(items)
				items = append(items, settingsPickerItem{key: "@@gdrive", label: gdLabel})
				lines = append(lines, pickerLine{text: gdLabel, itemIndex: gdIdx})

				aoLabel, _ := asanaOAuthStatusLabel()
				aoIdx := len(items)
				items = append(items, settingsPickerItem{key: "@@asana-oauth", label: aoLabel})
				lines = append(lines, pickerLine{text: aoLabel, itemIndex: aoIdx})
			}

			if lastCategory != "" {
				lines = append(lines, pickerLine{text: "", itemIndex: -1})
			}
			lines = append(lines, pickerLine{
				text:      "  " + headerStyle.Render(categoryDisplayName(def.category)),
				itemIndex: -1,
			})
			lastCategory = def.category
		}

		seen[def.envKey] = true
		val := allEntries[def.envKey]

		// Build the display label matching renderSettingsStatus style
		var icon, label string
		if c, isCred := credsMap[def.envKey]; isCred {
			switch c.status {
			case "valid":
				icon = passStyle.Render("✔")
			case "invalid":
				icon = failStyle.Render("✖")
			case "skipped":
				if c.optional {
					icon = warnStyle.Render("⊘")
				} else {
					icon = failStyle.Render("✖")
				}
			default:
				if c.value == "" && !c.optional {
					icon = failStyle.Render("✖")
				} else if c.value == "" {
					icon = warnStyle.Render("⊘")
				} else {
					icon = dimStyle.Render("?")
				}
			}
			label = c.label
			if c.detail != "" {
				label += dimStyle.Render(": " + c.detail)
			} else if c.value == "" && c.optional {
				label += dimStyle.Render(": not configured (optional)")
			} else if c.value == "" {
				label += dimStyle.Render(": missing")
			}
		} else {
			if val != "" {
				icon = passStyle.Render("✔")
				preview := settingDisplayValue(def.envKey, val)
				if def.sensitive {
					preview = maskValue(val)
				} else if len(preview) > 40 {
					preview = preview[:37] + "..."
				}
				label = def.label + dimStyle.Render(" = "+preview)
			} else if def.defaultVal != "" {
				icon = dimStyle.Render("·")
				label = def.label + dimStyle.Render(" = "+def.defaultVal)
			} else if def.required {
				icon = failStyle.Render("✖")
				label = def.label + failStyle.Render(" [required]")
			} else {
				icon = dimStyle.Render("·")
				label = def.label + dimStyle.Render(": not set") + dimStyle.Render(" (optional)")
			}
		}

		displayLabel := icon + " " + label
		itemIdx := len(items)
		items = append(items, settingsPickerItem{key: def.envKey, label: displayLabel})
		lines = append(lines, pickerLine{text: displayLabel, itemIndex: itemIdx})
	}

	// Extra .env keys not in the registry
	var extraKeys []string
	for key := range allEntries {
		if !seen[key] {
			extraKeys = append(extraKeys, key)
		}
	}
	sort.Strings(extraKeys)
	if len(extraKeys) > 0 {
		lines = append(lines, pickerLine{text: "", itemIndex: -1})
		lines = append(lines, pickerLine{
			text:      "  " + headerStyle.Render("Other"),
			itemIndex: -1,
		})
		for _, key := range extraKeys {
			val := allEntries[key]
			preview := val
			if len(preview) > 40 {
				preview = preview[:37] + "..."
			}
			displayLabel := passStyle.Render("✔") + " " + key + dimStyle.Render(" = "+preview)
			itemIdx := len(items)
			items = append(items, settingsPickerItem{key: key, label: displayLabel})
			lines = append(lines, pickerLine{text: displayLabel, itemIndex: itemIdx})
		}
	}

	// Done option
	lines = append(lines, pickerLine{text: "", itemIndex: -1})
	doneLabel := passStyle.Render("←") + " Done — return to previous menu"
	doneIdx := len(items)
	items = append(items, settingsPickerItem{key: "@@done", label: doneLabel})
	lines = append(lines, pickerLine{text: doneLabel, itemIndex: doneIdx})

	// Title status
	var title string
	if allCredsValid {
		title = passStyle.Render("✔ All required credentials are configured.")
	}

	return settingsPicker{
		items: items,
		lines: lines,
		title: title,
	}
}

// runSetupUpdateSingle lets the user pick which setting to replace.
// It loops back to the menu after each update until the user selects "Done".
func runSetupUpdateSingle(creds []credential, envPath string) error {
	passStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))

	for {
		// Re-read .env each iteration to reflect changes
		allEntries := loadExistingCredentials(envPath)

		// Rebuild creds with fresh values for display
		for i := range creds {
			if val, ok := allEntries[creds[i].envKey]; ok && val != "" {
				creds[i].value = val
			}
		}
		// Re-validate API credentials for accurate status display
		validateCredentials(creds)

		// Check required credentials status for title
		allCredsValid := true
		for _, c := range creds {
			if !c.optional && c.status != "valid" {
				allCredsValid = false
				break
			}
		}

		// Build and run the settings picker
		picker := buildSettingsPicker(allEntries, creds, allCredsValid)
		p := tea.NewProgram(picker, tea.WithOutput(os.Stderr), tea.WithAltScreen())
		result, err := teaProgramRun(p)
		if err != nil {
			return err
		}
		selected := result.(settingsPicker).selected

		switch {
		case selected == "@@done" || selected == "":
			fmt.Fprintln(os.Stderr, "\n  "+passStyle.Render("✔")+" Done.")
			return nil
		case selected == "@@boards":
			boardsStatus := checkBoardsConfig()
			if err := runSetupBoards(boardsStatus); err != nil {
				return err
			}
			continue
		case selected == "@@gdrive":
			if err := runGoogleDriveFromPicker(); err != nil {
				return err
			}
			continue
		case selected == "@@asana-oauth":
			if err := runAsanaOAuthFromPicker(); err != nil {
				return err
			}
			continue
		}

		// Handle the selected setting
		if err := handleSettingUpdate(selected, creds, envPath, allEntries); err != nil {
			return err
		}
	}
}

// handleSettingUpdate handles updating a single setting — either an API credential
// (with validation and masked input) or a plain setting.
func handleSettingUpdate(envKey string, creds []credential, envPath string, allEntries map[string]string) error {
	passStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))
	failStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("9"))
	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))

	if apiCredentialKeys[envKey] {
		for i := range creds {
			if creds[i].envKey == envKey {
				creds[i].value = ""
				creds[i].status = ""
				creds[i].detail = ""
				if envKey == "GITHUB_PERSONAL_ACCESS_TOKEN" {
					if err := promptGitHubAuth(&creds[i]); err != nil {
						return err
					}
				} else if envKey == "ASANA_API_TOKEN" {
					if err := promptAsanaAuth(&creds[i]); err != nil {
						return err
					}
				} else {
					if err := promptCredentialInput(&creds[i]); err != nil {
						return err
					}
				}

				fmt.Fprintln(os.Stderr, "\n  Validating…")
				validateCredentials(creds)

				c := creds[i]
				msg := c.label
				if c.detail != "" {
					msg += dimStyle.Render(": "+c.detail)
				}
				if c.status == "valid" {
					fmt.Fprintf(os.Stderr, "  %s %s\n", passStyle.Render("✔"), msg)
				} else {
					fmt.Fprintf(os.Stderr, "  %s %s\n", failStyle.Render("✖"), msg)
				}

				if err := updateEnvKey(envPath, envKey, creds[i].value); err != nil {
					return fmt.Errorf("failed to update credential: %w", err)
				}
				fmt.Fprintln(os.Stderr, "\n  "+passStyle.Render("✔")+" Credential updated.")
				return nil
			}
		}
	}

	return handlePlainSettingUpdate(envKey, envPath, allEntries)
}

// handlePlainSettingUpdate prompts for a new value for a non-credential setting.
// It shows the description from the registry for unconfigured settings.
func handlePlainSettingUpdate(envKey string, envPath string, allEntries map[string]string) error {
	passStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))

	currentVal := allEntries[envKey]

	// Build description: show help text, current value, and default
	var desc string
	var isSensitive bool
	var defaultVal string
	if def, ok := knownSettingsIndex[envKey]; ok {
		isSensitive = def.sensitive
		defaultVal = def.defaultVal
		if def.description != "" {
			desc = def.description
		}
		if currentVal != "" {
			if def.sensitive {
				desc += "\nCurrent: " + maskValue(currentVal)
			} else {
				desc += "\nCurrent: " + settingDisplayValue(envKey, currentVal)
			}
		} else if defaultVal != "" {
			desc += "\nDefault: " + defaultVal
		}
	} else {
		if currentVal != "" {
			desc = "Current: " + currentVal
		}
	}

	placeholder := "new value (Enter to keep current)"
	if currentVal == "" && defaultVal != "" {
		placeholder = "Enter to keep default: " + defaultVal
	}

	var newVal string
	input := huh.NewInput().
		Title(envKey).
		Description(desc).
		Placeholder(placeholder).
		Value(&newVal)

	if isSensitive {
		input = input.EchoMode(huh.EchoModePassword)
	}

	settingForm := huh.NewForm(huh.NewGroup(input)).WithTheme(huh.ThemeCharm())

	if err := huhFormRun(settingForm); err != nil {
		return err
	}

	trimmed := strings.TrimSpace(newVal)
	if trimmed == "" {
		fmt.Fprintln(os.Stderr, "\n  No changes made.")
		return nil
	}

	trimmed = settingStoreValue(envKey, trimmed)

	if err := updateEnvKey(envPath, envKey, trimmed); err != nil {
		return fmt.Errorf("failed to update setting: %w", err)
	}
	fmt.Fprintf(os.Stderr, "\n  %s %s updated.\n", passStyle.Render("✔"), envKey)
	return nil
}

// runSetupBoards handles interactive configuration of Visible Wins boards.
func runSetupBoards(status boardsConfigStatus) error {
	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))

	boardsPath := filepath.Join(configDir(), "asana-config.json")

	if status.found {
		fmt.Fprintln(os.Stderr)
		fmt.Fprintf(os.Stderr, "  Current config: %s\n", dimStyle.Render(status.path))
		fmt.Fprintf(os.Stderr, "  Boards configured: %d\n\n", status.count)

		var choice string
		form := huh.NewForm(huh.NewGroup(
			huh.NewSelect[string]().
				Title("What would you like to do?").
				Options(
					huh.NewOption("Add a new board", "add"),
					huh.NewOption("Replace entire configuration", "replace"),
					huh.NewOption("Cancel", "cancel"),
				).
				Value(&choice),
		)).WithTheme(huh.ThemeCharm())

		if err := huhFormRun(form); err != nil {
			return err
		}

		switch choice {
		case "cancel":
			fmt.Fprintln(os.Stderr, "\n  No changes made.")
			return nil
		case "add":
			return addBoardToConfig(boardsPath)
		case "replace":
			// Fall through to create new config
		}
	}

	return createBoardsConfig(boardsPath)
}

// addBoardToConfig adds a new board entry to the existing boards config.
func addBoardToConfig(path string) error {
	passStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))

	board, err := promptBoardInput()
	if err != nil {
		return err
	}
	if board == nil {
		fmt.Fprintln(os.Stderr, "\n  No board added.")
		return nil
	}

	// Read existing config
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("failed to read boards config: %w", err)
	}

	var config boardsFileSchema
	if err := json.Unmarshal(data, &config); err != nil {
		return fmt.Errorf("failed to parse boards config: %w", err)
	}

	config.Boards = append(config.Boards, *board)

	out, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to serialize boards config: %w", err)
	}

	if err := os.WriteFile(path, out, 0o644); err != nil {
		return fmt.Errorf("failed to write boards config: %w", err)
	}

	fmt.Fprintf(os.Stderr, "\n  %s Board added. %d board(s) now configured.\n", passStyle.Render("✔"), len(config.Boards))
	return nil
}

// createBoardsConfig creates a new boards config file with one board.
func createBoardsConfig(path string) error {
	passStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))

	board, err := promptBoardInput()
	if err != nil {
		return err
	}
	if board == nil {
		fmt.Fprintln(os.Stderr, "\n  No boards configured.")
		return nil
	}

	config := boardsFileSchema{Boards: []boardEntry{*board}}
	out, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to serialize boards config: %w", err)
	}

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	if err := os.WriteFile(path, out, 0o644); err != nil {
		return fmt.Errorf("failed to write boards config: %w", err)
	}

	fmt.Fprintf(os.Stderr, "\n  %s Boards config saved to %s\n", passStyle.Render("✔"), path)
	return nil
}

// boardsFileSchema mirrors the TypeScript BoardsFileSchema.
type boardsFileSchema struct {
	Boards []boardEntry `json:"boards"`
}

// boardEntry represents a single Asana board configuration.
type boardEntry struct {
	ProjectGid    string   `json:"projectGid"`
	Sections      []string `json:"sections"`
	Label         string   `json:"label,omitempty"`
	PriorityField string   `json:"priorityField,omitempty"`
}

// promptBoardInput prompts the user for a single board's configuration.
func promptBoardInput() (*boardEntry, error) {
	var projectGid, sectionsStr, label, priorityField string

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("Asana Project GID").
				Description("The numeric GID from the Asana project URL").
				Placeholder("e.g., 1234567890").
				Value(&projectGid).
				Validate(func(s string) error {
					if strings.TrimSpace(s) == "" {
						return fmt.Errorf("project GID is required")
					}
					return nil
				}),
			huh.NewInput().
				Title("Section names").
				Description("Comma-separated list of Asana sections to track").
				Placeholder("e.g., Now, Next, Later").
				Value(&sectionsStr).
				Validate(func(s string) error {
					if strings.TrimSpace(s) == "" {
						return fmt.Errorf("at least one section is required")
					}
					return nil
				}),
			huh.NewInput().
				Title("Board label").
				Description("A display name for this board (optional)").
				Placeholder("e.g., Product Roadmap").
				Value(&label),
			huh.NewInput().
				Title("Priority field name").
				Description("Custom field name for priority scoring (optional)").
				Placeholder("e.g., RICE Score").
				Value(&priorityField),
		),
	).WithTheme(huh.ThemeCharm())

	if err := huhFormRun(form); err != nil {
		if err == huh.ErrUserAborted {
			return nil, nil
		}
		return nil, err
	}

	gid := strings.TrimSpace(projectGid)
	if gid == "" {
		return nil, nil
	}

	sections := splitCSV(sectionsStr)
	if len(sections) == 0 {
		return nil, nil
	}

	entry := &boardEntry{
		ProjectGid:    gid,
		Sections:      sections,
		Label:         strings.TrimSpace(label),
		PriorityField: strings.TrimSpace(priorityField),
	}

	return entry, nil
}

// promptCredentialInput prompts for a single credential value.
func promptCredentialInput(c *credential) error {
	placeholder := "paste token here"
	if c.optional {
		placeholder = "optional — press Enter to skip"
	}

	var input string
	form := huh.NewForm(huh.NewGroup(
		huh.NewInput().
			Title(c.label).
			Placeholder(placeholder).
			Value(&input).
			EchoMode(huh.EchoModePassword).
			Validate(func(s string) error {
				if !c.optional && strings.TrimSpace(s) == "" && c.value == "" {
					return fmt.Errorf("%s is required", c.label)
				}
				return nil
			}),
	)).WithTheme(huh.ThemeCharm())

	if err := huhFormRun(form); err != nil {
		return err
	}

	trimmed := strings.TrimSpace(input)
	if trimmed != "" {
		c.value = trimmed
		c.status = "unchecked"
	} else if c.optional && c.value == "" {
		c.status = "skipped"
	}

	return nil
}

// promptGitHubAuth offers browser-based OAuth device flow or manual PAT entry.
// If the device flow succeeds, the credential is set to "valid" with the token
// and login detail. If the user chooses PAT or device flow fails, it falls back
// to the standard promptCredentialInput text input.
func promptGitHubAuth(c *credential) error {
	var method string
	form := huh.NewForm(huh.NewGroup(
		huh.NewSelect[string]().
			Title("How would you like to authenticate with GitHub?").
			Options(
				huh.NewOption("Sign in with browser (recommended)", "oauth"),
				huh.NewOption("Paste a Personal Access Token", "pat"),
			).
			Value(&method),
	)).WithTheme(huh.ThemeCharm())

	if err := huhFormRun(form); err != nil {
		return err
	}

	if method == "pat" {
		return promptCredentialInput(c)
	}

	// OAuth device flow
	passStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))

	fmt.Fprintln(os.Stderr, "\n  Starting GitHub sign-in...")
	result, err := serviceScriptRunner("github-auth.ts", map[string]interface{}{
		"action": "device_flow",
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "  GitHub OAuth failed: %s\n", err.Error())
		fmt.Fprintln(os.Stderr, "  Falling back to manual token entry…")
		return promptCredentialInput(c)
	}

	if okVal, ok := result["ok"].(bool); ok && okVal {
		if token, ok := result["token"].(string); ok && token != "" {
			c.value = token
			c.status = "valid"
			login, _ := result["login"].(string)
			if login != "" {
				c.detail = fmt.Sprintf("Connected as @%s", login)
				fmt.Fprintln(os.Stderr, "  "+passStyle.Render("✔")+" "+c.detail)
			} else {
				c.detail = "Authenticated via OAuth"
				fmt.Fprintln(os.Stderr, "  "+passStyle.Render("✔")+" GitHub authenticated")
			}
			return nil
		}
	}

	// Device flow returned but without a token — fall back
	if errMsg, ok := result["error"].(string); ok && errMsg != "" {
		fmt.Fprintf(os.Stderr, "  GitHub OAuth failed: %s\n", errMsg)
	}
	fmt.Fprintln(os.Stderr, "  Falling back to manual token entry…")
	return promptCredentialInput(c)
}

// validateCredentials validates each credential against its API.
func validateCredentials(creds []credential) {
	validateCredentialsWith(creds, defaultHTTPClient)
}

func validateCredentialsWith(creds []credential, client HTTPDoer) {
	for i := range creds {
		c := &creds[i]
		if c.value == "" {
			c.status = "skipped"
			continue
		}
		if c.status == "valid" {
			continue // already validated
		}

		switch c.envKey {
		case "GITHUB_PERSONAL_ACCESS_TOKEN":
			validateGitHub(client, c)
		case "OPENAI_API_KEY":
			validateOpenAI(client, c)
		case "ASANA_API_TOKEN":
			validateAsana(client, c)
		}
	}
}

func validateGitHub(client HTTPDoer, c *credential) {
	req, _ := http.NewRequest("GET", githubAPIBaseURL+"/user", nil)
	req.Header.Set("Authorization", "Bearer "+c.value)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := client.Do(req)
	if err != nil {
		c.status = "invalid"
		c.detail = "Connection failed"
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		c.status = "invalid"
		c.detail = "Token invalid or expired"
		return
	}

	var user struct {
		Login string `json:"login"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&user); err == nil && user.Login != "" {
		c.status = "valid"
		c.detail = fmt.Sprintf("Connected as @%s", user.Login)
	} else {
		c.status = "valid"
		c.detail = "Authenticated"
	}
}

func validateOpenAI(client HTTPDoer, c *credential) {
	body := strings.NewReader(`{"model":"gpt-4o-mini","input":"test","max_output_tokens":1}`)
	req, _ := http.NewRequest("POST", openAIAPIBaseURL+"/v1/responses", body)
	req.Header.Set("Authorization", "Bearer "+c.value)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		c.status = "invalid"
		c.detail = "Connection failed"
		return
	}
	defer resp.Body.Close()

	// 401 = invalid key. Other status codes (200, 400, 429) mean the key is valid.
	if resp.StatusCode == 401 {
		c.status = "invalid"
		c.detail = "API key invalid or expired"
		return
	}

	c.status = "valid"
	c.detail = "Validated"
}

func validateAsana(client HTTPDoer, c *credential) {
	req, _ := http.NewRequest("GET", asanaAPIBaseURL+"/users/me", nil)
	req.Header.Set("Authorization", "Bearer "+c.value)

	resp, err := client.Do(req)
	if err != nil {
		c.status = "invalid"
		c.detail = "Connection failed"
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		c.status = "invalid"
		c.detail = "Token invalid or expired"
		return
	}

	var result struct {
		Data struct {
			Name string `json:"name"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err == nil && result.Data.Name != "" {
		c.status = "valid"
		c.detail = fmt.Sprintf("Connected as %s", result.Data.Name)
	} else {
		c.status = "valid"
		c.detail = "Authenticated"
	}
}

// boardsConfigStatus describes the state of the visible-wins boards configuration.
type boardsConfigStatus struct {
	found bool
	path  string
	count int
}

// checkBoardsConfig looks for asana-config.json in the config dir.
func checkBoardsConfig() boardsConfigStatus {
	path := filepath.Join(configDir(), "asana-config.json")
	if count, ok := countBoards(path); ok {
		return boardsConfigStatus{found: true, path: path, count: count}
	}
	return boardsConfigStatus{found: false}
}

// ---------------------------------------------------------------------------
// Google Drive helpers
// ---------------------------------------------------------------------------

// isGoogleDriveConnected returns true when a valid Google Drive token exists.
func isGoogleDriveConnected() bool {
	tokenPath := filepath.Join(configDir(), "google-tokens.json")
	data, err := os.ReadFile(tokenPath)
	if err != nil {
		return false
	}
	var tokens map[string]interface{}
	if err := json.Unmarshal(data, &tokens); err != nil {
		return false
	}
	_, ok := tokens["refresh_token"]
	return ok
}

// getGoogleDriveEmail reads the access token from google-tokens.json and
// calls the Google userinfo API to get the user's email. Returns "" on any
// error. Does NOT attempt to refresh an expired token (avoids complexity in Go).
func getGoogleDriveEmail() string {
	tokenPath := filepath.Join(configDir(), "google-tokens.json")
	data, err := os.ReadFile(tokenPath)
	if err != nil {
		return ""
	}
	var tokens struct {
		AccessToken string  `json:"access_token"`
		ExpiresAt   float64 `json:"expires_at"`
	}
	if err := json.Unmarshal(data, &tokens); err != nil || tokens.AccessToken == "" {
		return ""
	}
	// Skip if token is expired (no refresh from Go)
	if float64(time.Now().UnixMilli()) >= tokens.ExpiresAt {
		return ""
	}

	client := &http.Client{Timeout: 5 * time.Second}
	req, err := http.NewRequest("GET", "https://www.googleapis.com/oauth2/v1/userinfo?alt=json", nil)
	if err != nil {
		return ""
	}
	req.Header.Set("Authorization", "Bearer "+tokens.AccessToken)
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != 200 {
		return ""
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return ""
	}
	var info struct {
		Email string `json:"email"`
	}
	if err := json.Unmarshal(body, &info); err != nil {
		return ""
	}
	return info.Email
}

// googleDriveStatusLabel returns a styled status line and whether Drive is connected.
func googleDriveStatusLabel() (string, bool) {
	passStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))
	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))

	if isGoogleDriveConnected() {
		email := getGoogleDriveEmail()
		if email != "" {
			return passStyle.Render("✔") + " Google Drive: " + email, true
		}
		return passStyle.Render("✔") + " Google Drive" + dimStyle.Render(": connected"), true
	}
	warnStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("11"))
	return warnStyle.Render("○") + " Google Drive" + dimStyle.Render(": connect for meeting transcripts"), false
}

// runGoogleDriveFromPicker is the entry point when the user selects @@gdrive
// from the settings picker. It branches based on connection state.
func runGoogleDriveFromPicker() error {
	if isGoogleDriveConnected() {
		return runGoogleDriveManage()
	}
	return runGoogleDriveSetup()
}

// runGoogleDriveSetup shows Quick Setup / BYOC / Skip for first-time connection.
func runGoogleDriveSetup() error {
	var choice string
	form := huh.NewForm(huh.NewGroup(
		huh.NewSelect[string]().
			Title("Connect Google Drive for meeting notes").
			Options(
				huh.NewOption("Quick Setup (use TeamHero's Google credentials)", "quick"),
				huh.NewOption("Bring Your Own Credentials (use your own OAuth app)", "byoc"),
				huh.NewOption("Skip", "skip"),
			).
			Value(&choice),
	)).WithTheme(huh.ThemeCharm())

	if err := huhFormRun(form); err != nil {
		return err
	}

	switch choice {
	case "quick":
		return runGoogleOAuthFlow(nil)
	case "byoc":
		return runGoogleBYOCFlow()
	case "skip":
		return nil
	}
	return nil
}

// byocInput holds the BYOC client credentials passed to the service script.
type byocInput struct {
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
}

// runGoogleBYOCFlow prompts for Client ID and Secret, then runs the OAuth flow.
func runGoogleBYOCFlow() error {
	var clientID, clientSecret string
	form := huh.NewForm(huh.NewGroup(
		huh.NewInput().
			Title("OAuth Client ID").
			Description("From Google Cloud Console → APIs & Services → Credentials").
			Placeholder("xxxxxxxxx.apps.googleusercontent.com").
			Value(&clientID).
			Validate(func(s string) error {
				if strings.TrimSpace(s) == "" {
					return fmt.Errorf("client ID is required")
				}
				return nil
			}),
		huh.NewInput().
			Title("OAuth Client Secret").
			Placeholder("paste client secret here").
			EchoMode(huh.EchoModePassword).
			Value(&clientSecret).
			Validate(func(s string) error {
				if strings.TrimSpace(s) == "" {
					return fmt.Errorf("client secret is required")
				}
				return nil
			}),
	)).WithTheme(huh.ThemeCharm())

	if err := huhFormRun(form); err != nil {
		return err
	}

	return runGoogleOAuthFlow(&byocInput{
		ClientID:     strings.TrimSpace(clientID),
		ClientSecret: strings.TrimSpace(clientSecret),
	})
}

// runGoogleOAuthFlow invokes the google-auth.ts service script with optional
// BYOC credentials. Displays the result (success with email, or error).
func runGoogleOAuthFlow(input *byocInput) error {
	passStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))

	fmt.Fprintln(os.Stderr, "\n  Starting Google sign-in...")
	result, err := runServiceScript("google-auth.ts", input)
	if err != nil {
		fmt.Fprintf(os.Stderr, "  ⚠ Google Drive connection failed: %s\n", err.Error())
		return nil
	}
	if result == nil {
		return nil
	}
	if okVal, ok := result["ok"].(bool); ok && okVal {
		msg := "Google Drive connected!"
		if email, ok := result["email"].(string); ok && email != "" {
			msg = fmt.Sprintf("Google Drive connected as %s", email)
		}
		fmt.Fprintln(os.Stderr, "  "+passStyle.Render("✔")+" "+msg)
		// Auto-configure meeting notes settings
		envPath := filepath.Join(configDir(), ".env")
		existing := loadExistingCredentials(envPath)
		if existing["MEETING_NOTES_PROVIDER"] == "" {
			updateEnvKey(envPath, "MEETING_NOTES_PROVIDER", "google-meet")
		}
		if existing["GOOGLE_DRIVE_INCLUDE_TRANSCRIPTS"] == "" {
			updateEnvKey(envPath, "GOOGLE_DRIVE_INCLUDE_TRANSCRIPTS", "true")
		}
	} else if errMsg, ok := result["error"].(string); ok {
		fmt.Fprintf(os.Stderr, "  ⚠ Google Drive connection failed: %s\n", errMsg)
	}
	return nil
}

// runGoogleDriveManage shows Reconnect / Disconnect / Keep for already-connected state.
func runGoogleDriveManage() error {
	passStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))
	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))

	email := getGoogleDriveEmail()
	status := "connected"
	if email != "" {
		status = email
	}
	fmt.Fprintf(os.Stderr, "\n  Google Drive: %s\n\n", dimStyle.Render(status))

	var choice string
	form := huh.NewForm(huh.NewGroup(
		huh.NewSelect[string]().
			Title("Google Drive is connected").
			Options(
				huh.NewOption("Keep current connection", "keep"),
				huh.NewOption("Reconnect (new account or refresh)", "reconnect"),
				huh.NewOption("Disconnect", "disconnect"),
			).
			Value(&choice),
	)).WithTheme(huh.ThemeCharm())

	if err := huhFormRun(form); err != nil {
		return err
	}

	switch choice {
	case "disconnect":
		return disconnectGoogleDrive()
	case "reconnect":
		return runGoogleDriveSetup()
	case "keep":
		fmt.Fprintln(os.Stderr, "\n  "+passStyle.Render("✔")+" No changes made.")
	}
	return nil
}

// disconnectGoogleDrive removes the Google token file.
func disconnectGoogleDrive() error {
	passStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))

	tokenPath := filepath.Join(configDir(), "google-tokens.json")
	if err := os.Remove(tokenPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove token file: %w", err)
	}
	fmt.Fprintln(os.Stderr, "\n  "+passStyle.Render("✔")+" Google Drive disconnected.")
	return nil
}

// ---------------------------------------------------------------------------
// Asana OAuth helpers
// ---------------------------------------------------------------------------

// isAsanaOAuthConnected returns true when a valid Asana OAuth token exists.
func isAsanaOAuthConnected() bool {
	tokenPath := filepath.Join(configDir(), "asana-tokens.json")
	data, err := os.ReadFile(tokenPath)
	if err != nil {
		return false
	}
	var tokens map[string]interface{}
	if err := json.Unmarshal(data, &tokens); err != nil {
		return false
	}
	_, ok := tokens["refresh_token"]
	return ok
}

// getAsanaOAuthName reads the access token from asana-tokens.json and
// calls the Asana userinfo API to get the user's name. Returns "" on any
// error. Does NOT attempt to refresh an expired token (avoids complexity in Go).
func getAsanaOAuthName() string {
	tokenPath := filepath.Join(configDir(), "asana-tokens.json")
	data, err := os.ReadFile(tokenPath)
	if err != nil {
		return ""
	}
	var tokens struct {
		AccessToken string  `json:"access_token"`
		ExpiresAt   float64 `json:"expires_at"`
	}
	if err := json.Unmarshal(data, &tokens); err != nil || tokens.AccessToken == "" {
		return ""
	}
	// Skip if token is expired (no refresh from Go)
	if float64(time.Now().UnixMilli()) >= tokens.ExpiresAt {
		return ""
	}

	client := &http.Client{Timeout: 5 * time.Second}
	req, err := http.NewRequest("GET", "https://app.asana.com/api/1.0/users/me", nil)
	if err != nil {
		return ""
	}
	req.Header.Set("Authorization", "Bearer "+tokens.AccessToken)
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != 200 {
		return ""
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return ""
	}
	var result struct {
		Data struct {
			Name string `json:"name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return ""
	}
	return result.Data.Name
}

// asanaOAuthStatusLabel returns a styled status line and whether Asana OAuth is connected.
func asanaOAuthStatusLabel() (string, bool) {
	passStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))
	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))

	if isAsanaOAuthConnected() {
		name := getAsanaOAuthName()
		if name != "" {
			return passStyle.Render("✔") + " Asana OAuth: " + name, true
		}
		return passStyle.Render("✔") + " Asana OAuth" + dimStyle.Render(": connected"), true
	}
	warnStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("11"))
	return warnStyle.Render("○") + " Asana OAuth" + dimStyle.Render(": sign in with browser"), false
}

// runAsanaOAuthFromPicker is the entry point when the user selects @@asana-oauth
// from the settings picker. It branches based on connection state.
func runAsanaOAuthFromPicker() error {
	if isAsanaOAuthConnected() {
		return runAsanaOAuthManage()
	}
	return runAsanaOAuthSetup()
}

// runAsanaOAuthSetup shows "Sign in with browser" / "Paste a PAT" / "Skip" for first-time connection.
func runAsanaOAuthSetup() error {
	var choice string
	form := huh.NewForm(huh.NewGroup(
		huh.NewSelect[string]().
			Title("How would you like to authenticate with Asana?").
			Options(
				huh.NewOption("Sign in with browser (recommended)", "browser"),
				huh.NewOption("Paste a Personal Access Token", "pat"),
				huh.NewOption("Skip", "skip"),
			).
			Value(&choice),
	)).WithTheme(huh.ThemeCharm())

	if err := huhFormRun(form); err != nil {
		return err
	}

	switch choice {
	case "browser":
		return runAsanaOAuthFlow()
	case "pat":
		// Fall through to PAT input — find the Asana credential and prompt
		return promptAsanaPATFromOAuthSetup()
	case "skip":
		return nil
	}
	return nil
}

// promptAsanaPATFromOAuthSetup prompts for and saves an Asana PAT via the .env file.
func promptAsanaPATFromOAuthSetup() error {
	passStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))

	c := &credential{envKey: "ASANA_API_TOKEN", label: "Asana API Token", optional: true}
	if err := promptCredentialInput(c); err != nil {
		return err
	}
	if c.value == "" {
		return nil
	}

	envPath := filepath.Join(configDir(), ".env")
	if err := updateEnvKey(envPath, "ASANA_API_TOKEN", c.value); err != nil {
		return fmt.Errorf("failed to save Asana token: %w", err)
	}
	fmt.Fprintln(os.Stderr, "  "+passStyle.Render("✔")+" Asana PAT saved.")
	return nil
}

// runAsanaOAuthFlow invokes the asana-auth.ts service script for browser-based auth.
func runAsanaOAuthFlow() error {
	passStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))

	fmt.Fprintln(os.Stderr, "\n  Starting Asana sign-in...")
	result, err := serviceScriptRunner("asana-auth.ts", map[string]interface{}{
		"action": "authorize",
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "  ⚠ Asana OAuth connection failed: %s\n", err.Error())
		return nil
	}
	if result == nil {
		return nil
	}
	if okVal, ok := result["ok"].(bool); ok && okVal {
		msg := "Asana connected!"
		if name, ok := result["name"].(string); ok && name != "" {
			msg = fmt.Sprintf("Asana connected as %s", name)
		}
		fmt.Fprintln(os.Stderr, "  "+passStyle.Render("✔")+" "+msg)
	} else if errMsg, ok := result["error"].(string); ok {
		fmt.Fprintf(os.Stderr, "  ⚠ Asana OAuth connection failed: %s\n", errMsg)
	}
	return nil
}

// runAsanaOAuthManage shows Reconnect / Disconnect / Keep for already-connected state.
func runAsanaOAuthManage() error {
	passStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))
	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))

	name := getAsanaOAuthName()
	status := "connected"
	if name != "" {
		status = name
	}
	fmt.Fprintf(os.Stderr, "\n  Asana OAuth: %s\n\n", dimStyle.Render(status))

	var choice string
	form := huh.NewForm(huh.NewGroup(
		huh.NewSelect[string]().
			Title("Asana OAuth is connected").
			Options(
				huh.NewOption("Keep current connection", "keep"),
				huh.NewOption("Reconnect (new account or refresh)", "reconnect"),
				huh.NewOption("Disconnect", "disconnect"),
			).
			Value(&choice),
	)).WithTheme(huh.ThemeCharm())

	if err := huhFormRun(form); err != nil {
		return err
	}

	switch choice {
	case "disconnect":
		return disconnectAsanaOAuth()
	case "reconnect":
		return runAsanaOAuthSetup()
	case "keep":
		fmt.Fprintln(os.Stderr, "\n  "+passStyle.Render("✔")+" No changes made.")
	}
	return nil
}

// disconnectAsanaOAuth removes the Asana OAuth token file.
func disconnectAsanaOAuth() error {
	passStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))

	tokenPath := filepath.Join(configDir(), "asana-tokens.json")
	if err := os.Remove(tokenPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove token file: %w", err)
	}
	fmt.Fprintln(os.Stderr, "\n  "+passStyle.Render("✔")+" Asana OAuth disconnected.")
	return nil
}

// promptAsanaAuth offers browser-based OAuth or manual PAT entry for Asana.
// Used during the interactive credential setup loop.
func promptAsanaAuth(c *credential) error {
	var method string
	form := huh.NewForm(huh.NewGroup(
		huh.NewSelect[string]().
			Title("How would you like to authenticate with Asana?").
			Options(
				huh.NewOption("Sign in with browser (recommended)", "browser"),
				huh.NewOption("Paste a Personal Access Token", "pat"),
				huh.NewOption("Skip (Asana is optional)", "skip"),
			).
			Value(&method),
	)).WithTheme(huh.ThemeCharm())

	if err := huhFormRun(form); err != nil {
		return err
	}

	switch method {
	case "pat":
		return promptCredentialInput(c)
	case "skip":
		c.status = "skipped"
		return nil
	case "browser":
		passStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))

		fmt.Fprintln(os.Stderr, "\n  Starting Asana sign-in...")
		result, err := serviceScriptRunner("asana-auth.ts", map[string]interface{}{
			"action": "authorize",
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "  Asana OAuth failed: %s\n", err.Error())
			fmt.Fprintln(os.Stderr, "  Falling back to manual token entry...")
			return promptCredentialInput(c)
		}

		if okVal, ok := result["ok"].(bool); ok && okVal {
			// OAuth succeeded — mark credential as valid (no PAT needed)
			c.status = "valid"
			name, _ := result["name"].(string)
			if name != "" {
				c.detail = fmt.Sprintf("Connected as %s (OAuth)", name)
				fmt.Fprintln(os.Stderr, "  "+passStyle.Render("✔")+" "+c.detail)
			} else {
				c.detail = "Authenticated via OAuth"
				fmt.Fprintln(os.Stderr, "  "+passStyle.Render("✔")+" Asana authenticated via OAuth")
			}
			return nil
		}

		// OAuth returned but failed
		if errMsg, ok := result["error"].(string); ok && errMsg != "" {
			fmt.Fprintf(os.Stderr, "  Asana OAuth failed: %s\n", errMsg)
		}
		fmt.Fprintln(os.Stderr, "  Falling back to manual token entry...")
		return promptCredentialInput(c)
	}

	// Default fallback (shouldn't reach here, but safe)
	return promptCredentialInput(c)
}

// countBoards reads a boards JSON file and returns the board count.
func countBoards(path string) (int, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, false
	}
	var parsed struct {
		Boards []json.RawMessage `json:"boards"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil || len(parsed.Boards) == 0 {
		return 0, false
	}
	return len(parsed.Boards), true
}

// stripInlineComment removes inline comments from a .env value string.
// Quoted values (starting with " or ') are closed at the matching quote;
// unquoted values are truncated at the first ` #` or `\t#`.
func stripInlineComment(val string) string {
	if len(val) == 0 {
		return val
	}
	// If value starts with a quote, find the closing quote and take only that portion.
	if val[0] == '"' || val[0] == '\'' {
		quote := val[0]
		end := strings.IndexByte(val[1:], quote)
		if end >= 0 {
			return val[:end+2] // include both quotes
		}
		return val // no closing quote found — return as-is
	}
	// Unquoted: find the first # preceded by whitespace.
	for i := 1; i < len(val); i++ {
		if val[i] == '#' && (val[i-1] == ' ' || val[i-1] == '\t') {
			return strings.TrimRight(val[:i-1], " \t")
		}
	}
	return val
}

// loadExistingCredentials reads an existing .env file into a map.
func loadExistingCredentials(path string) map[string]string {
	result := make(map[string]string)

	f, err := os.Open(path)
	if err != nil {
		return result
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			key := strings.TrimSpace(parts[0])
			val := strings.TrimSpace(parts[1])
			// Strip inline comments before stripping quotes
			val = stripInlineComment(val)
			// Strip quotes
			val = strings.Trim(val, `"'`)
			if val != "" {
				result[key] = val
			}
		}
	}

	return result
}

// writeEnvFile writes credentials to .env, preserving key-value lines and blank lines.
// Standalone comment lines are dropped on save for cleanliness.
// It updates known credential keys in-place and appends any new ones.
func writeEnvFile(path string, creds []credential) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	// Read existing file content to preserve ordering and extra keys
	existingContent, _ := os.ReadFile(path)
	existingLines := strings.Split(string(existingContent), "\n")

	// Track which credentials we've updated in-place
	written := make(map[string]bool)

	var outLines []string
	for _, line := range existingLines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") {
			continue // Drop standalone comment lines
		}
		if trimmed == "" {
			outLines = append(outLines, line)
			continue
		}
		parts := strings.SplitN(trimmed, "=", 2)
		if len(parts) != 2 {
			outLines = append(outLines, line)
			continue
		}
		key := strings.TrimSpace(parts[0])
		// Check if this key matches one of the credentials to update
		updated := false
		for _, c := range creds {
			if c.envKey == key {
				if c.value != "" {
					outLines = append(outLines, fmt.Sprintf("%s=%s", c.envKey, c.value))
				}
				// If value is empty, omit the line (credential was cleared)
				written[key] = true
				updated = true
				break
			}
		}
		if !updated {
			outLines = append(outLines, line)
		}
	}

	// Append any new credentials that weren't in the file
	for _, c := range creds {
		if !written[c.envKey] && c.value != "" {
			outLines = append(outLines, fmt.Sprintf("%s=%s", c.envKey, c.value))
		}
	}

	content := strings.Join(outLines, "\n")
	// Ensure trailing newline (POSIX text file requirement)
	if !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	return os.WriteFile(path, []byte(content), 0o600)
}

// updateEnvKey updates a single key in the .env file, preserving everything else.
func updateEnvKey(path string, key, value string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		// File doesn't exist — create with just this key
		content := fmt.Sprintf("%s=%s\n", key, value)
		return os.WriteFile(path, []byte(content), 0o600)
	}

	lines := strings.Split(string(data), "\n")
	found := false
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		parts := strings.SplitN(trimmed, "=", 2)
		if len(parts) == 2 && strings.TrimSpace(parts[0]) == key {
			// Preserve any inline comment
			lines[i] = fmt.Sprintf("%s=%s", key, value)
			found = true
			break
		}
	}

	if !found {
		lines = append(lines, fmt.Sprintf("%s=%s", key, value))
	}

	content := strings.Join(lines, "\n")
	// Ensure trailing newline (POSIX text file requirement)
	if !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	return os.WriteFile(path, []byte(content), 0o600)
}

// runExpressSetupPrompt is a minimal credential gate called from runInteractive
// when no credentials exist. It prompts for GitHub + OpenAI only.
func runExpressSetupPrompt() error {
	if HasCredentials() {
		return nil
	}

	passStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))
	warnStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("11"))

	fmt.Fprintf(os.Stderr, "\n  %s No credentials found.\n\n", warnStyle.Render("⚠"))

	var proceed bool
	form := huh.NewForm(huh.NewGroup(
		huh.NewSelect[bool]().
			Title("Set up credentials now? (takes ~30 seconds)").
			Options(
				huh.NewOption("Yes, let's go", true),
				huh.NewOption("No, exit", false),
			).
			Value(&proceed),
	)).WithTheme(huh.ThemeCharm())

	if err := huhFormRun(form); err != nil {
		return err
	}

	if !proceed {
		return fmt.Errorf("run `teamhero setup` first to configure credentials")
	}

	envPath := filepath.Join(configDir(), ".env")
	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub Personal Access Token", optional: false},
		{envKey: "OPENAI_API_KEY", label: "OpenAI API Key", optional: false},
	}

	for i := range creds {
		if creds[i].envKey == "GITHUB_PERSONAL_ACCESS_TOKEN" {
			if err := promptGitHubAuth(&creds[i]); err != nil {
				return err
			}
		} else {
			if err := promptCredentialInput(&creds[i]); err != nil {
				return err
			}
		}
	}

	fmt.Fprintln(os.Stderr, "\n  Validating credentials…")
	validateCredentials(creds)

	hasFailure := false
	for _, c := range creds {
		if c.status == "invalid" {
			hasFailure = true
			fmt.Fprintf(os.Stderr, "  ✖ %s: %s\n", c.label, c.detail)
		} else {
			fmt.Fprintf(os.Stderr, "  ✔ %s: %s\n", c.label, c.detail)
		}
	}

	if err := writeEnvFile(envPath, creds); err != nil {
		return fmt.Errorf("failed to write credentials: %w", err)
	}

	if hasFailure {
		fmt.Fprintln(os.Stderr, "\n  "+warnStyle.Render("⚠ Some credentials failed validation. They were saved but may not work."))
	}

	fmt.Fprintln(os.Stderr, "\n  "+passStyle.Render("✔")+" Credentials saved.\n")
	return nil
}

// parseEnvFile reads a .env file and returns a stream of lines.
func parseEnvFile(r io.Reader) map[string]string {
	result := make(map[string]string)
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			val := strings.TrimSpace(parts[1])
			val = stripInlineComment(val)
			result[strings.TrimSpace(parts[0])] = val
		}
	}
	return result
}

// resolveServiceScript finds a TypeScript script in the scripts/ directory,
// using the same resolution strategy as resolveScriptPath / resolveDiscoverScript.
func resolveServiceScript(script string) string {
	// Relative to the binary itself (installed layout)
	exePath, err := os.Executable()
	if err == nil {
		dir := filepath.Dir(exePath)
		candidate := filepath.Join(dir, "..", "scripts", script)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}

	// Relative to CWD (development layout)
	candidate := filepath.Join("scripts", script)
	if _, err := os.Stat(candidate); err == nil {
		return candidate
	}

	// Absolute fallback
	home, _ := os.UserHomeDir()
	locations := []string{
		filepath.Join(home, "teamhero.scripts", "scripts", script),
	}
	for _, loc := range locations {
		if _, err := os.Stat(loc); err == nil {
			return loc
		}
	}

	return filepath.Join("scripts", script)
}

// runServiceScript executes a TypeScript script via Bun and returns parsed JSON output.
// It follows the same binary/bun resolution pattern used by RunServiceRunner and Discover*.
func runServiceScript(script string, input interface{}) (map[string]interface{}, error) {
	scriptPath := resolveServiceScript(script)

	var cmd *exec.Cmd
	if serviceBin := resolveServiceBinary(); serviceBin != "" {
		cmd = exec.Command(serviceBin, "--script", script)
	} else {
		cmd = exec.Command(resolveBunBinary(), "run", scriptPath)
	}

	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = os.Stderr

	if input != nil {
		data, _ := json.Marshal(input)
		cmd.Stdin = bytes.NewReader(data)
	}

	if err := cmd.Run(); err != nil {
		return nil, err
	}

	var result map[string]interface{}
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		return nil, err
	}
	return result, nil
}
