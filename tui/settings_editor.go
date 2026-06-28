package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
)

type editMode int

const (
	modeNavigate editMode = iota
	modeEdit
)

// inputType determines how an editorItem is edited.
type inputType int

const (
	inputText    inputType = iota // free-form text (default)
	inputBool                     // true/false toggle
	inputYesNo                    // Yes/No toggle (for config.json fields)
	inputNumber                   // numeric input with validation
	inputSelect                   // select from predefined options
	inputJSON                     // multi-line JSON editor
)

// editorItem represents one editable row in the settings editor.
type editorItem struct {
	key         string    // envKey or special key like "@@gdrive", "@@boards"
	label       string    // display name
	category    string    // category for grouping
	value       string    // current value
	sensitive   bool      // mask value display
	defaultVal  string    // shown when value is empty
	special     bool      // true for items that open sub-flows (not inline-editable)
	description string    // help text shown in the right panel
	itype       inputType // how this item is edited
	options     []string  // valid options for inputSelect
}

// editorLine represents one rendered line (could be a header, blank, or item).
type editorLine struct {
	text      string
	itemIndex int // -1 for non-selectable lines (headers, blanks)
}

type inlineSettingsEditor struct {
	items          []editorItem
	lines          []editorLine
	cursor         int // index into lines (only stops on selectable lines)
	mode           editMode
	editIdx        int // which item is being edited
	textInput      textinput.Model
	editForm       *huh.Form     // huh form used for typed editing (bool, select, etc.)
	editVal        string        // bound value for the edit form
	viewport       viewport.Model // left panel (settings list)
	helpVP         viewport.Model // right panel (help/description)
	lastHelpCursor int            // last cursor position for help panel scroll reset
	ready          bool
	quitting       bool
	width          int
	height         int
	envPath        string // path to .env file
	statusMsg      string // transient feedback message (e.g., "Saved", "Invalid")
	action         string // pending special action key (set on quit)
}

func newInlineSettingsEditor(allEntries map[string]string, creds []credential, boardsStatus boardsConfigStatus) inlineSettingsEditor {
	credsMap := make(map[string]*credential)
	for i := range creds {
		credsMap[creds[i].envKey] = &creds[i]
	}

	var items []editorItem
	var lines []editorLine
	seen := make(map[string]bool)
	lastCategory := ""

	for _, def := range knownSettings {
		if def.hidden {
			continue
		}
		if def.category != lastCategory {
			// Inject Visible Wins boards right after Asana settings
			if lastCategory == "Asana" {
				boardsItem := buildBoardsItem(boardsStatus)
				boardsIdx := len(items)
				items = append(items, boardsItem)
				lines = append(lines, editorLine{text: formatEditorLine(boardsItem), itemIndex: boardsIdx})
			}

			// Inject Google Drive + GitHub options right after Core Credentials
			if lastCategory == "Creds" {
				gdItem := buildGDriveItem()
				gdIdx := len(items)
				items = append(items, gdItem)
				lines = append(lines, editorLine{text: formatEditorLine(gdItem), itemIndex: gdIdx})

				// GitHub options (from config.json)
				lines = append(lines, editorLine{text: "", itemIndex: -1})
				lines = append(lines, editorLine{text: "  GitHub", itemIndex: -1})
				savedCfg, _ := LoadSavedConfig()
				if savedCfg == nil {
					savedCfg = &ReportConfig{}
				}
				ghItems := []editorItem{
					{key: "@@private_repos", label: "Include Private Repos", value: boolToYesNo(!savedCfg.ExcludePrivate), defaultVal: "Yes", description: "Include private repositories when fetching from the org. Applies to all reports.", itype: inputYesNo},
					{key: "@@archived_repos", label: "Include Archived Repos", value: boolToYesNo(savedCfg.IncludeArchived), defaultVal: "No", description: "Include archived repositories in reports.", itype: inputYesNo},
					{key: "@@include_bots", label: "Include Bot Accounts", value: boolToYesNo(savedCfg.IncludeBots), defaultVal: "No", description: "Include bot accounts in team member analysis.", itype: inputYesNo},
				}
				for _, ci := range ghItems {
					idx := len(items)
					items = append(items, ci)
					lines = append(lines, editorLine{text: formatEditorLine(ci), itemIndex: idx})
				}
			}

			if lastCategory != "" {
				lines = append(lines, editorLine{text: "", itemIndex: -1})
			}
			lines = append(lines, editorLine{
				text:      "  " + categoryDisplayName(def.category),
				itemIndex: -1,
			})
			lastCategory = def.category
		}

		seen[def.envKey] = true
		val := allEntries[def.envKey]

		item := editorItem{
			key:         def.envKey,
			label:       def.label,
			category:    def.category,
			value:       val,
			sensitive:   def.sensitive,
			defaultVal:  def.defaultVal,
			description: settingHelpText(def.envKey, def.description),
			itype:       def.itype,
			options:     def.options,
		}

		// Check if this is a credential with validation details
		if c, isCred := credsMap[def.envKey]; isCred {
			item.value = c.value
			if item.value == "" {
				item.value = val
			}
		}

		itemIdx := len(items)
		items = append(items, item)
		lines = append(lines, editorLine{text: formatEditorLine(item), itemIndex: itemIdx})
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
		lines = append(lines, editorLine{text: "", itemIndex: -1})
		lines = append(lines, editorLine{text: "  Other", itemIndex: -1})
		for _, key := range extraKeys {
			val := allEntries[key]
			item := editorItem{
				key:      key,
				label:    key,
				category: "Other",
				value:    val,
			}
			itemIdx := len(items)
			items = append(items, item)
			lines = append(lines, editorLine{text: formatEditorLine(item), itemIndex: itemIdx})
		}
	}

	// Initialize text input
	ti := textinput.New()
	ti.CharLimit = 4096

	m := inlineSettingsEditor{
		items:          items,
		lines:          lines,
		textInput:      ti,
		envPath:        envPath(),
		lastHelpCursor: -1,
	}

	// Set cursor to first selectable line
	m.cursor = m.firstSelectableLine()

	return m
}

