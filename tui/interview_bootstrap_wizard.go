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
	// wsBootstrapJDProvided is the yes/no step that asks the hiring
	// manager whether they have a job description to attach. The JD is
	// now collected as a standalone input rather than being smuggled in
	// via a "default+jd" rubric value. When provided, two more
	// downstream steps follow (path + influences-project toggle); when
	// declined the wizard skips both.
	wsBootstrapJDProvided
	wsBootstrapJDPath
	// wsBootstrapJDInfluencesProject asks whether the JD should also
	// shape the AI's project-generation prompt (in addition to
	// informing the post-interview rubric analysis). When true the
	// generator reads the JD body and tailors the project's
	// complexity and domain accordingly — e.g., a junior healthtech
	// JD nudges toward an EHR-flavoured feature.
	wsBootstrapJDInfluencesProject
	// wsBootstrapFeatureSource is the either/or step that drives whether
	// the proctor types the feature description themselves or lets the
	// AI suggest project ideas. Replaces the old late-stage
	// PromptSource/ProjectPrompt redundancy — the feature description
	// IS the project prompt, so there's exactly one place to supply it.
	wsBootstrapFeatureSource
	wsBootstrapFeature
	// wsBootstrapIdeaFetching is a transient spinner state while the
	// wizard calls OpenAI to enumerate candidate ideas. Reached only when
	// featureSource == "suggest". Lands on wsBootstrapIdeaSelect on
	// success or surfaces the error on the same select screen.
	wsBootstrapIdeaFetching
	// wsBootstrapIdeaSelect presents the fetched ideas as a huh.Select.
	// The chosen idea's title+blurb populates the feature description.
	wsBootstrapIdeaSelect
	wsBootstrapTimeBox
	wsBootstrapProjectMode
	wsBootstrapAnalysisMode
	// wsBootstrapRubricMode is now just default/custom — the
	// "default+jd" value was retired in favour of the standalone JD
	// branch above. JD attachment is independent of rubric choice now.
	wsBootstrapRubricMode
	wsBootstrapCustomPrompt
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
	// modeProject holds one of three wizard-level values:
	//   "brownfield"       — generates a starter codebase (Mode A)
	//   "greenfield-stack" — written brief; candidate uses the named stack (Mode B)
	//   "greenfield-open"  — written brief; candidate picks their own stack (Mode B + stackByCandidate)
	// These collapse to projectMode "A"/"B" + stackByCandidate at the
	// BootstrapOptions boundary so the downstream validator and OpenAI
	// client stay simple.
	modeProject  string
	modeAnalysis string
	modeRubric   string
	customPrompt string
	jdPath       string
	// jdProvided is bound to the "Will you provide a JD?" select. The
	// string values are "yes"/"no" so huh.Select can bind directly; the
	// downstream code only branches on this — the canonical JD presence
	// signal is the non-empty jdPath that follows.
	jdProvided string
	// jdInfluencesProject is bound to the "Should the JD influence the
	// project?" select. Same "yes"/"no" pattern as jdProvided. The
	// boolean is collapsed at the BootstrapOptions boundary so the
	// downstream surface stays typed.
	jdInfluencesProject string
	outputDir           string

	// featureSource selects how the candidate-facing feature description
	// is supplied: "custom" — proctor types it themselves at
	// wsBootstrapFeature; "suggest" — wizard fetches ideas and the
	// proctor picks one at wsBootstrapIdeaSelect, which populates the
	// feature field. Defaults to "custom" so headless callers (who
	// always supply --feature) behave identically.
	featureSource string

	// ideas is populated by the Idea-fetch step when featureSource ==
	// "suggest". ideaSelected indexes into ideas; -1 means none yet.
	ideas        []ProjectIdea
	ideaSelected int
	ideaFetchErr string

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
		timeBox:      firstNonEmptyStr(d.TimeBox, "60"),
		// modeProject default is "brownfield" — the most common interview
		// shape (AI scaffolds a starter codebase the candidate extends).
		// Legacy "A"/"B" values from BootstrapWizardDefaults are accepted
		// and translated below so existing callers don't break.
		modeProject:  normalizeWizardProjectMode(firstNonEmptyStr(d.ModeProject, "brownfield")),
		modeAnalysis: firstNonEmptyStr(d.ModeAnalysis, "ai-assisted"),
		modeRubric:   firstNonEmptyStr(d.ModeRubric, "default"),
		outputDir:           firstNonEmptyStr(d.OutputDir, "./interviews/role"),
		featureSource:       "custom",
		jdProvided:          "no",
		jdInfluencesProject: "no",
		ideaSelected:        -1,
	}
	return m
}

