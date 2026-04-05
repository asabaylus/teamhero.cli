package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
)

// ---------------------------------------------------------------------------
// newInlineSettingsEditor tests
// ---------------------------------------------------------------------------

func TestNewInlineSettingsEditor_BuildsItemsFromKnownSettings(t *testing.T) {
	entries := map[string]string{
		"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_test",
		"OPENAI_API_KEY":               "sk_test",
	}
	creds := []credential{
		{envKey: "GITHUB_PERSONAL_ACCESS_TOKEN", value: "ghp_test", status: "valid"},
		{envKey: "OPENAI_API_KEY", value: "sk_test", status: "valid"},
	}
	m := newInlineSettingsEditor(entries, creds, boardsConfigStatus{})

	if len(m.items) == 0 {
		t.Fatal("expected items to be populated")
	}

	// Should have at least the known non-hidden settings + gdrive + boards
	foundGH := false
	foundOAI := false
	foundGDrive := false
	foundBoards := false
	for _, item := range m.items {
		switch item.key {
		case "GITHUB_PERSONAL_ACCESS_TOKEN":
			foundGH = true
			if item.value != "ghp_test" {
				t.Errorf("expected GH value 'ghp_test', got %q", item.value)
			}
			if !item.sensitive {
				t.Error("expected GH to be sensitive")
			}
		case "OPENAI_API_KEY":
			foundOAI = true
			if item.value != "sk_test" {
				t.Errorf("expected OAI value 'sk_test', got %q", item.value)
			}
		case "@@gdrive":
			foundGDrive = true
			if !item.special {
				t.Error("expected gdrive to be special")
			}
		case "@@boards":
			foundBoards = true
			if item.itype != inputJSON {
				t.Error("expected boards to have inputJSON type")
			}
		}
	}
	if !foundGH {
		t.Error("expected GITHUB_PERSONAL_ACCESS_TOKEN item")
	}
	if !foundOAI {
		t.Error("expected OPENAI_API_KEY item")
	}
	if !foundGDrive {
		t.Error("expected @@gdrive special item")
	}
	if !foundBoards {
		t.Error("expected @@boards special item")
	}
}

func TestNewInlineSettingsEditor_LinesContainHeaders(t *testing.T) {
	m := newInlineSettingsEditor(map[string]string{}, []credential{}, boardsConfigStatus{})

	foundCoreHeader := false
	for _, line := range m.lines {
		if line.itemIndex == -1 && strings.Contains(line.text, "Core Credentials") {
			foundCoreHeader = true
			break
		}
	}
	if !foundCoreHeader {
		t.Error("expected 'Core Credentials' header in lines")
	}
}

func TestNewInlineSettingsEditor_CursorStartsAtFirstSelectableLine(t *testing.T) {
	m := newInlineSettingsEditor(map[string]string{}, []credential{}, boardsConfigStatus{})

	if m.cursor < 0 || m.cursor >= len(m.lines) {
		t.Fatalf("cursor %d out of range [0, %d)", m.cursor, len(m.lines))
	}
	if m.lines[m.cursor].itemIndex < 0 {
		t.Error("cursor should be on a selectable line")
	}
}

func TestNewInlineSettingsEditor_ExtraEnvKeys(t *testing.T) {
	entries := map[string]string{
		"CUSTOM_SETTING": "custom_value",
	}
	m := newInlineSettingsEditor(entries, []credential{}, boardsConfigStatus{})

	found := false
	for _, item := range m.items {
		if item.key == "CUSTOM_SETTING" {
			found = true
			if item.value != "custom_value" {
				t.Errorf("expected 'custom_value', got %q", item.value)
			}
			if item.category != "Other" {
				t.Errorf("expected category 'Other', got %q", item.category)
			}
		}
	}
	if !found {
		t.Error("expected CUSTOM_SETTING to appear as extra key")
	}
}

func TestNewInlineSettingsEditor_BoardsFound(t *testing.T) {
	// Create a temp boards file so buildBoardsItem can read it
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	boardsDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(boardsDir, 0o755)
	boardsPath := filepath.Join(boardsDir, "asana-config.json")
	os.WriteFile(boardsPath, []byte(`{"boards":[{},{},{}]}`), 0o644)

	m := newInlineSettingsEditor(map[string]string{}, []credential{}, boardsConfigStatus{found: true, count: 3, path: boardsPath})

	for _, item := range m.items {
		if item.key == "@@boards" {
			if !strings.Contains(item.defaultVal, "3 configured") {
				t.Errorf("expected boards defaultVal to contain '3 configured', got %q", item.defaultVal)
			}
			return
		}
	}
	t.Error("expected @@boards item")
}

// ---------------------------------------------------------------------------
// moveCursor tests
// ---------------------------------------------------------------------------

func TestMoveCursor_SkipsHeaders(t *testing.T) {
	m := inlineSettingsEditor{
		lines: []editorLine{
			{text: "  Header", itemIndex: -1},   // 0: header
			{text: "    Item A", itemIndex: 0},   // 1: selectable
			{text: "", itemIndex: -1},            // 2: blank
			{text: "  Header2", itemIndex: -1},   // 3: header
			{text: "    Item B", itemIndex: 1},   // 4: selectable
		},
		items: []editorItem{
			{key: "A", label: "Item A"},
			{key: "B", label: "Item B"},
		},
		cursor: 1, // starting on Item A
	}

	m.moveCursor(1) // move down
	if m.cursor != 4 {
		t.Errorf("expected cursor at 4, got %d", m.cursor)
	}

	m.moveCursor(-1) // move up
	if m.cursor != 1 {
		t.Errorf("expected cursor at 1, got %d", m.cursor)
	}
}

func TestMoveCursor_StaysAtBoundsWhenNoMore(t *testing.T) {
	m := inlineSettingsEditor{
		lines: []editorLine{
			{text: "  Header", itemIndex: -1},
			{text: "    Item A", itemIndex: 0},
			{text: "    Item B", itemIndex: 1},
		},
		items: []editorItem{
			{key: "A", label: "Item A"},
			{key: "B", label: "Item B"},
		},
		cursor: 1, // first selectable
	}

	m.moveCursor(-1) // try to move up past beginning
	if m.cursor != 1 {
		t.Errorf("expected cursor to stay at 1, got %d", m.cursor)
	}

	m.cursor = 2 // last selectable
	m.moveCursor(1)  // try to move down past end
	if m.cursor != 2 {
		t.Errorf("expected cursor to stay at 2, got %d", m.cursor)
	}
}

// ---------------------------------------------------------------------------
// firstSelectableLine / lastSelectableLine tests
// ---------------------------------------------------------------------------

func TestFirstLastSelectableLine(t *testing.T) {
	m := inlineSettingsEditor{
		lines: []editorLine{
			{text: "header", itemIndex: -1},
			{text: "item0", itemIndex: 0},
			{text: "blank", itemIndex: -1},
			{text: "item1", itemIndex: 1},
			{text: "item2", itemIndex: 2},
		},
	}

	first := m.firstSelectableLine()
	if first != 1 {
		t.Errorf("expected first selectable at 1, got %d", first)
	}

	last := m.lastSelectableLine()
	if last != 4 {
		t.Errorf("expected last selectable at 4, got %d", last)
	}
}

func TestFirstSelectableLine_Empty(t *testing.T) {
	m := inlineSettingsEditor{
		lines: []editorLine{
			{text: "header", itemIndex: -1},
		},
	}
	if m.firstSelectableLine() != 0 {
		t.Error("expected 0 for no selectable lines")
	}
}

// ---------------------------------------------------------------------------
// formatEditorLine tests
// ---------------------------------------------------------------------------

func TestFormatEditorLine_PlainValue(t *testing.T) {
	item := editorItem{key: "TEST_KEY", label: "Test Key", value: "hello"}
	result := formatEditorLine(item)
	if !strings.Contains(result, "Test Key") || !strings.Contains(result, "hello") {
		t.Errorf("expected label and value in result, got %q", result)
	}
}

func TestFormatEditorLine_SensitiveValue(t *testing.T) {
	item := editorItem{key: "SECRET", label: "Secret", value: "abcdefgh", sensitive: true}
	result := formatEditorLine(item)
	if strings.Contains(result, "abcdefgh") {
		t.Error("sensitive value should be masked")
	}
	// Should contain last 4 chars
	if !strings.Contains(result, "efgh") {
		t.Errorf("expected masked value to show last 4 chars, got %q", result)
	}
}

