package main

import (
	"fmt"
	"io"
)

func printInterviewUsage(out io.Writer) {
	fmt.Fprint(out, `Usage: teamhero interview <verb> [flags]

Grade candidate AI-collaboration interviews.

Verbs:
  bootstrap   Configure a role and generate the candidate coding project
  grade       Grade a single candidate's interview artifacts
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
	switch verb {
	case "bootstrap", "grade", "cohort":
		fmt.Fprintf(out, "teamhero interview %s: not yet implemented\n", verb)
		return 1
	default:
		fmt.Fprintf(out, "teamhero interview: unknown verb %q\n", verb)
		printInterviewUsage(out)
		return 1
	}
}
