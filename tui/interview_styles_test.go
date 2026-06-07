package main

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
)

func TestInterviewStyles_ReusesProjectPalette(t *testing.T) {
	s := newInterviewStyles()
	// The header color must match the project's primary purple (used by the
	// report wizard's renderShellHeader) so the suite reads as one tool.
	if s.HeaderColor != lipgloss.Color("212") {
		t.Errorf("interview header color must match project palette purple (212), got %v", s.HeaderColor)
	}
	if s.DimColor != lipgloss.Color("241") && s.DimColor != lipgloss.Color("245") {
		t.Errorf("interview dim color should match the report wizard's dim shade, got %v", s.DimColor)
	}
}

func TestInterviewStyles_AdvisoryBannerStyleConfigured(t *testing.T) {
	s := newInterviewStyles()
	style := s.AdvisoryBanner()
	if !style.GetBold() {
		t.Errorf("AdvisoryBanner should be bold")
	}
	if style.GetForeground() != s.WarningColor {
		t.Errorf("AdvisoryBanner foreground should be the warning color, got %v", style.GetForeground())
	}
}

func TestInterviewStyles_HeaderForInterviewSection(t *testing.T) {
	s := newInterviewStyles()
	header := s.RenderHeader("bootstrap", 60)
	if !strings.Contains(header, "bootstrap") {
		t.Errorf("header should embed the section name, got %q", header)
	}
	if !strings.Contains(header, "TEAM HERO INTERVIEW") {
		t.Errorf("header should embed the suite brand, got %q", header)
	}
}