func TestFormatEditorLine_EmptyWithDefault(t *testing.T) {
	item := editorItem{key: "K", label: "Key", value: "", defaultVal: "42"}
	result := formatEditorLine(item)
	if !strings.Contains(result, "= 42") {
		t.Errorf("expected default value display, got %q", result)
	}
}

func TestFormatEditorLine_EmptyNoDefault(t *testing.T) {
	item := editorItem{key: "K", label: "Key", value: ""}
	result := formatEditorLine(item)
	if !strings.Contains(result, "(not set)") {
		t.Errorf("expected '(not set)', got %q", result)
	}
}

func TestFormatEditorLine_LongValue(t *testing.T) {
	item := editorItem{key: "K", label: "Key", value: strings.Repeat("x", 60)}
	result := formatEditorLine(item)
	if !strings.Contains(result, "...") {
		t.Errorf("expected truncated value with '...', got %q", result)
	}
}

// ---------------------------------------------------------------------------
// Init tests
// ---------------------------------------------------------------------------

func TestInlineSettingsEditor_Init(t *testing.T) {
	m := inlineSettingsEditor{}
	cmd := m.Init()
	if cmd == nil {
		t.Error("expected non-nil Init cmd (textinput.Blink)")
	}
}

// ---------------------------------------------------------------------------
// Update: WindowSizeMsg tests
// ---------------------------------------------------------------------------

func TestInlineSettingsEditor_UpdateWindowSizeMsg(t *testing.T) {
	m := inlineSettingsEditor{
		lines: []editorLine{{text: "test", itemIndex: 0}},
		items: []editorItem{{key: "test", label: "test"}},
	}
	updated, _ := m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	editor := updated.(*inlineSettingsEditor)
	if !editor.ready {
		t.Error("expected ready=true after WindowSizeMsg")
	}
	if editor.width != 80 {
		t.Errorf("expected width=80, got %d", editor.width)
	}
}

func TestInlineSettingsEditor_UpdateWindowSizeSmall(t *testing.T) {
	m := inlineSettingsEditor{}
	updated, _ := m.Update(tea.WindowSizeMsg{Width: 10, Height: 5})
	editor := updated.(*inlineSettingsEditor)
	if !editor.ready {
		t.Error("expected ready=true after WindowSizeMsg")
	}
}

func TestInlineSettingsEditor_UpdateWindowSizeAlreadyReady(t *testing.T) {
	m := inlineSettingsEditor{ready: true}
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	updated, _ := m.Update(tea.WindowSizeMsg{Width: 100, Height: 30})
	editor := updated.(*inlineSettingsEditor)
	if editor.width != 100 {
		t.Errorf("expected width=100, got %d", editor.width)
	}
}

// ---------------------------------------------------------------------------
// Update: Navigate key tests
// ---------------------------------------------------------------------------

func TestInlineSettingsEditor_NavigateDown(t *testing.T) {
	m := inlineSettingsEditor{
		lines: []editorLine{
			{text: "header", itemIndex: -1},
			{text: "item0", itemIndex: 0},
			{text: "item1", itemIndex: 1},
		},
		items:  []editorItem{{key: "A"}, {key: "B"}},
		cursor: 1,
	}

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyDown})
	editor := updated.(*inlineSettingsEditor)
	if editor.cursor != 2 {
		t.Errorf("expected cursor=2, got %d", editor.cursor)
	}
}

func TestInlineSettingsEditor_NavigateUp(t *testing.T) {
	m := inlineSettingsEditor{
		lines: []editorLine{
			{text: "header", itemIndex: -1},
			{text: "item0", itemIndex: 0},
			{text: "item1", itemIndex: 1},
		},
		items:  []editorItem{{key: "A"}, {key: "B"}},
		cursor: 2,
	}

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'k'}})
	editor := updated.(*inlineSettingsEditor)
	if editor.cursor != 1 {
		t.Errorf("expected cursor=1, got %d", editor.cursor)
	}
}

func TestInlineSettingsEditor_NavigateHome(t *testing.T) {
	m := inlineSettingsEditor{
		lines: []editorLine{
			{text: "header", itemIndex: -1},
			{text: "item0", itemIndex: 0},
			{text: "item1", itemIndex: 1},
			{text: "item2", itemIndex: 2},
		},
		items:  []editorItem{{key: "A"}, {key: "B"}, {key: "C"}},
		cursor: 3,
	}

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyHome})
	editor := updated.(*inlineSettingsEditor)
	if editor.cursor != 1 {
		t.Errorf("expected cursor=1 (first selectable), got %d", editor.cursor)
	}
}

func TestInlineSettingsEditor_NavigateEnd(t *testing.T) {
	m := inlineSettingsEditor{
		lines: []editorLine{
			{text: "header", itemIndex: -1},
			{text: "item0", itemIndex: 0},
			{text: "item1", itemIndex: 1},
			{text: "item2", itemIndex: 2},
		},
		items:  []editorItem{{key: "A"}, {key: "B"}, {key: "C"}},
		cursor: 1,
	}

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnd})
	editor := updated.(*inlineSettingsEditor)
	if editor.cursor != 3 {
		t.Errorf("expected cursor=3 (last selectable), got %d", editor.cursor)
	}
}

func TestInlineSettingsEditor_NavigateQuit(t *testing.T) {
	m := inlineSettingsEditor{
		lines: []editorLine{{text: "item0", itemIndex: 0}},
		items: []editorItem{{key: "A"}},
	}

	updated, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}})
	editor := updated.(*inlineSettingsEditor)
	if !editor.quitting {
		t.Error("expected quitting=true")
	}
	if cmd == nil {
		t.Error("expected non-nil cmd (tea.Quit)")
	}
}

func TestInlineSettingsEditor_NavigateEsc(t *testing.T) {
	m := inlineSettingsEditor{
		lines: []editorLine{{text: "item0", itemIndex: 0}},
		items: []editorItem{{key: "A"}},
	}

	updated, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEscape})
	editor := updated.(*inlineSettingsEditor)
	if !editor.quitting {
		t.Error("expected quitting=true")
	}
	if cmd == nil {
		t.Error("expected non-nil cmd (tea.Quit)")
	}
}

func TestInlineSettingsEditor_NavigateCtrlC(t *testing.T) {
	m := inlineSettingsEditor{
		lines: []editorLine{{text: "item0", itemIndex: 0}},
		items: []editorItem{{key: "A"}},
	}

	updated, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	editor := updated.(*inlineSettingsEditor)
	if !editor.quitting {
		t.Error("expected quitting=true")
	}
	if cmd == nil {
		t.Error("expected non-nil cmd (tea.Quit)")
	}
}

// ---------------------------------------------------------------------------
// Update: Enter on special item
// ---------------------------------------------------------------------------

func TestInlineSettingsEditor_EnterOnSpecialItem(t *testing.T) {
	m := inlineSettingsEditor{
		lines: []editorLine{
			{text: "gdrive", itemIndex: 0},
		},
		items: []editorItem{
			{key: "@@gdrive", label: "Google Drive", special: true, itype: inputSelect, options: []string{"Connect now"}},
		},
		cursor: 0,
		width:  80,
		height: 24,
	}

	// Enter on @@gdrive should open the select modal (not quit immediately)
	updated, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	editor := updated.(*inlineSettingsEditor)
	if editor.quitting {
		t.Error("expected quitting=false for @@gdrive (opens modal first)")
	}
	if editor.mode != modeEdit {
		t.Error("expected modeEdit for @@gdrive select modal")
	}
	if editor.editForm == nil {
		t.Error("expected editForm to be set for @@gdrive select")
	}
	_ = cmd
}

// ---------------------------------------------------------------------------
// Update: Enter on regular item → edit mode
// ---------------------------------------------------------------------------

