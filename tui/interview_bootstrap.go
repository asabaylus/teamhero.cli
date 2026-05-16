package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// BootstrapOptions are the headless flags accepted by `teamhero interview bootstrap`.
type BootstrapOptions struct {
	Role         string
	RoleTitle    string
	Stack        string
	Domain       string
	Feature      string
	TimeBox      string
	ModeProject  string
	ModeAnalysis string
	ModeRubric   string
	JDPath       string
	CustomPrompt string
	OutputDir    string
	KitDir       string
	Headless     bool
	NoConfirm    bool
	Foreground   bool
	// StackByCandidate flips Mode B's brief from "use Stack" to
	// "candidate picks their own stack". Only meaningful when
	// ModeProject == "B"; the validator rejects the combination
	// otherwise so the headless protocol stays explicit. Set by the
	// wizard's "Greenfield (candidate picks stack)" option or the
	// --stack-by-candidate headless flag.
	StackByCandidate bool
	// JDInfluencesProject tells the project-generation prompt to read
	// the JD at JDPath and tailor the generated repo to its seniority
	// and domain (e.g., junior healthtech → EHR-flavoured feature).
	// Requires JDPath; the validator rejects the combination otherwise.
	// Independent of ModeRubric — the JD is now a standalone input
	// rather than being smuggled in via a rubric value.
	JDInfluencesProject bool
	// Debug toggles verbose run-context logs in the bun subprocess (the
	// generator client) and the Go dispatcher. Off by default — light
	// run logs print regardless so failure triage doesn't require a rerun.
	Debug bool
}

// ParseBootstrapFlags parses headless flags from the args following `bootstrap`.
// Returns nil and an error message if a flag value is missing.
func ParseBootstrapFlags(args []string) (*BootstrapOptions, string) {
	opts := &BootstrapOptions{}
	i := 0
	for i < len(args) {
		a := args[i]
		switch a {
		case "--headless":
			opts.Headless = true
		case "--no-confirm":
			opts.NoConfirm = true
		case "--foreground":
			opts.Foreground = true
		case "--debug", "-d":
			opts.Debug = true
		case "--stack-by-candidate":
			opts.StackByCandidate = true
		case "--jd-influences-project":
			opts.JDInfluencesProject = true
		case "--role", "--role-title", "--stack", "--domain", "--feature",
			"--time-box", "--mode-project", "--mode-analysis", "--mode-rubric",
			"--jd-path", "--custom-prompt",
			"--output-dir", "--kit-dir":
			if i+1 >= len(args) {
				return nil, fmt.Sprintf("flag %s requires a value", a)
			}
			val := args[i+1]
			switch a {
			case "--role":
				opts.Role = val
			case "--role-title":
				opts.RoleTitle = val
			case "--stack":
				opts.Stack = val
			case "--domain":
				opts.Domain = val
			case "--feature":
				opts.Feature = val
			case "--time-box":
				opts.TimeBox = val
			case "--mode-project":
				opts.ModeProject = val
			case "--mode-analysis":
				opts.ModeAnalysis = val
			case "--mode-rubric":
				opts.ModeRubric = val
			case "--jd-path":
				opts.JDPath = val
			case "--custom-prompt":
				opts.CustomPrompt = val
			case "--output-dir":
				opts.OutputDir = val
			case "--kit-dir":
				opts.KitDir = val
			}
			i++
		default:
			return nil, fmt.Sprintf("unknown flag: %s", a)
		}
		i++
	}
	return opts, ""
}

