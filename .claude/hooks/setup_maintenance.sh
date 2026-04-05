#!/usr/bin/env bash
set -euo pipefail
#
# File: .claude/hooks/setup_maintenance.sh
#
# Setup maintenance hook — triggered by `claude --maintenance`
# Runs maintenance tasks (deps, build, test, lint) and logs output.
#

# Resolve project root
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
LOG_FILE="$PROJECT_DIR/.claude/hooks/setup.maintenance.log"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Start logging
{
  echo "=== TeamHero Maintenance ==="
  echo "Timestamp: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "Project: $PROJECT_DIR"
  echo "---"
} > "$LOG_FILE"

cd "$PROJECT_DIR"

OVERALL_EXIT=0
RESULTS=()

# Helper: run a step, log output, track pass/fail
run_step() {
  local name="$1"
  shift
  local step_exit=0

  echo "" >> "$LOG_FILE"
  echo ">>> $name" >> "$LOG_FILE"
  "$@" >> "$LOG_FILE" 2>&1 || step_exit=$?

  if [[ $step_exit -eq 0 ]]; then
    echo "<<< $name: PASS" >> "$LOG_FILE"
    RESULTS+=("$name: PASS")
  else
    echo "<<< $name: FAIL (exit $step_exit)" >> "$LOG_FILE"
    RESULTS+=("$name: FAIL (exit $step_exit)")
    OVERALL_EXIT=2
  fi
}

# Run maintenance steps
run_step "bun install" bun install
run_step "bun run build" bun run build
run_step "bun run test" bun run test
run_step "bun run lint" bun run lint

# Log summary
{
  echo ""
  echo "---"
  echo "Summary:"
  for r in "${RESULTS[@]}"; do
    echo "  $r"
  done
  echo "Overall exit: $OVERALL_EXIT"
  echo "Completed: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
} >> "$LOG_FILE"

# Build JSON results array
RESULTS_JSON="["
for i in "${!RESULTS[@]}"; do
  if [[ $i -gt 0 ]]; then RESULTS_JSON+=","; fi
  RESULTS_JSON+="\"${RESULTS[$i]}\""
done
RESULTS_JSON+="]"

# Output JSON for Claude Code hookSpecificOutput
if [[ $OVERALL_EXIT -eq 0 ]]; then
  STATUS="success"
  MESSAGE="All maintenance steps passed. See .claude/hooks/setup.maintenance.log for details."
else
  STATUS="failure"
  MESSAGE="Some maintenance steps failed. See .claude/hooks/setup.maintenance.log for details."
fi

cat <<EOF
{
  "hookSpecificOutput": {
    "status": "$STATUS",
    "exitCode": $OVERALL_EXIT,
    "logFile": ".claude/hooks/setup.maintenance.log",
    "steps": $RESULTS_JSON,
    "message": "$MESSAGE"
  }
}
EOF

if [[ $OVERALL_EXIT -ne 0 ]]; then
  exit 2
fi