func TestInlineSettingsEditor_EnterOnRegularItem(t *testing.T) {
	ti := textinput.New()
	m := inlineSettingsEditor{
		lines: []editorLine{
			{text: "    AI Model = gpt-5-mini", itemIndex: 0},
		},
		items: []editorItem{
			{key: "AI_MODEL", label: "AI Model", value: "gpt-5-mini"},
		},
		cursor:    0,
		textInput: ti,
	}

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	editor := updated.(*inlineSettingsEditor)
	if editor.mode != modeEdit {
		t.Error("expected mode to switch to modeEdit")
	}
	if editor.editIdx != 0 {
		t.Errorf("expected editIdx=0, got %d", editor.editIdx)
	}
}

func TestInlineSettingsEditor_EnterOnSensitiveItem(t *testing.T) {
	ti := textinput.New()
	m := inlineSettingsEditor{
		lines: []editorLine{
			{text: "    Secret = ****", itemIndex: 0},
		},
		items: []editorItem{
			{key: "SECRET", label: "Secret", value: "hidden", sensitive: true},
		},
		cursor:    0,
		textInput: ti,
	}

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	editor := updated.(*inlineSettingsEditor)
	if editor.mode != modeEdit {
		t.Error("expected mode to switch to modeEdit")
	}
	if editor.editForm == nil {
		t.Error("expected editForm to be set for sensitive item")
	}
}

// ---------------------------------------------------------------------------
// Update: Edit mode key handling
// ---------------------------------------------------------------------------

func TestInlineSettingsEditor_EditModeEsc(t *testing.T) {
	m := inlineSettingsEditor{
		mode:      modeEdit,
		textInput: textinput.New(),
		lines:     []editorLine{{text: "item", itemIndex: 0}},
		items:     []editorItem{{key: "A"}},
	}

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyEscape})
	editor := updated.(*inlineSettingsEditor)
	if editor.mode != modeNavigate {
		t.Error("expected mode to switch back to modeNavigate on Esc")
	}
	if editor.statusMsg != "" {
		t.Errorf("expected empty statusMsg, got %q", editor.statusMsg)
	}
}

func TestInlineSettingsEditor_EditModeForwardsKeys(t *testing.T) {
	// Edit mode with a huh form should stay in modeEdit when receiving key input
	m := inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		lines:   []editorLine{{text: "item", itemIndex: 0}},
		items:   []editorItem{{key: "A", value: "old"}},
	}
	// Without a form set, key events return nil cmd
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'x'}})
	editor := updated.(*inlineSettingsEditor)
	if editor.mode != modeEdit {
		t.Error("expected to stay in modeEdit")
	}
}

// ---------------------------------------------------------------------------
// confirmEdit tests
// ---------------------------------------------------------------------------

func TestConfirmEdit_SavesValue(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envFile := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envFile, []byte("AI_MODEL=old\n"), 0o600)

	m := inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		editVal: "gpt-5-mini",
		cursor:  0,
		envPath: envFile,
		items: []editorItem{
			{key: "AI_MODEL", label: "AI Model", value: "old"},
		},
		lines: []editorLine{
			{text: "    AI Model = old", itemIndex: 0},
		},
	}

	result, _ := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeNavigate {
		t.Error("expected mode to switch to modeNavigate")
	}
	if editor.items[0].value != "gpt-5-mini" {
		t.Errorf("expected item value 'gpt-5-mini', got %q", editor.items[0].value)
	}
	if editor.statusMsg != "Saved" {
		t.Errorf("expected statusMsg 'Saved', got %q", editor.statusMsg)
	}

	// Check the .env file was updated
	data, _ := os.ReadFile(envFile)
	if !strings.Contains(string(data), "AI_MODEL=gpt-5-mini") {
		t.Errorf("expected .env to contain AI_MODEL=gpt-5-mini, got %q", string(data))
	}
}

func TestConfirmEdit_ClearsValue(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envFile := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envFile, []byte("AI_MODEL=old\n"), 0o600)

	m := inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		editVal: "",
		cursor:  0,
		envPath: envFile,
		items: []editorItem{
			{key: "AI_MODEL", label: "AI Model", value: "old"},
		},
		lines: []editorLine{
			{text: "    AI Model = old", itemIndex: 0},
		},
	}

	result, _ := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	if editor.items[0].value != "" {
		t.Errorf("expected item value to be empty, got %q", editor.items[0].value)
	}
	if editor.statusMsg != "Cleared" {
		t.Errorf("expected statusMsg 'Cleared', got %q", editor.statusMsg)
	}
}

func TestConfirmEdit_EmptyOnEmptyNoChange(t *testing.T) {
	m := inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		editVal: "",
		cursor:  0,
		envPath: "/nonexistent/path",
		items: []editorItem{
			{key: "K", label: "Key", value: ""},
		},
		lines: []editorLine{
			{text: "    Key = (not set)", itemIndex: 0},
		},
	}

	result, _ := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	if editor.statusMsg != "" {
		t.Errorf("expected empty statusMsg, got %q", editor.statusMsg)
	}
}

func TestConfirmEdit_InvalidEditIdx(t *testing.T) {
	m := inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 99, // out of range
		items:   []editorItem{},
		lines:   []editorLine{},
	}

	result, _ := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeNavigate {
		t.Error("expected mode to switch to modeNavigate")
	}
}

func TestConfirmEdit_TranslatesDisplayValue(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envFile := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envFile, []byte("TEAMHERO_SEQUENTIAL=false\n"), 0o600)

	m := inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		editVal: "sequential",
		cursor:  0,
		envPath: envFile,
		items: []editorItem{
			{key: "TEAMHERO_SEQUENTIAL", label: "Processing Mode", value: "false"},
		},
		lines: []editorLine{
			{text: "    Processing Mode = parallel", itemIndex: 0},
		},
	}

	result, _ := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	// "sequential" should be stored as "true"
	if editor.items[0].value != "true" {
		t.Errorf("expected stored value 'true', got %q", editor.items[0].value)
	}
}

// ---------------------------------------------------------------------------
// enterEditOrSpecial tests
// ---------------------------------------------------------------------------

func TestEnterEditOrSpecial_InvalidCursor(t *testing.T) {
	m := inlineSettingsEditor{
		cursor: -1,
		lines:  []editorLine{},
		items:  []editorItem{},
	}

	result, cmd := m.enterEditOrSpecial()
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeNavigate {
		t.Error("expected to stay in modeNavigate for invalid cursor")
	}
	if cmd != nil {
		t.Error("expected nil cmd for invalid cursor")
	}
}

func TestEnterEditOrSpecial_OnHeaderLine(t *testing.T) {
	m := inlineSettingsEditor{
		cursor: 0,
		lines: []editorLine{
			{text: "header", itemIndex: -1},
		},
		items: []editorItem{},
	}

	result, cmd := m.enterEditOrSpecial()
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeNavigate {
		t.Error("expected to stay in modeNavigate for header line")
	}
	if cmd != nil {
		t.Error("expected nil cmd for header line")
	}
}

// ---------------------------------------------------------------------------
// View tests
// ---------------------------------------------------------------------------

func TestInlineSettingsEditor_ViewNotReady(t *testing.T) {
	m := inlineSettingsEditor{ready: false}
	view := m.View()
	if !strings.Contains(view, "Loading") {
		t.Errorf("expected Loading message, got %q", view)
	}
}

func TestInlineSettingsEditor_ViewReady(t *testing.T) {
	m := newInlineSettingsEditor(map[string]string{}, []credential{}, boardsConfigStatus{})
	// Simulate window size
	updated, _ := m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	editor := updated.(*inlineSettingsEditor)

	view := editor.View()
	if !strings.Contains(view, "TEAM HERO") {
		t.Error("expected 'TEAM HERO' banner in view")
	}
	if !strings.Contains(view, "navigate") {
		t.Error("expected navigation hint in view")
	}
}

func TestInlineSettingsEditor_ViewEditMode(t *testing.T) {
	m := &inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		ready:   true,
		cursor:  0,
		lines: []editorLine{
			{text: "    Test = old", itemIndex: 0},
		},
		items: []editorItem{
			{key: "TEST", label: "Test", value: "old"},
		},
	}

	view := m.View()
	if !strings.Contains(view, "cancel") {
		t.Error("expected 'cancel' hint in edit mode view")
	}
}

