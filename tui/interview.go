package main

import (
	"fmt"
	"io"

	"github.com/charmbracelet/huh"
)

func printInterviewUsage(out io.Writer) {
	fmt.Fprint(out, `Usage: teamhero interview <verb> [flags]

Review candidate AI-collaboration interviews.

Verbs:
  bootstrap   Configure a role and generate the candidate coding project
  review      Review a single candidate's interview artifacts
  cohort      Review the cohort across all candidates for a role

Run 'teamhero interview <verb> --help' for verb-specific help.
`)
}

// interviewVerbPicker returns the verb the user chose ("bootstrap" / "review"
// / "cohort"), "" if they cancelled, or an error. Tests override this so the
// dispatcher logic can be exercised without a TTY.
var interviewVerbPicker = func() (string, error) {
	var verb string
	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("teamhero interview").
				Description("What would you like to do?").
				Options(
					huh.NewOption("Bootstrap — generate a candidate coding project", "bootstrap"),
					huh.NewOption("Review — review a single candidate's interview", "review"),
					huh.NewOption("Cohort — review all candidates for a role", "cohort"),
					huh.NewOption("Cancel", ""),
				).
				Value(&verb),
		),
	)
	if err := form.Run(); err != nil {
		if err == huh.ErrUserAborted {
			return "", nil
		}
		return "", err
	}
	return verb, nil
}

func runInterview(args []string, out io.Writer) int {
	if len(args) == 0 {
		// Non-TTY callers (CI, piped stdin, `go test`) cannot drive the picker;
		// keep the legacy usage-and-exit-1 behavior so scripts stay deterministic.
		if !isStdinTTY() {
			printInterviewUsage(out)
			return 1
		}
		verb, err := interviewVerbPicker()
		if err != nil {
			fmt.Fprintf(out, "interview menu failed: %v\n", err)
			return 1
		}
		if verb == "" {
			return 0
		}
		args = []string{verb}
	}
	verb := args[0]
	rest := args[1:]
	switch verb {
	case "bootstrap":
		launcher := newHuhBootstrapWizardLauncher(BootstrapWizardDefaults{})
		return runInterviewBootstrapWithWizard(rest, bunBootstrapRunner{}, launcher, out, out)
	case "review":
		return runInterviewReview(rest, bunReviewRunner{}, out, out)
	case "cohort":
		return runInterviewCohort(rest, bunCohortRunner{}, out, out)
	default:
		fmt.Fprintf(out, "teamhero interview: unknown verb %q\n", verb)
		printInterviewUsage(out)
		return 1
	}
}
