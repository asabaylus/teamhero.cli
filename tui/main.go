package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/charmbracelet/huh"
)

// version is injected at build time via -ldflags "-X main.version=X.Y.Z"
var version = "dev"

func printUsage() {
	fmt.Fprintf(os.Stderr, `Usage: teamhero <command> [flags]

Commands:
  report    Generate a developer contribution report (default)
  setup     Configure credentials and preferences
  doctor    Validate installation health

Run 'teamhero <command> --help' for command-specific help.

Global flags:
  --version    Print version and exit
  --help       Show this help
`)
}

func printReportUsage() {
	fmt.Fprintf(os.Stderr, `Usage: teamhero report [flags]

Generate a developer contribution report.

Saved configuration:
  Previous interactive runs save settings to ~/.config/teamhero/config.json
  (or $XDG_CONFIG_HOME/teamhero/config.json). Headless mode loads this
  automatically, so --org and other flags can be omitted if a config exists.
  Use --show-config to inspect the saved configuration.

Flags:
  --headless              Run non-interactively (auto-detected in CI or piped) (default: false)
  --show-config           Print saved configuration as JSON and exit
  --org <name>            GitHub organization (uses saved config if omitted)
  --repos <list>          Comma-separated repository names (omit for all)
  --team <list>           Comma-separated contributor identifiers
  --members <list>        Comma-separated member logins
  --sources <list>        Data sources to fetch: git,asana (omit for all)
  --sections <list>       Report sections to render: loc,individual,visible-wins,discrepancy-log,weekly-wins (omit for all)
                          Note: "loc" (lines of code) is a section — GitHub is fetched automatically when included
  --since <date>          Start date, YYYY-MM-DD (default: 7 days ago)
  --until <date>          End date, YYYY-MM-DD (default: today)
  --output <path>         Output file path (default: timestamped in cwd)
  --output-format <fmt>   Output format: markdown (default), json, both
  --max-commit-pages N    Maximum pages of commits to fetch (0 = no limit)
  --max-pr-pages N        Maximum pages of PRs to fetch (0 = no limit)
  --include-bots          Include bot accounts (default: false)
  --exclude-private       Exclude private repositories (default: false)
  --include-archived      Include archived repositories (default: false)
  --detailed              Include detailed PR/commit listings (default: false)
  --no-confirm            Skip confirmation prompt before running (default: false)
  --advanced              Use full configuration wizard (skip express mode) (default: false)
  --sequential            Run API requests sequentially instead of in parallel (default: false)
  --discrepancy-threshold N  Discrepancy report threshold: only items with confidence >= N appear (default: 30)
  --flush-cache <spec>    Flush cached data before run: 'all' or comma-separated sources
  --foreground            Run subprocess with direct I/O, bypass event piping (default: false)

Examples:
  teamhero report                              Interactive TUI wizard
  teamhero report --show-config                Inspect saved configuration
  teamhero report --headless                   Reuse saved config from last run
  teamhero report --headless --since 2026-02-20
                                               Saved config with date override
  teamhero report --headless --org my-org      Explicit org, all defaults
  teamhero report --headless --org my-org \
    --sections loc --since 2026-02-22           LOC-only report (GitHub fetched automatically)
  teamhero report --headless --org my-org \
    --sources git,asana --sections individual   Narrowed scope
  teamhero report --headless --org my-org \
    --output /tmp/report.md --since 2026-02-14  Custom path and date range
  teamhero report --headless --org my-org \
    --output-format json                        Structured JSON (skip AI summary)
  teamhero report --headless --org my-org \
    --output-format both                        Markdown + JSON files

Exit codes:
  0  Success
  1  Configuration error
  2  Source/API error
`)
}

func printDoctorUsage() {
	fmt.Fprintf(os.Stderr, `Usage: teamhero doctor [flags]

Validate installation health. Checks credentials, config files,
permissions, API connectivity, and directory access.

Flags:
  --format json    Output structured JSON instead of human-readable text

Examples:
  teamhero doctor                Styled checklist
  teamhero doctor --format json  Machine-readable JSON
`)
}

