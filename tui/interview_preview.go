package main

import (
	"github.com/charmbracelet/glamour"
)

const interviewAdvisoryBanner = "⚠ THIS AUDIT IS ADVISORY. Hiring decisions are made by humans. " +
	"The candidate is a person, not a score. The audit is one factor among many."

// renderInterviewAuditPreview returns a glamour-rendered preview of the audit
// summary, with the ADVISORY warning banner pinned above the source content.
// The pinned banner is mandatory — managers must read it before being sent to
// the sign-off file.
//
// width is passed to glamour's word-wrap. Pass 0 or a negative number to use
// the glamour default (80).
func renderInterviewAuditPreview(source string, width int) (string, error) {
	if width <= 0 {
		width = 80
	}

	withBanner := "> " + interviewAdvisoryBanner + "\n\n" + source

	r, err := glamour.NewTermRenderer(
		glamour.WithWordWrap(width),
		glamourStyleOption(),
	)
	if err != nil {
		// Fallback: return the raw text with the banner still pinned.
		return interviewAdvisoryBanner + "\n\n" + source, nil
	}

	rendered, err := r.Render(withBanner)
	if err != nil {
		return interviewAdvisoryBanner + "\n\n" + source, nil
	}
	return rendered, nil
}
