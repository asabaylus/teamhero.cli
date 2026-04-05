#!/usr/bin/env bash
set -euo pipefail
#
# File: .claude/hooks/setup_init.sh
#
# Setup init hook — triggered by `claude --init`
# Runs scripts/bootstrap.sh and logs output for Claude Code analysis.
#

# Resolve project root
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
LOG_FILE="$PROJECT_DIR/.claude/hooks/setup.init.log"
BOOTSTRAP_SCRIPT="$PROJECT_DIR/scripts/bootstrap.sh"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Start logging
{
  echo "=== TeamHero Setup Init ==="
  echo "Timestamp: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "Project: $PROJECT_DIR"
  echo "---"
} > "$LOG_FILE"

# Run bootstrap and capture output
EXIT_CODE=0
if [[ -f "$BOOTSTRAP_SCRIPT" ]]; then
  sh "$BOOTSTRAP_SCRIPT" >> "$LOG_FILE" 2>&1 || EXIT_CODE=$?
else
  echo "ERROR: bootstrap.sh not found at $BOOTSTRAP_SCRIPT" >> "$LOG_FILE"
  EXIT_CODE=2
fi

# Log result
{
  echo "---"
  echo "Exit code: $EXIT_CODE"
  echo "Completed: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
} >> "$LOG_FILE"

# Output JSON for Claude Code hookSpecificOutput
if [[ $EXIT_CODE -eq 0 ]]; then
  STATUS="success"
  MESSAGE="Bootstrap completed successfully. See .claude/hooks/setup.init.log for details."
else
  STATUS="failure"
  MESSAGE="Bootstrap failed (exit $EXIT_CODE). See .claude/hooks/setup.init.log for details."
fi

cat <<EOF
{
  "hookSpecificOutput": {
    "status": "$STATUS",
    "exitCode": $EXIT_CODE,
    "logFile": ".claude/hooks/setup.init.log",
    "message": "$MESSAGE"
  }
}
EOF

# Exit 0 on success, 2 on failure (Claude Code convention)
if [[ $EXIT_CODE -ne 0 ]]; then
  exit 2
fi