func TestInlineSettingsEditor_ViewWithStatusMsg(t *testing.T) {
	m := inlineSettingsEditor{
		ready:     true,
		statusMsg: "Saved",
		cursor:    0,
		lines: []editorLine{
			{text: "    Test = val", itemIndex: 0},
		},
		items: []editorItem{
			{key: "TEST", label: "Test", value: "val"},
		},
	}

	view := m.View()
	if !strings.Contains(view, "Saved") {
		t.Error("expected 'Saved' status message in view")
	}
}

// ---------------------------------------------------------------------------
// rebuildLine tests
// ---------------------------------------------------------------------------

func TestRebuildLine_UpdatesText(t *testing.T) {
	m := inlineSettingsEditor{
		items: []editorItem{
			{key: "K", label: "Key", value: "new_val"},
		},
		lines: []editorLine{
			{text: "    Key = old_val", itemIndex: 0},
		},
	}

	m.rebuildLine(0)
	if !strings.Contains(m.lines[0].text, "new_val") {
		t.Errorf("expected line to contain 'new_val', got %q", m.lines[0].text)
	}
}

func TestRebuildLine_OutOfRange(t *testing.T) {
	m := inlineSettingsEditor{
		items: []editorItem{{key: "K", label: "Key", value: "val"}},
		lines: []editorLine{{text: "original", itemIndex: 0}},
	}

	// Should not panic
	m.rebuildLine(-1)
	m.rebuildLine(99)
}

func TestRebuildLine_HeaderLine(t *testing.T) {
	m := inlineSettingsEditor{
		lines: []editorLine{
			{text: "header", itemIndex: -1},
		},
	}

	m.rebuildLine(0) // should be a no-op
	if m.lines[0].text != "header" {
		t.Errorf("expected header to remain unchanged, got %q", m.lines[0].text)
	}
}

// ---------------------------------------------------------------------------
// buildGDriveItem / buildBoardsItem tests
// ---------------------------------------------------------------------------

func TestBuildBoardsItem_NotFound(t *testing.T) {
	item := buildBoardsItem(boardsConfigStatus{found: false})
	if item.key != "@@boards" {
		t.Errorf("expected key '@@boards', got %q", item.key)
	}
	if item.itype != inputJSON {
		t.Error("expected itype=inputJSON")
	}
	if item.defaultVal != "not set" {
		t.Errorf("expected defaultVal 'not set', got %q", item.defaultVal)
	}
}

func TestBuildBoardsItem_Found(t *testing.T) {
	// Create a temp boards file
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	boardsDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(boardsDir, 0o755)
	boardsPath := filepath.Join(boardsDir, "asana-config.json")
	os.WriteFile(boardsPath, []byte(`{"boards":[{},{},{},{},{}]}`), 0o644)

	item := buildBoardsItem(boardsConfigStatus{found: true, count: 5, path: boardsPath})
	if !strings.Contains(item.defaultVal, "5 configured") {
		t.Errorf("expected defaultVal '5 configured', got %q", item.defaultVal)
	}
	if item.value == "" {
		t.Error("expected value to contain the JSON content")
	}
}

// ---------------------------------------------------------------------------
// showInlineSettingsEditor tests
// ---------------------------------------------------------------------------

func TestShowInlineSettingsEditor_ReturnsActionFromEditor(t *testing.T) {
	origTPR := teaProgramRun
	t.Cleanup(func() { teaProgramRun = origTPR })

	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		return &inlineSettingsEditor{quitting: true, action: "@@gdrive"}, nil
	}

	action, err := showInlineSettingsEditor(map[string]string{}, []credential{}, boardsConfigStatus{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if action != "@@gdrive" {
		t.Errorf("expected action '@@gdrive', got %q", action)
	}
}

func TestShowInlineSettingsEditor_ReturnsEmptyOnQuit(t *testing.T) {
	origTPR := teaProgramRun
	t.Cleanup(func() { teaProgramRun = origTPR })

	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		return &inlineSettingsEditor{quitting: true, action: ""}, nil
	}

	action, err := showInlineSettingsEditor(map[string]string{}, []credential{}, boardsConfigStatus{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if action != "" {
		t.Errorf("expected empty action, got %q", action)
	}
}

func TestShowInlineSettingsEditor_ReturnsErrorFromTeaProgram(t *testing.T) {
	origTPR := teaProgramRun
	t.Cleanup(func() { teaProgramRun = origTPR })

	teaProgramRun = func(p *tea.Program) (tea.Model, error) {
		return nil, os.ErrClosed
	}

	_, err := showInlineSettingsEditor(map[string]string{}, []credential{}, boardsConfigStatus{})
	if err == nil {
		t.Error("expected error from teaProgramRun")
	}
}

// ---------------------------------------------------------------------------
// Update: Fallthrough (non-key messages)
// ---------------------------------------------------------------------------

func TestInlineSettingsEditor_UpdateFallthrough(t *testing.T) {
	m := inlineSettingsEditor{
		ready: true,
		lines: []editorLine{{text: "item", itemIndex: 0}},
		items: []editorItem{{key: "A"}},
	}

	// Send a non-key, non-window message
	updated, _ := m.Update(tea.FocusMsg{})
	editor := updated.(*inlineSettingsEditor)
	// Should not crash and should return the same model
	if editor.cursor != m.cursor {
		t.Error("cursor should not change on fallthrough")
	}
}

// ---------------------------------------------------------------------------
// ensureCursorVisible tests
// ---------------------------------------------------------------------------

func TestEditorEnsureCursorVisible_NotReady(t *testing.T) {
	m := inlineSettingsEditor{ready: false, cursor: 0}
	// Should not panic
	m.ensureCursorVisible()
}

func TestEditorEnsureCursorVisible_ScrollUp(t *testing.T) {
	m := inlineSettingsEditor{
		ready:    true,
		cursor:   0,
		viewport: viewport.New(80, 5),
	}
	m.viewport.SetContent("a\nb\nc\nd\ne\nf\ng\nh")
	m.viewport.SetYOffset(3)
	m.ensureCursorVisible()
	if m.viewport.YOffset != 0 {
		t.Errorf("expected YOffset=0, got %d", m.viewport.YOffset)
	}
}

func TestEditorEnsureCursorVisible_ScrollDown(t *testing.T) {
	m := inlineSettingsEditor{
		ready:    true,
		cursor:   7,
		viewport: viewport.New(80, 3),
	}
	m.viewport.SetContent("a\nb\nc\nd\ne\nf\ng\nh")
	m.viewport.SetYOffset(0)
	m.ensureCursorVisible()
	expected := 7 - 3 + 1
	if m.viewport.YOffset != expected {
		t.Errorf("expected YOffset=%d, got %d", expected, m.viewport.YOffset)
	}
}

// ---------------------------------------------------------------------------
// Report Defaults section tests
// ---------------------------------------------------------------------------

func TestNewInlineSettingsEditor_ReportDefaultsSection(t *testing.T) {
	m := newInlineSettingsEditor(map[string]string{}, []credential{}, boardsConfigStatus{})

	// Check that "GitHub" header exists (repo options moved here from Report Defaults)
	foundHeader := false
	for _, line := range m.lines {
		if line.itemIndex == -1 && strings.Contains(line.text, "GitHub") {
			foundHeader = true
			break
		}
	}
	if !foundHeader {
		t.Error("expected 'GitHub' header in lines")
	}

	// Check that the three config items exist
	foundPrivate := false
	foundArchived := false
	foundBots := false
	for _, item := range m.items {
		switch item.key {
		case "@@private_repos":
			foundPrivate = true
			if item.label != "Include Private Repos" {
				t.Errorf("expected label 'Include Private Repos', got %q", item.label)
			}
		case "@@archived_repos":
			foundArchived = true
			if item.label != "Include Archived Repos" {
				t.Errorf("expected label 'Include Archived Repos', got %q", item.label)
			}
		case "@@include_bots":
			foundBots = true
			if item.label != "Include Bot Accounts" {
				t.Errorf("expected label 'Include Bot Accounts', got %q", item.label)
			}
		}
	}
	if !foundPrivate {
		t.Error("expected @@private_repos item")
	}
	if !foundArchived {
		t.Error("expected @@archived_repos item")
	}
	if !foundBots {
		t.Error("expected @@include_bots item")
	}
}

func TestBoolToYesNo(t *testing.T) {
	if boolToYesNo(true) != "Yes" {
		t.Error("boolToYesNo(true) should return 'Yes'")
	}
	if boolToYesNo(false) != "No" {
		t.Error("boolToYesNo(false) should return 'No'")
	}
}

func TestConfirmEdit_ConfigJsonItem(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)

	// Write an initial config.json
	initialCfg := &ReportConfig{Org: "test-org", ExcludePrivate: true}
	data, _ := json.Marshal(initialCfg)
	os.WriteFile(filepath.Join(teamheroDir, "config.json"), data, 0o644)

	m := inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		editVal: "Yes",
		cursor:  0,
		envPath: filepath.Join(teamheroDir, ".env"),
		items: []editorItem{
			{key: "@@private_repos", label: "Include Private Repos", value: "No"},
		},
		lines: []editorLine{
			{text: "    Include Private Repos = No", itemIndex: 0},
		},
	}

	result, _ := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	if editor.items[0].value != "Yes" {
		t.Errorf("expected item value 'Yes', got %q", editor.items[0].value)
	}
	if editor.statusMsg != "Saved" {
		t.Errorf("expected statusMsg 'Saved', got %q", editor.statusMsg)
	}

	// Verify config.json was updated
	savedCfg, err := LoadSavedConfig()
	if err != nil {
		t.Fatalf("failed to load saved config: %v", err)
	}
	if savedCfg.ExcludePrivate {
		t.Error("expected ExcludePrivate=false after setting @@private_repos to Yes")
	}
}

