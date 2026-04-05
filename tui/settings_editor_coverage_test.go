package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// ---------------------------------------------------------------------------
// prettyPrintJSON tests
// ---------------------------------------------------------------------------

func TestPrettyPrintJSON_ValidJSON(t *testing.T) {
	result := prettyPrintJSON(`{"name":"test","value":42}`)
	if !strings.Contains(result, "  ") {
		t.Error("expected indented output")
	}
	if !strings.Contains(result, `"name"`) {
		t.Errorf("expected key in output, got %q", result)
	}
}

func TestPrettyPrintJSON_InvalidJSON(t *testing.T) {
	input := "not json at all"
	result := prettyPrintJSON(input)
	if result != input {
		t.Errorf("expected original string for invalid JSON, got %q", result)
	}
}

func TestPrettyPrintJSON_EmptyObject(t *testing.T) {
	result := prettyPrintJSON(`{}`)
	if result != "{}" {
		t.Errorf("expected '{}', got %q", result)
	}
}

func TestPrettyPrintJSON_Array(t *testing.T) {
	result := prettyPrintJSON(`[1,2,3]`)
	if !strings.Contains(result, "1") {
		t.Errorf("expected array elements in output, got %q", result)
	}
}

func TestPrettyPrintJSON_NestedObject(t *testing.T) {
	result := prettyPrintJSON(`{"a":{"b":"c"}}`)
	if !strings.Contains(result, "    ") {
		t.Error("expected nested indentation")
	}
}

// ---------------------------------------------------------------------------
// previewBoardsConfig tests
// ---------------------------------------------------------------------------

func TestPreviewBoardsConfig_FileNotExists(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	os.MkdirAll(filepath.Join(tmpDir, "teamhero"), 0o755)

	result := previewBoardsConfig()
	if result != "" {
		t.Errorf("expected empty string for missing file, got %q", result)
	}
}

func TestPreviewBoardsConfig_ValidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "asana-config.json"), []byte(`{"boards":[{"projectGid":"123"}]}`), 0o644)

	result := previewBoardsConfig()
	if !strings.Contains(result, "projectGid") {
		t.Errorf("expected pretty-printed JSON, got %q", result)
	}
	if !strings.Contains(result, "  ") {
		t.Error("expected indented output")
	}
}

func TestPreviewBoardsConfig_InvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	configPath := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(configPath, 0o755)
	os.WriteFile(filepath.Join(configPath, "asana-config.json"), []byte(`not json`), 0o644)

	result := previewBoardsConfig()
	if result != "not json" {
		t.Errorf("expected raw content for invalid JSON, got %q", result)
	}
}

// ---------------------------------------------------------------------------
// aiModelHelpTable tests
// ---------------------------------------------------------------------------

func TestAiModelHelpTable_ContainsModels(t *testing.T) {
	result := aiModelHelpTable()
	for _, model := range []string{"gpt-4.1-nano", "gpt-4.1-mini", "gpt-5-mini", "gpt-5", "o3-mini", "o4-mini"} {
		if !strings.Contains(result, model) {
			t.Errorf("aiModelHelpTable missing model %q", model)
		}
	}
	if !strings.Contains(result, "Model") || !strings.Contains(result, "Notes") {
		t.Error("expected table headers")
	}
}

// ---------------------------------------------------------------------------
// settingModalHelp tests
// ---------------------------------------------------------------------------

