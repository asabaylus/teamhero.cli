package main

import (
	"fmt"
	"strings"
)

// runHuhBootstrapWizard runs the bootstrap wizard as a single bubbletea
// program (interviewBootstrapTeaModel) so the wizard adopts the same
// shell-header + summary-panel layout as the report wizard. The data
// container (bootstrapWizardModel) and per-screen validators are
// unchanged; only the runner is. This function exists as the launcher
// entry point so callers don't need to know about the tea-program seam.
func runHuhBootstrapWizard(d BootstrapWizardDefaults) (*BootstrapWizardResult, error) {
	return runBootstrapTeaWizard(d)
}

// summarizeBootstrapModel renders a compact one-line summary of the
// wizard's collected values. Used by the confirm-step description and by
// callers that want a short config string.
func summarizeBootstrapModel(m bootstrapWizardModel) string {
	jd := "none"
	if m.jdProvided == "yes" && m.jdPath != "" {
		jd = m.jdPath
		if m.jdInfluencesProject == "yes" {
			jd += " (shapes project)"
		}
	}
	return fmt.Sprintf(
		"role=%s · stack=%s · domain=%s · time-box=%s · project=%s · analysis=%s · rubric=%s · jd=%s · out=%s",
		m.role, m.stack, m.domain, m.timeBox, m.modeProject, m.modeAnalysis, m.modeRubric, jd, m.outputDir,
	)
}

// nonEmpty produces a huh.Input.Validate-compatible function that rejects
// whitespace-only input for the given field name.
func nonEmpty(field string) func(string) error {
	return func(s string) error {
		if strings.TrimSpace(s) == "" {
			return fmt.Errorf("%s is required", field)
		}
		return nil
	}
}