// ---------------------------------------------------------------------------
// prettyPrintJSON tests
// ---------------------------------------------------------------------------

func TestPrettyPrintJSON_ValidJSON(t *testing.T) {
	result := prettyPrintJSON(`{"key":"value","num":42}`)
	if !strings.Contains(result, "  ") {
		t.Error("expected indented output")
	}
	if !strings.Contains(result, `"key"`) {
		t.Error("expected key in output")
	}
}

func TestPrettyPrintJSON_InvalidJSON(t *testing.T) {
	input := "not json at all"
	result := prettyPrintJSON(input)
	if result != input {
		t.Errorf("expected original string for invalid JSON, got %q", result)
	}
}

func TestPrettyPrintJSON_Array(t *testing.T) {
	result := prettyPrintJSON(`[1,2,3]`)
	if !strings.Contains(result, "  ") {
		t.Error("expected indented output for array")
	}
}

// ---------------------------------------------------------------------------
// previewBoardsConfig tests
// ---------------------------------------------------------------------------

func TestPreviewBoardsConfig_FileExists(t *testing.T) {
	origDir := os.Getenv("XDG_CONFIG_HOME")
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	defer func() {
		if origDir != "" {
			os.Setenv("XDG_CONFIG_HOME", origDir)
		} else {
			os.Unsetenv("XDG_CONFIG_HOME")
		}
	}()

	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	os.WriteFile(filepath.Join(teamheroDir, "asana-config.json"), []byte(`{"boards":[{"id":"123"}]}`), 0o644)

	result := previewBoardsConfig()
	if result == "" {
		t.Error("expected non-empty result for existing config")
	}
	if !strings.Contains(result, "boards") {
		t.Error("expected 'boards' in output")
	}
}

func TestPreviewBoardsConfig_FileNotFound(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	result := previewBoardsConfig()
	if result != "" {
		t.Errorf("expected empty string for missing file, got %q", result)
	}
}

// ---------------------------------------------------------------------------
// settingModalHelp tests
// ---------------------------------------------------------------------------

func TestSettingModalHelp_AllKnownKeys(t *testing.T) {
	keys := []string{
		"GITHUB_PERSONAL_ACCESS_TOKEN",
		"OPENAI_API_KEY",
		"ASANA_API_TOKEN",
		"AI_MODEL",
		"OPENAI_PROJECT",
		"OPENAI_SERVICE_TIER",
		"TEAMHERO_LOG_LEVEL",
		"TEAMHERO_AI_DEBUG",
		"TEAMHERO_AI_MAX_RETRIES",
		"TEAMHERO_ENABLE_PERIOD_DELTAS",
		"TEAMHERO_SEQUENTIAL",
		"TEAMHERO_DISCREPANCY_CONFIDENCE_THRESHOLD",
		"GITHUB_MAX_REPOSITORIES",
		"TEAMHERO_MAX_PR_PAGES",
		"USER_MAP",
		"ASANA_WORKSPACE_GID",
		"ASANA_DEFAULT_EMAIL_DOMAIN",
		"MEETING_NOTES_DIR",
		"GOOGLE_DRIVE_FOLDER_IDS",
		"@@private_repos",
		"@@archived_repos",
		"@@include_bots",
	}
	for _, key := range keys {
		result := settingModalHelp(key)
		if result == "" {
			t.Errorf("expected non-empty help for key %q", key)
		}
		// Should NOT be the default fallback for known keys
		if result == "Press Enter to confirm your selection, or Esc to cancel." {
			t.Errorf("key %q returned default help instead of specific help", key)
		}
	}
}

func TestSettingModalHelp_UnknownKey(t *testing.T) {
	result := settingModalHelp("UNKNOWN_KEY_12345")
	if result != "Press Enter to confirm your selection, or Esc to cancel." {
		t.Errorf("expected default help for unknown key, got %q", result)
	}
}

// ---------------------------------------------------------------------------
// styleBoldAndCode tests
// ---------------------------------------------------------------------------

func TestStyleBoldAndCode_Bold(t *testing.T) {
	boldStyle := lipgloss.NewStyle().Bold(true)
	codeStyle := lipgloss.NewStyle()
	result := styleBoldAndCode("hello **world** end", boldStyle, codeStyle)
	if strings.Contains(result, "**") {
		t.Error("expected ** markers to be removed")
	}
	if !strings.Contains(result, "world") {
		t.Error("expected 'world' in output")
	}
}

func TestStyleBoldAndCode_Code(t *testing.T) {
	boldStyle := lipgloss.NewStyle()
	codeStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("14"))
	result := styleBoldAndCode("use `command` here", boldStyle, codeStyle)
	if strings.Contains(result, "`") {
		t.Error("expected backtick markers to be removed")
	}
	if !strings.Contains(result, "command") {
		t.Error("expected 'command' in output")
	}
}

func TestStyleBoldAndCode_NoMarkers(t *testing.T) {
	boldStyle := lipgloss.NewStyle()
	codeStyle := lipgloss.NewStyle()
	input := "plain text"
	result := styleBoldAndCode(input, boldStyle, codeStyle)
	if result != input {
		t.Errorf("expected unchanged text, got %q", result)
	}
}

func TestStyleBoldAndCode_UnmatchedBold(t *testing.T) {
	boldStyle := lipgloss.NewStyle()
	codeStyle := lipgloss.NewStyle()
	input := "only **one marker"
	result := styleBoldAndCode(input, boldStyle, codeStyle)
	if result != input {
		t.Errorf("expected unchanged text for unmatched bold, got %q", result)
	}
}

func TestStyleBoldAndCode_UnmatchedCode(t *testing.T) {
	boldStyle := lipgloss.NewStyle()
	codeStyle := lipgloss.NewStyle()
	input := "only `one marker"
	result := styleBoldAndCode(input, boldStyle, codeStyle)
	if result != input {
		t.Errorf("expected unchanged text for unmatched code, got %q", result)
	}
}

// ---------------------------------------------------------------------------
// renderHelpStyled tests
// ---------------------------------------------------------------------------

func TestRenderHelpStyled_RegularParagraph(t *testing.T) {
	result := renderHelpStyled("Hello world this is a test paragraph.", 40)
	if result == "" {
		t.Error("expected non-empty output")
	}
}

func TestRenderHelpStyled_BulletList(t *testing.T) {
	input := "- item one\n- item two\n- item three"
	result := renderHelpStyled(input, 60)
	if result == "" {
		t.Error("expected non-empty output for bullet list")
	}
}

func TestRenderHelpStyled_Table(t *testing.T) {
	input := "| Col1 | Col2 |\n|------|------|\n| a | b |"
	result := renderHelpStyled(input, 60)
	if result == "" {
		t.Error("expected non-empty output for table")
	}
}