// ValidateBootstrapOptions returns a non-empty string describing why the
// options are invalid, or "" when they are complete.
func ValidateBootstrapOptions(opts *BootstrapOptions) string {
	required := map[string]string{
		"--role":          opts.Role,
		"--stack":         opts.Stack,
		"--feature":       opts.Feature,
		"--mode-project":  opts.ModeProject,
		"--mode-analysis": opts.ModeAnalysis,
		"--mode-rubric":   opts.ModeRubric,
		"--output-dir":    opts.OutputDir,
	}
	// --domain is required UNLESS a --jd-path is supplied. The job
	// description, when attached, describes the business domain;
	// forcing the proctor to also type it as a separate flag is
	// redundant and error-prone.
	if strings.TrimSpace(opts.JDPath) == "" && strings.TrimSpace(opts.Domain) == "" {
		required["--domain"] = ""
	}
	missing := []string{}
	for flag, val := range required {
		if strings.TrimSpace(val) == "" {
			missing = append(missing, flag)
		}
	}
	if len(missing) > 0 {
		return "missing required flags: " + strings.Join(missing, ", ")
	}
	if opts.ModeProject != "A" && opts.ModeProject != "B" {
		return "--mode-project must be 'A' or 'B'"
	}
	if opts.StackByCandidate && opts.ModeProject != "B" {
		// stack-by-candidate is a Mode B variant. Combining it with Mode A
		// is incoherent — Mode A generates a starter codebase IN a stack,
		// so "candidate picks the stack" can't apply. Reject explicitly so
		// callers don't get a brownfield project with a mismatched brief.
		return "--stack-by-candidate requires --mode-project B"
	}
	if opts.ModeAnalysis != "ai-assisted" && opts.ModeAnalysis != "human-only" {
		return "--mode-analysis must be 'ai-assisted' or 'human-only'"
	}
	switch opts.ModeRubric {
	case "default", "custom":
	default:
		return "--mode-rubric must be 'default' or 'custom'"
	}
	if opts.ModeRubric == "custom" && strings.TrimSpace(opts.CustomPrompt) == "" {
		return "--mode-rubric 'custom' requires --custom-prompt"
	}
	// jd-path is now optional regardless of rubric mode. When supplied,
	// the file must exist. --jd-influences-project requires a path
	// (the generator has nothing to read otherwise).
	if strings.TrimSpace(opts.JDPath) != "" {
		if _, err := os.Stat(opts.JDPath); err != nil {
			return fmt.Sprintf("--jd-path does not exist: %s", opts.JDPath)
		}
	}
	if opts.JDInfluencesProject && strings.TrimSpace(opts.JDPath) == "" {
		return "--jd-influences-project requires --jd-path"
	}
	return ""
}

// BootstrapRunner spawns the TS bootstrap process. Tests substitute a stub.
type BootstrapRunner interface {
	Run(opts *BootstrapOptions, stdout, stderr io.Writer) int
}

// bunBootstrapRunner is the production runner that spawns the TS script via bun.
type bunBootstrapRunner struct{}

func (bunBootstrapRunner) Run(opts *BootstrapOptions, stdout, stderr io.Writer) int {
	args := []string{"run", findBootstrapScript()}
	args = append(args,
		"--role", opts.Role,
		"--stack", opts.Stack,
		"--domain", opts.Domain,
		"--feature", opts.Feature,
		"--mode-project", opts.ModeProject,
		"--mode-analysis", opts.ModeAnalysis,
		"--mode-rubric", opts.ModeRubric,
		"--output-dir", opts.OutputDir,
	)
	if opts.RoleTitle != "" {
		args = append(args, "--role-title", opts.RoleTitle)
	}
	if opts.TimeBox != "" {
		args = append(args, "--time-box", opts.TimeBox)
	}
	if opts.JDPath != "" {
		args = append(args, "--jd-path", opts.JDPath)
	}
	if opts.CustomPrompt != "" {
		args = append(args, "--custom-prompt", opts.CustomPrompt)
	}
	if opts.KitDir != "" {
		args = append(args, "--kit-dir", opts.KitDir)
	}
	if opts.StackByCandidate {
		args = append(args, "--stack-by-candidate")
	}
	if opts.JDInfluencesProject {
		args = append(args, "--jd-influences-project")
	}
	if opts.Debug {
		args = append(args, "--debug")
	}

	bunPath := resolveBunBinary()
	cmd := exec.Command(bunPath, args...)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	cmd.Env = os.Environ()
	if err := cmd.Run(); err != nil {
		if exit, ok := err.(*exec.ExitError); ok {
			return exit.ExitCode()
		}
		fmt.Fprintf(stderr, "Failed to run bootstrap subprocess: %v\n", err)
		return 1
	}
	return 0
}

