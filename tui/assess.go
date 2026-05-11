package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/charmbracelet/lipgloss"
)

// printAssessUsage prints the usage and help message for the `teamhero assess` subcommand to stderr.
// 
// The message describes the assessment's purpose and outputs, saved configuration location,
// scope and run flags (including headless and interview options), examples, and exit codes.
func printAssessUsage() {
	fmt.Fprintf(os.Stderr, `Usage: teamhero assess [flags]

Run the Agent Maturity Assessment — a 12-criterion diagnostic that scores an
engineering organization for AI-agentic-coding readiness. Produces a weighted
percentage, a raw /12 score, item-level evidence, top-3 fixes, strengths, and
a maturity band (Excellent / Healthy / Functional but slow / Significant
dysfunction / Triage).

Saved configuration:
  Previous interactive runs save settings to ~/.config/teamhero/assess-config.json
  (or $XDG_CONFIG_HOME/teamhero/assess-config.json). Headless mode loads this
  automatically when present.

Scope flags:
  --scope-mode <mode>      org | local-repo | both
  --target-org <name>      GitHub org name (org or both modes)
  --target-repos <list>    Comma-separated repo names (optional, narrows scope)
  --path <path>            Local repo path (local-repo or both modes)
  --display-name <name>    Override the audit's scope display name

Run flags:
  --headless                  Run non-interactively (auto-detected in CI / piped stdin)
  --evidence-tier <tier>      auto | gh | github-mcp | git-only (default: auto)
  --interview-answers <file>  JSON file with pre-supplied Phase-1 answers
                              Format: {"q1":"...","q2":"...",...}
  --audit-output <path>       Output file path (default: timestamped in cwd)
  --audit-output-format <fmt> markdown | json | both (default: both)
  --dry-run                   Skip the AI scorer and emit a placeholder audit
  --flush-assess-cache        Flush cached assessment(s) before running
  --show-assess-config        Print saved configuration as JSON and exit

Examples:
  teamhero assess                              Interactive wizard + interview
  teamhero assess --headless --path .          Audit the current repo, no interview
  teamhero assess --headless --target-org acme --interview-answers answers.json
                                               Headless org-level audit with pre-supplied answers
  teamhero assess --dry-run --path .           Smoke test without an OpenAI call

Exit codes:
  0  Success
  1  Configuration error
  2  Service / scoring error
`)
}

// runAssess is the entry point for the "assess" subcommand. It dispatches to
// runAssess dispatches the `assess` subcommand behavior.
// If `--show-assess-config` is set, it prints the saved assess configuration (exits with status 1 if none) and returns nil.
// Otherwise it loads or initializes the config, applies flag overrides, and fills defaults.
// In headless mode it verifies that minimal scope is present (exits with status 1 if missing) and runs the headless assessment, returning any error from that run.
// In interactive mode it runs the interactive assessment and returns any error from that run.
func runAssess() error {
	if *flagAssessShowConfig {
		cfg, err := LoadAssessConfig()
		if err != nil || cfg == nil {
			fmt.Fprintln(os.Stderr, "No saved assess configuration found at "+assessConfigPath())
			os.Exit(1)
		}
		data, _ := json.MarshalIndent(cfg, "", "  ")
		fmt.Println(string(data))
		return nil
	}

	cfg := loadOrInitAssessConfig()
	applyAssessFlagsTo(&cfg, flagWasSet)
	fillAssessDefaults(&cfg)

	if isHeadless() {
		if !hasMinimalAssessConfig(&cfg) {
			fmt.Fprintln(os.Stderr, "assess: scope is required (set --path, --target-org, or run interactively)")
			os.Exit(1)
		}
		return runAssessHeadless(cfg)
	}

	return runAssessInteractive(&cfg)
}

// loadOrInitAssessConfig returns a previously saved AssessConfig if one exists.
// If no saved config is available or loading it fails, it returns the DefaultAssessConfig().
func loadOrInitAssessConfig() AssessConfig {
	saved, _ := LoadAssessConfig()
	if saved != nil {
		return *saved
	}
	return DefaultAssessConfig()
}

// runAssessHeadless drives the assess service runner without any TTY UI.
// command to fail.
func runAssessHeadless(cfg AssessConfig) error {
	cfg.Mode = "headless"
	cfg.InteractiveInterview = false

	res, err := RunAssessServiceRunner(cfg)
	if err != nil {
		return err
	}
	defer res.Close()

	for evt := range res.Events {
		switch evt.Type {
		case "progress":
			fmt.Fprintf(os.Stderr, "[%s] %s\n", evt.Step, evt.Message)
		case "interview-frame":
			fmt.Fprintln(os.Stderr, evt.Message)
		case "interview-question":
			fmt.Fprintf(
				os.Stderr,
				"⚠ assess: interview question %q received in headless mode — answer with --interview-answers or run interactively\n",
				evt.QuestionID,
			)
			// Headless mode never sends an answer; the service times out the
			// stream and falls back to "unknown" for the question.
		case "result":
			styled := lipgloss.NewStyle().Bold(true)
			fmt.Println(styled.Render("Audit complete:"))
			fmt.Println("  " + evt.OutputPath)
			if evt.JsonOutputPath != "" {
				fmt.Println("  " + evt.JsonOutputPath)
			}
		case "error":
			fmt.Fprintf(os.Stderr, "✖ %s\n", evt.Message)
			return fmt.Errorf("assess: %s", evt.Message)
		}
	}

	for err := range res.Errors {
		if err != nil {
			if res.Stderr != nil && res.Stderr.Len() > 0 {
				fmt.Fprintln(os.Stderr, res.Stderr.String())
			}
			return err
		}
	}

	if err := SaveAssessConfig(&cfg); err != nil {
		fmt.Fprintf(os.Stderr, "Note: failed to save assess config: %v\n", err)
	}
	return nil
}
