#!/usr/bin/env bash
# Interview kit: end.sh
# Verifies the recording exists, stages all interview artifacts, and creates
# a single commit. Run this AFTER you have exited the asciinema recording.
#
# Environment overrides:
#   SKIP_COMMIT=1   skip the actual git commit (used by smoke tests)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"

if [ ! -f "$REPO_ROOT/.interview-state/started-at" ]; then
    echo "✖ No record of start.sh having been run. Did you start the interview?" >&2
    exit 1
fi

CAST_PATH="$REPO_ROOT/terminal.cast"
if [ ! -f "$CAST_PATH" ] && [ "${SKIP_RECORD:-0}" != "1" ]; then
    echo "✖ terminal.cast not found at $CAST_PATH. Did you finish the recording?" >&2
    exit 1
fi

RELEASE_PATH="$REPO_ROOT/PRIVACY_RELEASE.md"
LOG_PATH="$REPO_ROOT/interview.log"
RULES_PATH="$REPO_ROOT/INTERVIEW_RULES.md"

# Stage everything that exists.
STAGE=()
[ -f "$CAST_PATH" ] && STAGE+=("$CAST_PATH")
[ -f "$RELEASE_PATH" ] && STAGE+=("$RELEASE_PATH")
[ -f "$LOG_PATH" ] && STAGE+=("$LOG_PATH")
[ -f "$RULES_PATH" ] && STAGE+=("$RULES_PATH")

if [ "${SKIP_COMMIT:-0}" = "1" ]; then
    echo "✓ end.sh: artifacts ready (SKIP_COMMIT=1 — no commit made)."
    printf '  - %s\n' "${STAGE[@]}"
    exit 0
fi

cd "$REPO_ROOT"

if [ ! -d .git ]; then
    echo "✖ Not a git repository. Was the project cloned correctly?" >&2
    exit 1
fi

git add "${STAGE[@]}"

# Single combined commit so the timestamp matches the recording window.
git commit -m "Interview session: signed release + terminal recording + agent log" \
    --no-verify

echo "✓ Committed. Push instructions:"
echo "  git push origin HEAD"
echo
echo "Share the resulting repo URL with the interviewer."