// findBootstrapScript locates scripts/run-interview-bootstrap.ts relative to the
// installed teamhero.cli source tree. Falls back to a best-effort path next to
// the TUI binary's working directory.
func findBootstrapScript() string {
	candidates := []string{
		"scripts/run-interview-bootstrap.ts",
		"../scripts/run-interview-bootstrap.ts",
	}
	if runtime.GOOS != "windows" {
		exe, err := os.Executable()
		if err == nil {
			candidates = append(candidates,
				filepath.Join(filepath.Dir(exe), "..", "scripts", "run-interview-bootstrap.ts"),
			)
		}
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return "scripts/run-interview-bootstrap.ts"
}

// applyBootstrapDefaults fills in any optional flag whose value is derivable
// from the rest of the config so the proctor doesn't have to repeat the
// obvious defaults every run.
//
//   - --output-dir defaults to `./interviews/<role-slug>`. The repo's
//     .gitignore covers `interviews/`, so generated candidate material
//     never accidentally lands in a commit.
//   - --time-box defaults to "60" minutes — the recommended length for a
//     candidate interview project. Override with --time-box per the
//     original PRD when the role needs more or less runway.
//   - --kit-dir defaults to `teamhero-interview-kit` (resolved relative
//     to the current working directory) so the bootstrap scripts,
//     INTERVIEW_RULES.md, AGENTS.md, PRIVACY_RELEASE.md, .claude/CLAUDE.md,
//     and other scaffolding files are ALWAYS copied into the generated
//     repo — regardless of whether the proctor picked a generated
//     starter project (Mode A) or a brief-only flow (Mode B). Without
//     this default a proctor who forgot to pass --kit-dir got the AI
//     output but none of the proctor/candidate guidance, which broke
//     the recording workflow.
//
// Defaults are applied in-place; an explicit user flag always wins.
func applyBootstrapDefaults(opts *BootstrapOptions) {
	if opts == nil {
		return
	}
	role := strings.TrimSpace(opts.Role)
	if strings.TrimSpace(opts.OutputDir) == "" && role != "" {
		opts.OutputDir = filepath.Join("interviews", role)
	}
	if strings.TrimSpace(opts.TimeBox) == "" {
		opts.TimeBox = "60"
	}
	if strings.TrimSpace(opts.KitDir) == "" {
		opts.KitDir = "teamhero-interview-kit"
	}
}

// runInterviewBootstrap dispatches the bootstrap verb. Parses flags, validates,
// invokes the runner. On success it prints a clickable output-dir link and,
// when running interactively, offers to publish the generated repo to GitHub.
// Returns the exit code.
func runInterviewBootstrap(args []string, runner BootstrapRunner, stdout, stderr io.Writer) int {
	opts, parseErr := ParseBootstrapFlags(args)
	if parseErr != "" {
		fmt.Fprintln(stderr, parseErr)
		return 1
	}
	if !opts.Headless {
		fmt.Fprintln(stderr, "teamhero interview bootstrap: only --headless mode is implemented in this slice; pass --headless and all required flags.")
		return 1
	}
	applyBootstrapDefaults(opts)
	if msg := ValidateBootstrapOptions(opts); msg != "" {
		fmt.Fprintln(stderr, msg)
		return 1
	}
	logBootstrapRunContext(opts, stderr)
	exit := runner.Run(opts, stdout, stderr)
	if exit == 0 {
		printBootstrapSuccessLink(opts.OutputDir, stdout)
		// Suppress the publish prompt on non-interactive runs (CI, piped
		// stdin) and when --no-confirm explicitly opts out, so scripted
		// callers never block on a huh form.
		if isStdinTTY() && !opts.NoConfirm {
			offerPublishToGitHub(opts, stdout, stderr)
		}
	}
	return exit
}

// logBootstrapRunContext emits a single-line summary of the validated
// options before the bun subprocess runs so a failure ticket can be
// triaged without rerunning. Always prints (light context); the verbose
// per-field dump is delegated to the bun subprocess via --debug.
//
// Goes to stderr because stdout is reserved for the user-facing success
// link / OSC 8 hyperlink, which the TUI consumes verbatim.
func logBootstrapRunContext(opts *BootstrapOptions, w io.Writer) {
	if opts == nil {
		return
	}
	jdShort := opts.JDPath
	if jdShort == "" {
		jdShort = "(none)"
	}
	fmt.Fprintf(w,
		"[bootstrap] role=%s mode=%s stack=%s stack-by-candidate=%t domain=%s time-box=%sm rubric=%s jd=%s jd-influences-project=%t output=%s kit=%s debug=%t\n",
		opts.Role, opts.ModeProject, opts.Stack, opts.StackByCandidate, opts.Domain, opts.TimeBox,
		opts.ModeRubric, jdShort, opts.JDInfluencesProject, opts.OutputDir, opts.KitDir, opts.Debug,
	)
}

// printBootstrapSuccessLink emits the generated project's path as an OSC 8
// hyperlink so the proctor can ctrl-click to open it in their OS file
// browser. The display label prefers a path relative to the current
// working directory (so a project under ~/Documents/interviews shows as
// "interviews/<role>" rather than "/home/.../Documents/interviews/<role>")
// — but the underlying file:// URL is always absolute so the click
// actually opens. Falls back to absolute display if Rel fails or escapes
// upward via "..".
func printBootstrapSuccessLink(dir string, w io.Writer) {
	abs, link := absPathLink(dir)
	if link == "" {
		fmt.Fprintf(w, "Project: %s\n", abs)
		return
	}
	display := abs
	if cwd, err := os.Getwd(); err == nil {
		if rel, err := filepath.Rel(cwd, abs); err == nil && !strings.HasPrefix(rel, "..") {
			display = rel
		}
	}
	fmt.Fprintf(w, "Project: %s\n", osc8Link(link, display))
}
