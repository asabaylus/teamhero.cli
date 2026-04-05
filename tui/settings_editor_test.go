package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
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