func printSetupUsage() {
	fmt.Fprintf(os.Stderr, `Usage: teamhero setup

Configure credentials and preferences interactively. Analyzes existing
configuration and offers to fill gaps or start fresh.

Credentials are stored at ~/.config/teamhero/.env

Headless mode:
  Reads credentials from environment variables when running non-interactively:
    GITHUB_PERSONAL_ACCESS_TOKEN, OPENAI_API_KEY, ASANA_API_TOKEN

  Environment variable TEAMHERO_SEQUENTIAL=true disables parallel API execution.

Examples:
  teamhero setup                                       Interactive wizard
  GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx teamhero setup  Headless credential setup
`)
}

func main() {
	// Detect subcommand first so --help can be routed to the right usage.
	subcommand := ""
	for _, arg := range os.Args[1:] {
		if arg == "report" || arg == "doctor" || arg == "setup" {
			subcommand = arg
			break
		}
		// Stop scanning at first flag-like argument
		if strings.HasPrefix(arg, "-") {
			break
		}
	}

	wantsHelp := containsArg(os.Args, "--help") || containsArg(os.Args, "-help") || containsArg(os.Args, "-h")

	if wantsHelp {
		switch subcommand {
		case "doctor":
			printDoctorUsage()
		case "setup":
			printSetupUsage()
		case "report":
			printReportUsage()
		default:
			printUsage()
		}
		os.Exit(0)
	}

	flag.Usage = printUsage
	flag.Parse()

	// Handle subcommands
	args := flag.Args()
	if len(args) > 0 {
		switch args[0] {
		case "setup":
			if err := runSetup(); err != nil {
				if err == huh.ErrUserAborted {
					fmt.Fprintln(os.Stderr, "\nSetup cancelled.")
					os.Exit(0)
				}
				RenderError(err.Error())
				os.Exit(1)
			}
			return
		case "doctor":
			exitCode := runDoctor()
			os.Exit(exitCode)
			return
		}
	}

	// Check for --version flag
	if flagWasSet("version") || containsArg(os.Args, "--version") || containsArg(os.Args, "-version") {
		fmt.Println(version)
		os.Exit(0)
	}

	// Check for --show-config flag
	if *flagShowConfig || containsArg(os.Args, "--show-config") {
		cfg, err := LoadSavedConfig()
		if err != nil || cfg == nil {
			fmt.Fprintln(os.Stderr, "No saved configuration found at "+configFilePath())
			os.Exit(1)
		}
		data, _ := json.MarshalIndent(cfg, "", "  ")
		fmt.Println(string(data))
		os.Exit(0)
	}

	if isHeadless() {
		runHeadless()
		return
	}

	if err := runInteractive(); err != nil {
		if err == huh.ErrUserAborted {
			fmt.Fprintln(os.Stderr, "\nOperation cancelled.")
			os.Exit(0)
		}
		RenderError(err.Error())
		os.Exit(1)
	}
}

func containsArg(args []string, target string) bool {
	for _, a := range args {
		if a == target {
			return true
		}
	}
	return false
}

func isHeadless() bool {
	if *flagHeadless {
		return true
	}
	if env := os.Getenv("TEAMHERO_HEADLESS"); env != "" {
		lower := strings.ToLower(env)
		if lower == "1" || lower == "true" || lower == "yes" || lower == "on" {
			return true
		}
	}
	if os.Getenv("CI") != "" {
		return true
	}
	// Check if stdin/stdout are TTYs
	stdinInfo, _ := os.Stdin.Stat()
	stdoutInfo, _ := os.Stdout.Stat()
	if (stdinInfo.Mode()&os.ModeCharDevice) == 0 || (stdoutInfo.Mode()&os.ModeCharDevice) == 0 {
		return true
	}
	return false
}

