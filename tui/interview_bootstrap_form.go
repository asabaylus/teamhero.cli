package main

import (
	"errors"
	"fmt"
	"strings"

	"github.com/charmbracelet/huh"
)

// runHuhBootstrapWizard renders the sequence of huh.Forms that populate a
// bootstrapWizardModel. Each screen uses huhFormRun so tests can stub the
// driver. On huh.ErrUserAborted at any screen, the wizard returns
// Aborted=true with no options.
func runHuhBootstrapWizard(d BootstrapWizardDefaults) (*BootstrapWizardResult, error) {
	m := newBootstrapWizardModel(d)

	steps := []func(*bootstrapWizardModel) error{
		stepRole,
		stepRoleTitle,
		stepStack,
		stepDomain,
		stepFeature,
		stepTimeBox,
		stepProjectMode,
		stepAnalysisMode,
		stepRubricMode,
		stepConditionalRubric,
		stepOutputDir,
		stepConfirm,
	}

	for _, step := range steps {
		if err := step(&m); err != nil {
			if errors.Is(err, huh.ErrUserAborted) {
				return &BootstrapWizardResult{Aborted: true}, nil
			}
			return nil, err
		}
		if m.aborted {
			return &BootstrapWizardResult{Aborted: true}, nil
		}
	}

	res := &BootstrapWizardResult{
		Options:   bootstrapWizardOptionsFromModel(m),
		Confirmed: m.confirmed,
	}
	return res, nil
}

func stepRole(m *bootstrapWizardModel) error {
	form := huh.NewForm(huh.NewGroup(
		huh.NewInput().
			Title("Role slug (URL-safe identifier)").
			Description("Lowercase, hyphenated — e.g. 'senior-backend' or 'staff-frontend'").
			Value(&m.role).
			Validate(validateRoleSlug),
	)).WithTheme(huh.ThemeCharm())
	return huhFormRun(form)
}

func stepRoleTitle(m *bootstrapWizardModel) error {
	form := huh.NewForm(huh.NewGroup(
		huh.NewInput().
			Title("Role title (human-readable, optional)").
			Description("e.g. 'Senior Backend Engineer'").
			Value(&m.roleTitle),
	)).WithTheme(huh.ThemeCharm())
	return huhFormRun(form)
}

func stepStack(m *bootstrapWizardModel) error {
	form := huh.NewForm(huh.NewGroup(
		huh.NewInput().
			Title("Primary tech stack").
			Description("e.g. 'TypeScript', 'Go', 'Python'").
			Value(&m.stack).
			Validate(nonEmpty("stack")),
	)).WithTheme(huh.ThemeCharm())
	return huhFormRun(form)
}

func stepDomain(m *bootstrapWizardModel) error {
	form := huh.NewForm(huh.NewGroup(
		huh.NewInput().
			Title("Business domain").
			Description("e.g. 'Payments', 'Storefront', 'Identity'").
			Value(&m.domain).
			Validate(nonEmpty("domain")),
	)).WithTheme(huh.ThemeCharm())
	return huhFormRun(form)
}

func stepFeature(m *bootstrapWizardModel) error {
	form := huh.NewForm(huh.NewGroup(
		huh.NewText().
			Title("Feature description").
			Description("A short paragraph describing what the candidate will build").
			Value(&m.feature).
			Validate(nonEmpty("feature")),
	)).WithTheme(huh.ThemeCharm())
	return huhFormRun(form)
}

func stepTimeBox(m *bootstrapWizardModel) error {
	choice := m.timeBox
	form := huh.NewForm(huh.NewGroup(
		huh.NewSelect[string]().
			Title("Time-box (minutes)").
			Options(
				huh.NewOption("60 minutes", "60"),
				huh.NewOption("90 minutes (recommended)", "90"),
				huh.NewOption("120 minutes", "120"),
				huh.NewOption("Custom", "custom"),
			).
			Value(&choice),
	)).WithTheme(huh.ThemeCharm())
	if err := huhFormRun(form); err != nil {
		return err
	}
	if choice == "custom" {
		custom := m.timeBox
		customForm := huh.NewForm(huh.NewGroup(
			huh.NewInput().
				Title("Custom time-box (30-240 minutes)").
				Value(&custom).
				Validate(validateTimeBox),
		)).WithTheme(huh.ThemeCharm())
		if err := huhFormRun(customForm); err != nil {
			return err
		}
		m.timeBox = custom
	} else {
		m.timeBox = choice
	}
	return nil
}

