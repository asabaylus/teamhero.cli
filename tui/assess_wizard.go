package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/charmbracelet/huh"
)

// runAssessInteractive walks the user through scope selection, then runs the
// service runner under a Bubble Tea progress display that mirrors the report
// flow's two-pane layout. After the audit is written, a tabbed preview
// (Audit / Evidence / JSON Data) opens — same shape as RunReportPreviewFull.
func runAssessInteractive(cfg *AssessConfig) error {
	if err := assessScopeWizard(cfg); err != nil {
		return err
	}

	cfg.Mode = "interactive"
	cfg.InteractiveInterview = true

	res, err := RunAssessServiceRunner(*cfg)
	if err != nil {
		return err
	}
	defer res.Close()

	result := RunAssessProgressDisplay("Agent Maturity Assessment", cfg, res, promptInterviewQuestion)

	// Drain any errors emitted by the runner goroutine.
	for err := range res.Errors {
		if err != nil {
			if res.Stderr != nil && res.Stderr.Len() > 0 {
				fmt.Fprintln(os.Stderr, res.Stderr.String())
			}
			return err
		}
	}

	if result.Cancelled {
		fmt.Fprintln(os.Stderr, "\nAssessment cancelled.")
		return nil
	}
	if result.ErrorMsg != "" {
		RenderError(result.ErrorMsg)
		return fmt.Errorf("assess: %s", result.ErrorMsg)
	}

	if err := SaveAssessConfig(cfg); err != nil {
		fmt.Fprintf(os.Stderr, "Note: failed to save assess config: %v\n", err)
	}

	if result.ResultPath == "" {
		return nil
	}

	// Show the tabbed preview using the same Glamour rendering pipeline the
	// report flow uses. Errors from the preview are non-fatal — the audit
	// files are already on disk.
	if err := RunAssessPreview(result.ResultPath, result.JsonPath, result.JsonData); err != nil {
		fmt.Fprintf(os.Stderr, "Note: preview unavailable (%v). Audit at: %s\n", err, result.ResultPath)
	}
	return nil
}

// assessScopeWizard collects the minimum config the service runner needs.
func assessScopeWizard(cfg *AssessConfig) error {
	cwd, _ := os.Getwd()

	scopeMode := cfg.Scope.Mode
	if scopeMode == "" {
		scopeMode = "local-repo"
	}

	scopeForm := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("What's the scope of this audit?").
				Description("Choose what you're assessing.").
				Options(
					huh.NewOption("This local repo", "local-repo"),
					huh.NewOption("A GitHub organization", "org"),
					huh.NewOption("Both (org + a local checkout)", "both"),
				).
				Value(&scopeMode),
		),
	)
	if err := scopeForm.Run(); err != nil {
		return err
	}
	cfg.Scope.Mode = scopeMode

	switch scopeMode {
	case "local-repo":
		path := cfg.Scope.LocalPath
		if path == "" {
			path = cwd
		}
		pathForm := huh.NewForm(
			huh.NewGroup(
				huh.NewInput().
					Title("Local repo path").
					Description("Path to the repo you want to audit.").
					Value(&path).
					Validate(validateLocalPath),
			),
		)
		if err := pathForm.Run(); err != nil {
			return err
		}
		cfg.Scope.LocalPath = strings.TrimSpace(path)
		cfg.Scope.Org = ""
		cfg.Scope.Repos = nil
		if cfg.Scope.DisplayName == "" {
			cfg.Scope.DisplayName = filepath.Base(cfg.Scope.LocalPath)
		}
	case "org":
		org := cfg.Scope.Org
		orgForm := huh.NewForm(
			huh.NewGroup(
				huh.NewInput().
					Title("GitHub organization").
					Description("e.g. acme-co (no slashes).").
					Value(&org).
					Validate(func(s string) error {
						if strings.TrimSpace(s) == "" {
							return fmt.Errorf("org name is required")
						}
						return nil
					}),
			),
		)
		if err := orgForm.Run(); err != nil {
			return err
		}
		cfg.Scope.Org = strings.TrimSpace(org)
		cfg.Scope.LocalPath = ""
		if cfg.Scope.DisplayName == "" {
			cfg.Scope.DisplayName = cfg.Scope.Org
		}
	case "both":
		path := cfg.Scope.LocalPath
		if path == "" {
			path = cwd
		}
		org := cfg.Scope.Org
		bothForm := huh.NewForm(
			huh.NewGroup(
				huh.NewInput().
					Title("GitHub organization").
					Value(&org).
					Validate(func(s string) error {
						if strings.TrimSpace(s) == "" {
							return fmt.Errorf("org name is required")
						}
						return nil
					}),
				huh.NewInput().
					Title("Local repo path").
					Value(&path).
					Validate(validateLocalPath),
			),
		)
		if err := bothForm.Run(); err != nil {
			return err
		}
		cfg.Scope.Org = strings.TrimSpace(org)
		cfg.Scope.LocalPath = strings.TrimSpace(path)
		if cfg.Scope.DisplayName == "" {
			cfg.Scope.DisplayName = cfg.Scope.Org
		}
	}

	if cfg.OutputFormat == "" {
		cfg.OutputFormat = "both"
	}
	if cfg.EvidenceTier == "" {
		cfg.EvidenceTier = "auto"
	}
	return nil
}

func validateLocalPath(s string) error {
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return fmt.Errorf("path is required")
	}
	info, err := os.Stat(trimmed)
	if err != nil {
		return fmt.Errorf("path does not exist: %s", trimmed)
	}
	if !info.IsDir() {
		return fmt.Errorf("path is not a directory: %s", trimmed)
	}
	return nil
}

// promptInterviewQuestion shows a single Phase-1 question via huh and returns
// the captured answer. Choosing "Other" pops a free-text follow-up.
func promptInterviewQuestion(evt GenericEvent) (string, bool, error) {
	const freeTextSentinel = "__free_text__"
	options := evt.Options
	if len(options) == 0 {
		options = []string{"I don't know"}
	}
	choice := ""

	huhOptions := make([]huh.Option[string], 0, len(options)+1)
	for _, opt := range options {
		huhOptions = append(huhOptions, huh.NewOption(opt, opt))
	}
	if evt.AllowFreeText {
		huhOptions = append(huhOptions, huh.NewOption("Other (type your own)", freeTextSentinel))
	}

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title(evt.QuestionText).
				Description(fmt.Sprintf("[%s]", evt.QuestionID)).
				Options(huhOptions...).
				Value(&choice),
		),
	)
	if err := form.Run(); err != nil {
		return "unknown", false, err
	}

	if choice == freeTextSentinel {
		freeText := ""
		ftForm := huh.NewForm(
			huh.NewGroup(
				huh.NewText().
					Title("Your answer").
					Description("Free text — leave blank for 'unknown'.").
					Value(&freeText),
			),
		)
		if err := ftForm.Run(); err != nil {
			return "unknown", false, err
		}
		freeText = strings.TrimSpace(freeText)
		if freeText == "" {
			return "unknown", false, nil
		}
		return freeText, false, nil
	}

	return choice, true, nil
}
