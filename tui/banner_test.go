package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestFormatSample_EmptyList(t *testing.T) {
	got := formatSample([]string{}, 3)
	if got != "none" {
		t.Errorf("formatSample(empty, 3) = %q, want %q", got, "none")
	}
}

func TestFormatSample_NilList(t *testing.T) {
	got := formatSample(nil, 3)
	if got != "none" {
		t.Errorf("formatSample(nil, 3) = %q, want %q", got, "none")
	}
}

func TestFormatSample_WithinLimit(t *testing.T) {
	items := []string{"alpha", "beta"}
	got := formatSample(items, 3)
	want := "alpha, beta"
	if got != want {
		t.Errorf("formatSample(%v, 3) = %q, want %q", items, got, want)
	}
}

func TestFormatSample_ExactlyAtLimit(t *testing.T) {
	items := []string{"a", "b", "c"}
	got := formatSample(items, 3)
	want := "a, b, c"
	if got != want {
		t.Errorf("formatSample(%v, 3) = %q, want %q", items, got, want)
	}
}

func TestFormatSample_ExceedsLimit(t *testing.T) {
	items := []string{"a", "b", "c", "d", "e"}
	got := formatSample(items, 2)
	want := "a, b, … (+3 more)"
	if got != want {
		t.Errorf("formatSample(%v, 2) = %q, want %q", items, got, want)
	}
}

func TestFormatSample_SingleItem(t *testing.T) {
	items := []string{"only"}
	got := formatSample(items, 1)
	want := "only"
	if got != want {
		t.Errorf("formatSample(%v, 1) = %q, want %q", items, got, want)
	}
}

func TestFormatCompact_Empty(t *testing.T) {
	got := formatCompact([]string{})
	if got != "none" {
		t.Errorf("formatCompact(empty) = %q, want %q", got, "none")
	}
}

func TestFormatCompact_Nil(t *testing.T) {
	got := formatCompact(nil)
	if got != "none" {
		t.Errorf("formatCompact(nil) = %q, want %q", got, "none")
	}
}

func TestFormatCompact_SingleItem(t *testing.T) {
	got := formatCompact([]string{"repo-a"})
	if got != "repo-a" {
		t.Errorf("formatCompact([repo-a]) = %q, want %q", got, "repo-a")
	}
}

func TestFormatCompact_TwoItems(t *testing.T) {
	got := formatCompact([]string{"repo-a", "repo-b"})
	want := "repo-a +1"
	if got != want {
		t.Errorf("formatCompact([repo-a, repo-b]) = %q, want %q", got, want)
	}
}

func TestFormatCompact_ManyItems(t *testing.T) {
	got := formatCompact([]string{"x", "y", "z", "w"})
	want := "x +3"
	if got != want {
		t.Errorf("formatCompact([x,y,z,w]) = %q, want %q", got, want)
	}
}

func TestBoolStr_True(t *testing.T) {
	if got := boolStr(true); got != "Yes" {
		t.Errorf("boolStr(true) = %q, want %q", got, "Yes")
	}
}

func TestBoolStr_False(t *testing.T) {
	if got := boolStr(false); got != "No" {
		t.Errorf("boolStr(false) = %q, want %q", got, "No")
	}
}

func TestBuildSlashHeader_ZeroWidth(t *testing.T) {
	got := buildSlashHeader(0)
	if got != shellHeaderPrefix {
		t.Errorf("buildSlashHeader(0) = %q, want prefix only %q", got, shellHeaderPrefix)
	}
}

func TestBuildSlashHeader_NegativeWidth(t *testing.T) {
	got := buildSlashHeader(-5)
	if got != shellHeaderPrefix {
		t.Errorf("buildSlashHeader(-5) = %q, want prefix only %q", got, shellHeaderPrefix)
	}
}

func TestBuildSlashHeader_SmallWidth(t *testing.T) {
	// When contentWidth is less than the prefix width, should return prefix only
	got := buildSlashHeader(5)
	if got != shellHeaderPrefix {
		t.Errorf("buildSlashHeader(5) = %q, want prefix only %q", got, shellHeaderPrefix)
	}
}

func TestBuildSlashHeader_NormalWidth(t *testing.T) {
	width := 80
	got := buildSlashHeader(width)
	if !strings.HasPrefix(got, shellHeaderPrefix) {
		t.Errorf("buildSlashHeader(%d) should start with prefix %q, got %q", width, shellHeaderPrefix, got)
	}
	// The rest should be slashes
	rest := got[len(shellHeaderPrefix):]
	expected := strings.Repeat("/", width-len(shellHeaderPrefix))
	if rest != expected {
		t.Errorf("buildSlashHeader(%d) trailing slashes: got len %d, want len %d", width, len(rest), len(expected))
	}
}

