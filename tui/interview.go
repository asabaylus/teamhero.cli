package main

import (
	"fmt"
	"io"
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

func runInterview(args []string, out io.Writer) int {
	if len(args) == 0 {
		printInterviewUsage(out)
		return 1
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