// envPath returns the path to the .env file.
func envPath() string {
	return configDir() + "/.env"
}

// buildGDriveItem creates the Google Drive special item.
func buildGDriveItem() editorItem {
	connected := isGoogleDriveConnected()
	label := "Google Drive"
	val := "not connected"
	if connected {
		email := getGoogleDriveEmail()
		if email != "" {
			val = email
		} else {
			val = "connected"
		}
	}
	desc := "Connect Google Drive to automatically pull meeting transcripts from Google Meet recordings. Press Enter to connect or manage."
	itype := inputSelect
	var opts []string
	if connected {
		opts = []string{"Manage connection", "Disconnect"}
	} else {
		opts = []string{"Connect now"}
	}
	return editorItem{
		key:         "@@gdrive",
		label:       label,
		value:       val,
		special:     true,
		description: desc,
		itype:       itype,
		options:     opts,
	}
}

// buildBoardsItem creates the Boards item with JSON editing support.
func buildBoardsItem(status boardsConfigStatus) editorItem {
	label := "Visible Wins boards"
	val := ""
	displayVal := "not set"
	if status.found {
		displayVal = fmt.Sprintf("%d configured", status.count)
		// Load the actual JSON for editing
		data, err := os.ReadFile(status.path)
		if err == nil {
			val = string(data)
		}
	}
	return editorItem{
		key:         "@@boards",
		label:       label,
		value:       val,
		defaultVal:  displayVal,
		itype:       inputJSON,
		description: "Configure which Asana boards to pull Visible Wins from. Each board entry has a projectGid, sections, label, and optional priorityField. Edit the JSON directly.",
	}
}

// boolToYesNo converts a bool to "Yes" or "No".
func boolToYesNo(b bool) string {
	if b {
		return "Yes"
	}
	return "No"
}

// settingHelpText returns help text for a setting, using the description from
// settingDef or providing a richer default for well-known keys.
func settingHelpText(envKey, description string) string {
	// Provide richer help for credentials and common settings
	switch envKey {
	case "GITHUB_PERSONAL_ACCESS_TOKEN":
		return "GitHub access for repos, pull requests, commits, and org members. Press Enter to choose: sign in with GitHub (OAuth), paste a Personal Access Token, or disconnect."
	case "OPENAI_API_KEY":
		return "OpenAI API key for AI-powered summaries, member highlights, and discrepancy analysis. Get one at platform.openai.com/api-keys"
	case "ASANA_API_TOKEN":
		return "Asana authentication for Visible Wins. Press Enter to sign in with OAuth or paste a personal access token. Optional — only needed if you use Asana boards."
	case "USER_MAP":
		return "Maps GitHub logins to Asana identities so the report can cross-reference contributions. Format: JSON object keyed by short name, each with name, email, github.login, and asana fields."
	case "TEAMHERO_DISCREPANCY_CONFIDENCE_THRESHOLD":
		return "Only discrepancies with confidence >= this value appear in the report summary (0–100). The full Discrepancy Log always shows all entries regardless of this threshold."
	}
	if description != "" {
		return description
	}
	return "Press Enter to edit this value."
}

// formatEditorLine formats an editorItem into a plain display string (no ANSI styles).
func formatEditorLine(item editorItem) string {
	displayVal := item.value
	if displayVal == "" && item.defaultVal != "" {
		displayVal = item.defaultVal
	} else if displayVal == "" {
		displayVal = "(not set)"
	} else if item.sensitive {
		displayVal = maskValue(displayVal)
	} else {
		displayVal = settingDisplayValue(item.key, displayVal)
		if len(displayVal) > 50 {
			displayVal = displayVal[:47] + "..."
		}
	}

	return fmt.Sprintf("    %s = %s", item.label, displayVal)
}

// renderStyledLine renders an editor line with proper color coding.
func renderStyledLine(item editorItem) string {
	labelStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("15"))  // white/bright
	valueStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))  // green for set values
	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))   // dim gray
	warnStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("11"))   // yellow

	displayVal := item.value
	var styledVal string

	if displayVal == "" && item.defaultVal != "" {
		styledVal = dimStyle.Render(item.defaultVal)
	} else if displayVal == "" {
		styledVal = dimStyle.Render("(not set)")
	} else if item.sensitive {
		styledVal = valueStyle.Render(maskValue(displayVal))
	} else if item.special {
		dv := settingDisplayValue(item.key, displayVal)
		if displayVal == "not connected" || displayVal == "not set" {
			styledVal = warnStyle.Render(dv)
		} else {
			styledVal = valueStyle.Render(dv)
		}
	} else {
		dv := settingDisplayValue(item.key, displayVal)
		if len(dv) > 50 {
			dv = dv[:47] + "..."
		}
		styledVal = valueStyle.Render(dv)
	}

	return fmt.Sprintf("    %s %s %s", labelStyle.Render(item.label), dimStyle.Render("="), styledVal)
}

func (m *inlineSettingsEditor) Init() tea.Cmd {
	return textinput.Blink
}

