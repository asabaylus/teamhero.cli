#!/usr/bin/env bash
# Privacy gate for the interview kit. Detects whether PRIVACY_RELEASE.md has
# been signed by the candidate.
#
# Detection rule: the file must exist, must not be empty, must contain a
# "## Signed" section with a non-whitespace, non-placeholder value beneath it,
# and must contain a "## Date" section with a non-whitespace, non-placeholder
# value beneath it.
#
# Usage:
#   bash privacy-gate.sh /path/to/PRIVACY_RELEASE.md   # returns 0 if signed
#   source privacy-gate.sh; check_privacy_release_signed /path/...
#
# Works on macOS, Linux, and WSL (POSIX-compatible; uses awk + grep).

# Note: `set -u` lives inside the direct-exec block at the bottom of this file
# rather than at the top level, because sourcing this script with `set -u`
# would leak nounset into the caller's shell.

# extract_section <file> <heading> — prints the body that follows a given
# "## Heading" line up to (but not including) the next "## " heading or EOF.
extract_section() {
    local file="$1"
    local heading="$2"
    awk -v h="## ${heading}" '
        $0 == h { capturing = 1; next }
        capturing && /^## / { capturing = 0 }
        capturing { print }
    ' "$file"
}

# Returns 0 if the given string is a real candidate-supplied value (not empty,
# not whitespace-only, not the placeholder text we ship in the template).
is_real_value() {
    local body="$1"
    local trimmed
    trimmed=$(printf '%s' "$body" | tr -d '[:space:]')
    if [ -z "$trimmed" ]; then
        return 1
    fi
    # Reject the literal placeholder content from the shipped template.
    if printf '%s' "$body" | grep -qiE '^\(placeholder.*\)$'; then
        return 1
    fi
    return 0
}

check_privacy_release_signed() {
    local file="${1:-}"
    if [ -z "$file" ]; then
        return 2
    fi
    if [ ! -f "$file" ]; then
        return 3
    fi
    if [ ! -s "$file" ]; then
        return 4
    fi
    local signed_body
    local date_body
    signed_body=$(extract_section "$file" "Signed")
    date_body=$(extract_section "$file" "Date")
    if ! is_real_value "$signed_body"; then
        return 5
    fi
    if ! is_real_value "$date_body"; then
        return 6
    fi
    return 0
}

# When invoked directly (not sourced), run the check on $1 and exit with the
# function's return code. nounset is enabled here, scoped to this block, so
# callers that source this library don't inherit it.
if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
    set -u
    check_privacy_release_signed "${1:-}"
    exit $?
fi