func stepProjectMode(m *bootstrapWizardModel) error {
	form := huh.NewForm(huh.NewGroup(
		huh.NewSelect[string]().
			Title("Project mode").
			Description("A: generate a starter project for the candidate. B: candidate brings their own.").
			Options(
				huh.NewOption("A — generate starter project", "A"),
				huh.NewOption("B — candidate brings their own", "B"),
			).
			Value(&m.modeProject),
	)).WithTheme(huh.ThemeCharm())
	return huhFormRun(form)
}

func stepAnalysisMode(m *bootstrapWizardModel) error {
	form := huh.NewForm(huh.NewGroup(
		huh.NewSelect[string]().
			Title("Analysis mode").
			Description("ai-assisted: AI generates observations for the manager to review. human-only: manager writes everything.").
			Options(
				huh.NewOption("AI-assisted (recommended)", "ai-assisted"),
				huh.NewOption("Human-only", "human-only"),
			).
			Value(&m.modeAnalysis),
	)).WithTheme(huh.ThemeCharm())
	return huhFormRun(form)
}

func stepRubricMode(m *bootstrapWizardModel) error {
	form := huh.NewForm(huh.NewGroup(
		huh.NewSelect[string]().
			Title("Rubric mode").
			Description("default: 9 built-in dimensions. custom: write your own prompt. default+jd: 9 dims plus your JD as additional context.").
			Options(
				huh.NewOption("Default (recommended)", "default"),
				huh.NewOption("Custom prompt", "custom"),
				huh.NewOption("Default + Job Description", "default+jd"),
			).
			Value(&m.modeRubric),
	)).WithTheme(huh.ThemeCharm())
	return huhFormRun(form)
}

// stepConditionalRubric reads the rubric-mode and routes to the appropriate
// follow-up screen, or skips both for "default".
func stepConditionalRubric(m *bootstrapWizardModel) error {
	switch m.modeRubric {
	case "custom":
		return stepCustomPrompt(m)
	case "default+jd":
		return stepJDPath(m)
	}
	return nil
}

func stepCustomPrompt(m *bootstrapWizardModel) error {
	form := huh.NewForm(huh.NewGroup(
		huh.NewText().
			Title("Custom rubric prompt").
			Description("Describe the dimensions you want to assess").
			Value(&m.customPrompt).
			Validate(nonEmpty("custom prompt")),
	)).WithTheme(huh.ThemeCharm())
	return huhFormRun(form)
}

func stepJDPath(m *bootstrapWizardModel) error {
	form := huh.NewForm(huh.NewGroup(
		huh.NewInput().
			Title("Path to job description file").
			Description("Absolute or relative path to a .md or .txt file").
			Value(&m.jdPath).
			Validate(func(s string) error {
				if err := validateJDPath(s); err != nil {
					return err
				}
				if s == "" {
					return fmt.Errorf("JD path is required for 'default+jd' rubric mode")
				}
				return nil
			}),
	)).WithTheme(huh.ThemeCharm())
	return huhFormRun(form)
}

func stepOutputDir(m *bootstrapWizardModel) error {
	if m.outputDir == "./roles/role" && m.role != "" {
		m.outputDir = "./roles/" + m.role
	}
	form := huh.NewForm(huh.NewGroup(
		huh.NewInput().
			Title("Output directory").
			Description("Where the role config and starter project will be written").
			Value(&m.outputDir).
			Validate(nonEmpty("output directory")),
	)).WithTheme(huh.ThemeCharm())
	return huhFormRun(form)
}

func stepConfirm(m *bootstrapWizardModel) error {
	form := huh.NewForm(huh.NewGroup(
		huh.NewConfirm().
			Title("Ready to bootstrap?").
			Description(summarizeBootstrapModel(*m)).
			Affirmative("Yes, generate the role").
			Negative("Cancel").
			Value(&m.confirmed),
	)).WithTheme(huh.ThemeCharm())
	return huhFormRun(form)
}

func summarizeBootstrapModel(m bootstrapWizardModel) string {
	rub := m.modeRubric
	if m.modeRubric == "default+jd" && m.jdPath != "" {
		rub = "default+jd (" + m.jdPath + ")"
	}
	return fmt.Sprintf(
		"role=%s · stack=%s · domain=%s · time-box=%s · project=%s · analysis=%s · rubric=%s · out=%s",
		m.role, m.stack, m.domain, m.timeBox, m.modeProject, m.modeAnalysis, rub, m.outputDir,
	)
}

func nonEmpty(field string) func(string) error {
	return func(s string) error {
		if strings.TrimSpace(s) == "" {
			return fmt.Errorf("%s is required", field)
		}
		return nil
	}
}
