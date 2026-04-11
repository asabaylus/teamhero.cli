#!/usr/bin/env bash
# Replay a captured teamhero week end-to-end against its synthetic cache.
#
# Builds a temporary cache directory from one .local/synthetic-runs/week-*/
# bucket, rewrites cachedAt timestamps on TTL-limited cache envelopes so
# they don't stale-miss, constructs a ReportCommandInput matching the
# captured window, and runs bun run scripts/run-report.ts against the
# staged cache via XDG_CACHE_HOME override.
#
# The replay should produce a report byte-for-byte close to the captured
# report.md. Diffs are surfaced at the end.
#
# Usage:
#   ./scripts/replay-synthetic-run.sh                    # replays week-2026-04-11
#   ./scripts/replay-synthetic-run.sh week-2026-04-04    # specific week
#
# Requires:
#   - .local/synthetic-runs/ populated by capture-synthetic-runs.py
#   - bun, python3, jq
#   - OPENAI_API_KEY set in ~/.config/teamhero/.env (in case of AI cache misses)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SYNTH_ROOT="$REPO_ROOT/.local/synthetic-runs"
WEEK_LABEL="${1:-week-2026-04-11}"
WEEK_DIR="$SYNTH_ROOT/$WEEK_LABEL"

if [[ ! -d "$WEEK_DIR" ]]; then
	echo "[error] week dir not found: $WEEK_DIR" >&2
	echo "  Available weeks:" >&2
	ls -1 "$SYNTH_ROOT" 2>/dev/null | grep '^week-' | sed 's/^/    /' >&2
	exit 1
fi

if [[ ! -f "$WEEK_DIR/report.md" ]]; then
	echo "[error] no report.md in $WEEK_DIR" >&2
	exit 1
fi

MANIFEST="$WEEK_DIR/MANIFEST.json"
if [[ ! -f "$MANIFEST" ]]; then
	echo "[error] no MANIFEST.json in $WEEK_DIR" >&2
	exit 1
fi

WINDOW_START=$(jq -r '.reportingWindow.start' "$MANIFEST")
WINDOW_END=$(jq -r '.reportingWindow.end' "$MANIFEST")

echo "[info] Replaying $WEEK_LABEL ($WINDOW_START .. $WINDOW_END)"

# -- Stage the cache --------------------------------------------------------
#
# Build a fresh XDG_CACHE_HOME so we don't pollute the real cache at
# ~/.cache/teamhero. Copy every namespace from the week's cache dir to
# the staged location, then rewrite cachedAt to NOW so TTL-limited
# namespaces (tasks, loc-repo) don't stale-miss.

STAGE_DIR=$(mktemp -d -t teamhero-replay-XXXXXX)
# Keep the stage dir on exit so the caller can inspect logs.
# To auto-clean on success, set REPLAY_CLEANUP=1.
if [[ "${REPLAY_CLEANUP:-0}" == "1" ]]; then
	trap 'rm -rf "$STAGE_DIR"' EXIT
fi

echo "[info] Staging cache at $STAGE_DIR"

STAGED_CACHE="$STAGE_DIR/teamhero/data-cache"
mkdir -p "$STAGED_CACHE"
cp -r "$WEEK_DIR/cache/." "$STAGED_CACHE/"

# Rewrite cachedAt to now so tasks (1 hour TTL) and any other
# non-permanent entries pass their freshness check on replay.
NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
python3 - <<PY
import json
import os
import sys

staged = "$STAGED_CACHE"
now_iso = "$NOW_ISO"
touched = 0
for ns in os.listdir(staged):
	ns_dir = os.path.join(staged, ns)
	if not os.path.isdir(ns_dir):
		continue
	for name in os.listdir(ns_dir):
		if not name.endswith(".json"):
			continue
		path = os.path.join(ns_dir, name)
		try:
			with open(path, "r") as f:
				envelope = json.load(f)
		except (OSError, json.JSONDecodeError):
			continue
		meta = envelope.get("meta") if isinstance(envelope, dict) else None
		if not isinstance(meta, dict):
			continue
		meta["cachedAt"] = now_iso
		with open(path, "w") as f:
			json.dump(envelope, f, indent=2, sort_keys=True)
		touched += 1
print(f"[info] Rewrote cachedAt on {touched} cache envelopes", file=sys.stderr)
PY

# -- Build the ReportCommandInput ------------------------------------------
#
# Base on the live config.json but override since/until to the captured
# window and enable all the sections the captured report had.