func (m *inlineSettingsEditor) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		headerHeight := 3 // title + blank line
		footerHeight := 2 // hint
		borderHeight := 2 // HiddenBorder top+bottom on the left panel frame
		panelHeight := msg.Height - headerHeight - footerHeight - borderHeight
		if panelHeight < 5 {
			panelHeight = 5
		}
		// Left panel gets 60% width, right gets the rest
		formWidth := msg.Width * 3 / 5
		helpWidth := msg.Width - formWidth - 4 // 2 gap + 2 border
		if helpWidth < 15 {
			helpWidth = 15
		}
		if !m.ready {
			m.viewport = viewport.New(formWidth-2, panelHeight)
			m.helpVP = viewport.New(helpWidth, panelHeight)
			m.ready = true
		} else {
			m.viewport.Width = formWidth - 2
			m.viewport.Height = panelHeight
			m.helpVP.Width = helpWidth
			m.helpVP.Height = panelHeight
		}
		return m, nil

	case tea.KeyMsg:
		if m.mode == modeEdit {
			return m.handleEditKey(msg)
		}
		return m.handleNavigateKey(msg)
	}

	// Forward non-key messages to edit form if active
	if m.mode == modeEdit && m.editForm != nil {
		model, cmd := m.editForm.Update(msg)
		if f, ok := model.(*huh.Form); ok {
			m.editForm = f
			if f.State == huh.StateCompleted {
				return m.confirmEdit()
			}
		}
		return m, cmd
	}

	var cmd tea.Cmd
	m.viewport, cmd = m.viewport.Update(msg)
	return m, cmd
}

func (m *inlineSettingsEditor) handleNavigateKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "up", "k":
		m.moveCursor(-1)
		m.ensureCursorVisible()
		return m, nil
	case "down", "j":
		m.moveCursor(1)
		m.ensureCursorVisible()
		return m, nil
	case "home":
		m.cursor = m.firstSelectableLine()
		m.ensureCursorVisible()
		return m, nil
	case "end":
		m.cursor = m.lastSelectableLine()
		m.ensureCursorVisible()
		return m, nil
	case "enter":
		return m.enterEditOrSpecial()
	case "pgup":
		m.helpVP.LineUp(5)
		return m, nil
	case "pgdown":
		m.helpVP.LineDown(5)
		return m, nil
	case "q", "esc":
		m.quitting = true
		return m, tea.Quit
	case "ctrl+c":
		m.quitting = true
		return m, tea.Quit
	}
	return m, nil
}

func (m *inlineSettingsEditor) handleEditKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if msg.String() == "esc" {
		m.mode = modeNavigate
		m.editForm = nil
		m.statusMsg = ""
		return m, nil
	}

	// Delegate to the huh form
	if m.editForm != nil {
		model, cmd := m.editForm.Update(msg)
		if f, ok := model.(*huh.Form); ok {
			m.editForm = f
			if f.State == huh.StateCompleted {
				return m.confirmEdit()
			}
		}
		return m, cmd
	}
	return m, nil
}

func (m *inlineSettingsEditor) confirmEdit() (tea.Model, tea.Cmd) {
	if m.editIdx < 0 || m.editIdx >= len(m.items) {
		m.mode = modeNavigate
		return m, nil
	}
	item := &m.items[m.editIdx]
	newVal := strings.TrimSpace(m.editVal)

	// Handle @@gdrive selection — quit to the OAuth sub-flow
	if item.key == "@@gdrive" && newVal != "" {
		m.editForm = nil
		m.quitting = true
		m.action = "@@gdrive"
		return m, tea.Quit
	}

	// Handle "custom..." selection — switch to free-text input
	if newVal == "custom..." {
		m.editVal = item.value // pre-populate with current value
		f := huh.NewForm(huh.NewGroup(
			huh.NewInput().
				Title(item.label + " (custom)").
				Value(&m.editVal),
		)).WithTheme(huh.ThemeCharm()).WithWidth(40)
		m.editForm = f
		return m, f.Init()
	}

	m.editForm = nil

	// Handle @@boards JSON — write to asana-config.json
	if item.key == "@@boards" {
		boardsPath := filepath.Join(configDir(), "asana-config.json")
		if newVal == "" {
			// Clear the boards config
			os.Remove(boardsPath)
			item.value = ""
			item.defaultVal = "not set"
		} else {
			// Compact the JSON for storage, then write
			if err := os.MkdirAll(filepath.Dir(boardsPath), 0o755); err == nil {
				os.WriteFile(boardsPath, []byte(newVal), 0o644)
			}
			item.value = newVal
			// Count boards for display
			var parsed struct{ Boards []json.RawMessage `json:"boards"` }
			if json.Unmarshal([]byte(newVal), &parsed) == nil {
				item.defaultVal = fmt.Sprintf("%d configured", len(parsed.Boards))
			}
		}
		m.statusMsg = "Saved"
		m.mode = modeNavigate
		m.rebuildLine(m.cursor)
		return m, nil
	}

	// Handle config.json keys (Report Defaults)
	if item.key == "@@private_repos" || item.key == "@@archived_repos" || item.key == "@@include_bots" {
		cfg, _ := LoadSavedConfig()
		if cfg == nil {
			cfg = &ReportConfig{}
		}
		lower := strings.ToLower(newVal)
		isYes := lower == "yes" || lower == "y" || lower == "true" || lower == "1"
		switch item.key {
		case "@@private_repos":
			cfg.ExcludePrivate = !isYes
		case "@@archived_repos":
			cfg.IncludeArchived = isYes
		case "@@include_bots":
			cfg.IncludeBots = isYes
		}
		_ = SaveConfig(cfg)
		item.value = boolToYesNo(isYes)
		m.statusMsg = "Saved"
		m.mode = modeNavigate
		m.rebuildLine(m.cursor)
		return m, nil
	}

	if newVal != "" {
		storeVal := newVal
		// For JSON values in .env, compact to single line with single-quote wrapping
		if item.itype == inputJSON && looksLikeJSON(storeVal) {
			var buf bytes.Buffer
			if json.Compact(&buf, []byte(storeVal)) == nil {
				storeVal = "'" + buf.String() + "'"
			}
		} else {
			// Translate display value to stored value (e.g., "sequential" -> "true")
			storeVal = settingStoreValue(item.key, storeVal)
		}
		updateEnvKey(m.envPath, item.key, storeVal)
		item.value = storeVal
		m.statusMsg = "Saved"
	} else if item.value != "" {
		// Clear the value
		updateEnvKey(m.envPath, item.key, "")
		item.value = ""
		m.statusMsg = "Cleared"
	} else {
		m.statusMsg = ""
	}

	m.mode = modeNavigate
	// Rebuild the line text for this item
	m.rebuildLine(m.cursor)
	return m, nil
}