func TestRenderHelpStyled_EmptyParagraphs(t *testing.T) {
	input := "first\n\n\n\nsecond"
	result := renderHelpStyled(input, 60)
	if !strings.Contains(result, "first") || !strings.Contains(result, "second") {
		t.Error("expected both paragraphs in output")
	}
}

func TestRenderHelpStyled_NarrowWidth(t *testing.T) {
	result := renderHelpStyled("test", 5)
	// Width < 10 should be clamped to 10
	if result == "" {
		t.Error("expected non-empty output even with narrow width")
	}
}

// ---------------------------------------------------------------------------
// renderEditModal tests
// ---------------------------------------------------------------------------

func TestRenderEditModal_ValidItem(t *testing.T) {
	m := &inlineSettingsEditor{
		editIdx: 0,
		items: []editorItem{
			{key: "OPENAI_API_KEY", label: "OpenAI API Key", value: "sk-test"},
		},
	}
	result := m.renderEditModal(60)
	if result == "" {
		t.Error("expected non-empty modal output")
	}
	if !strings.Contains(result, "OpenAI API Key") {
		t.Error("expected label in modal output")
	}
}

func TestRenderEditModal_OutOfBounds(t *testing.T) {
	m := &inlineSettingsEditor{
		editIdx: -1,
		items:   []editorItem{},
	}
	result := m.renderEditModal(60)
	if result != "" {
		t.Errorf("expected empty string for out-of-bounds editIdx, got %q", result)
	}
}

func TestRenderEditModal_NarrowWidth(t *testing.T) {
	m := &inlineSettingsEditor{
		editIdx: 0,
		items: []editorItem{
			{key: "AI_MODEL", label: "AI Model", value: "gpt-5-mini"},
		},
	}
	result := m.renderEditModal(10)
	if result == "" {
		t.Error("expected non-empty modal even at narrow width")
	}
}

// ---------------------------------------------------------------------------
// renderHelpContent tests
// ---------------------------------------------------------------------------

func TestRenderHelpContent_NoSelection(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "header", itemIndex: -1}},
		items:  []editorItem{},
	}
	result := m.renderHelpContent(60)
	if !strings.Contains(result, "Select a setting") {
		t.Error("expected placeholder text when no item selected")
	}
}

func TestRenderHelpContent_WithSelectedItem(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "GitHub Token", itemIndex: 0}},
		items: []editorItem{
			{key: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub Token", value: "ghp_test", sensitive: true, description: "GitHub authentication token"},
		},
	}
	result := m.renderHelpContent(60)
	if !strings.Contains(result, "GitHub Token") {
		t.Error("expected setting label in help content")
	}
	if !strings.Contains(result, "Current:") {
		t.Error("expected 'Current:' label in help content")
	}
}

func TestRenderHelpContent_WithJSONValue(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "User Map", itemIndex: 0}},
		items: []editorItem{
			{key: "USER_MAP", label: "User Map", value: `{"alice":{"name":"Alice"}}`, description: "Maps users"},
		},
	}
	result := m.renderHelpContent(60)
	if !strings.Contains(result, "Current:") {
		t.Error("expected 'Current:' label for JSON value")
	}
}

func TestRenderHelpContent_WithDefaultValue(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "AI Model", itemIndex: 0}},
		items: []editorItem{
			{key: "AI_MODEL", label: "AI Model", value: "", defaultVal: "gpt-5-mini", description: "Model choice"},
		},
	}
	result := m.renderHelpContent(60)
	if !strings.Contains(result, "Default:") {
		t.Error("expected 'Default:' label when value is empty")
	}
}

func TestRenderHelpContent_EmptyValue(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "Some Setting", itemIndex: 0}},
		items: []editorItem{
			{key: "SOME_KEY", label: "Some Setting", value: "", defaultVal: "", description: "Desc"},
		},
	}
	result := m.renderHelpContent(60)
	if !strings.Contains(result, "not set") {
		t.Error("expected 'not set' for empty value with no default")
	}
}

func TestRenderHelpContent_TooNarrow(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "test", itemIndex: 0}},
		items:  []editorItem{{key: "X", label: "X"}},
	}
	result := m.renderHelpContent(10)
	if result != "" {
		t.Errorf("expected empty string for very narrow width, got %q", result)
	}
}

func TestRenderHelpContent_EnvKeyShown(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "Log Level", itemIndex: 0}},
		items: []editorItem{
			{key: "TEAMHERO_LOG_LEVEL", label: "Log Level", value: "3", description: "Controls logging"},
		},
	}
	result := m.renderHelpContent(60)
	if !strings.Contains(result, "Env var:") {
		t.Error("expected 'Env var:' label for non-special key")
	}
}

func TestRenderHelpContent_SpecialKeyNoEnvVar(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "Boards", itemIndex: 0}},
		items: []editorItem{
			{key: "@@boards", label: "Boards", value: "", description: "Board config"},
		},
	}
	result := m.renderHelpContent(60)
	if strings.Contains(result, "Env var:") {
		t.Error("expected no 'Env var:' for @@-prefixed key")
	}
}

func TestRenderHelpContent_BoardsPreview(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	os.WriteFile(filepath.Join(teamheroDir, "asana-config.json"),
		[]byte(`{"boards":[{"gid":"1"}]}`), 0o644)

	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "Boards", itemIndex: 0}},
		items: []editorItem{
			{key: "@@boards", label: "Boards", value: `{"boards":[]}`, description: "Board config"},
		},
	}
	result := m.renderHelpContent(60)
	if !strings.Contains(result, "Config:") {
		t.Error("expected 'Config:' label for boards preview")
	}
}

func TestRenderHelpContent_NoDescription(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "Test", itemIndex: 0}},
		items: []editorItem{
			{key: "TEST_KEY", label: "Test", value: "val", description: ""},
		},
	}
	result := m.renderHelpContent(60)
	if !strings.Contains(result, "No description available") {
		t.Error("expected fallback description text")
	}
}

func TestRenderHelpContent_DisplayValueTranslation(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "Sequential", itemIndex: 0}},
		items: []editorItem{
			{key: "TEAMHERO_SEQUENTIAL", label: "Sequential", value: "true", description: "Sequential mode"},
		},
	}
	result := m.renderHelpContent(60)
	if result == "" {
		t.Error("expected non-empty output for display value translation")
	}
}

// ---------------------------------------------------------------------------
// enterEditOrSpecial tests
// ---------------------------------------------------------------------------

func TestEnterEditOrSpecial_OutOfBounds(t *testing.T) {
	m := &inlineSettingsEditor{cursor: -1, lines: nil}
	result, _ := m.enterEditOrSpecial()
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeNavigate {
		t.Error("expected mode to remain navigate for out-of-bounds cursor")
	}
}

func TestEnterEditOrSpecial_NonSelectableLine(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "header", itemIndex: -1}},
	}
	result, _ := m.enterEditOrSpecial()
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeNavigate {
		t.Error("expected mode to remain navigate for non-selectable line")
	}
}

func TestEnterEditOrSpecial_SpecialNonSelect(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "Google Drive", itemIndex: 0}},
		items: []editorItem{
			{key: "@@gdrive", label: "Google Drive", special: true, itype: inputText},
		},
	}
	result, _ := m.enterEditOrSpecial()
	editor := result.(*inlineSettingsEditor)
	if !editor.quitting {
		t.Error("expected quitting for special non-select item")
	}
	if editor.action != "@@gdrive" {
		t.Errorf("expected action '@@gdrive', got %q", editor.action)
	}
}

func TestEnterEditOrSpecial_BoolItem(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "Debug", itemIndex: 0}},
		items: []editorItem{
			{key: "TEAMHERO_AI_DEBUG", label: "AI Debug", value: "true", itype: inputBool},
		},
	}
	result, _ := m.enterEditOrSpecial()
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeEdit {
		t.Error("expected mode to switch to edit")
	}
	if editor.editForm == nil {
		t.Error("expected editForm to be created")
	}
}

func TestEnterEditOrSpecial_YesNoItem(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "Private Repos", itemIndex: 0}},
		items: []editorItem{
			{key: "@@private_repos", label: "Private Repos", value: "Yes", itype: inputYesNo},
		},
	}
	result, _ := m.enterEditOrSpecial()
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeEdit {
		t.Error("expected mode to switch to edit for YesNo")
	}
	if editor.editForm == nil {
		t.Error("expected editForm for YesNo")
	}
}