func TestSettingModalHelp_KnownKeys(t *testing.T) {
	knownKeys := []struct {
		key      string
		contains string
	}{
		{"GITHUB_PERSONAL_ACCESS_TOKEN", "GitHub"},
		{"OPENAI_API_KEY", "OpenAI"},
		{"ASANA_API_TOKEN", "Asana"},
		{"AI_MODEL", "primary AI model"},
		{"AI_TEAM_HIGHLIGHT_MODEL", "team summary"},
		{"AI_MEMBER_HIGHLIGHTS_MODEL", "per-member"},
		{"AI_INDIVIDUAL_SUMMARIES_MODEL", "individual contributor"},
		{"VISIBLE_WINS_AI_MODEL", "visible wins"},
		{"AI_DISCREPANCY_ANALYSIS_MODEL", "discrepancy"},
		{"OPENAI_PROJECT", "Project ID"},
		{"OPENAI_SERVICE_TIER", "service tier"},
		{"TEAMHERO_LOG_LEVEL", "log file"},
		{"TEAMHERO_AI_DEBUG", "AI request"},
		{"TEAMHERO_AI_MAX_RETRIES", "retry"},
		{"TEAMHERO_ENABLE_PERIOD_DELTAS", "previous period"},
		{"TEAMHERO_SEQUENTIAL", "parallel"},
		{"TEAMHERO_DISCREPANCY_CONFIDENCE_THRESHOLD", "Confidence"},
		{"GITHUB_MAX_REPOSITORIES", "repositories"},
		{"TEAMHERO_MAX_PR_PAGES", "pull requests"},
		{"USER_MAP", "GitHub usernames"},
		{"ASANA_WORKSPACE_GID", "workspace"},
		{"ASANA_DEFAULT_EMAIL_DOMAIN", "email domain"},
		{"MEETING_NOTES_DIR", "meeting notes"},
		{"GOOGLE_DRIVE_FOLDER_IDS", "Google Drive"},
		{"@@private_repos", "private repositories"},
		{"@@archived_repos", "archived repositories"},
		{"@@include_bots", "bot accounts"},
	}

	for _, tc := range knownKeys {
		t.Run(tc.key, func(t *testing.T) {
			result := settingModalHelp(tc.key)
			if !strings.Contains(strings.ToLower(result), strings.ToLower(tc.contains)) {
				t.Errorf("settingModalHelp(%q) expected to contain %q, got %q", tc.key, tc.contains, result)
			}
		})
	}
}

func TestSettingModalHelp_UnknownKey(t *testing.T) {
	result := settingModalHelp("UNKNOWN_KEY_XYZ")
	if !strings.Contains(result, "Enter") {
		t.Errorf("expected default help text, got %q", result)
	}
}

func TestSettingModalHelp_AIModelContainsTable(t *testing.T) {
	result := settingModalHelp("AI_MODEL")
	if !strings.Contains(result, "gpt-5-mini") {
		t.Error("AI_MODEL help should include model table")
	}
}

// ---------------------------------------------------------------------------
// styleBoldAndCode tests
// ---------------------------------------------------------------------------

func TestStyleBoldAndCode_BoldText(t *testing.T) {
	boldStyle := lipgloss.NewStyle().Bold(true)
	codeStyle := lipgloss.NewStyle()

	result := styleBoldAndCode("This is **bold** text", boldStyle, codeStyle)
	if strings.Contains(result, "**") {
		t.Error("expected ** markers to be removed")
	}
	if !strings.Contains(result, "bold") {
		t.Error("expected bold text to remain")
	}
}

func TestStyleBoldAndCode_CodeText(t *testing.T) {
	boldStyle := lipgloss.NewStyle()
	codeStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("14"))

	result := styleBoldAndCode("Use `code` here", boldStyle, codeStyle)
	if strings.Contains(result, "`") {
		t.Error("expected backtick markers to be removed")
	}
	if !strings.Contains(result, "code") {
		t.Error("expected code text to remain")
	}
}

func TestStyleBoldAndCode_BothBoldAndCode(t *testing.T) {
	boldStyle := lipgloss.NewStyle().Bold(true)
	codeStyle := lipgloss.NewStyle()

	result := styleBoldAndCode("**bold** and `code`", boldStyle, codeStyle)
	if strings.Contains(result, "**") || strings.Contains(result, "`") {
		t.Error("expected markers to be removed")
	}
	if !strings.Contains(result, "bold") || !strings.Contains(result, "code") {
		t.Error("expected both bold and code text to remain")
	}
}

func TestStyleBoldAndCode_NoMarkers(t *testing.T) {
	boldStyle := lipgloss.NewStyle()
	codeStyle := lipgloss.NewStyle()

	input := "plain text with no markers"
	result := styleBoldAndCode(input, boldStyle, codeStyle)
	if result != input {
		t.Errorf("expected unchanged text, got %q", result)
	}
}

func TestStyleBoldAndCode_UnmatchedBold(t *testing.T) {
	boldStyle := lipgloss.NewStyle()
	codeStyle := lipgloss.NewStyle()

	result := styleBoldAndCode("unmatched **bold", boldStyle, codeStyle)
	if !strings.Contains(result, "**") {
		t.Error("expected unmatched ** to remain")
	}
}

func TestStyleBoldAndCode_UnmatchedCode(t *testing.T) {
	boldStyle := lipgloss.NewStyle()
	codeStyle := lipgloss.NewStyle()

	result := styleBoldAndCode("unmatched `code", boldStyle, codeStyle)
	if !strings.Contains(result, "`") {
		t.Error("expected unmatched backtick to remain")
	}
}

// ---------------------------------------------------------------------------
// renderHelpStyled tests
// ---------------------------------------------------------------------------

