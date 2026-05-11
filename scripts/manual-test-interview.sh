#!/usr/bin/env bash
#
# manual-test-interview.sh — manual end-to-end smoke test for `teamhero interview`
#
# This script is for a HUMAN running on a TTY. It walks through the v1.5
# interactive flows that automated tests cannot meaningfully cover:
# the wizard's branching, the glamour preview's readability, and the
# phased progress display's responsiveness.
#
# It does NOT spend money on OpenAI: the grade step is invoked with
# --mode-analysis human-only so no API key is required.
#
# Usage:
#   ./scripts/manual-test-interview.sh
#
# Requirements:
#   - A TTY (this script bails out on piped/non-interactive stdin)
#   - A built teamhero-tui binary (run `just tui-build` first)
#   - bun available on PATH (the headless path spawns a TS subprocess)

set -euo pipefail

if [[ ! -t 0 ]] || [[ ! -t 1 ]]; then
  echo "ERROR: this script is for interactive manual testing on a TTY." >&2
  echo "       Refusing to run with piped stdin/stdout." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$REPO_ROOT/tui/teamhero-tui"
TMPDIR="$(mktemp -d -t teamhero-manual-XXXXXX)"
trap 'rm -rf "$TMPDIR"' EXIT

if [[ ! -x "$BIN" ]]; then
  echo "ERROR: teamhero-tui binary not found at $BIN" >&2
  echo "       Run \`just tui-build\` first." >&2
  exit 1
fi

pause() {
  echo
  echo "──────────────────────────────────────────────────────────"
  echo "  $1"
  echo "  Press Enter to continue, or Ctrl+C to abort."
  echo "──────────────────────────────────────────────────────────"
  read -r _
}

step() {
  echo
  echo "═══ STEP $1: $2 ═══"
  echo
}

step 1 "Interactive wizard for \`teamhero interview bootstrap\`"
echo "You should see a series of huh.Form prompts asking for role slug, stack,"
echo "domain, feature, time-box, project mode, analysis mode, rubric mode, and"
echo "output directory. Try selecting the 'Custom prompt' rubric mode on one"
echo "run and the 'Default + Job Description' mode on another to verify both"
echo "conditional branches work. Cancel out with Ctrl+C — it must exit cleanly."
pause "Verify the wizard branches correctly and Ctrl+C exits cleanly."
"$BIN" interview bootstrap || true

step 2 "Headless bootstrap (no wizard) — agents/CI path"
echo "This invocation should bypass the wizard entirely and behave exactly like"
echo "it always has."
pause "Run the headless bootstrap and verify no TUI is rendered."
"$BIN" interview bootstrap \
  --headless --no-confirm \
  --role manual-test-role --stack TypeScript --domain Manual \
  --feature "Verify the headless path still works" \
  --mode-project A --mode-analysis human-only --mode-rubric default \
  --output-dir "$TMPDIR/manual-test-role" || true
echo "Bootstrap output (if any) is in: $TMPDIR/manual-test-role"

step 3 "Grade flow — phased progress display + glamour preview"
echo "The grade step is invoked with --mode-analysis human-only so no OpenAI"
echo "key is needed. Watch for:"
echo "  - Phased progress display: clone → collect-evidence → extract-measurements → observe → audit-write"
echo "  - The ADVISORY warning banner at the start"
echo "  - A glamour-rendered preview of summary.md after the run completes"
pause "Run grade and verify the progress display + glamour preview."
"$BIN" interview grade \
  --candidate "Manual Test Candidate" \
  --repo "https://example.com/fake-repo" \
  --output-dir "$TMPDIR/grade-output" || true

step 4 "Sign-off file gating"
echo "Open the summary.md and audit.md in $TMPDIR/grade-output/ and verify:"
echo "  - The ADVISORY banner is at the top of BOTH files"
echo "  - The sign-off section is present and requires a categorical decision"
echo "  - The session recording URL appears in frontmatter only (not in body)"
pause "Confirm the sign-off section exists and the ADVISORY banner is present."

step 5 "Cohort rendering for the manual-test-role"
echo "Run cohort to confirm it lists the single candidate without any"
echo "Score/Total/Rank columns (rankless by design)."
pause "Run cohort and verify the output is rankless."
"$BIN" interview cohort --role manual-test-role || true

echo
echo "═══ MANUAL TEST COMPLETE ═══"
echo
echo "If all five steps behaved as expected, the v1.5 interactive surfaces"
echo "are working correctly. Output artifacts (auto-cleaned on exit):"
echo "  $TMPDIR"
echo