func (m *inlineSettingsEditor) enterEditOrSpecial() (tea.Model, tea.Cmd) {
	if m.cursor < 0 || m.cursor >= len(m.lines) {
		return m, nil
	}
	line := m.lines[m.cursor]
	if line.itemIndex < 0 {
		return m, nil
	}
	item := m.items[line.itemIndex]
	if item.special && item.itype != inputSelect {
		m.quitting = true
		m.action = item.key
		return m, tea.Quit
	}

	// GitHub: leave Bubble Tea and run OAuth / PAT / disconnect (device flow needs stderr + browser).
	if item.key == "GITHUB_PERSONAL_ACCESS_TOKEN" {
		m.quitting = true
		m.action = actionInlineGitHubAuth
		return m, tea.Quit
	}

	m.mode = modeEdit
	m.editIdx = line.itemIndex
	m.statusMsg = ""

	// Build a typed huh form based on the item's input type
	switch item.itype {
	case inputBool:
		// true/false toggle
		currentVal := strings.ToLower(item.value)
		if currentVal == "" {
			currentVal = strings.ToLower(item.defaultVal)
		}
		m.editVal = currentVal
		f := huh.NewForm(huh.NewGroup(
			huh.NewSelect[string]().
				Title(item.label).
				Options(
					huh.NewOption("true", "true"),
					huh.NewOption("false", "false"),
				).
				Value(&m.editVal),
		)).WithTheme(huh.ThemeCharm()).WithWidth(40)
		m.editForm = f
		return m, f.Init()

	case inputYesNo:
		// Yes/No toggle
		currentVal := item.value
		if currentVal == "" {
			currentVal = item.defaultVal
		}
		m.editVal = currentVal
		f := huh.NewForm(huh.NewGroup(
			huh.NewSelect[string]().
				Title(item.label).
				Options(
					huh.NewOption("Yes", "Yes"),
					huh.NewOption("No", "No"),
				).
				Value(&m.editVal),
		)).WithTheme(huh.ThemeCharm()).WithWidth(40)
		m.editForm = f
		return m, f.Init()

	case inputSelect:
		// Select from predefined options
		currentVal := settingDisplayValue(item.key, item.value)
		if currentVal == "" {
			currentVal = item.defaultVal
		}
		m.editVal = currentVal
		var opts []huh.Option[string]
		for _, o := range item.options {
			label := o
			if label == "" {
				label = "(default)"
			}
			opt := huh.NewOption(label, o)
			opts = append(opts, opt)
		}
		f := huh.NewForm(huh.NewGroup(
			huh.NewSelect[string]().
				Title(item.label).
				Options(opts...).
				Value(&m.editVal),
		)).WithTheme(huh.ThemeCharm()).WithWidth(40)
		m.editForm = f
		return m, f.Init()

	case inputNumber:
		// Numeric input with validation
		editVal := item.value
		if editVal == "" {
			editVal = item.defaultVal
		}
		m.editVal = editVal
		f := huh.NewForm(huh.NewGroup(
			huh.NewInput().
				Title(item.label).
				Value(&m.editVal).
				Validate(func(s string) error {
					s = strings.TrimSpace(s)
					if s == "" {
						return nil // allow clearing
					}
					for _, c := range s {
						if c < '0' || c > '9' {
							return fmt.Errorf("must be a number")
						}
					}
					return nil
				}),
		)).WithTheme(huh.ThemeCharm()).WithWidth(40)
		m.editForm = f
		return m, f.Init()

	case inputJSON:
		// Multi-line JSON editor
		editVal := item.value
		if editVal == "" {
			editVal = item.defaultVal
		}
		// Pretty-print for editing
		if looksLikeJSON(editVal) {
			editVal = prettyPrintJSON(editVal)
		}
		m.editVal = editVal
		formWidth := min(m.width-8, 86)
		if formWidth < 40 {
			formWidth = 40
		}
		// Calculate modal chrome to size textarea so the full modal fits on screen:
		//   outer: shell header + 2 blanks + hint = 4
		//   modal: border (2) + padding (2) = 4
		//   header: title + blank + help (H lines) + blank = 3 + H
		//   form:  huh form view = textLines + 7 (title, padding, field separator)
		// Total = textLines + 18 + H  →  textLines = m.height - 18 - H
		modalWidth := min(m.width-4, 90)
		helpHeight := lipgloss.Height(renderHelpStyled(settingModalHelp(item.key), modalWidth-6))
		textLines := max(8, m.height-18-helpHeight)
		formHeight := textLines + 7
		f := huh.NewForm(huh.NewGroup(
			huh.NewText().
				CharLimit(16384).
				Title(item.label).
				Value(&m.editVal).
				Lines(textLines).
				Validate(func(s string) error {
					s = strings.TrimSpace(s)
					if s == "" {
						return nil // allow clearing
					}
					if !json.Valid([]byte(s)) {
						return fmt.Errorf("invalid JSON")
					}
					return nil
				}),
		)).WithTheme(huh.ThemeCharm()).WithWidth(formWidth).WithHeight(formHeight)
		m.editForm = f
		return m, f.Init()

	default:
		// Free-form text input (textinput or huh.Input)
		editVal := settingDisplayValue(item.key, item.value)
		m.editVal = editVal
		f := huh.NewForm(huh.NewGroup(
			huh.NewInput().
				Title(item.label).
				Value(&m.editVal),
		)).WithTheme(huh.ThemeCharm()).WithWidth(40)
		if item.sensitive {
			f = huh.NewForm(huh.NewGroup(
				huh.NewInput().
					Title(item.label).
					Value(&m.editVal).
					EchoMode(huh.EchoModePassword),
			)).WithTheme(huh.ThemeCharm()).WithWidth(40)
		}
		m.editForm = f
		return m, f.Init()
	}
}