func TestEnterEditOrSpecial_SelectItem(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "AI Model", itemIndex: 0}},
		items: []editorItem{
			{key: "AI_MODEL", label: "AI Model", value: "gpt-5-mini", itype: inputSelect, options: []string{"gpt-4.1-nano", "gpt-5-mini", "custom..."}},
		},
	}
	result, _ := m.enterEditOrSpecial()
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeEdit {
		t.Error("expected mode to switch to edit for Select")
	}
}

func TestEnterEditOrSpecial_NumberItem(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "Max Retries", itemIndex: 0}},
		items: []editorItem{
			{key: "TEAMHERO_AI_MAX_RETRIES", label: "Max Retries", value: "3", itype: inputNumber},
		},
	}
	result, _ := m.enterEditOrSpecial()
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeEdit {
		t.Error("expected mode to switch to edit for Number")
	}
}

func TestEnterEditOrSpecial_TextItem(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "Asana Domain", itemIndex: 0}},
		items: []editorItem{
			{key: "ASANA_DEFAULT_EMAIL_DOMAIN", label: "Asana Domain", value: "example.com", itype: inputText},
		},
	}
	result, _ := m.enterEditOrSpecial()
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeEdit {
		t.Error("expected mode to switch to edit for Text")
	}
}

func TestEnterEditOrSpecial_JSONItem(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "User Map", itemIndex: 0}},
		items: []editorItem{
			{key: "USER_MAP", label: "User Map", value: `{"a":"b"}`, itype: inputJSON},
		},
	}
	result, _ := m.enterEditOrSpecial()
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeEdit {
		t.Error("expected mode to switch to edit for JSON")
	}
}

func TestEnterEditOrSpecial_SelectSpecialWithOptions(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "Google Drive", itemIndex: 0}},
		items: []editorItem{
			{key: "@@gdrive", label: "Google Drive", special: true, itype: inputSelect, options: []string{"Connect now"}},
		},
	}
	result, _ := m.enterEditOrSpecial()
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeEdit {
		t.Error("expected mode to switch to edit for special select item")
	}
}

// ---------------------------------------------------------------------------
// handleEditKey tests
// ---------------------------------------------------------------------------

func TestHandleEditKey_Escape(t *testing.T) {
	m := &inlineSettingsEditor{
		mode:     modeEdit,
		editForm: nil,
	}
	result, _ := m.handleEditKey(tea.KeyMsg{Type: tea.KeyEscape})
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeNavigate {
		t.Error("expected mode to switch to navigate on Esc")
	}
}

func TestHandleEditKey_NoForm(t *testing.T) {
	m := &inlineSettingsEditor{
		mode:     modeEdit,
		editForm: nil,
	}
	result, cmd := m.handleEditKey(tea.KeyMsg{Type: tea.KeyEnter})
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeEdit {
		t.Error("expected mode to remain edit when no form and non-esc key")
	}
	if cmd != nil {
		t.Error("expected nil cmd when no form")
	}
}

// ---------------------------------------------------------------------------
// buildGDriveItem tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// confirmEdit additional branch tests
// ---------------------------------------------------------------------------

func TestConfirmEdit_GDriveAction(t *testing.T) {
	m := &inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		editVal: "Connect now",
		cursor:  0,
		items: []editorItem{
			{key: "@@gdrive", label: "Google Drive"},
		},
		lines: []editorLine{
			{text: "Google Drive", itemIndex: 0},
		},
	}
	result, _ := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	if !editor.quitting {
		t.Error("expected quitting for @@gdrive action")
	}
	if editor.action != "@@gdrive" {
		t.Errorf("expected action '@@gdrive', got %q", editor.action)
	}
}

func TestConfirmEdit_CustomSelection(t *testing.T) {
	m := &inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		editVal: "custom...",
		cursor:  0,
		items: []editorItem{
			{key: "AI_MODEL", label: "AI Model", value: "gpt-5-mini"},
		},
		lines: []editorLine{
			{text: "AI Model", itemIndex: 0},
		},
	}
	result, _ := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	// Should create a new form for free-text input
	if editor.editForm == nil {
		t.Error("expected editForm for custom input")
	}
	if editor.editVal != "gpt-5-mini" {
		t.Errorf("expected editVal to be current value 'gpt-5-mini', got %q", editor.editVal)
	}
}

func TestConfirmEdit_BoardsJSON_Save(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)

	boardsJSON := `{"boards":[{"projectGid":"123","sections":["Done"]}]}`
	m := &inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		editVal: boardsJSON,
		cursor:  0,
		items: []editorItem{
			{key: "@@boards", label: "Boards", value: "", defaultVal: "not set", itype: inputJSON},
		},
		lines: []editorLine{
			{text: "Boards", itemIndex: 0},
		},
	}
	result, _ := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	if editor.statusMsg != "Saved" {
		t.Errorf("expected 'Saved', got %q", editor.statusMsg)
	}
	if editor.items[0].value != boardsJSON {
		t.Errorf("expected item value to be updated")
	}
}

func TestConfirmEdit_BoardsJSON_Clear(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)

	// Create existing boards config
	boardsPath := filepath.Join(teamheroDir, "asana-config.json")
	os.WriteFile(boardsPath, []byte(`{"boards":[]}`), 0o644)

	m := &inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		editVal: "",
		cursor:  0,
		items: []editorItem{
			{key: "@@boards", label: "Boards", value: `{"boards":[]}`, defaultVal: "1 configured", itype: inputJSON},
		},
		lines: []editorLine{
			{text: "Boards", itemIndex: 0},
		},
	}
	result, _ := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	if editor.items[0].value != "" {
		t.Error("expected value to be cleared")
	}
	if editor.items[0].defaultVal != "not set" {
		t.Errorf("expected defaultVal 'not set', got %q", editor.items[0].defaultVal)
	}
}

func TestConfirmEdit_RegularEnvKey_Clear(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)

	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte("AI_MODEL=gpt-5-mini\n"), 0o644)

	m := &inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		editVal: "",
		cursor:  0,
		envPath: envPath,
		items: []editorItem{
			{key: "AI_MODEL", label: "AI Model", value: "gpt-5-mini"},
		},
		lines: []editorLine{
			{text: "AI Model", itemIndex: 0},
		},
	}
	result, _ := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	if editor.statusMsg != "Cleared" {
		t.Errorf("expected 'Cleared', got %q", editor.statusMsg)
	}
	if editor.items[0].value != "" {
		t.Error("expected value to be cleared")
	}
}

func TestConfirmEdit_RegularEnvKey_SaveJSON(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)

	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte(""), 0o644)

	m := &inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		editVal: `{"alice":{"name":"Alice"}}`,
		cursor:  0,
		envPath: envPath,
		items: []editorItem{
			{key: "USER_MAP", label: "User Map", value: "", itype: inputJSON},
		},
		lines: []editorLine{
			{text: "User Map", itemIndex: 0},
		},
	}
	result, _ := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	if editor.statusMsg != "Saved" {
		t.Errorf("expected 'Saved', got %q", editor.statusMsg)
	}
}

func TestConfirmEdit_ArchivedRepos(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)

	data, _ := json.Marshal(&ReportConfig{})
	os.WriteFile(filepath.Join(teamheroDir, "config.json"), data, 0o644)

	m := &inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		editVal: "Yes",
		cursor:  0,
		envPath: filepath.Join(teamheroDir, ".env"),
		items: []editorItem{
			{key: "@@archived_repos", label: "Include Archived Repos", value: "No"},
		},
		lines: []editorLine{
			{text: "Include Archived Repos = No", itemIndex: 0},
		},
	}
	result, _ := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	if editor.items[0].value != "Yes" {
		t.Errorf("expected 'Yes', got %q", editor.items[0].value)
	}
}

