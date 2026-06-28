package main

import (
	"testing"
)

func TestValidateDate_Valid(t *testing.T) {
	validDates := []string{
		"2026-01-01",
		"2025-12-31",
		"2026-02-28",
		"2024-02-29", // leap year
	}
	for _, d := range validDates {
		if err := validateDate(d); err != nil {
			t.Errorf("validateDate(%q) = %v, want nil", d, err)
		}
	}
}

func TestValidateDate_Invalid(t *testing.T) {
	invalidDates := []string{
		"01-01-2026",     // wrong format
		"2026/01/01",     // wrong separator
		"2026-13-01",     // invalid month
		"2026-01-32",     // invalid day
		"not-a-date",     // not a date at all
		"2025-02-29",     // not a leap year
	}
	for _, d := range invalidDates {
		if err := validateDate(d); err == nil {
			t.Errorf("validateDate(%q) = nil, want error", d)
		}
	}
}

func TestValidateDate_Empty(t *testing.T) {
	if err := validateDate(""); err == nil {
		t.Error("validateDate('') should return error")
	}
}

func TestValidateDate_Whitespace(t *testing.T) {
	if err := validateDate("   "); err == nil {
		t.Error("validateDate('   ') should return error for whitespace-only")
	}
}

func TestValidateDate_WithSurroundingSpaces(t *testing.T) {
	// validateDate trims spaces, so this should be valid
	if err := validateDate("  2026-03-01  "); err != nil {
		t.Errorf("validateDate('  2026-03-01  ') = %v, want nil (should trim)", err)
	}
}

func TestSplitCSV_BasicSplit(t *testing.T) {
	got := splitCSV("a,b,c")
	want := []string{"a", "b", "c"}
	if len(got) != len(want) {
		t.Fatalf("splitCSV(a,b,c) len = %d, want %d", len(got), len(want))
	}
	for i, v := range got {
		if v != want[i] {
			t.Errorf("splitCSV(a,b,c)[%d] = %q, want %q", i, v, want[i])
		}
	}
}

func TestSplitCSV_WithSpaces(t *testing.T) {
	got := splitCSV("  a , b , c  ")
	want := []string{"a", "b", "c"}
	if len(got) != len(want) {
		t.Fatalf("splitCSV with spaces len = %d, want %d", len(got), len(want))
	}
	for i, v := range got {
		if v != want[i] {
			t.Errorf("splitCSV with spaces [%d] = %q, want %q", i, v, want[i])
		}
	}
}

func TestSplitCSV_EmptyString(t *testing.T) {
	got := splitCSV("")
	if len(got) != 0 {
		t.Errorf("splitCSV('') = %v, want empty slice", got)
	}
}

func TestSplitCSV_SingleItem(t *testing.T) {
	got := splitCSV("only")
	if len(got) != 1 || got[0] != "only" {
		t.Errorf("splitCSV(only) = %v, want [only]", got)
	}
}

func TestSplitCSV_EmptyParts(t *testing.T) {
	got := splitCSV("a,,b,,,c")
	want := []string{"a", "b", "c"}
	if len(got) != len(want) {
		t.Fatalf("splitCSV(a,,b,,,c) len = %d, want %d", len(got), len(want))
	}
	for i, v := range got {
		if v != want[i] {
			t.Errorf("splitCSV(a,,b,,,c)[%d] = %q, want %q", i, v, want[i])
		}
	}
}

func TestSplitCSV_OnlyCommas(t *testing.T) {
	got := splitCSV(",,,")
	if len(got) != 0 {
		t.Errorf("splitCSV(',,,') = %v, want empty slice", got)
	}
}

func TestSplitCSV_TrailingComma(t *testing.T) {
	got := splitCSV("a,b,")
	want := []string{"a", "b"}
	if len(got) != len(want) {
		t.Fatalf("splitCSV(a,b,) len = %d, want %d", len(got), len(want))
	}
	for i, v := range got {
		if v != want[i] {
			t.Errorf("splitCSV(a,b,)[%d] = %q, want %q", i, v, want[i])
		}
	}
}

func TestContains_Found(t *testing.T) {
	if !contains([]string{"git", "asana", "loc"}, "asana") {
		t.Error("contains should find 'asana' in slice")
	}
}

func TestContains_NotFound(t *testing.T) {
	if contains([]string{"git", "asana"}, "loc") {
		t.Error("contains should not find 'loc' in [git, asana]")
	}
}

func TestContains_EmptySlice(t *testing.T) {
	if contains([]string{}, "anything") {
		t.Error("contains should return false for empty slice")
	}
}

func TestContains_NilSlice(t *testing.T) {
	if contains(nil, "anything") {
		t.Error("contains should return false for nil slice")
	}
}

func TestContains_CaseSensitive(t *testing.T) {
	if contains([]string{"Git"}, "git") {
		t.Error("contains should be case-sensitive")
	}
}

func TestContains_EmptyItem(t *testing.T) {
	if contains([]string{"a", "b"}, "") {
		t.Error("contains should return false for empty item")
	}
}

func TestContains_EmptyItemInSlice(t *testing.T) {
	if !contains([]string{"a", "", "b"}, "") {
		t.Error("contains should find empty string in slice containing empty string")
	}
}

func TestBoolSelect_ReturnsSelect(t *testing.T) {
	var value bool
	sel := boolSelect("Test?", &value)
	if sel == nil {
		t.Fatal("boolSelect should not return nil")
	}
}