func TestRenderHelpStyled_EmptyText(t *testing.T) {
	result := renderHelpStyled("", 80)
	if result != "" {
		t.Errorf("expected empty result for empty text, got %q", result)
	}
}

func TestRenderHelpStyled_RegularParagraph(t *testing.T) {
	result := renderHelpStyled("This is a simple paragraph.", 80)
	if !strings.Contains(result, "simple paragraph") {
		t.Error("expected paragraph text in output")
	}
}

func TestRenderHelpStyled_BulletList(t *testing.T) {
	input := "- First item\n- Second item\n- Third item"
	result := renderHelpStyled(input, 80)
	if !strings.Contains(result, "First") || !strings.Contains(result, "Third") {
		t.Error("expected bullet list items in output")
	}
}

func TestRenderHelpStyled_Table(t *testing.T) {
	input := "| Model | Notes |\n|-------|-------|\n| gpt-5 | Best |"
	result := renderHelpStyled(input, 80)
	if !strings.Contains(result, "gpt-5") {
		t.Error("expected table content in output")
	}
}

func TestRenderHelpStyled_MultipleParagraphs(t *testing.T) {
	input := "First paragraph.\n\nSecond paragraph."
	result := renderHelpStyled(input, 80)
	if !strings.Contains(result, "First") || !strings.Contains(result, "Second") {
		t.Error("expected both paragraphs in output")
	}
}

func TestRenderHelpStyled_NarrowWidth(t *testing.T) {
	result := renderHelpStyled("Some text", 5)
	// Width < 10 is set to 10
	if !strings.Contains(result, "Some") {
		t.Error("expected text even at narrow width")
	}
}

func TestRenderHelpStyled_EmptyParagraph(t *testing.T) {
	input := "Before\n\n\n\nAfter"
	result := renderHelpStyled(input, 80)
	if !strings.Contains(result, "Before") || !strings.Contains(result, "After") {
		t.Error("expected content around empty paragraphs")
	}
}

func TestRenderHelpStyled_WithBoldAndCode(t *testing.T) {
	input := "Use **bold** and `code` in help text."
	result := renderHelpStyled(input, 80)
	if strings.Contains(result, "**") || strings.Contains(result, "`") {
		t.Error("expected markers to be styled, not raw")
	}
}

func TestRenderHelpStyled_TableSeparatorRowSkipped(t *testing.T) {
	input := "| Col1 | Col2 |\n|------|------|\n| A | B |"
	result := renderHelpStyled(input, 80)
	if strings.Contains(result, "------") {
		t.Error("expected separator row to be skipped")
	}
}

func TestRenderHelpStyled_MixedListAndText(t *testing.T) {
	input := "Description here.\n\n- Item one\n- Item two\n\nAnother paragraph."
	result := renderHelpStyled(input, 80)
	if !strings.Contains(result, "Item one") || !strings.Contains(result, "Another") {
		t.Error("expected mixed content in output")
	}
}

// ---------------------------------------------------------------------------
// renderHelpContent tests
// ---------------------------------------------------------------------------

func TestRenderHelpContent_NarrowWidth(t *testing.T) {
	m := &inlineSettingsEditor{
		items: []editorItem{{key: "A", label: "Test", description: "Help text"}},
		lines: []editorLine{{text: "item", itemIndex: 0}},
		cursor: 0,
	}
	result := m.renderHelpContent(10)
	if result != "" {
		t.Errorf("expected empty for width < 15, got %q", result)
	}
}

func TestRenderHelpContent_NoSelectedItem(t *testing.T) {
	m := &inlineSettingsEditor{
		items:  []editorItem{},
		lines:  []editorLine{{text: "header", itemIndex: -1}},
		cursor: 0,
	}
	result := m.renderHelpContent(60)
	if !strings.Contains(result, "Select a setting") {
		t.Errorf("expected placeholder text, got %q", result)
	}
}

func TestRenderHelpContent_SelectedItem(t *testing.T) {
	m := &inlineSettingsEditor{
		items: []editorItem{
			{key: "TEST_KEY", label: "Test Setting", value: "test-val", description: "A test description"},
		},
		lines:  []editorLine{{text: "item", itemIndex: 0}},
		cursor: 0,
	}
	result := m.renderHelpContent(60)
	if !strings.Contains(result, "Test Setting") {
		t.Error("expected setting label in help content")
	}
	if !strings.Contains(result, "test-val") {
		t.Error("expected current value in help content")
	}
}