// bootstrapWizardNextState returns the next wizard state given the current
// state and the values on the model. Branching points:
//   - jdProvided: "yes" takes the JD-path + influences-project detour
//   - featureSource: "suggest" diverts through the spinner + idea-select
//   - modeRubric: "custom" diverts through the custom-prompt step
func bootstrapWizardNextState(cur bootstrapWizardState, m bootstrapWizardModel) bootstrapWizardState {
	switch cur {
	case wsBootstrapRole:
		return wsBootstrapRoleTitle
	case wsBootstrapRoleTitle:
		return wsBootstrapStack
	case wsBootstrapStack:
		return wsBootstrapDomain
	case wsBootstrapDomain:
		return wsBootstrapJDProvided
	case wsBootstrapJDProvided:
		if m.jdProvided == "yes" {
			return wsBootstrapJDPath
		}
		return wsBootstrapFeatureSource
	case wsBootstrapJDPath:
		return wsBootstrapJDInfluencesProject
	case wsBootstrapJDInfluencesProject:
		return wsBootstrapFeatureSource
	case wsBootstrapFeatureSource:
		if m.featureSource == "suggest" {
			return wsBootstrapIdeaFetching
		}
		return wsBootstrapFeature
	case wsBootstrapFeature:
		return wsBootstrapTimeBox
	case wsBootstrapIdeaFetching:
		return wsBootstrapIdeaSelect
	case wsBootstrapIdeaSelect:
		return wsBootstrapTimeBox
	case wsBootstrapTimeBox:
		return wsBootstrapProjectMode
	case wsBootstrapProjectMode:
		return wsBootstrapAnalysisMode
	case wsBootstrapAnalysisMode:
		return wsBootstrapRubricMode
	case wsBootstrapRubricMode:
		if m.modeRubric == "custom" {
			return wsBootstrapCustomPrompt
		}
		return wsBootstrapOutputDir
	case wsBootstrapCustomPrompt:
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
// normalizeWizardProjectMode accepts both the new self-describing values
// ("brownfield" / "greenfield-stack" / "greenfield-open") and the legacy
// "A"/"B" values that older defaults / tests / saved configs might pass
// in. Returns one of the three new values so the wizard's project-type
// select renders the right option as pre-selected.
func normalizeWizardProjectMode(v string) string {
	switch v {
	case "A":
		return "brownfield"
	case "B":
		return "greenfield-stack"
	case "brownfield", "greenfield-stack", "greenfield-open":
		return v
	default:
		return "brownfield"
	}
}

// resolveWizardProjectMode collapses a wizard-level project-type value
// into (modeProject, stackByCandidate) so the BootstrapOptions struct
// only ever carries the two-state mode the downstream validator and
// OpenAI client understand. "greenfield-open" is the only case that
// flips stackByCandidate to true; the rest set it false.
func resolveWizardProjectMode(v string) (string, bool) {
	switch v {
	case "brownfield", "A":
		return "A", false
	case "greenfield-stack", "B":
		return "B", false
	case "greenfield-open":
		return "B", true
	default:
		return "A", false
	}
}

func bootstrapWizardOptionsFromModel(m bootstrapWizardModel) *BootstrapOptions {
	mode, stackByCandidate := resolveWizardProjectMode(m.modeProject)
	// JD is only attached when the proctor said "yes" up front. If they
	// said "no" but somehow still typed a path, ignore the path — the
	// declared intent wins. Likewise, jdInfluencesProject is meaningless
	// without a JD, so collapse it to false in that case.
	jdPath := ""
	jdInfluencesProject := false
	if m.jdProvided == "yes" {
		jdPath = m.jdPath
		jdInfluencesProject = m.jdInfluencesProject == "yes"
	}
	return &BootstrapOptions{
		Role:                m.role,
		RoleTitle:           m.roleTitle,
		Stack:               m.stack,
		Domain:              m.domain,
		Feature:             m.feature,
		TimeBox:             m.timeBox,
		ModeProject:         mode,
		StackByCandidate:    stackByCandidate,
		ModeAnalysis:        m.modeAnalysis,
		ModeRubric:          m.modeRubric,
		CustomPrompt:        m.customPrompt,
		JDPath:              jdPath,
		JDInfluencesProject: jdInfluencesProject,
		OutputDir:           m.outputDir,
		Headless:            true, // the runner always speaks the headless protocol
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
		// Interactive path: hand off to the bubbletea generate screen so the
		// user sees a spinner during the bun subprocess and lands on a
		// persistent result view (with a clickable output path) afterward,
		// rather than the TUI exiting silently the moment generation ends.
		code := runBootstrapGenerate(runner, opts, stdout, stderr)
		if code == 0 {
			// Offer GitHub publish only after successful generation, and
			// only when the user already configured a GitHub token via
			// `teamhero setup` (silent skip otherwise — no nag).
			offerPublishToGitHub(opts, stdout, stderr)
		}
		return code
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
