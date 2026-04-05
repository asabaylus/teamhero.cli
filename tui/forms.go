package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/huh"
)

// boolSelect creates a Yes/No radio-button-style select for boolean values.
func boolSelect(title string, value *bool) *huh.Select[bool] {
	return huh.NewSelect[bool]().
		Title(title).
		Options(
			huh.NewOption("Yes", true),
			huh.NewOption("No", false),
		).
		Value(value)
}

func validateDate(s string) error {
	s = strings.TrimSpace(s)
	if s == "" {
		return fmt.Errorf("date is required")
	}
	if _, err := time.Parse("2006-01-02", s); err != nil {
		return fmt.Errorf("enter a valid date in YYYY-MM-DD format")
	}
	return nil
}

func splitCSV(s string) []string {
	var result []string
	for _, part := range strings.Split(s, ",") {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}