func TestRenderHelpContent_SensitiveValue(t *testing.T) {
	m := &inlineSettingsEditor{
		items: []editorItem{
			{key: "SECRET", label: "Secret", value: "my-secret-value", sensitive: true, description: "Sensitive"},
		},
		lines:  []editorLine{{text: "item", itemIndex: 0}},
		cursor: 0,
	}
	result := m.renderHelpContent(60)
	if strings.Contains(result, "my-secret-value") {
		t.Error("sensitive value should be masked")
	}
}

func TestRenderHelpContent_JSONValue(t *testing.T) {
	m := &inlineSettingsEditor{
		items: []editorItem{
			{key: "USER_MAP", label: "User Map", value: `{"alice":{"name":"Alice"}}`, description: "Maps users"},
		},
		lines:  []editorLine{{text: "item", itemIndex: 0}},
		cursor: 0,
	}
	result := m.renderHelpContent(60)
	if !strings.Contains(result, "Current") {
		t.Error("expected 'Current:' label for JSON value")
	}
}

func TestRenderHelpContent_EmptyValue(t *testing.T) {
	m := &inlineSettingsEditor{
		items: []editorItem{
			{key: "K", label: "Key", value: "", defaultVal: "42", description: "A key"},
		},
		lines:  []editorLine{{text: "item", itemIndex: 0}},
		cursor: 0,
	}
	result := m.renderHelpContent(60)
	if !strings.Contains(result, "42") {
		t.Error("expected default value in help content")
	}
}

func TestRenderHelpContent_EmptyDescription(t *testing.T) {
	m := &inlineSettingsEditor{
		items: []editorItem{
			{key: "K", label: "Key", value: "val", description: ""},
		},
		lines:  []editorLine{{text: "item", itemIndex: 0}},
		cursor: 0,
	}
	result := m.renderHelpContent(60)
	if !strings.Contains(result, "No description") {
		t.Error("expected 'No description' for empty description")
	}
}

// ---------------------------------------------------------------------------
// renderEditModal tests
// ---------------------------------------------------------------------------

func TestRenderEditModal_InvalidEditIdx(t *testing.T) {
	m := &inlineSettingsEditor{
		editIdx: -1,
		items:   []editorItem{},
	}
	result := m.renderEditModal(60)
	if result != "" {
		t.Errorf("expected empty for invalid editIdx, got %q", result)
	}
}

func TestRenderEditModal_OutOfRange(t *testing.T) {
	m := &inlineSettingsEditor{
		editIdx: 99,
		items:   []editorItem{{key: "A"}},
	}
	result := m.renderEditModal(60)
	if result != "" {
		t.Errorf("expected empty for out-of-range editIdx, got %q", result)
	}
}

func TestRenderEditModal_ValidItem(t *testing.T) {
	m := &inlineSettingsEditor{
		editIdx: 0,
		items: []editorItem{
			{key: "AI_MODEL", label: "AI Model", description: "Choose model"},
		},
	}
	result := m.renderEditModal(60)
	if !strings.Contains(result, "AI Model") {
		t.Error("expected item label in modal")
	}
}

func TestRenderEditModal_NarrowWidth(t *testing.T) {
	m := &inlineSettingsEditor{
		editIdx: 0,
		items: []editorItem{
			{key: "K", label: "Key"},
		},
	}
	result := m.renderEditModal(10)
	if !strings.Contains(result, "Key") {
		t.Error("expected item label even at narrow width")
	}
}

// ---------------------------------------------------------------------------
// ensureCursorVisible tests
// ---------------------------------------------------------------------------

func TestEnsureCursorVisible_NotReady_Cov(t *testing.T) {
	m := &inlineSettingsEditor{ready: false, cursor: 5}
	m.ensureCursorVisible() // should be no-op
}

func TestEnsureCursorVisible_CursorAboveViewport_Cov(t *testing.T) {
	m := &inlineSettingsEditor{
		ready:    true,
		cursor:   0,
		viewport: viewport.New(40, 10),
	}
	m.viewport.SetYOffset(5) // viewport starts at line 5
	m.ensureCursorVisible()
	if m.viewport.YOffset != 0 {
		t.Errorf("expected viewport to scroll to cursor at 0, got offset %d", m.viewport.YOffset)
	}
}

func TestEnsureCursorVisible_CursorBelowViewport_Cov(t *testing.T) {
	m := &inlineSettingsEditor{
		ready:    true,
		cursor:   15,
		viewport: viewport.New(40, 10),
	}
	// Need content tall enough that the viewport can scroll
	var lines []string
	for i := 0; i < 30; i++ {
		lines = append(lines, "line")
	}
	m.viewport.SetContent(strings.Join(lines, "\n"))
	m.viewport.SetYOffset(0) // viewport starts at top
	m.ensureCursorVisible()
	expected := 15 - 10 + 1 // cursor - height + 1
	if m.viewport.YOffset != expected {
		t.Errorf("expected viewport offset %d, got %d", expected, m.viewport.YOffset)
	}
}

