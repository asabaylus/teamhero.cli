#!/usr/bin/env bash
# Interview kit: start.sh
# Checks the privacy gate, verifies the Claude Code hooks are wired, and
# begins terminal recording with asciinema. Run this BEFORE you start the
# interview project.
#
# Environment overrides (for testing or non-standard installs):
#   ASCIINEMA_BIN   path to the asciinema binary (default: asciinema)
#   SKIP_RECORD=1   skip the actual recording step (used by smoke tests)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"

# shellcheck source=lib/privacy-gate.sh
. "$SCRIPT_DIR/lib/privacy-gate.sh"

RELEASE_PATH="$REPO_ROOT/PRIVACY_RELEASE.md"

if ! check_privacy_release_signed "$RELEASE_PATH"; then
    cat <<'EOF' >&2
✖ Privacy release is not signed.

This interview is recorded. Before you begin, you must:

  1. Open PRIVACY_RELEASE.md in this repo.
  2. Read it carefully — it covers what is recorded during the session
     and our privacy commitment to you.
  3. Fill in your name in the "## Signed" section.
  4. Fill in today's date in the "## Date" section.
  5. Re-run ./start.sh.

If you do not consent to the recording, do not sign — and let the
interviewer know.
EOF
    exit 1
fi

# Verify the Claude Code hooks are wired so the interview.log can be produced.
HOOKS_FILE="$REPO_ROOT/.claude/settings.json"
if [ ! -f "$HOOKS_FILE" ]; then
    echo "✖ Missing $HOOKS_FILE — kit is incomplete. Re-clone the project." >&2
    exit 1
fi
if ! grep -q '"UserPromptSubmit"' "$HOOKS_FILE"; then
    echo "✖ $HOOKS_FILE does not declare a UserPromptSubmit hook. Kit is incomplete." >&2
    exit 1
fi
if ! grep -q '"PreToolUse"' "$HOOKS_FILE"; then
    echo "✖ $HOOKS_FILE does not declare a PreToolUse hook. Kit is incomplete." >&2
    exit 1
fi

if [ "${SKIP_RECORD:-0}" = "1" ]; then
    # We still write started-at in this path since there's no preflight
    # that could fail after this point.
    mkdir -p "$REPO_ROOT/.interview-state"
    date -u +%FT%TZ > "$REPO_ROOT/.interview-state/started-at"
    echo "✓ Privacy gate passed. SKIP_RECORD=1 — not starting asciinema."
    exit 0
fi

ASCIINEMA_BIN="${ASCIINEMA_BIN:-asciinema}"
if ! command -v "$ASCIINEMA_BIN" >/dev/null 2>&1; then
    cat <<EOF >&2
✖ asciinema is not installed (looked for: $ASCIINEMA_BIN).

Install:
  macOS:  brew install asciinema
  Linux:  sudo apt install asciinema   (or your distro's package manager)
  WSL:    sudo apt install asciinema   (inside your WSL distro)

Then re-run ./start.sh.
EOF
    exit 1
fi

# Mark "started" only after asciinema preflight passes. Writing it earlier
# would leave a stale marker behind if preflight failed, and end.sh would
# then mistakenly think a session was completed.
mkdir -p "$REPO_ROOT/.interview-state"
date -u +%FT%TZ > "$REPO_ROOT/.interview-state/started-at"

CAST_PATH="$REPO_ROOT/terminal.cast"
echo "✓ Privacy gate passed."
echo "  Starting terminal recording: $CAST_PATH"
echo "  When you finish, exit this shell, then run ./end.sh"
exec "$ASCIINEMA_BIN" rec --overwrite "$CAST_PATH"
