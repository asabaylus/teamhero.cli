package main

import (
	"regexp"
	"strings"
	"testing"
)

var ansiEscapes = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]`)

func stripANSI(s string) string {
	return ansiEscapes.ReplaceAllString(s, "")
}

func TestRenderInterviewAuditPreview_PinsAdvisoryBannerAtTop(t *testing.T) {
	body := "# Senior Backend Engineer — Jane Doe\n\n" +
		"## Observations\n\nThe candidate explored the cache layer thoroughly.\n"
	out, err := renderInterviewAuditPreview(body, 80)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	plain := stripANSI(out)
	if !strings.Contains(plain, "ADVISORY") {
		t.Fatalf("preview must include ADVISORY warning banner, got %q", plain)
	}
	if !strings.Contains(plain, "Jane Doe") {
		t.Fatalf("preview must include the candidate name from the input, got %q", plain)
	}
	bannerIdx := strings.Index(plain, "ADVISORY")
	nameIdx := strings.Index(plain, "Jane Doe")
	if bannerIdx > nameIdx {
		t.Errorf("ADVISORY banner must be pinned ABOVE the candidate name; banner@%d name@%d", bannerIdx, nameIdx)
	}
}

func TestRenderInterviewAuditPreview_PreservesContent(t *testing.T) {
	body := "## Reasoning chain\n\n- Candidate ran tests after each change.\n- Used type-narrowing to scope refactor."
	out, err := renderInterviewAuditPreview(body, 80)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	plain := stripANSI(out)
	if !strings.Contains(plain, "type-narrowing") {
		t.Errorf("preview must preserve the source content, got %q", plain)
	}
}

func TestRenderInterviewAuditPreview_EmptyBodyStillEmitsBanner(t *testing.T) {
	out, err := renderInterviewAuditPreview("", 80)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	plain := stripANSI(out)
	if !strings.Contains(plain, "ADVISORY") {
		t.Errorf("preview must include ADVISORY banner even for empty source, got %q", plain)
	}
}