func (m *inlineSettingsEditor) View() string {
	if !m.ready {
		w := m.width
		if w <= 0 {
			w = 80
		}
		return renderShellHeader(w) + "\n\n  Loading..."
	}

	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	headerStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("12"))
	cursorStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("14")) // cyan
	editStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("11"))   // yellow

	var content strings.Builder
	for i, line := range m.lines {
		if line.itemIndex < 0 {
			// Header or blank line
			if strings.TrimSpace(line.text) != "" {
				content.WriteString(headerStyle.Render(line.text) + "\n")
			} else {
				content.WriteString("\n")
			}
		} else if i == m.cursor {
			// Highlighted cursor line — cyan with arrow indicator
			item := m.items[line.itemIndex]
			displayVal := item.value
			if displayVal == "" && item.defaultVal != "" {
				displayVal = item.defaultVal
			} else if displayVal == "" {
				displayVal = "(not set)"
			} else if item.sensitive {
				displayVal = maskValue(displayVal)
			} else {
				displayVal = settingDisplayValue(item.key, displayVal)
				if len(displayVal) > 50 {
					displayVal = displayVal[:47] + "..."
				}
			}
			content.WriteString(cursorStyle.Render(fmt.Sprintf("  > %s = %s", item.label, displayVal)) + "\n")
		} else {
			// Normal line with color coding
			item := m.items[line.itemIndex]
			content.WriteString(renderStyledLine(item) + "\n")
		}
	}

	m.viewport.SetContent(content.String())

	// --- Layout: two-panel like the wizard ---
	w := m.width
	if w <= 0 {
		w = 80
	}

	title := renderShellHeader(w)

	// Left panel: settings list (60% width)
	formWidth := w * 3 / 5
	helpWidth := w - formWidth - 2 // 2 = gap

	leftFrame := lipgloss.NewStyle().
		Border(lipgloss.HiddenBorder()).
		Padding(0, 1)
	leftInnerWidth := max(20, formWidth-leftFrame.GetHorizontalFrameSize())
	leftPanel := leftFrame.Width(leftInnerWidth).Render(m.viewport.View())

	// Right panel: help/description in a scrollable viewport
	helpContent := m.renderHelpContent(helpWidth)
	m.helpVP.SetContent(helpContent)
	if m.cursor != m.lastHelpCursor {
		m.helpVP.GotoTop()
		m.lastHelpCursor = m.cursor
	}

	helpBoxStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("240")).
		Padding(0, 1)
	helpInnerWidth := helpWidth - helpBoxStyle.GetHorizontalBorderSize()
	// Constrain help viewport height to account for box border
	helpBoxBorderH := helpBoxStyle.GetVerticalBorderSize()
	if m.helpVP.Height > 0 {
		m.helpVP.Height = max(3, m.viewport.Height-helpBoxBorderH)
	}
	rightPanel := helpBoxStyle.Width(helpInnerWidth).Render(m.helpVP.View())

	left := lipgloss.NewStyle().Width(formWidth).Render(leftPanel)
	right := lipgloss.NewStyle().Width(helpWidth).Render(rightPanel)

	normalBody := lipgloss.JoinHorizontal(lipgloss.Top, left, "  ", right)

	var body string
	if m.mode == modeEdit && m.editForm != nil {
		// Render the edit form as a centered modal overlay
		bodyHeight := lipgloss.Height(normalBody)
		modalWidth := min(65, w-8)
		if m.editIdx >= 0 && m.editIdx < len(m.items) && m.items[m.editIdx].itype == inputJSON {
			modalWidth = min(w-4, 90) // wider for JSON
		}
		modal := m.renderEditModal(modalWidth)
		body = lipgloss.Place(w-2, bodyHeight, lipgloss.Center, lipgloss.Center, modal,
			lipgloss.WithWhitespaceChars(" "),
		)
	} else {
		body = normalBody
	}

	// Navigation hints
	hint := dimStyle.Render("  up/down navigate  Enter edit  Esc/q back")
	if m.mode == modeEdit {
		hint = editStyle.Render("  Esc cancel")
	}
	if m.statusMsg != "" {
		hint += "  " + dimStyle.Render(m.statusMsg)
	}

	return lipgloss.JoinVertical(lipgloss.Left, title, "", body, "", hint)
}

// renderEditModal builds a centered modal overlay containing contextual help and the edit form.
func (m *inlineSettingsEditor) renderEditModal(width int) string {
	if m.editIdx < 0 || m.editIdx >= len(m.items) {
		return ""
	}
	item := m.items[m.editIdx]

	headerStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("212"))

	modalStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("212")).
		Padding(1, 2).
		Width(width)

	contentWidth := width - 6 // borders + padding
	if contentWidth < 20 {
		contentWidth = 20
	}

	var lines []string
	lines = append(lines, headerStyle.Render(item.label))
	lines = append(lines, "")

	// Rich contextual help with lightweight formatting
	help := settingModalHelp(item.key)
	lines = append(lines, renderHelpStyled(help, contentWidth))
	lines = append(lines, "")

	// The huh form
	if m.editForm != nil {
		lines = append(lines, m.editForm.View())
	}

	content := strings.Join(lines, "\n")
	return modalStyle.Render(content)
}

// aiModelHelpTable returns a markdown table of available AI models for use in help text.
func aiModelHelpTable() string {
	return "| Model | Notes |\n" +
		"|-------|-------|\n" +
		"| gpt-4.1-nano | Cheapest, fastest. Good for large teams |\n" +
		"| gpt-4.1-mini | Low cost, solid quality |\n" +
		"| **gpt-5-mini** | **Default.** Best balance of cost and quality |\n" +
		"| gpt-5-nano | Very low cost. Good for high-volume batch calls |\n" +
		"| o3-mini | Reasoning model. Better analysis, higher cost |\n" +
		"| o4-mini | Latest reasoning. Best analysis, moderate cost |\n" +
		"| gpt-4.1 | Premium quality, higher cost |\n" +
		"| gpt-5 | Top tier. Best quality, highest cost |\n" +
		"| o3 | Full reasoning model. Highest cost |\n\n"
}

