package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
)

// CohortOptions are the flags accepted by `teamhero interview cohort`.
type CohortOptions struct {
	Role    string
	RoleDir string
	Order   string
}

func ParseCohortFlags(args []string) (*CohortOptions, string) {
	opts := &CohortOptions{}
	i := 0
	for i < len(args) {
		a := args[i]
		switch a {
		case "--role", "--role-dir", "--order":
			if i+1 >= len(args) {
				return nil, fmt.Sprintf("flag %s requires a value", a)
			}
			val := args[i+1]
			switch a {
			case "--role":
				opts.Role = val
			case "--role-dir":
				opts.RoleDir = val
			case "--order":
				opts.Order = val
			}
			i++
		default:
			return nil, fmt.Sprintf("unknown flag: %s", a)
		}
		i++
	}
	return opts, ""
}

func ValidateCohortOptions(opts *CohortOptions) string {
	if strings.TrimSpace(opts.Role) == "" {
		return "missing required flag: --role"
	}
	if opts.Order != "" && opts.Order != "alphabetical" && opts.Order != "chronological" {
		return "--order must be 'alphabetical' or 'chronological'"
	}
	return ""
}

type CohortRunner interface {
	Run(opts *CohortOptions, stdout, stderr io.Writer) int
}

type bunCohortRunner struct{}

func (bunCohortRunner) Run(opts *CohortOptions, stdout, stderr io.Writer) int {
	script := findCohortScript()
	args := []string{"run", script, "--role", opts.Role}
	if opts.RoleDir != "" {
		args = append(args, "--role-dir", opts.RoleDir)
	}
	if opts.Order != "" {
		args = append(args, "--order", opts.Order)
	}
	cmd := exec.Command(resolveBunBinary(), args...)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	cmd.Env = os.Environ()
	if err := cmd.Run(); err != nil {
		if exit, ok := err.(*exec.ExitError); ok {
			return exit.ExitCode()
		}
		fmt.Fprintf(stderr, "Failed to run cohort subprocess: %v\n", err)
		return 1
	}
	return 0
}

func findCohortScript() string {
	candidates := []string{
		"scripts/run-interview-cohort.ts",
		"../scripts/run-interview-cohort.ts",
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return "scripts/run-interview-cohort.ts"
}

func runInterviewCohort(args []string, runner CohortRunner, stdout, stderr io.Writer) int {
	opts, parseErr := ParseCohortFlags(args)
	if parseErr != "" {
		fmt.Fprintln(stderr, parseErr)
		return 1
	}
	if msg := ValidateCohortOptions(opts); msg != "" {
		fmt.Fprintln(stderr, msg)
		return 1
	}
	return runner.Run(opts, stdout, stderr)
}