func runHeadless() {
	// Start from saved config, then overlay CLI flags.
	// applyEnvTuningOverrides re-applies .env tuning values (threshold, sequential)
	// after saved config, since config.json may contain stale zero-values.
	cfg := DefaultConfig()
	if prev, err := LoadSavedConfig(); err == nil && prev != nil {
		cfg = *prev
		applyEnvTuningOverrides(&cfg)
	}
	applyFlags(&cfg)
	ensureDateDefaults(&cfg)

	if !hasMinimalHeadlessConfig(&cfg) {
		fmt.Fprintln(os.Stderr, "No saved configuration found and --org not provided. Run interactively first or pass --org.")
		os.Exit(1)
	}

	// Auto-disable Asana when no token is available to prevent runtime errors
	if cfg.Sections.DataSources.Asana && !hasAsanaToken() {
		cfg.Sections.DataSources.Asana = false
		fmt.Fprintln(os.Stderr, "Note: Asana data source disabled (no ASANA_API_TOKEN found).")
	}

	input := cfg.ToCommandInput("headless")
	inputJSON, _ := json.MarshalIndent(input, "", "  ")
	fmt.Fprintf(os.Stderr, "Running in headless mode with configuration:\n%s\n\n", inputJSON)

	// Foreground mode: connect subprocess I/O directly, bypass event piping.
	// Avoids pipe-related hangs in non-TTY / background agent environments.
	if *flagForeground {
		if err := RunServiceForeground(input); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(2)
		}
		return
	}

	eventCh, errCh, stderrBuf := RunServiceRunner(input)

	// In headless mode, just print events as they arrive
	var outputPath string
	var jsonOutputPath string
	var discrepancyData *DiscrepancyEvent
	var reportDataJSON []byte
	for evt := range eventCh {
		switch evt.Type {
		case "progress":
			symbol := "…"
			if evt.Status == "done" {
				symbol = "✔"
			} else if evt.Status == "error" {
				symbol = "✖"
			}
			msg := evt.Step
			if evt.Message != "" {
				msg = evt.Message
			}
			fmt.Fprintf(os.Stderr, "%s %s\n", symbol, msg)
		case "result":
			outputPath = evt.OutputPath
			if evt.JsonOutputPath != "" {
				jsonOutputPath = evt.JsonOutputPath
			}
			fmt.Fprintf(os.Stderr, "\nReport generated: %s\n", evt.OutputPath)
			if jsonOutputPath != "" && jsonOutputPath != outputPath {
				fmt.Fprintf(os.Stderr, "JSON data: %s\n", jsonOutputPath)
			}
		case "report-data":
			reportDataJSON = evt.Data
		case "discrepancy":
			discrepancyData = &DiscrepancyEvent{
				Type:          evt.Type,
				TotalCount:    evt.TotalCount,
				ByContributor: evt.ByContributor,
				Unattributed:  evt.Unattributed,
				Items:         evt.Items,
				AllItems:      evt.AllItems,
				DiscrepancyThreshold: evt.DiscrepancyThreshold,
			}
			if discrepancyData.TotalCount > 0 {
				fmt.Fprintf(os.Stderr, "Detected %d cross-source discrepancies.\n", discrepancyData.TotalCount)
				// Emit full discrepancy data on stdout for machine consumption.
				discrepancyJSON, _ := json.Marshal(discrepancyData)
				fmt.Println(string(discrepancyJSON))
			}
		case "error":
			fmt.Fprintf(os.Stderr, "Error: %s\n", evt.Message)
			os.Exit(2) // Exit code 2: source error
		}
	}
	_ = discrepancyData // headless mode only logs count
	_ = reportDataJSON  // available for future use (e.g. MCP)

	if err := <-errCh; err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(2)
	}

	// Print captured subprocess stderr after event loop completes
	if captured := stderrBuf.String(); captured != "" {
		fmt.Fprintln(os.Stderr)
		fmt.Fprint(os.Stderr, captured)
	}

	// Emit output path on stdout for machine consumption
	if outputPath != "" {
		fmt.Println(outputPath)
	}
	if jsonOutputPath != "" && jsonOutputPath != outputPath {
		fmt.Println(jsonOutputPath)
	}
}

