#!/usr/bin/env bash
# Run bun tests with per-file process isolation.
# Bun's mock.module() leaks across test files in the same process,
# so we run each file in its own bun test invocation.
#
# Usage:
#   bash scripts/run-tests.sh [pattern]           # run tests matching pattern
#   bash scripts/run-tests.sh --coverage          # run all tests with coverage
#   bash scripts/run-tests.sh --coverage [pattern] # run matching tests with coverage
set -uo pipefail

PASS=0
FAIL=0
SKIP=0
ERRORS=()
COVERAGE=false
PATTERN=""

# Parse arguments
for arg in "$@"; do
  if [[ "$arg" == "--coverage" ]]; then
    COVERAGE=true
  else
    PATTERN="$arg"
  fi
done

# Coverage setup
LCOV_MERGED="coverage/lcov.info"
LCOV_TMP="coverage/lcov-merged.info"
if [[ "$COVERAGE" == true ]]; then
  mkdir -p coverage
  rm -f "$LCOV_MERGED" "$LCOV_TMP"
fi

# Collect test files
mapfile -t FILES < <(find tests -type f \( -name '*.spec.ts' -o -name '*.test.ts' \) | sort)

for f in "${FILES[@]}"; do
  # If a pattern was provided, filter by it
  if [[ -n "$PATTERN" ]] && [[ "$f" != *"$PATTERN"* ]]; then
    continue
  fi

  if [[ "$COVERAGE" == true ]]; then
    output=$(bun test --coverage --coverage-reporter=lcov "$f" 2>&1)
    # Append this file's lcov output to merged file
    if [[ -f "$LCOV_MERGED" ]]; then
      cat "$LCOV_MERGED" >> "$LCOV_TMP"
    fi
  else
    output=$(bun test "$f" 2>&1)
  fi

  file_pass=$(echo "$output" | grep -oP '\d+(?= pass)' || echo 0)
  file_fail=$(echo "$output" | grep -oP '\d+(?= fail)' || echo 0)
  file_skip=$(echo "$output" | grep -oP '\d+(?= skip)' || echo 0)

  [[ -z "$file_pass" ]] && file_pass=0
  [[ -z "$file_fail" ]] && file_fail=0
  [[ -z "$file_skip" ]] && file_skip=0

  PASS=$((PASS + file_pass))
  FAIL=$((FAIL + file_fail))
  SKIP=$((SKIP + file_skip))

  if [[ "$file_fail" -gt 0 ]]; then
    ERRORS+=("$f ($file_fail failures)")
    echo "FAIL $f"
    echo "$output" | grep -A3 "(fail)" | head -20
    echo ""
  fi
done

# Finalize merged coverage — replace lcov.info with deduplicated merged result
if [[ "$COVERAGE" == true && -f "$LCOV_TMP" ]]; then
  mv "$LCOV_TMP" "$LCOV_MERGED"
fi

echo ""
echo "=== Results: $PASS pass, $FAIL fail, $SKIP skip ==="

if [[ ${#ERRORS[@]} -gt 0 ]]; then
  echo ""
  echo "Failed files:"
  for e in "${ERRORS[@]}"; do
    echo "  - $e"
  done
  exit 1
fi