// settingModalHelp returns rich contextual help for a setting, shown inside the edit modal.
func settingModalHelp(envKey string) string {
	switch envKey {
	case "GITHUB_PERSONAL_ACCESS_TOKEN":
		return "Your GitHub credential grants read access to repositories, pull requests, commits, and organization members.\n\nPress Enter on this row to open a menu: **Quick Setup** (OAuth / browser sign-in), **Advanced** (paste a Personal Access Token), or **Disconnect** when a token is already saved.\n\nTo create a PAT: GitHub > Settings > Developer settings > Personal access tokens > Fine-grained tokens. Required scopes: Contents, Metadata, Pull requests, Members (read)."
	case "OPENAI_API_KEY":
		return "The OpenAI API key powers AI summaries, member highlights, and discrepancy analysis. Get one at platform.openai.com/api-keys. You'll need a funded account — API calls typically cost $0.01-0.10 per report depending on team size and model choice."
	case "ASANA_API_TOKEN":
		return "Connects TeamHero to your Asana workspace for Visible Wins tracking. You can sign in via OAuth (browser) or paste a Personal Access Token. To create a PAT: Asana > My Settings > Apps > Developer Apps > Personal Access Tokens. Optional — only needed if you use Asana for project tracking."
	case "AI_MODEL":
		return "The primary AI model used for all report sections (unless overridden below).\n\n" +
			aiModelHelpTable() +
			"Select **custom...** to enter any OpenAI-compatible model name."
	case "AI_TEAM_HIGHLIGHT_MODEL":
		return "Model used for the **team summary highlight** at the top of the report.\n\n" +
			"Leave as **(use primary model)** to inherit from the primary AI Model setting.\n\n" +
			aiModelHelpTable() +
			"Select **custom...** to enter any OpenAI-compatible model name."
	case "AI_MEMBER_HIGHLIGHTS_MODEL":
		return "Model used for **per-member highlight** paragraphs in the report.\n\n" +
			"Leave as **(use primary model)** to inherit from the primary AI Model setting.\n\n" +
			aiModelHelpTable() +
			"Select **custom...** to enter any OpenAI-compatible model name."
	case "AI_INDIVIDUAL_SUMMARIES_MODEL":
		return "Model used for **individual contributor summaries** — one call per team member.\n\n" +
			"Defaults to **gpt-5-nano** (not the primary model) because this section makes many " +
			"parallel API calls and a cheaper model keeps costs down for large teams.\n\n" +
			aiModelHelpTable() +
			"Select **custom...** to enter any OpenAI-compatible model name."
	case "VISIBLE_WINS_AI_MODEL":
		return "Model used for **visible wins extraction** — identifies accomplishments from Asana tasks and meeting notes.\n\n" +
			"Leave as **(use primary model)** to inherit from the primary AI Model setting.\n\n" +
			aiModelHelpTable() +
			"Select **custom...** to enter any OpenAI-compatible model name."
	case "AI_DISCREPANCY_ANALYSIS_MODEL":
		return "Model used for **discrepancy analysis** — cross-checks report data for inconsistencies.\n\n" +
			"Leave as **(use primary model)** to inherit from the primary AI Model setting.\n\n" +
			aiModelHelpTable() +
			"Select **custom...** to enter any OpenAI-compatible model name."
	case "OPENAI_PROJECT":
		return "OpenAI Project ID for billing isolation. Find it at platform.openai.com/settings — click your project name, the ID is shown as 'proj_...' in the URL or project settings. Leave empty to use your default project."
	case "OPENAI_SERVICE_TIER":
		return "OpenAI service tier controls cost vs speed. 'flex' uses batch processing at ~50% lower cost but responses may be slower. Leave empty for standard (real-time) processing. Flex is recommended for scheduled/automated reports where speed isn't critical."
	case "TEAMHERO_LOG_LEVEL":
		return "Controls how much detail appears in the log file (`~/.cache/teamhero/logs/`).\n\n" +
			"- **0** — Silent: No logs\n" +
			"- **1** — Fatal: Only critical errors\n" +
			"- **2** — Error: Errors and warnings\n" +
			"- **3** — Info: Normal operation (default)\n" +
			"- **4** — Debug: Detailed operation info\n" +
			"- **5** — Trace: Maximum verbosity (large logs)"
	case "TEAMHERO_AI_DEBUG":
		return "When enabled, logs the full AI request/response payloads to the log file. Useful for debugging unexpected AI output or prompt issues. Warning: generates very large log entries. Turn off for normal use."
	case "TEAMHERO_AI_MAX_RETRIES":
		return "How many times to retry failed AI API calls (e.g., 500/503 errors). Uses exponential backoff between retries. Set to 0 to disable retries. Higher values improve reliability but slow down error recovery."
	case "TEAMHERO_ENABLE_PERIOD_DELTAS":
		return "When enabled, the report compares the current period's metrics against the previous period of the same length. Shows trends like '+15% commits' or '-3 PRs'. Requires cached data from a prior run covering the comparison period."
	case "TEAMHERO_SEQUENTIAL":
		return "Controls whether API requests are made in parallel or sequentially. Parallel is faster but uses more connections. Sequential is slower but gentler on API rate limits. Use sequential if you hit GitHub or Asana rate limit errors."
	case "TEAMHERO_DISCREPANCY_CONFIDENCE_THRESHOLD":
		return "Confidence threshold (0-100) for the discrepancy report summary. Only entries with confidence >= this value appear in the main report. The full Discrepancy Log always shows all entries regardless. Lower values show more potential issues; higher values show only high-confidence findings."
	case "GITHUB_MAX_REPOSITORIES":
		return "Maximum number of repositories to fetch from the GitHub organization. If your org has many repos, this limits the API calls. Set higher if repos are missing from reports."
	case "TEAMHERO_MAX_PR_PAGES":
		return "Maximum pages of pull requests to fetch per repository (100 PRs per page). Increase if team members have very high PR volume and some PRs are missing from reports."
	case "USER_MAP":
		return "Maps GitHub usernames to Asana identities for cross-referencing. Format: JSON object where each entry has name, email, github.login, and asana fields. This enables the report to match Git commits to Asana task assignments."
	case "ASANA_WORKSPACE_GID":
		return "Asana workspace GID(s) to search for users. Leave as 'auto-discover' to search all accessible workspaces. Set explicitly if auto-discovery is slow or picks the wrong workspace. Find the GID in your Asana URL: app.asana.com/0/{workspace_gid}/..."
	case "ASANA_DEFAULT_EMAIL_DOMAIN":
		return "Fallback email domain for matching GitHub users to Asana. When no USER_MAP entry exists for a GitHub user, TeamHero tries {github_login}@{domain}. Set to your company's email domain (e.g., 'example.com')."
	case "MEETING_NOTES_DIR":
		return "Path to a local directory containing meeting notes (e.g., an Obsidian vault). TeamHero scans this for notes matching the report period to include in Visible Wins context. Not needed if using Google Drive for transcripts."
	case "GOOGLE_DRIVE_FOLDER_IDS":
		return "Comma-separated Google Drive folder IDs to scan for meeting transcripts. Leave empty to auto-discover the 'Meet Notes' folder. Find folder IDs in the Google Drive URL: drive.google.com/drive/folders/{folder_id}"
	case "@@private_repos":
		return "When enabled, TeamHero includes private repositories from your GitHub organization in reports. Disable if you only want to analyze public repos or if certain private repos should be excluded from team reports."
	case "@@archived_repos":
		return "When enabled, TeamHero includes archived repositories in reports. Usually disabled since archived repos don't have active development. Enable if you need historical analysis of archived projects."
	case "@@include_bots":
		return "When enabled, bot accounts (like dependabot, renovate, github-actions) are included in team member analysis. Usually disabled to focus on human contributors. Enable if bot activity is relevant to your team metrics."
	}
	return "Press Enter to confirm your selection, or Esc to cancel."
}
func (m *inlineSettingsEditor) renderHelpContent(width int) string {
	if width < 15 {
		return ""
	}

	headerStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("212"))
	labelStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("245"))
	valueStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("15"))
	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))

	// Account for border + padding that the caller adds
	contentWidth := width - 6 // border (2) + padding (2) + safety (2)
	if contentWidth < 10 {
		contentWidth = 10
	}

	var lines []string
	lines = append(lines, headerStyle.Render("Settings Help"))
	lines = append(lines, "")

	// Get the currently selected item
	var selectedItem *editorItem
	if m.cursor >= 0 && m.cursor < len(m.lines) && m.lines[m.cursor].itemIndex >= 0 {
		selectedItem = &m.items[m.lines[m.cursor].itemIndex]
	}

	if selectedItem == nil {
		lines = append(lines, dimStyle.Render("Select a setting to see details."))
	} else {
		// Setting name
		lines = append(lines, labelStyle.Render("Setting: ")+valueStyle.Render(selectedItem.label))
		lines = append(lines, "")

		// Description with lightweight formatting
		desc := selectedItem.description
		if desc == "" {
			desc = "No description available."
		}
		lines = append(lines, renderHelpStyled(desc, contentWidth))

		// Current value
		lines = append(lines, "")
		if selectedItem.value != "" {
			val := selectedItem.value
			if selectedItem.sensitive {
				lines = append(lines, labelStyle.Render("Current: ")+valueStyle.Render(maskValue(val)))
			} else if looksLikeJSON(val) {
				// Pretty-print JSON values (USER_MAP, etc.) with syntax highlighting
				lines = append(lines, labelStyle.Render("Current:"))
				colorized := renderJSONContent(prettyPrintJSON(val))
				for _, jl := range strings.Split(colorized, "\n") {
					lines = append(lines, "  "+jl)
				}
			} else {
				dv := settingDisplayValue(selectedItem.key, val)
				lines = append(lines, labelStyle.Render("Current: ")+valueStyle.Render(dv))
			}
		} else if selectedItem.defaultVal != "" {
			lines = append(lines, labelStyle.Render("Default: ")+dimStyle.Render(selectedItem.defaultVal))
		} else {
			lines = append(lines, labelStyle.Render("Current: ")+dimStyle.Render("not set"))
		}

		// For @@boards, show the asana-config.json preview
		if selectedItem.key == "@@boards" {
			boardsPreview := previewBoardsConfig()
			if boardsPreview != "" {
				lines = append(lines, "")
				lines = append(lines, labelStyle.Render("Config:"))
				colorized := renderJSONContent(boardsPreview)
				for _, bl := range strings.Split(colorized, "\n") {
					lines = append(lines, "  "+bl)
				}
			}
		}

		// Env key
		if selectedItem.key != "" && !strings.HasPrefix(selectedItem.key, "@@") {
			lines = append(lines, labelStyle.Render("Env var: ")+dimStyle.Render(selectedItem.key))
		}
	}

	return strings.Join(lines, "\n")
}