func TestConfirmEdit_IncludeBots(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)

	data, _ := json.Marshal(&ReportConfig{})
	os.WriteFile(filepath.Join(teamheroDir, "config.json"), data, 0o644)

	m := &inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		editVal: "Yes",
		cursor:  0,
		envPath: filepath.Join(teamheroDir, ".env"),
		items: []editorItem{
			{key: "@@include_bots", label: "Include Bot Accounts", value: "No"},
		},
		lines: []editorLine{
			{text: "Include Bot Accounts = No", itemIndex: 0},
		},
	}
	result, _ := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	if editor.items[0].value != "Yes" {
		t.Errorf("expected 'Yes', got %q", editor.items[0].value)
	}
}

func TestConfirmEdit_EmptyNoExistingValue(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)

	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte(""), 0o644)

	m := &inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		editVal: "",
		cursor:  0,
		envPath: envPath,
		items: []editorItem{
			{key: "AI_MODEL", label: "AI Model", value: ""},
		},
		lines: []editorLine{
			{text: "AI Model", itemIndex: 0},
		},
	}
	result, _ := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	if editor.statusMsg != "" {
		t.Errorf("expected empty statusMsg for no-op, got %q", editor.statusMsg)
	}
}

func TestConfirmEdit_OutOfBounds(t *testing.T) {
	m := &inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 5,
		items:   []editorItem{},
	}
	result, _ := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeNavigate {
		t.Error("expected mode to switch to navigate for out-of-bounds editIdx")
	}
}

func TestConfirmEdit_StoreValueTranslation(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)

	envPath := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envPath, []byte(""), 0o644)

	m := &inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		editVal: "sequential",
		cursor:  0,
		envPath: envPath,
		items: []editorItem{
			{key: "TEAMHERO_SEQUENTIAL", label: "Sequential", value: ""},
		},
		lines: []editorLine{
			{text: "Sequential", itemIndex: 0},
		},
	}
	result, _ := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	if editor.statusMsg != "Saved" {
		t.Errorf("expected 'Saved', got %q", editor.statusMsg)
	}
}

// ---------------------------------------------------------------------------
// handleNavigateKey tests (covers ensureCursorVisible + moveCursor paths)
// ---------------------------------------------------------------------------

func TestHandleNavigateKey_Up(t *testing.T) {
	m := &inlineSettingsEditor{
		mode:   modeNavigate,
		cursor: 1,
		lines: []editorLine{
			{text: "Item A", itemIndex: 0},
			{text: "Item B", itemIndex: 1},
		},
		items: []editorItem{{key: "a"}, {key: "b"}},
	}
	result, _ := m.handleNavigateKey(tea.KeyMsg{Type: tea.KeyUp})
	editor := result.(*inlineSettingsEditor)
	if editor.cursor != 0 {
		t.Errorf("expected cursor=0, got %d", editor.cursor)
	}
}

func TestHandleNavigateKey_Down(t *testing.T) {
	m := &inlineSettingsEditor{
		mode:   modeNavigate,
		cursor: 0,
		lines: []editorLine{
			{text: "Item A", itemIndex: 0},
			{text: "Item B", itemIndex: 1},
		},
		items: []editorItem{{key: "a"}, {key: "b"}},
	}
	result, _ := m.handleNavigateKey(tea.KeyMsg{Type: tea.KeyDown})
	editor := result.(*inlineSettingsEditor)
	if editor.cursor != 1 {
		t.Errorf("expected cursor=1, got %d", editor.cursor)
	}
}

func TestHandleNavigateKey_Home(t *testing.T) {
	m := &inlineSettingsEditor{
		mode:   modeNavigate,
		cursor: 2,
		lines: []editorLine{
			{text: "header", itemIndex: -1},
			{text: "Item A", itemIndex: 0},
			{text: "Item B", itemIndex: 1},
		},
		items: []editorItem{{key: "a"}, {key: "b"}},
	}
	result, _ := m.handleNavigateKey(tea.KeyMsg{Type: tea.KeyHome})
	editor := result.(*inlineSettingsEditor)
	if editor.cursor != 1 {
		t.Errorf("expected cursor=1 (first selectable), got %d", editor.cursor)
	}
}

func TestHandleNavigateKey_End(t *testing.T) {
	m := &inlineSettingsEditor{
		mode:   modeNavigate,
		cursor: 0,
		lines: []editorLine{
			{text: "Item A", itemIndex: 0},
			{text: "Item B", itemIndex: 1},
			{text: "footer", itemIndex: -1},
		},
		items: []editorItem{{key: "a"}, {key: "b"}},
	}
	result, _ := m.handleNavigateKey(tea.KeyMsg{Type: tea.KeyEnd})
	editor := result.(*inlineSettingsEditor)
	if editor.cursor != 1 {
		t.Errorf("expected cursor=1 (last selectable), got %d", editor.cursor)
	}
}

func TestHandleNavigateKey_PgUp(t *testing.T) {
	m := &inlineSettingsEditor{
		mode:   modeNavigate,
		cursor: 0,
		lines:  []editorLine{{text: "Item A", itemIndex: 0}},
		items:  []editorItem{{key: "a"}},
	}
	result, _ := m.handleNavigateKey(tea.KeyMsg{Type: tea.KeyPgUp})
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestHandleNavigateKey_PgDown(t *testing.T) {
	m := &inlineSettingsEditor{
		mode:   modeNavigate,
		cursor: 0,
		lines:  []editorLine{{text: "Item A", itemIndex: 0}},
		items:  []editorItem{{key: "a"}},
	}
	result, _ := m.handleNavigateKey(tea.KeyMsg{Type: tea.KeyPgDown})
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestHandleNavigateKey_Quit(t *testing.T) {
	m := &inlineSettingsEditor{
		mode:   modeNavigate,
		cursor: 0,
		lines:  []editorLine{{text: "Item A", itemIndex: 0}},
		items:  []editorItem{{key: "a"}},
	}
	result, _ := m.handleNavigateKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}})
	editor := result.(*inlineSettingsEditor)
	if !editor.quitting {
		t.Error("expected quitting on 'q'")
	}
}

func TestHandleNavigateKey_UnknownKey(t *testing.T) {
	m := &inlineSettingsEditor{
		mode:   modeNavigate,
		cursor: 0,
		lines:  []editorLine{{text: "Item A", itemIndex: 0}},
		items:  []editorItem{{key: "a"}},
	}
	result, cmd := m.handleNavigateKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'x'}})
	editor := result.(*inlineSettingsEditor)
	if editor.cursor != 0 {
		t.Errorf("expected cursor unchanged, got %d", editor.cursor)
	}
	if cmd != nil {
		t.Error("expected nil cmd for unknown key")
	}
}

// ---------------------------------------------------------------------------
// lastSelectableLine tests
// ---------------------------------------------------------------------------

func TestLastSelectableLine_NoSelectable(t *testing.T) {
	m := &inlineSettingsEditor{
		lines: []editorLine{
			{text: "header", itemIndex: -1},
			{text: "blank", itemIndex: -1},
		},
	}
	idx := m.lastSelectableLine()
	if idx != 0 {
		t.Errorf("expected 0 for no selectable lines, got %d", idx)
	}
}

// ---------------------------------------------------------------------------
// handleEditKey with form delegation
// ---------------------------------------------------------------------------

func TestHandleEditKey_DelegateToForm(t *testing.T) {
	// Create a real huh form to delegate to
	val := "test"
	f := huh.NewForm(huh.NewGroup(
		huh.NewInput().Title("Test").Value(&val),
	)).WithTheme(huh.ThemeCharm()).WithWidth(40)

	m := &inlineSettingsEditor{
		mode:     modeEdit,
		editForm: f,
		editIdx:  0,
		items: []editorItem{
			{key: "AI_MODEL", label: "AI Model", value: "gpt-5-mini"},
		},
		lines: []editorLine{
			{text: "AI Model", itemIndex: 0},
		},
	}
	// Send a regular key to the form
	result, _ := m.handleEditKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'a'}})
	if result == nil {
		t.Error("expected non-nil result from form delegation")
	}
}

func TestBuildGDriveItem_NotConnected(t *testing.T) {
	// Without credentials, should show "not connected"
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	item := buildGDriveItem()
	if item.key != "@@gdrive" {
		t.Errorf("expected key '@@gdrive', got %q", item.key)
	}
	if item.value != "not connected" {
		t.Errorf("expected 'not connected', got %q", item.value)
	}
	if !item.special {
		t.Error("expected special=true")
	}
}