func TestBuildSlashHeader_ExactPrefixWidth(t *testing.T) {
	// When contentWidth exactly equals prefix width, no slashes appended
	prefixWidth := len(shellHeaderPrefix)
	got := buildSlashHeader(prefixWidth)
	if got != shellHeaderPrefix {
		t.Errorf("buildSlashHeader(%d) = %q, want prefix only %q", prefixWidth, got, shellHeaderPrefix)
	}
}

// ---------------------------------------------------------------------------
// RenderBanner — uses bannerWriter override
// ---------------------------------------------------------------------------

func TestRenderBanner_WritesText(t *testing.T) {
	var buf bytes.Buffer
	orig := bannerWriter
	bannerWriter = &buf
	t.Cleanup(func() { bannerWriter = orig })

	RenderBanner("Hello World")

	got := buf.String()
	if got == "" {
		t.Fatal("RenderBanner wrote nothing")
	}
	if !strings.Contains(got, "Hello World") {
		t.Errorf("RenderBanner output %q does not contain %q", got, "Hello World")
	}
}

func TestRenderBanner_EmptyText(t *testing.T) {
	var buf bytes.Buffer
	orig := bannerWriter
	bannerWriter = &buf
	t.Cleanup(func() { bannerWriter = orig })

	RenderBanner("")

	got := buf.String()
	// Should still produce output (the styled box), even if text is empty
	if got == "" {
		t.Fatal("RenderBanner with empty text wrote nothing")
	}
}

func TestRenderBanner_MultiLineText(t *testing.T) {
	var buf bytes.Buffer
	orig := bannerWriter
	bannerWriter = &buf
	t.Cleanup(func() { bannerWriter = orig })

	RenderBanner("Line 1\nLine 2")

	got := buf.String()
	if !strings.Contains(got, "Line 1") || !strings.Contains(got, "Line 2") {
		t.Errorf("RenderBanner output missing multi-line content: %q", got)
	}
}

// ---------------------------------------------------------------------------
// RenderSuccessBox
// ---------------------------------------------------------------------------

func TestRenderSuccessBox_ContainsTitleAndBody(t *testing.T) {
	var buf bytes.Buffer
	orig := bannerWriter
	bannerWriter = &buf
	t.Cleanup(func() { bannerWriter = orig })

	RenderSuccessBox("Report Complete", "/tmp/report.md")

	got := buf.String()
	if !strings.Contains(got, "Report Complete") {
		t.Errorf("RenderSuccessBox output missing title: %q", got)
	}
	if !strings.Contains(got, "/tmp/report.md") {
		t.Errorf("RenderSuccessBox output missing body: %q", got)
	}
}

func TestRenderSuccessBox_ContainsMarkdownLabel(t *testing.T) {
	var buf bytes.Buffer
	orig := bannerWriter
	bannerWriter = &buf
	t.Cleanup(func() { bannerWriter = orig })

	RenderSuccessBox("Done", "/path/to/file.md")

	got := buf.String()
	if !strings.Contains(got, "Markdown") {
		t.Errorf("RenderSuccessBox output missing 'Markdown' label: %q", got)
	}
}

// ---------------------------------------------------------------------------
// RenderError
// ---------------------------------------------------------------------------

func TestRenderError_ContainsErrorPrefix(t *testing.T) {
	var buf bytes.Buffer
	orig := bannerWriter
	bannerWriter = &buf
	t.Cleanup(func() { bannerWriter = orig })

	RenderError("something went wrong")

	got := buf.String()
	if !strings.Contains(got, "Error:") {
		t.Errorf("RenderError output missing 'Error:' prefix: %q", got)
	}
	if !strings.Contains(got, "something went wrong") {
		t.Errorf("RenderError output missing message: %q", got)
	}
}

func TestRenderError_EmptyMessage(t *testing.T) {
	var buf bytes.Buffer
	orig := bannerWriter
	bannerWriter = &buf
	t.Cleanup(func() { bannerWriter = orig })

	RenderError("")

	got := buf.String()
	if !strings.Contains(got, "Error:") {
		t.Errorf("RenderError output missing 'Error:' even with empty message: %q", got)
	}
}

// ---------------------------------------------------------------------------
// renderShellHeader
// ---------------------------------------------------------------------------

func TestRenderShellHeader_NormalWidth(t *testing.T) {
	got := renderShellHeader(80)
	if got == "" {
		t.Fatal("renderShellHeader(80) returned empty string")
	}
	// The output contains ANSI escape codes, so we cannot check exact text.
	// But it should contain the word "TEAM HERO" somewhere in the raw bytes.
	if !strings.Contains(got, "TEAM HERO") {
		t.Errorf("renderShellHeader(80) missing 'TEAM HERO': %q", got)
	}
}

func TestRenderShellHeader_SmallWidth(t *testing.T) {
	// Even with a very small width, it should not panic
	got := renderShellHeader(5)
	if got == "" {
		t.Fatal("renderShellHeader(5) returned empty string")
	}
}