func TestEnsureCursorVisible_CursorAlreadyVisible_Cov(t *testing.T) {
	m := &inlineSettingsEditor{
		ready:    true,
		cursor:   5,
		viewport: viewport.New(40, 10),
	}
	m.viewport.SetYOffset(0)
	m.ensureCursorVisible()
	if m.viewport.YOffset != 0 {
		t.Errorf("expected viewport to stay at 0, got %d", m.viewport.YOffset)
	}
}

// ---------------------------------------------------------------------------
// enterEditOrSpecial tests — more paths
// ---------------------------------------------------------------------------

func TestEnterEditOrSpecial_SpecialNonSelect_Quits(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "item", itemIndex: 0}},
		items: []editorItem{
			{key: "@@setup", label: "Run Setup", special: true, itype: inputText},
		},
	}

	result, cmd := m.enterEditOrSpecial()
	editor := result.(*inlineSettingsEditor)
	if !editor.quitting {
		t.Error("expected quitting=true for special non-select item")
	}
	if editor.action != "@@setup" {
		t.Errorf("expected action '@@setup', got %q", editor.action)
	}
	if cmd == nil {
		t.Error("expected tea.Quit cmd")
	}
}

func TestEnterEditOrSpecial_BoolItem(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "item", itemIndex: 0}},
		items: []editorItem{
			{key: "TEAMHERO_AI_DEBUG", label: "AI Debug", itype: inputBool, value: "false"},
		},
	}

	result, _ := m.enterEditOrSpecial()
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeEdit {
		t.Error("expected modeEdit")
	}
	if editor.editForm == nil {
		t.Error("expected editForm to be set for bool item")
	}
}

func TestEnterEditOrSpecial_YesNoItem(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "item", itemIndex: 0}},
		items: []editorItem{
			{key: "@@private_repos", label: "Include Private Repos", itype: inputYesNo, value: "Yes"},
		},
	}

	result, _ := m.enterEditOrSpecial()
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeEdit {
		t.Error("expected modeEdit")
	}
	if editor.editForm == nil {
		t.Error("expected editForm for YesNo item")
	}
}

func TestEnterEditOrSpecial_SelectItem(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "item", itemIndex: 0}},
		items: []editorItem{
			{key: "AI_MODEL", label: "AI Model", itype: inputSelect, options: []string{"gpt-5-mini", "gpt-5", "custom..."}, value: "gpt-5-mini"},
		},
	}

	result, _ := m.enterEditOrSpecial()
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeEdit {
		t.Error("expected modeEdit")
	}
	if editor.editForm == nil {
		t.Error("expected editForm for select item")
	}
}

func TestEnterEditOrSpecial_NumberItem(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "item", itemIndex: 0}},
		items: []editorItem{
			{key: "TEAMHERO_AI_MAX_RETRIES", label: "Max Retries", itype: inputNumber, value: "3"},
		},
	}

	result, _ := m.enterEditOrSpecial()
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeEdit {
		t.Error("expected modeEdit")
	}
	if editor.editForm == nil {
		t.Error("expected editForm for number item")
	}
}

func TestEnterEditOrSpecial_JSONItem(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		width:  80,
		height: 24,
		lines:  []editorLine{{text: "item", itemIndex: 0}},
		items: []editorItem{
			{key: "@@boards", label: "Boards", itype: inputJSON, value: `{"boards":[]}`},
		},
	}

	result, _ := m.enterEditOrSpecial()
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeEdit {
		t.Error("expected modeEdit")
	}
	if editor.editForm == nil {
		t.Error("expected editForm for JSON item")
	}
}

func TestEnterEditOrSpecial_SensitiveTextItem(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "item", itemIndex: 0}},
		items: []editorItem{
			{key: "SECRET", label: "Secret Key", itype: inputText, sensitive: true, value: "hidden"},
		},
	}

	result, _ := m.enterEditOrSpecial()
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeEdit {
		t.Error("expected modeEdit")
	}
	if editor.editForm == nil {
		t.Error("expected editForm for sensitive text item")
	}
}

