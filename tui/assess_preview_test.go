package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildAssessEvidenceMarkdown_Empty(t *testing.T) {
	out := buildAssessEvidenceMarkdown("")
	if !strings.Contains(out, "No JSON data available") {
		t.Errorf("expected fallback message, got: %s", out)
	}
}

func TestBuildAssessEvidenceMarkdown_InvalidJSON(t *testing.T) {
	out := buildAssessEvidenceMarkdown("not json")
	if !strings.Contains(out, "Failed to parse audit JSON") {
		t.Errorf("expected parse-error message, got: %s", out)
	}
}

func TestBuildAssessEvidenceMarkdown_RendersItems(t *testing.T) {
	jsonStr := `{
		"items": [
			{"itemId": 1, "score": 1, "whyThisScore": "justfile present"},
			{"itemId": 2, "score": 0.5, "whyThisScore": "tier-3 cap"}
		],
		"notesForReaudit": ["Re-check item 4 next quarter."]
	}`
	out := buildAssessEvidenceMarkdown(jsonStr)
	if !strings.Contains(out, "## Per-item evidence") {
		t.Errorf("missing header: %s", out)
	}
	if !strings.Contains(out, "Item 1") || !strings.Contains(out, "Item 2") {
		t.Errorf("missing items: %s", out)
	}
	if !strings.Contains(out, "justfile present") {
		t.Errorf("missing item-1 reason: %s", out)
	}
	if !strings.Contains(out, "tier-3 cap") {
		t.Errorf("missing item-2 reason: %s", out)
	}
	if !strings.Contains(out, "Notes for re-audit") {
		t.Errorf("missing notes section: %s", out)
	}
	if !strings.Contains(out, "Re-check item 4 next quarter.") {
		t.Errorf("missing note text: %s", out)
	}
}

func TestNewAssessPreviewModel_ReadsMarkdown(t *testing.T) {
	dir := t.TempDir()
	mdPath := filepath.Join(dir, "audit.md")
	if err := os.WriteFile(mdPath, []byte("# Audit\n\nbody"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	m := newAssessPreviewModel(mdPath, "", "")
	if m.renderErr != "" {
		t.Errorf("unexpected renderErr: %s", m.renderErr)
	}
	if !strings.Contains(m.markdown, "# Audit") {
		t.Errorf("markdown not loaded: %s", m.markdown)
	}
	if m.activeTab != assessTabAudit {
		t.Errorf("activeTab = %d, want %d", m.activeTab, assessTabAudit)
	}
}

func TestNewAssessPreviewModel_MissingFile(t *testing.T) {
	m := newAssessPreviewModel("/no/such/file.md", "", "")
	if !strings.Contains(m.renderErr, "Could not read audit file") {
		t.Errorf("expected read error, got: %s", m.renderErr)
	}
}

func TestAssessPreview_TabBarHasThreeTabs(t *testing.T) {
	m := newAssessPreviewModel("/no/such.md", "", `{"items":[]}`)
	bar := m.renderTabBar()
	for _, label := range assessTabLabels {
		if !strings.Contains(bar, label) {
			t.Errorf("tab bar missing label %q: %s", label, bar)
		}
	}
}

func TestAssessPreview_TabBarShowsJSONCheckmark(t *testing.T) {
	withData := newAssessPreviewModel("/no/such.md", "", `{"items":[]}`)
	bar1 := withData.renderTabBar()
	if !strings.Contains(bar1, "✔") {
		t.Errorf("expected ✔ next to JSON tab when data present: %s", bar1)
	}

	withoutData := newAssessPreviewModel("/no/such.md", "", "")
	bar2 := withoutData.renderTabBar()
	if strings.Contains(bar2, "✔") {
		t.Errorf("did not expect ✔ when no JSON data: %s", bar2)
	}
}
