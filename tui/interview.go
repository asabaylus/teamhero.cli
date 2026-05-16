package main

import (
	"fmt"
	"io"

	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
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

// interviewVerbOptions returns the picker choices. Each Value must be a
// non-empty string distinct from the zero value of `string` — otherwise huh
// treats Cancel (whose value used to be "") as the bound `verb`'s current
// value, places the cursor on Cancel (the LAST row), and the viewport
// scrolls to keep that cursor visible, clipping every option above it. The
// user only sees "> Cancel" on first paint until they press the up arrow.
// Regression test: TestInterviewVerbOptions_NoValueMatchesZeroDefault.
func interviewVerbOptions() []huh.Option[string] {
	return []huh.Option[string]{
		huh.NewOption("Bootstrap — generate a candidate coding project", "bootstrap"),
		huh.NewOption("Review — review a single candidate's interview", "review"),
		huh.NewOption("Cohort — review all candidates for a role", "cohort"),
		huh.NewOption("Cancel", "cancel"),
	}
}

// interviewVerbPicker returns the verb the user chose ("bootstrap" / "review"
// / "cohort"), "" if they cancelled, or an error. Tests override this so the
// dispatcher logic can be exercised without a TTY.
//
// The picker is wrapped with the shared shell-header + hints-footer so the
// `teamhero interview` no-args screen lands inside the same contextual
// frame as every other top-level command. Without the frame the user
// drops out of the app's visual layout and the picker looks like an
// unrelated tool.
var interviewVerbPicker = func() (string, error) {
	w := termWidth()
	fmt.Println(renderShellHeader(w))
	fmt.Println()

	var verb string
	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("teamhero interview").
				Description("What would you like to do?").
				Options(interviewVerbOptions()...).
				Value(&verb),
		),
	).WithTheme(huh.ThemeCharm()).WithWidth(w * 3 / 5)
	if err := form.Run(); err != nil {
		if err == huh.ErrUserAborted {
			return "", nil
		}
		return "", err
	}

	hintStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	fmt.Println()
	fmt.Println(hintStyle.Render("enter continue • ctrl+c quit"))

	// Map the "cancel" sentinel back to the caller's "" no-op convention so
	// the dispatcher's existing `if verb == ""` check covers both abort
	// (ctrl-c) and explicit Cancel selection.
	if verb == "cancel" {
		return "", nil
	}
	return verb, nil
}

func runInterview(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		// Non-TTY callers (CI, piped stdin, `go test`) cannot drive the picker;
		// keep the legacy usage-and-exit-1 behavior so scripts stay deterministic.
		if !isStdinTTY() {
			printInterviewUsage(stderr)
			return 1
		}
		verb, err := interviewVerbPicker()
		if err != nil {
			fmt.Fprintf(stderr, "interview menu failed: %v\n", err)
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
		return runInterviewBootstrapWithWizard(rest, bunBootstrapRunner{}, launcher, stdout, stderr)
	case "review":
		return runInterviewReview(rest, bunReviewRunner{}, stdout, stderr)
	case "cohort":
		return runInterviewCohort(rest, bunCohortRunner{}, stdout, stderr)
	default:
		fmt.Fprintf(stderr, "teamhero interview: unknown verb %q\n", verb)
		printInterviewUsage(stderr)
		return 1
	}
}