CONFIG_PATH="$STAGE_DIR/replay-config.json"
python3 - <<PY > "$CONFIG_PATH"
import json
import os
with open(os.path.expanduser("~/.config/teamhero/config.json")) as f:
	cfg = json.load(f)
out = {
	"org": cfg["org"],
	"members": cfg["members"],
	"repos": cfg.get("repos", []),
	"since": "$WINDOW_START",
	"until": "$WINDOW_END",
	"includeBots": cfg.get("includeBots", False),
	"excludePrivate": cfg.get("excludePrivate", False),
	"includeArchived": cfg.get("includeArchived", False),
	"detailed": cfg.get("detailed", False),
	"sections": {
		"dataSources": {"git": True, "asana": True},
		"reportSections": {
			"visibleWins": True,
			"technicalFoundationalWins": True,
			"individualContributions": True,
			"discrepancyLog": True,
			"loc": True,
		},
	},
	"mode": "headless",
	"discrepancyThreshold": cfg.get("discrepancyThreshold", 30),
}
print(json.dumps(out))
PY

# -- Run the report ---------------------------------------------------------

REPORT_OUTPUT="$STAGE_DIR/replay-report.md"
STDOUT_LOG="$STAGE_DIR/replay-stdout.jsonl"
STDERR_LOG="$STAGE_DIR/replay-stderr.log"

echo "[info] Running bun run scripts/run-report.ts"
cd "$REPO_ROOT"

# XDG_CACHE_HOME redirects cacheDir() to the staged location.
# TEAMHERO_DISABLE_AI_AUDIT=1 is NOT set — we want to exercise the audit path.
#
# Prove the replay is cache-only: unset GITHUB/ASANA credentials so any
# live call triggers a loud failure. OpenAI stays available because AI
# output caches may miss on schema drift and we want the pipeline to
# regenerate only those entries (which is a valid part of replay).
if cat "$CONFIG_PATH" | env \
	-u GITHUB_PERSONAL_ACCESS_TOKEN \
	-u GITHUB_TOKEN \
	-u ASANA_API_TOKEN \
	XDG_CACHE_HOME="$STAGE_DIR" \
	bun run "$REPO_ROOT/scripts/run-report.ts" \
	>"$STDOUT_LOG" 2>"$STDERR_LOG"; then
	echo "[info] Report subprocess exited 0"
else
	echo "[error] Report subprocess exited nonzero — see $STDERR_LOG" >&2
	tail -30 "$STDERR_LOG" >&2
	exit 2
fi

# -- Locate the generated report -------------------------------------------
#
# The report is written to cwd with a date-stamped filename. Find it by
# looking for the newest teamhero-report-*-{WINDOW_END}.md.

FOUND_REPORT="$REPO_ROOT/teamhero-report-lumata-health-${WINDOW_END}.md"
if [[ ! -f "$FOUND_REPORT" ]]; then
	echo "[error] expected generated report at $FOUND_REPORT — not found" >&2
	ls -la "$REPO_ROOT"/teamhero-report-*.md 2>/dev/null | tail -5 >&2 || true
	exit 3
fi

cp "$FOUND_REPORT" "$REPORT_OUTPUT"
echo "[info] Generated report: $REPORT_OUTPUT"
echo "[info] Captured report : $WEEK_DIR/report.md"

# -- Diff -------------------------------------------------------------------

GEN_LINES=$(wc -l <"$REPORT_OUTPUT")
CAP_LINES=$(wc -l <"$WEEK_DIR/report.md")
echo "[info] line counts: generated=$GEN_LINES captured=$CAP_LINES"

# -- Parse cache hit/miss events -------------------------------------------
#
# The replay's unified log (under the staged cacheDir) records every
# cache-hit / cache-miss event. Classify them: structural input caches
# should always hit (metrics, tasks, visible-wins, loc-repo). AI output
# caches may miss when the cache-key formula evolves — that's expected
# and causes a fresh OpenAI call, not a failure.

UNIFIED_LOG="$STAGE_DIR/teamhero/logs/teamhero.log"
STRUCTURAL_NS=("metrics" "tasks" "visible-wins" "loc" "loc-repo")
AI_NS=("visible-wins-extraction" "team-highlight" "member-highlights" "technical-wins" "audit")

STRUCT_HITS=0
STRUCT_MISSES=0
AI_HITS=0
AI_MISSES=0