// looksLikeJSON returns true if a string appears to be a JSON object or array.
func looksLikeJSON(s string) bool {
	s = strings.TrimSpace(s)
	return (strings.HasPrefix(s, "{") && strings.HasSuffix(s, "}")) ||
		(strings.HasPrefix(s, "[") && strings.HasSuffix(s, "]"))
}

// prettyPrintJSON formats a JSON string with indentation.
func prettyPrintJSON(s string) string {
	var out bytes.Buffer
	if err := json.Indent(&out, []byte(s), "", "  "); err != nil {
		return s // Return as-is if not valid JSON
	}
	return out.String()
}

// previewBoardsConfig reads and pretty-prints the asana-config.json file.
func previewBoardsConfig() string {
	path := filepath.Join(configDir(), "asana-config.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var out bytes.Buffer
	if err := json.Indent(&out, data, "", "  "); err != nil {
		return string(data)
	}
	return out.String()
}

// wordWrap breaks a string into lines that fit within maxWidth.
func wordWrap(s string, maxWidth int) []string {
	if maxWidth <= 0 {
		return []string{s}
	}
	words := strings.Fields(s)
	if len(words) == 0 {
		return nil
	}

	var lines []string
	current := words[0]
	for _, word := range words[1:] {
		if len(current)+1+len(word) <= maxWidth {
			current += " " + word
		} else {
			lines = append(lines, current)
			current = word
		}
	}
	lines = append(lines, current)
	return lines
}

// renderHelpStyled renders help text with lightweight lipgloss formatting.
// Recognizes markdown-style bullet lists (- **bold**), tables, and `code`.
func renderHelpStyled(text string, width int) string {
	if width < 10 {
		width = 10
	}
	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	boldStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("15"))
	codeStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("14"))

	var out []string
	for _, paragraph := range strings.Split(text, "\n\n") {
		paragraph = strings.TrimSpace(paragraph)
		if paragraph == "" {
			out = append(out, "")
			continue
		}
		// Check if this is a table (contains |)
		pLines := strings.Split(paragraph, "\n")
		isTable := len(pLines) > 1 && strings.Contains(pLines[0], "|")
		if isTable {
			for _, tl := range pLines {
				tl = strings.TrimSpace(tl)
				if tl == "" || strings.Trim(tl, "|-: ") == "" {
					continue // skip separator rows
				}
				out = append(out, dimStyle.Render(styleBoldAndCode(tl, boldStyle, codeStyle)))
			}
			continue
		}
		// Check if lines are a bullet list
		isList := true
		for _, pl := range pLines {
			trimmed := strings.TrimSpace(pl)
			if trimmed != "" && !strings.HasPrefix(trimmed, "- ") && !strings.HasPrefix(trimmed, "* ") {
				isList = false
				break
			}
		}
		if isList {
			for _, pl := range pLines {
				styled := styleBoldAndCode(strings.TrimSpace(pl), boldStyle, codeStyle)
				out = append(out, dimStyle.Render(styled))
			}
		} else {
			// Regular paragraph — word-wrap
			joined := strings.Join(pLines, " ")
			styled := styleBoldAndCode(joined, boldStyle, codeStyle)
			for _, wl := range wordWrap(styled, width) {
				out = append(out, dimStyle.Render(wl))
			}
		}
		out = append(out, "")
	}
	return strings.TrimRight(strings.Join(out, "\n"), "\n")
}

