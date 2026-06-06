#!/usr/bin/env bash
# Interview kit: start.sh
# Checks the privacy gate, reports any optional agent hook configs, and
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

# Report any optional agent hook configs. These enrich interview.log with
# structured prompt/tool-call events, but they are NOT required: the
# terminal recording is the universal capture. We support multiple AI
# tools (Claude Code, Cursor, Codex) and never block on a missing hook.
report_optional_hooks() {
    local found=0
    echo "Optional agent hook configs (for structured interview.log enrichment):"
    for hook_file in \
        "$REPO_ROOT/.claude/settings.json" \
        "$REPO_ROOT/.cursor/hooks.json" \
        "$REPO_ROOT/.codex/hooks.json"
    do
        if [ -f "$hook_file" ]; then
            echo "  ✓ $hook_file"
            found=1
        fi
    done
    if [ "$found" -eq 0 ]; then
        echo "  (none found — terminal recording still works)"
    else
        echo "  If your AI tool supports project hooks, these may append to interview.log."
        echo "  Codex users may need to trust project hooks via /hooks before they run."
    fi
}

if [ "${SKIP_RECORD:-0}" = "1" ]; then
    # We still write started-at in this path since there's no preflight
    # that could fail after this point.
    mkdir -p "$REPO_ROOT/.interview-state"
    date -u +%FT%TZ > "$REPO_ROOT/.interview-state/started-at"
    echo "✓ Privacy gate passed. SKIP_RECORD=1 — not starting asciinema."
    report_optional_hooks
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
report_optional_hooks
echo "  Starting terminal recording: $CAST_PATH"
echo "  When you finish, exit this shell, then run ./end.sh"
exec "$ASCIINEMA_BIN" rec --overwrite "$CAST_PATH"
