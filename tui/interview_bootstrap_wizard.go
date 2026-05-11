package main

import (
	"fmt"
	"io"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// ---------------------------------------------------------------------------
// Wizard state machine — testable without rendering the TTY.
// ---------------------------------------------------------------------------

type bootstrapWizardState int

const (
	wsBootstrapRole bootstrapWizardState = iota
	wsBootstrapRoleTitle
	wsBootstrapStack
	wsBootstrapDomain
	wsBootstrapFeature
	wsBootstrapTimeBox
	wsBootstrapProjectMode
	wsBootstrapAnalysisMode
	wsBootstrapRubricMode
	wsBootstrapCustomPrompt
	wsBootstrapJDPath
	wsBootstrapOutputDir
	wsBootstrapConfirm
	wsBootstrapDone
)

// BootstrapWizardDefaults seeds the wizard model. Empty fields get sensible
// hard-coded defaults so a manager can press Enter through screens they don't
// care about.
type BootstrapWizardDefaults struct {
	Role         string
	RoleTitle    string
	Stack        string
	Domain       string
	Feature      string
	TimeBox      string
	ModeProject  string
	ModeAnalysis string
	ModeRubric   string
	OutputDir    string
}

// bootstrapWizardModel is the form-state container. It is intentionally a
// plain struct so the form-building helpers can be unit-tested without a TTY.
type bootstrapWizardModel struct {
	state bootstrapWizardState

	role         string
	roleTitle    string
	stack        string
	domain       string
	feature      string
	timeBox      string
	modeProject  string
	modeAnalysis string
	modeRubric   string
	customPrompt string
	jdPath       string
	outputDir    string

	confirmed bool
	aborted   bool
}

// newBootstrapWizardModel builds a new wizard model with the given defaults.
// Empty defaults fall back to hard-coded values so users can mash Enter.
func newBootstrapWizardModel(d BootstrapWizardDefaults) bootstrapWizardModel {
	m := bootstrapWizardModel{
		state:        wsBootstrapRole,
		role:         d.Role,
		roleTitle:    d.RoleTitle,
		stack:        d.Stack,
		domain:       d.Domain,
		feature:      d.Feature,
		timeBox:      firstNonEmptyStr(d.TimeBox, "90"),
		modeProject:  firstNonEmptyStr(d.ModeProject, "A"),
		modeAnalysis: firstNonEmptyStr(d.ModeAnalysis, "ai-assisted"),
		modeRubric:   firstNonEmptyStr(d.ModeRubric, "default"),
		outputDir:    firstNonEmptyStr(d.OutputDir, "./roles/role"),
	}
	return m
}

// bootstrapWizardNextState returns the next wizard state given the current
// state and the values on the model. Rubric mode is the only branching point.
func bootstrapWizardNextState(cur bootstrapWizardState, m bootstrapWizardModel) bootstrapWizardState {
	switch cur {
	case wsBootstrapRole:
		return wsBootstrapRoleTitle
	case wsBootstrapRoleTitle:
		return wsBootstrapStack
	case wsBootstrapStack:
		return wsBootstrapDomain
	case wsBootstrapDomain:
		return wsBootstrapFeature
	case wsBootstrapFeature:
		return wsBootstrapTimeBox
	case wsBootstrapTimeBox:
		return wsBootstrapProjectMode
	case wsBootstrapProjectMode:
		return wsBootstrapAnalysisMode
	case wsBootstrapAnalysisMode:
		return wsBootstrapRubricMode
	case wsBootstrapRubricMode:
		switch m.modeRubric {
		case "custom":
			return wsBootstrapCustomPrompt
		case "default+jd":
			return wsBootstrapJDPath
		default:
			return wsBootstrapOutputDir
		}
	case wsBootstrapCustomPrompt:
		return wsBootstrapOutputDir
	case wsBootstrapJDPath:
		return wsBootstrapOutputDir
	case wsBootstrapOutputDir:
		return wsBootstrapConfirm
	case wsBootstrapConfirm:
		return wsBootstrapDone
	default:
		return wsBootstrapDone
	}
}

// bootstrapWizardOptionsFromModel converts the wizard model into the same
// BootstrapOptions shape the headless flag parser produces. The result MUST
// pass ValidateBootstrapOptions or the dispatcher will reject it — that single
// validator is the shared gate between headless and interactive paths.
func bootstrapWizardOptionsFromModel(m bootstrapWizardModel) *BootstrapOptions {
	return &BootstrapOptions{
		Role:         m.role,
		RoleTitle:    m.roleTitle,
		Stack:        m.stack,
		Domain:       m.domain,
		Feature:      m.feature,
		TimeBox:      m.timeBox,
		ModeProject:  m.modeProject,
		ModeAnalysis: m.modeAnalysis,
		ModeRubric:   m.modeRubric,
		CustomPrompt: m.customPrompt,
		JDPath:       m.jdPath,
		OutputDir:    m.outputDir,
		Headless:     true, // the runner always speaks the headless protocol
	}
}

// ---------------------------------------------------------------------------
// Field validators — used by huh.Input.Validate at runtime, but kept as
// plain functions so they're unit-testable.
// ---------------------------------------------------------------------------

var roleSlugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$`)

func validateRoleSlug(s string) error {
	t := strings.TrimSpace(s)
	if t == "" {
		return fmt.Errorf("role slug is required")
	}
	if !roleSlugRe.MatchString(t) {
		return fmt.Errorf("role slug must be lowercase, URL-safe (a-z, 0-9, hyphen)")
	}
	return nil
}

func validateTimeBox(s string) error {
	t := strings.TrimSpace(s)
	if t == "" {
		return fmt.Errorf("time-box is required")
	}
	n, err := strconv.Atoi(t)
	if err != nil {
		return fmt.Errorf("time-box must be a number of minutes (got %q)", s)
	}
	if n < 30 || n > 240 {
		return fmt.Errorf("time-box must be between 30 and 240 minutes (got %d)", n)
	}
	return nil
}

// validateJDPath returns nil for empty input — the rubric-mode branch enforces
// that JD is supplied when the user picks "default+jd". A non-empty path must
// exist on disk.
func validateJDPath(s string) error {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	if _, err := os.Stat(s); err != nil {
		return fmt.Errorf("JD path not found: %s", s)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

// BootstrapWizardResult is what the interactive wizard returns to the dispatcher.
// Aborted=true means the user pressed Ctrl+C or escaped out of the first screen;
// Confirmed=false means they reached the confirm screen and chose "no".
type BootstrapWizardResult struct {
	Options   *BootstrapOptions
	Confirmed bool
	Aborted   bool
}

// BootstrapWizardLauncher renders the interactive huh.Form wizard and returns
// the chosen options. The interface exists so tests can substitute a stub that
// never touches the TTY.
type BootstrapWizardLauncher interface {
	Launch() (*BootstrapWizardResult, error)
}

// huhBootstrapWizardLauncher is the production launcher. It drives a sequence
// of huh.Forms to populate a bootstrapWizardModel, then converts to
// BootstrapOptions on confirm.
type huhBootstrapWizardLauncher struct {
	defaults BootstrapWizardDefaults
}

func newHuhBootstrapWizardLauncher(d BootstrapWizardDefaults) *huhBootstrapWizardLauncher {
	return &huhBootstrapWizardLauncher{defaults: d}
}

// Launch drives the wizard to completion. Each huh.Form is run sequentially;
// huh.ErrUserAborted at any step results in Aborted=true. Returns a result
// even on abort so the dispatcher can exit cleanly without writing any files.
func (h *huhBootstrapWizardLauncher) Launch() (*BootstrapWizardResult, error) {
	return runHuhBootstrapWizard(h.defaults)
}

// runInterviewBootstrapWithWizard is the dispatch shape that supports both
// the headless path (any flag present, or --headless explicit) and the
// interactive wizard path (no flags at all on a TTY caller).
func runInterviewBootstrapWithWizard(
	args []string,
	runner BootstrapRunner,
	launcher BootstrapWizardLauncher,
	stdout, stderr io.Writer,
) int {
	// No flags at all → interactive wizard, but only when stdin is a TTY.
	// Running an interactive huh.Form against piped/CI stdin hangs forever
	// or fails confusingly; we'd rather print a clear message.
	if len(args) == 0 {
		if !isStdinTTY() {
			fmt.Fprintln(stderr, "teamhero interview bootstrap: no flags supplied and stdin is not a TTY; cannot launch the interactive wizard. Pass --headless and the required flags, or run from an interactive terminal.")
			return 1
		}
		res, err := launcher.Launch()
		if err != nil {
			fmt.Fprintf(stderr, "wizard failed: %v\n", err)
			return 1
		}
		if res == nil || res.Aborted {
			fmt.Fprintln(stderr, "Wizard aborted. No role was generated.")
			return 0
		}
		if !res.Confirmed {
			// User reached the confirm screen and chose "Cancel". Surface
			// that explicitly so the exit isn't indistinguishable from a
			// successful no-op completion.
			fmt.Fprintln(stderr, "Wizard cancelled at confirm. No role was generated.")
			return 0
		}
		opts := res.Options
		if opts == nil {
			fmt.Fprintln(stderr, "wizard returned no options; aborting")
			return 1
		}
		if msg := ValidateBootstrapOptions(opts); msg != "" {
			fmt.Fprintln(stderr, msg)
			return 1
		}
		return runner.Run(opts, stdout, stderr)
	}

	// Otherwise fall through to the existing headless dispatch.
	return runInterviewBootstrap(args, runner, stdout, stderr)
}

// isStdinTTY reports whether os.Stdin is a real terminal. Returns false on
// piped input, CI runners, or any error reading the fd. Tests override this
// via the package-level var below.
var isStdinTTY = func() bool {
	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return (fi.Mode() & os.ModeCharDevice) != 0
}
