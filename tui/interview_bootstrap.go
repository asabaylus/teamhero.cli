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
	Role          string
	RoleTitle     string
	Stack         string
	Domain        string
	Feature       string
	TimeBox       string
	ModeProject   string
	ModeAnalysis  string
	ModeRubric    string
	JDPath        string
	CustomPrompt  string
	// ProjectPrompt is the proctor's free-form addendum to the AI
	// project-generation prompt. Optional. Distinct from CustomPrompt
	// (which is rubric-mode-only).
	ProjectPrompt string
	OutputDir     string
	KitDir        string
	Headless      bool
	NoConfirm     bool
	Foreground    bool
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
		case "--role", "--role-title", "--stack", "--domain", "--feature",
			"--time-box", "--mode-project", "--mode-analysis", "--mode-rubric",
			"--jd-path", "--custom-prompt", "--project-prompt",
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
			case "--project-prompt":
				opts.ProjectPrompt = val
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
		"--domain":        opts.Domain,
		"--feature":       opts.Feature,
		"--mode-project":  opts.ModeProject,
		"--mode-analysis": opts.ModeAnalysis,
		"--mode-rubric":   opts.ModeRubric,
		"--output-dir":    opts.OutputDir,
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
	if opts.ModeAnalysis != "ai-assisted" && opts.ModeAnalysis != "human-only" {
		return "--mode-analysis must be 'ai-assisted' or 'human-only'"
	}
	switch opts.ModeRubric {
	case "default", "custom", "default+jd":
	default:
		return "--mode-rubric must be 'default', 'custom', or 'default+jd'"
	}
	if opts.ModeRubric == "custom" && strings.TrimSpace(opts.CustomPrompt) == "" {
		return "--mode-rubric 'custom' requires --custom-prompt"
	}
	if opts.ModeRubric == "default+jd" {
		if strings.TrimSpace(opts.JDPath) == "" {
			return "--mode-rubric 'default+jd' requires --jd-path"
		}
		if _, err := os.Stat(opts.JDPath); err != nil {
			return fmt.Sprintf("--jd-path does not exist: %s", opts.JDPath)
		}
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
	if opts.ProjectPrompt != "" {
		args = append(args, "--project-prompt", opts.ProjectPrompt)
	}
	if opts.KitDir != "" {
		args = append(args, "--kit-dir", opts.KitDir)
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

// printBootstrapSuccessLink emits the generated project's absolute path as
// an OSC 8 hyperlink so the proctor can ctrl-click to open it in their OS
// file browser. Falls back to a plain path when no file:// URL can be derived.
func printBootstrapSuccessLink(dir string, w io.Writer) {
	abs, link := absPathLink(dir)
	if link == "" {
		fmt.Fprintf(w, "Project: %s\n", abs)
		return
	}
	fmt.Fprintf(w, "Project: %s\n", osc8Link(link, abs))
}