func TestEnterEditOrSpecial_EmptyBoolValue(t *testing.T) {
	m := &inlineSettingsEditor{
		cursor: 0,
		lines:  []editorLine{{text: "item", itemIndex: 0}},
		items: []editorItem{
			{key: "FLAG", label: "Flag", itype: inputBool, value: "", defaultVal: "false"},
		},
	}

	result, _ := m.enterEditOrSpecial()
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeEdit {
		t.Error("expected modeEdit")
	}
}

// ---------------------------------------------------------------------------
// confirmEdit — more paths
// ---------------------------------------------------------------------------

func TestConfirmEdit_GDriveSelection(t *testing.T) {
	m := &inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		editVal: "Manage connection",
		cursor:  0,
		items: []editorItem{
			{key: "@@gdrive", label: "Google Drive", special: true},
		},
		lines: []editorLine{{text: "item", itemIndex: 0}},
	}

	result, cmd := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	if !editor.quitting {
		t.Error("expected quitting=true for @@gdrive selection")
	}
	if editor.action != "@@gdrive" {
		t.Errorf("expected action '@@gdrive', got %q", editor.action)
	}
	if cmd == nil {
		t.Error("expected tea.Quit cmd")
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
		lines: []editorLine{{text: "item", itemIndex: 0}},
	}

	result, cmd := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeEdit {
		t.Error("expected to stay in modeEdit for custom input")
	}
	if editor.editForm == nil {
		t.Error("expected new form for custom input")
	}
	if editor.editVal != "gpt-5-mini" {
		t.Errorf("expected editVal pre-populated with current value, got %q", editor.editVal)
	}
	_ = cmd
}

func TestConfirmEdit_BoardsSaveJSON(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)

	m := &inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		editVal: `{"boards":[{"projectGid":"123"},{"projectGid":"456"}]}`,
		cursor:  0,
		items: []editorItem{
			{key: "@@boards", label: "Boards", itype: inputJSON},
		},
		lines: []editorLine{{text: "item", itemIndex: 0}},
	}

	result, _ := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	if editor.statusMsg != "Saved" {
		t.Errorf("expected 'Saved', got %q", editor.statusMsg)
	}
	if !strings.Contains(editor.items[0].defaultVal, "2 configured") {
		t.Errorf("expected '2 configured', got %q", editor.items[0].defaultVal)
	}

	// Verify file was written
	boardsPath := filepath.Join(teamheroDir, "asana-config.json")
	data, err := os.ReadFile(boardsPath)
	if err != nil {
		t.Fatalf("expected boards file to exist: %v", err)
	}
	if !strings.Contains(string(data), "123") {
		t.Error("expected boards JSON in file")
	}
}

func TestConfirmEdit_BoardsClear(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	boardsPath := filepath.Join(teamheroDir, "asana-config.json")
	os.WriteFile(boardsPath, []byte(`{"boards":[]}`), 0o644)

	m := &inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		editVal: "",
		cursor:  0,
		items: []editorItem{
			{key: "@@boards", label: "Boards", itype: inputJSON, value: `{"boards":[]}`},
		},
		lines: []editorLine{{text: "item", itemIndex: 0}},
	}

	result, _ := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	if editor.items[0].value != "" {
		t.Error("expected boards value to be cleared")
	}
	if editor.items[0].defaultVal != "not set" {
		t.Errorf("expected defaultVal 'not set', got %q", editor.items[0].defaultVal)
	}
}

func TestConfirmEdit_JSONValueCompacted(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	envFile := filepath.Join(teamheroDir, ".env")
	os.WriteFile(envFile, []byte("USER_MAP=\n"), 0o600)

	m := &inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		editVal: `{"alice": {"name": "Alice"}}`,
		cursor:  0,
		envPath: envFile,
		items: []editorItem{
			{key: "USER_MAP", label: "User Map", itype: inputJSON},
		},
		lines: []editorLine{{text: "item", itemIndex: 0}},
	}

	result, _ := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	if editor.statusMsg != "Saved" {
		t.Errorf("expected 'Saved', got %q", editor.statusMsg)
	}
	// JSON value should be stored compacted with single-quote wrapping
	if !strings.HasPrefix(editor.items[0].value, "'") {
		t.Errorf("expected single-quote wrapped JSON, got %q", editor.items[0].value)
	}
}