// styleBoldAndCode applies bold (**text**) and code (`text`) styling inline.
func styleBoldAndCode(s string, boldStyle, codeStyle lipgloss.Style) string {
	// Handle **bold**
	for {
		start := strings.Index(s, "**")
		if start < 0 {
			break
		}
		end := strings.Index(s[start+2:], "**")
		if end < 0 {
			break
		}
		end += start + 2
		inner := s[start+2 : end]
		s = s[:start] + boldStyle.Render(inner) + s[end+2:]
	}
	// Handle `code`
	for {
		start := strings.Index(s, "`")
		if start < 0 {
			break
		}
		end := strings.Index(s[start+1:], "`")
		if end < 0 {
			break
		}
		end += start + 1
		inner := s[start+1 : end]
		s = s[:start] + codeStyle.Render(inner) + s[end+1:]
	}
	return s
}

// moveCursor moves to the next/previous selectable line.
func (m *inlineSettingsEditor) moveCursor(delta int) {
	newPos := m.cursor + delta
	for newPos >= 0 && newPos < len(m.lines) {
		if m.lines[newPos].itemIndex >= 0 {
			m.cursor = newPos
			return
		}
		newPos += delta
	}
	// Don't move if no selectable line found in that direction
}

// ensureCursorVisible scrolls the viewport so the cursor line is visible.
func (m *inlineSettingsEditor) ensureCursorVisible() {
	if !m.ready {
		return
	}
	top := m.viewport.YOffset
	bottom := top + m.viewport.Height - 1
	if m.cursor < top {
		m.viewport.SetYOffset(m.cursor)
	} else if m.cursor > bottom {
		m.viewport.SetYOffset(m.cursor - m.viewport.Height + 1)
	}
}

// firstSelectableLine returns the index of the first selectable line.
func (m *inlineSettingsEditor) firstSelectableLine() int {
	for i, line := range m.lines {
		if line.itemIndex >= 0 {
			return i
		}
	}
	return 0
}

// lastSelectableLine returns the index of the last selectable line.
func (m *inlineSettingsEditor) lastSelectableLine() int {
	for i := len(m.lines) - 1; i >= 0; i-- {
		if m.lines[i].itemIndex >= 0 {
			return i
		}
	}
	return 0
}

// rebuildLine updates the text of a specific line after an edit.
func (m *inlineSettingsEditor) rebuildLine(lineIdx int) {
	if lineIdx < 0 || lineIdx >= len(m.lines) {
		return
	}
	line := m.lines[lineIdx]
	if line.itemIndex < 0 {
		return
	}
	m.lines[lineIdx].text = formatEditorLine(m.items[line.itemIndex])
}

// showInlineSettingsEditor runs the unified inline settings editor.
// Returns the special action key (e.g., "@@gdrive", "@@boards", actionInlineGitHubAuth) if the user
// selected a sub-flow, or "" if the user quit normally.
func showInlineSettingsEditor(existing map[string]string, creds []credential, boardsStatus boardsConfigStatus) (string, error) {
	m := newInlineSettingsEditor(existing, creds, boardsStatus)
	p := tea.NewProgram(&m, tea.WithOutput(os.Stderr), tea.WithAltScreen())
	result, err := teaProgramRun(p)
	if err != nil {
		return "", err
	}
	if editor, ok := result.(*inlineSettingsEditor); ok {
		return editor.action, nil
	}
	return "", nil
}