func runInteractive() error {
	prev, _ := LoadSavedConfig()

	// Determine wizard mode: express for first-timers, full otherwise
	mode := wizardModeFull
	if prev == nil && !flagWasSet("org") && !*flagAdvanced {
		mode = wizardModeExpress
		// No credentials? Offer inline setup
		if !HasCredentials() {
			if err := runExpressSetupPrompt(); err != nil {
				return err
			}
		}
	}

	defaults := DefaultConfig()
	if mode == wizardModeExpress {
		defaults = ExpressConfig()
	}
	if prev != nil {
		defaults = *prev
		applyEnvTuningOverrides(&defaults)
	}
	applyFlags(&defaults)
	ensureDateDefaults(&defaults)
	populateAIFields(&defaults)

	// Run the wizard (side-by-side form + config summary)
	result, err := RunWizard(prev, defaults, mode)
	if err != nil {
		return err
	}

	if result.Aborted {
		return huh.ErrUserAborted
	}
	if !result.Confirmed {
		fmt.Fprintln(os.Stderr, "Report cancelled.")
		return nil
	}

	cfg := result.Config

	// Save config for next time
	if err := SaveConfig(cfg); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: could not save config: %v\n", err)
	}

	// Calculate expected steps from config (mirrors report.service.ts logic)
	expectedSteps := 7 // core: org + repos/skip + members + metrics/skip + asana/skip + final + write
	if cfg.Sections.ReportSections.Loc {
		expectedSteps++
	}
	if cfg.Sections.ReportSections.VisibleWins {
		expectedSteps++
	}
	if cfg.Sections.ReportSections.IndividualContributions {
		expectedSteps += 2
	}

	// Populate AI display fields for the progress panel
	populateAIFields(cfg)

	// Run the report
	input := cfg.ToCommandInput("interactive")
	eventCh, errCh, stderrBuf := RunServiceRunner(input)

	// Display progress using Bubble Tea (capture discrepancy data for tabbed preview)
	progressResult := RunProgressDisplayFull("Report Progress", expectedSteps, cfg, eventCh)
	resultPath := progressResult.ResultPath
	errMsg := progressResult.ErrorMsg

	// Check for subprocess errors
	if subErr := <-errCh; subErr != nil && errMsg == "" {
		errMsg = subErr.Error()
	}

	// Print captured subprocess stderr (warnings, logs) after progress completes
	if captured := stderrBuf.String(); captured != "" {
		fmt.Fprintln(os.Stderr)
		fmt.Fprint(os.Stderr, captured)
	}

	if errMsg != "" {
		RenderError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	if resultPath != "" {
		if err := RunReportPreviewFull(resultPath, progressResult.Discrepancy, progressResult.JsonData); err != nil {
			// Fallback to plain success box if preview UI fails.
			fmt.Fprintln(os.Stderr)
			RenderSuccessBox("Report Ready", resultPath)
			fmt.Fprintf(os.Stderr, "Warning: could not start markdown preview: %v\n", err)
		}
	}

	return nil
}

// firstNonEmpty returns the first non-empty string from the arguments.
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// populateAIFields fills the display-only AI fields on cfg from .env and environment variables.
func populateAIFields(cfg *ReportConfig) {
	cfg.AIProvider = "OpenAI"
	creds := loadExistingCredentials(filepath.Join(configDir(), ".env"))
	cfg.AIModel = firstNonEmpty(os.Getenv("AI_MODEL"), creds["AI_MODEL"], "gpt-5-mini")
	cfg.ServiceTier = firstNonEmpty(os.Getenv("OPENAI_SERVICE_TIER"), creds["OPENAI_SERVICE_TIER"])
}