func TestRenderShellHeader_ZeroWidth(t *testing.T) {
	got := renderShellHeader(0)
	// Should still return the prefix at minimum (function uses max(20, totalWidth-1))
	if got == "" {
		t.Fatal("renderShellHeader(0) returned empty string")
	}
}

func TestRenderShellHeader_LargeWidth(t *testing.T) {
	got := renderShellHeader(200)
	if got == "" {
		t.Fatal("renderShellHeader(200) returned empty string")
	}
	if !strings.Contains(got, "TEAM HERO") {
		t.Errorf("renderShellHeader(200) missing 'TEAM HERO': %q", got)
	}
}

// ---------------------------------------------------------------------------
// renderGradientSlashes
// ---------------------------------------------------------------------------

func TestRenderGradientSlashes_ZeroCount(t *testing.T) {
	got := renderGradientSlashes(0)
	if got != "" {
		t.Errorf("renderGradientSlashes(0) = %q, want empty", got)
	}
}

func TestRenderGradientSlashes_NegativeCount(t *testing.T) {
	got := renderGradientSlashes(-5)
	if got != "" {
		t.Errorf("renderGradientSlashes(-5) = %q, want empty", got)
	}
}

func TestRenderGradientSlashes_SingleChar(t *testing.T) {
	got := renderGradientSlashes(1)
	if got == "" {
		t.Fatal("renderGradientSlashes(1) returned empty string")
	}
	// Should contain exactly one "/" character (possibly wrapped in ANSI codes)
	if !strings.Contains(got, "/") {
		t.Errorf("renderGradientSlashes(1) missing '/': %q", got)
	}
}

func TestRenderGradientSlashes_TenChars(t *testing.T) {
	got := renderGradientSlashes(10)
	if got == "" {
		t.Fatal("renderGradientSlashes(10) returned empty string")
	}
	// Should contain exactly 10 slash characters
	count := strings.Count(got, "/")
	if count != 10 {
		t.Errorf("renderGradientSlashes(10) has %d '/' chars, want 10", count)
	}
}

func TestRenderGradientSlashes_ContainsSlashes(t *testing.T) {
	got := renderGradientSlashes(5)
	// Should contain exactly 5 slash characters regardless of color profile
	count := strings.Count(got, "/")
	if count != 5 {
		t.Errorf("renderGradientSlashes(5) has %d '/' chars, want 5", count)
	}
	// Length should be at least 5 (plain slashes) — may be longer with ANSI codes
	if len(got) < 5 {
		t.Errorf("renderGradientSlashes(5) len = %d, want >= 5", len(got))
	}
}

// ---------------------------------------------------------------------------
// renderDividerLine
// ---------------------------------------------------------------------------

func TestRenderDividerLine_NormalWidth(t *testing.T) {
	got := renderDividerLine(80)
	// Should be 78 "─" chars (contentWidth - 2 safety margin)
	expected := strings.Repeat("─", 78)
	if got != expected {
		t.Errorf("renderDividerLine(80) = len %d, want len %d", len(got), len(expected))
	}
}

func TestRenderDividerLine_SmallWidth(t *testing.T) {
	got := renderDividerLine(3)
	// 3 - 2 = 1
	expected := strings.Repeat("─", 1)
	if got != expected {
		t.Errorf("renderDividerLine(3) = %q, want %q", got, expected)
	}
}

func TestRenderDividerLine_ZeroWidth(t *testing.T) {
	got := renderDividerLine(0)
	if got != "" {
		t.Errorf("renderDividerLine(0) = %q, want empty", got)
	}
}

func TestRenderDividerLine_NegativeWidth(t *testing.T) {
	got := renderDividerLine(-10)
	if got != "" {
		t.Errorf("renderDividerLine(-10) = %q, want empty", got)
	}
}

func TestRenderDividerLine_WidthTwo(t *testing.T) {
	got := renderDividerLine(2)
	// 2 - 2 = 0
	if got != "" {
		t.Errorf("renderDividerLine(2) = %q, want empty", got)
	}
}

func TestRenderDividerLine_WidthOne(t *testing.T) {
	got := renderDividerLine(1)
	// max(0, 1-2) = 0
	if got != "" {
		t.Errorf("renderDividerLine(1) = %q, want empty", got)
	}
}

func TestRenderDividerLine_LargeWidth(t *testing.T) {
	got := renderDividerLine(200)
	expected := strings.Repeat("─", 198)
	if got != expected {
		t.Errorf("renderDividerLine(200) = len %d, want len %d", len(got), len(expected))
	}
}

// ---------------------------------------------------------------------------
// termWidth — can only test fallback behavior
// ---------------------------------------------------------------------------

func TestTermWidth_ReturnsPositive(t *testing.T) {
	w := termWidth()
	if w <= 0 {
		t.Errorf("termWidth() = %d, want > 0", w)
	}
}