func TestConfirmEdit_ArchivedRepos(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	os.WriteFile(filepath.Join(teamheroDir, "config.json"), []byte(`{}`), 0o644)

	m := &inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		editVal: "Yes",
		cursor:  0,
		envPath: filepath.Join(teamheroDir, ".env"),
		items: []editorItem{
			{key: "@@archived_repos", label: "Include Archived Repos", value: "No"},
		},
		lines: []editorLine{{text: "item", itemIndex: 0}},
	}

	result, _ := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	if editor.items[0].value != "Yes" {
		t.Errorf("expected 'Yes', got %q", editor.items[0].value)
	}

	savedCfg, _ := LoadSavedConfig()
	if savedCfg != nil && !savedCfg.IncludeArchived {
		t.Error("expected IncludeArchived=true")
	}
}

func TestConfirmEdit_IncludeBots(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	teamheroDir := filepath.Join(tmpDir, "teamhero")
	os.MkdirAll(teamheroDir, 0o755)
	os.WriteFile(filepath.Join(teamheroDir, "config.json"), []byte(`{}`), 0o644)

	m := &inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		editVal: "true",
		cursor:  0,
		envPath: filepath.Join(teamheroDir, ".env"),
		items: []editorItem{
			{key: "@@include_bots", label: "Include Bot Accounts", value: "No"},
		},
		lines: []editorLine{{text: "item", itemIndex: 0}},
	}

	result, _ := m.confirmEdit()
	editor := result.(*inlineSettingsEditor)
	if editor.items[0].value != "Yes" {
		t.Errorf("expected 'Yes', got %q", editor.items[0].value)
	}
}

// ---------------------------------------------------------------------------
// handleEditKey tests — more paths
// ---------------------------------------------------------------------------

func TestHandleEditKey_EscReturnsToNavigate(t *testing.T) {
	m := &inlineSettingsEditor{
		mode:    modeEdit,
		editIdx: 0,
		items:   []editorItem{{key: "A"}},
		lines:   []editorLine{{text: "item", itemIndex: 0}},
	}

	result, _ := m.handleEditKey(tea.KeyMsg{Type: tea.KeyEscape})
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeNavigate {
		t.Error("expected modeNavigate after Esc")
	}
	if editor.editForm != nil {
		t.Error("expected editForm to be nil after Esc")
	}
}

func TestHandleEditKey_NoForm(t *testing.T) {
	m := &inlineSettingsEditor{
		mode:     modeEdit,
		editIdx:  0,
		editForm: nil,
		items:    []editorItem{{key: "A"}},
		lines:    []editorLine{{text: "item", itemIndex: 0}},
	}

	result, cmd := m.handleEditKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'x'}})
	editor := result.(*inlineSettingsEditor)
	if editor.mode != modeEdit {
		t.Error("expected to stay in modeEdit")
	}
	if cmd != nil {
		t.Error("expected nil cmd with no form")
	}
}

// ---------------------------------------------------------------------------
// wordWrap tests
// ---------------------------------------------------------------------------

func TestWordWrap_NormalText(t *testing.T) {
	lines := wordWrap("hello world foo bar", 10)
	if len(lines) < 2 {
		t.Errorf("expected multiple lines for narrow wrap, got %d", len(lines))
	}
}

func TestWordWrap_ZeroWidth(t *testing.T) {
	lines := wordWrap("test", 0)
	if len(lines) != 1 || lines[0] != "test" {
		t.Errorf("expected single line for zero width, got %v", lines)
	}
}

func TestWordWrap_EmptyString(t *testing.T) {
	lines := wordWrap("", 80)
	if lines != nil {
		t.Errorf("expected nil for empty string, got %v", lines)
	}
}

func TestWordWrap_SingleWord(t *testing.T) {
	lines := wordWrap("hello", 3)
	if len(lines) != 1 || lines[0] != "hello" {
		t.Errorf("expected single word even if wider than maxWidth, got %v", lines)
	}
}

// ---------------------------------------------------------------------------
// looksLikeJSON tests
// ---------------------------------------------------------------------------

func TestLooksLikeJSON_Object(t *testing.T) {
	if !looksLikeJSON(`{"key":"val"}`) {
		t.Error("expected true for JSON object")
	}
}

func TestLooksLikeJSON_Array(t *testing.T) {
	if !looksLikeJSON(`[1,2,3]`) {
		t.Error("expected true for JSON array")
	}
}

func TestLooksLikeJSON_NotJSON(t *testing.T) {
	if looksLikeJSON("hello") {
		t.Error("expected false for plain text")
	}
}

func TestLooksLikeJSON_WithWhitespace(t *testing.T) {
	if !looksLikeJSON("  { } ") {
		t.Error("expected true for JSON with whitespace")
	}
}

// ---------------------------------------------------------------------------
// lastSelectableLine edge case
// ---------------------------------------------------------------------------