if [[ -f "$UNIFIED_LOG" ]]; then
	# `set -o pipefail` propagates grep's exit=1 (no matches) through the
	# pipeline and aborts the script. We want zero-match to mean "0 hits",
	# not "abort", so use `|| true` to absorb the nonzero exit.
	for ns in "${STRUCTURAL_NS[@]}"; do
		hits=$(grep -oEc "\"event\":\"cache-hit\",\"namespace\":\"$ns\"" "$UNIFIED_LOG" || true)
		misses=$(grep -oEc "\"event\":\"cache-miss[^\"]*\",\"namespace\":\"$ns\"" "$UNIFIED_LOG" || true)
		STRUCT_HITS=$((STRUCT_HITS + ${hits:-0}))
		STRUCT_MISSES=$((STRUCT_MISSES + ${misses:-0}))
	done
	for ns in "${AI_NS[@]}"; do
		hits=$(grep -oEc "\"event\":\"cache-hit\",\"namespace\":\"$ns\"" "$UNIFIED_LOG" || true)
		misses=$(grep -oEc "\"event\":\"cache-miss[^\"]*\",\"namespace\":\"$ns\"" "$UNIFIED_LOG" || true)
		AI_HITS=$((AI_HITS + ${hits:-0}))
		AI_MISSES=$((AI_MISSES + ${misses:-0}))
	done
fi

echo "[info] cache events — structural: ${STRUCT_HITS} hit / ${STRUCT_MISSES} miss | AI: ${AI_HITS} hit / ${AI_MISSES} miss"

# PASS criteria:
#   1. Report subprocess exited 0 (already verified above)
#   2. No structural cache misses — live GitHub/Asana would be required
#      to satisfy them, but we unset those credentials, so a miss would
#      have aborted with an auth error.
#   3. Byte-identical report OR AI-only differences.
if [[ "$STRUCT_MISSES" -gt 0 ]]; then
	echo ""
	echo "[FAIL] ${STRUCT_MISSES} structural cache miss(es) — replay escaped offline mode." >&2
	echo "This means the captured cache does not cover all inputs the" >&2
	echo "pipeline needed. Check the unified log for details:" >&2
	echo "  $UNIFIED_LOG" >&2
	exit 4
fi

if diff -q "$WEEK_DIR/report.md" "$REPORT_OUTPUT" >/dev/null; then
	echo ""
	echo "[PASS] Replay is byte-identical to the captured report."
	echo "  Structural caches: ${STRUCT_HITS} hit / ${STRUCT_MISSES} miss"
	echo "  AI output caches:  ${AI_HITS} hit / ${AI_MISSES} miss"
	exit 0
fi

# `diff` exits 1 when files differ. Disable `set -e` around the
# reporting block so an expected nonzero exit doesn't abort the script.
set +e
DIFF_LINES=$(diff "$WEEK_DIR/report.md" "$REPORT_OUTPUT" | wc -l)
echo ""
echo "[PASS-SOFT] Structural caches all hit; report diverges by $DIFF_LINES lines."
echo "  Structural caches: ${STRUCT_HITS} hit / ${STRUCT_MISSES} miss"
echo "  AI output caches:  ${AI_HITS} hit / ${AI_MISSES} miss  (misses trigger fresh OpenAI calls)"
echo ""
echo "First 40 lines of diff:"
echo "------------------------------------------------------------"
diff "$WEEK_DIR/report.md" "$REPORT_OUTPUT" | head -40
echo "------------------------------------------------------------"
echo ""
echo "Full outputs:"
echo "  captured: $WEEK_DIR/report.md"
echo "  replay:   $REPORT_OUTPUT"
echo "  stage:    $STAGE_DIR"
echo "  stderr:   $STDERR_LOG"
echo ""
echo "A non-zero diff does not automatically mean failure. Expected drift sources:"
echo "  1. Schema evolution: features added after the capture (e.g. Technical/"
echo "     Foundational Wins) will appear in the replay but not the captured report."
echo "  2. Prompt evolution: AI cache keys include the prompt hash. Prompt changes"
echo "     (e.g. Phase 1-4 roadmap work) invalidate cached AI outputs → cache miss"
echo "     → fresh AI call → slight wording variation."
echo "  3. Clock-dependent fields: the 'Generated:' timestamp in the report header."
echo ""
echo "Check stderr for cache miss warnings:"
echo "  grep -i 'cache miss\\|ai:' \"$STDERR_LOG\""
set -e