func TestLastSelectableLine_Empty(t *testing.T) {
	m := inlineSettingsEditor{
		lines: []editorLine{
			{text: "header", itemIndex: -1},
		},
	}
	if m.lastSelectableLine() != 0 {
		t.Error("expected 0 for no selectable lines")
	}
}

// ---------------------------------------------------------------------------
// Navigate with ensureCursorVisible integration
// ---------------------------------------------------------------------------

func TestNavigateDown_WithViewport(t *testing.T) {
	m := inlineSettingsEditor{
		ready: true,
		lines: []editorLine{
			{text: "header", itemIndex: -1},
			{text: "item0", itemIndex: 0},
			{text: "item1", itemIndex: 1},
		},
		items:    []editorItem{{key: "A"}, {key: "B"}},
		cursor:   1,
		viewport: viewport.New(40, 10),
	}

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyDown})
	editor := updated.(*inlineSettingsEditor)
	if editor.cursor != 2 {
		t.Errorf("expected cursor=2, got %d", editor.cursor)
	}
}

// ---------------------------------------------------------------------------
// settingHelpText tests
// ---------------------------------------------------------------------------

func TestSettingHelpText_KnownKeys(t *testing.T) {
	cases := []struct {
		key      string
		contains string
	}{
		{"GITHUB_PERSONAL_ACCESS_TOKEN", "GitHub"},
		{"OPENAI_API_KEY", "OpenAI"},
		{"ASANA_API_TOKEN", "Asana"},
		{"USER_MAP", "Maps GitHub"},
		{"TEAMHERO_DISCREPANCY_CONFIDENCE_THRESHOLD", "confidence"},
	}
	for _, tc := range cases {
		result := settingHelpText(tc.key, "")
		if !strings.Contains(strings.ToLower(result), strings.ToLower(tc.contains)) {
			t.Errorf("settingHelpText(%q) expected to contain %q", tc.key, tc.contains)
		}
	}
}

func TestSettingHelpText_WithDescription(t *testing.T) {
	result := settingHelpText("UNKNOWN", "Custom description")
	if result != "Custom description" {
		t.Errorf("expected custom description, got %q", result)
	}
}

func TestSettingHelpText_NoDescription(t *testing.T) {
	result := settingHelpText("UNKNOWN", "")
	if result != "Press Enter to edit this value." {
		t.Errorf("expected default help text, got %q", result)
	}
}

// ---------------------------------------------------------------------------
// renderStyledLine tests
// ---------------------------------------------------------------------------

func TestRenderStyledLine_SetValue(t *testing.T) {
	item := editorItem{key: "K", label: "Key", value: "val"}
	result := renderStyledLine(item)
	if !strings.Contains(result, "Key") || !strings.Contains(result, "val") {
		t.Errorf("expected label and value, got %q", result)
	}
}

func TestRenderStyledLine_EmptyWithDefault(t *testing.T) {
	item := editorItem{key: "K", label: "Key", value: "", defaultVal: "42"}
	result := renderStyledLine(item)
	if !strings.Contains(result, "42") {
		t.Errorf("expected default value, got %q", result)
	}
}

func TestRenderStyledLine_Sensitive(t *testing.T) {
	item := editorItem{key: "K", label: "Key", value: "secret123", sensitive: true}
	result := renderStyledLine(item)
	if strings.Contains(result, "secret123") {
		t.Error("sensitive value should be masked")
	}
}

func TestRenderStyledLine_SpecialNotConnected(t *testing.T) {
	item := editorItem{key: "@@gdrive", label: "Google Drive", value: "not connected", special: true}
	result := renderStyledLine(item)
	if !strings.Contains(result, "not connected") {
		t.Errorf("expected 'not connected', got %q", result)
	}
}

func TestRenderStyledLine_SpecialConnected(t *testing.T) {
	item := editorItem{key: "@@gdrive", label: "Google Drive", value: "user@example.com", special: true}
	result := renderStyledLine(item)
	if !strings.Contains(result, "user@example.com") {
		t.Errorf("expected email, got %q", result)
	}
}

func TestRenderStyledLine_LongValue(t *testing.T) {
	item := editorItem{key: "K", label: "Key", value: strings.Repeat("x", 60)}
	result := renderStyledLine(item)
	if !strings.Contains(result, "...") {
		t.Error("expected truncated long value")
	}
}

func TestRenderStyledLine_Empty(t *testing.T) {
	item := editorItem{key: "K", label: "Key", value: ""}
	result := renderStyledLine(item)
	if !strings.Contains(result, "(not set)") {
		t.Errorf("expected '(not set)', got %q", result)
	}
}
