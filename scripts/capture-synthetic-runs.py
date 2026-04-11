#!/usr/bin/env python3
"""
Capture N weeks of real teamhero runs into a local-only synthetic test
data directory. Contents are kept as-is (no scrubbing) — this directory
is .gitignore'd and exists only for local development reference.

Why this script exists:
    The caches at ~/.cache/teamhero/data-cache/ contain real runs grouped
    only by content hash, not by reporting week. This script groups them
    by week so a month of realistic run data can be referenced during
    future development (regression checks, new-feature fixtures, AI
    prompt experiments) without having to re-run the pipeline.

What it does:
    1. Inventories ~/.cache/teamhero/data-cache/**/*.json and groups files
       by the week they belong to (inferred from the reporting window
       embedded in the payload, falling back to `meta.cachedAt`).
    2. For each of N most recent sliding weekly buckets, copies the
       week's cache files, the matching generated report markdown, and
       the meeting notes whose filename date lands in the window.
    3. Writes a MANIFEST.json per week describing what's in it.
    4. Writes a top-level README.md summarising the capture.

Usage:
    python3 scripts/capture-synthetic-runs.py                       # defaults
    python3 scripts/capture-synthetic-runs.py --weeks 4 --end 2026-04-11
    python3 scripts/capture-synthetic-runs.py --dry-run             # inventory only

Output defaults to .local/synthetic-runs/ which is gitignored. Do NOT
point this at a tracked path — the output contains real identities,
real business prose, and real financial figures.

Re-run safety: idempotent. The output directory is wiped and rewritten
on each run.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import shutil
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

HOME = Path.home()
CACHE_ROOT = HOME / ".cache" / "teamhero" / "data-cache"
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = REPO_ROOT / ".local" / "synthetic-runs"
MEETING_NOTES_DIR = Path(
    "/mnt/c/Users/Asa/iCloudDrive/iCloud~md~obsidian/Lumata/Meetings"
)
REPORT_GLOB = "teamhero-report-lumata-health-*.md"

# Cache namespaces to include. Each corresponds to a subdirectory under
# data-cache/; the values describe what kind of artifact the namespace
# contains so manifest readers can tell structured inputs from AI outputs.
CACHE_NAMESPACES: dict[str, dict[str, str]] = {
    "metrics": {"kind": "input", "description": "GitHub PR/commit metrics per member"},
    "tasks": {"kind": "input", "description": "Asana task summaries per member"},
    "visible-wins": {
        "kind": "input",
        "description": "Project tasks + meeting notes + per-project associations",
    },
    "loc": {"kind": "input", "description": "Aggregated LOC counts per member"},
    "loc-repo": {"kind": "input", "description": "Per-repo LOC counts"},
    "visible-wins-extraction": {
        "kind": "ai-output",
        "description": "AI-extracted accomplishment bullets from visible-wins data",
    },
    "team-highlight": {
        "kind": "ai-output",
        "description": "AI-synthesized team highlight summary",
    },
    "member-highlights": {
        "kind": "ai-output",
        "description": "AI-synthesized per-member highlight paragraphs",
    },
    "technical-wins": {
        "kind": "ai-output",
        "description": "AI-synthesized Technical/Foundational Wins section",
    },
    "audit": {
        "kind": "ai-output",
        "description": "Discrepancy audit results per report section",
    },
}

# ---------------------------------------------------------------------------
# Week bucketing
# ---------------------------------------------------------------------------


@dataclass
class WeekBucket:
    label: str  # e.g. "week-2026-04-11"
    start: dt.date  # inclusive
    end: dt.date  # inclusive
    cache_files: list[Path] = field(default_factory=list)
    report_markdown: Path | None = None
    meeting_notes: list[Path] = field(default_factory=list)


def parse_iso_utc(value: str) -> dt.datetime:
    """Parse an ISO-8601 UTC timestamp with optional 'Z' suffix."""
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return dt.datetime.fromisoformat(value)


def derive_weeks(end_date: dt.date, count: int) -> list[WeekBucket]:
    """Build N sliding weekly buckets ending at `end_date` inclusive.
    Each bucket spans 7 calendar days: end_date - 6 .. end_date.
    Returns oldest-first.
    """
    buckets: list[WeekBucket] = []
    for i in range(count):
        week_end = end_date - dt.timedelta(days=7 * i)
        week_start = week_end - dt.timedelta(days=6)
        buckets.append(
            WeekBucket(
                label=f"week-{week_end.isoformat()}",
                start=week_start,
                end=week_end,
            )
        )
    return list(reversed(buckets))


# ---------------------------------------------------------------------------
# Cache → week assignment
# ---------------------------------------------------------------------------


def infer_window_from_payload(data: dict) -> tuple[dt.date, dt.date] | None:
    """Best-effort pull of a reporting window out of a cache payload.
    Different namespaces expose the window differently (or not at all);
    returns (start, end) when we can find one.
    """
    d = data.get("data") if isinstance(data.get("data"), dict) else data
    if not isinstance(d, dict):
        return None

    # Visible-wins style: notes with .date fields
    notes = d.get("notes")
    if isinstance(notes, list):
        dates: list[dt.date] = []
        for n in notes:
            if isinstance(n, dict) and isinstance(n.get("date"), str):
                try:
                    dates.append(dt.date.fromisoformat(n["date"][:10]))
                except ValueError:
                    pass
        if dates:
            return min(dates), max(dates)

    # Metrics style: walk members' rawCommits for committedAt
    members = d.get("members")
    if isinstance(members, list):
        dates = []
        for m in members:
            if not isinstance(m, dict):
                continue
            raw_commits = m.get("rawCommits") or []
            for c in raw_commits:
                if isinstance(c, dict) and isinstance(c.get("committedAt"), str):
                    try:
                        dates.append(dt.date.fromisoformat(c["committedAt"][:10]))
                    except ValueError:
                        pass
        if dates:
            return min(dates), max(dates)

    return None


def assign_cache_file_to_bucket(
    cache_file: Path,
    buckets: list[WeekBucket],
) -> WeekBucket | None:
    """Assign a cache file to the week whose range contains its payload
    window (preferred) or `cachedAt` timestamp (fallback).
    """
    try:
        raw = json.loads(cache_file.read_text())
    except (OSError, json.JSONDecodeError):
        return None

    meta = raw.get("meta", {}) if isinstance(raw, dict) else {}
    cached_at_str = meta.get("cachedAt") if isinstance(meta, dict) else None

    window = infer_window_from_payload(raw) if isinstance(raw, dict) else None
    if window is not None:
        payload_end = window[1]
    elif cached_at_str:
        try:
            payload_end = parse_iso_utc(cached_at_str).date()
        except ValueError:
            return None
    else:
        return None

    for bucket in buckets:
        if bucket.start <= payload_end <= bucket.end:
            return bucket
    return None


# ---------------------------------------------------------------------------
# Meeting notes
# ---------------------------------------------------------------------------

# Meeting note filenames typically contain "YYYY MM DD" or "YYYY-MM-DD".
DATE_IN_FILENAME = re.compile(r"(\d{4})[-\s_](\d{2})[-\s_](\d{2})")


def meeting_note_date(path: Path) -> dt.date | None:
    m = DATE_IN_FILENAME.search(path.name)
    if not m:
        return None
    try:
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def discover_meeting_notes(
    directory: Path,
    buckets: list[WeekBucket],
) -> None:
    if not directory.exists():
        print(f"[warn] meeting notes dir not found: {directory}", file=sys.stderr)
        return
    for md in directory.iterdir():
        if not md.is_file() or md.suffix.lower() != ".md":
            continue
        file_date = meeting_note_date(md)
        if not file_date:
            continue
        for bucket in buckets:
            if bucket.start <= file_date <= bucket.end:
                bucket.meeting_notes.append(md)
                break


# ---------------------------------------------------------------------------
# Report markdowns
# ---------------------------------------------------------------------------


def discover_report_markdowns(repo_root: Path, buckets: list[WeekBucket]) -> None:
    report_date_re = re.compile(r"teamhero-report-lumata-health-(\d{4}-\d{2}-\d{2})\.md")
    for md in repo_root.glob(REPORT_GLOB):
        m = report_date_re.search(md.name)
        if not m:
            continue
        try:
            report_date = dt.date.fromisoformat(m.group(1))
        except ValueError:
            continue
        for bucket in buckets:
            if bucket.start <= report_date <= bucket.end:
                # Prefer the most recent report markdown mtime in the window
                if (
                    bucket.report_markdown is None
                    or bucket.report_markdown.stat().st_mtime < md.stat().st_mtime
                ):
                    bucket.report_markdown = md
                break


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------


def build_bucket_manifest(
    bucket: WeekBucket,
    cache_namespace_counts: dict[str, int],
    meeting_note_count: int,
    report_markdown: str | None,
) -> dict[str, Any]:
    return {
        "label": bucket.label,
        "reportingWindow": {
            "start": bucket.start.isoformat(),
            "end": bucket.end.isoformat(),
        },
        "cacheFilesByNamespace": dict(sorted(cache_namespace_counts.items())),
        "cacheFilesTotal": sum(cache_namespace_counts.values()),
        "meetingNotesCount": meeting_note_count,
        "reportMarkdown": report_markdown,
        "scrubbed": False,
        "notes": (
            "Raw, unscrubbed capture from the live dev machine's cache. "
            "Contains real identities, real business prose, and real dollar "
            "figures. Never commit — the enclosing .local/ directory is "
            "gitignored for this reason."
        ),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Capture N weeks of real teamhero runs into .local/synthetic-runs/",
    )
    parser.add_argument(
        "--weeks", type=int, default=4, help="Number of weekly buckets to capture (default: 4)"
    )
    parser.add_argument(
        "--end",
        type=str,
        default="2026-04-11",
        help="Last day of the most recent bucket, YYYY-MM-DD (default: 2026-04-11)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output directory (default: {DEFAULT_OUTPUT.relative_to(REPO_ROOT)})",
    )
    parser.add_argument(
        "--cache-root",
        type=Path,
        default=CACHE_ROOT,
        help="teamhero cache root (default: ~/.cache/teamhero/data-cache)",
    )
    parser.add_argument(
        "--meeting-notes",
        type=Path,
        default=MEETING_NOTES_DIR,
        help="Meeting notes source directory",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Inventory only; do not write any files",
    )
    args = parser.parse_args()

    try:
        end_date = dt.date.fromisoformat(args.end)
    except ValueError:
        print(f"[error] --end must be YYYY-MM-DD, got {args.end!r}", file=sys.stderr)
        return 2

    # Safety check: refuse to write anywhere other than .local/** or a
    # path the user explicitly opted into on the command line. This is
    # the belt-and-suspenders backup to the .gitignore entry.
    output_abs = args.output.resolve()
    repo_local = (REPO_ROOT / ".local").resolve()
    if not args.dry_run and output_abs != args.output.resolve():
        pass  # no-op, just a parity line
    if (
        not args.dry_run
        and not str(output_abs).startswith(str(repo_local))
        and args.output == DEFAULT_OUTPUT
    ):
        print(
            f"[error] refusing to write to {output_abs} — must be under .local/",
            file=sys.stderr,
        )
        return 2

    buckets = derive_weeks(end_date, args.weeks)
    print(f"[info] Building {args.weeks} weekly buckets ending {end_date}:")
    for b in buckets:
        print(f"  - {b.label}: {b.start} .. {b.end}")

    # Discover side-artifacts
    discover_meeting_notes(args.meeting_notes, buckets)
    discover_report_markdowns(REPO_ROOT, buckets)

    # Walk the cache and assign files to buckets
    for namespace in CACHE_NAMESPACES:
        ns_dir = args.cache_root / namespace
        if not ns_dir.exists():
            continue
        for json_file in ns_dir.iterdir():
            if json_file.suffix != ".json":
                continue
            bucket = assign_cache_file_to_bucket(json_file, buckets)
            if bucket is not None:
                bucket.cache_files.append(json_file)

    # Print inventory summary
    print("\n[info] Inventory:")
    for b in buckets:
        ns_counts: dict[str, int] = defaultdict(int)
        for f in b.cache_files:
            ns_counts[f.parent.name] += 1
        ns_summary = ", ".join(f"{k}={v}" for k, v in sorted(ns_counts.items()))
        print(
            f"  - {b.label}: cache={len(b.cache_files)} ({ns_summary or 'none'}) "
            f"mn={len(b.meeting_notes)} "
            f"report={b.report_markdown.name if b.report_markdown else 'MISSING'}"
        )

    if args.dry_run:
        print("\n[dry-run] No files written.")
        return 0

    # Wipe + rewrite output dir
    if args.output.exists():
        print(f"\n[info] Wiping existing {args.output}")
        shutil.rmtree(args.output)
    args.output.mkdir(parents=True)

    top_level_readme_lines: list[str] = [
        "# Synthetic Runs — Local Capture of Real Teamhero Runs",
        "",
        f"Captured on {dt.datetime.now(dt.timezone.utc).isoformat()}Z by "
        "`scripts/capture-synthetic-runs.py`.",
        "",
        "> **This directory is gitignored.** It contains real identities, "
        "real business prose, and real financial figures from live teamhero "
        "runs. Never commit it, never copy it elsewhere, never share it.",
        "",
        "## What's in here",
        "",
        "Four weeks of real teamhero pipeline runs, kept raw so they accurately "
        "represent what the live pipeline produces. Use as a local reference "
        "for future development — regression shapes, new-feature fixtures, "
        "AI prompt experiments, and as evidence of real edge cases.",
        "",
        "Per-week contents:",
        "- `cache/<namespace>/*.json` — raw cache payloads (inputs + AI outputs)",
        "- `meeting-notes/*.md` — Google Meet transcripts scoped to the week",
        "- `report.md` — the generated teamhero markdown report for the week",
        "- `MANIFEST.json` — inventory for the week",
        "",
        "## Cache namespaces",
        "",
    ]
    for ns, info in CACHE_NAMESPACES.items():
        top_level_readme_lines.append(f"- `{ns}` ({info['kind']}) — {info['description']}")
    top_level_readme_lines.extend(
        [
            "",
            "## Regenerating",
            "",
            "```",
            "python3 scripts/capture-synthetic-runs.py --weeks 4 --end YYYY-MM-DD",
            "```",
            "",
            "The output directory is wiped and rewritten on each run.",
            "",
            "## Weeks captured",
            "",
        ]
    )

    overall_totals = {"cacheFiles": 0, "meetingNotes": 0, "reportsFound": 0}

    for bucket in buckets:
        bucket_root = args.output / bucket.label
        bucket_root.mkdir()

        # Copy cache files, grouped by namespace, unmodified
        cache_ns_counts: dict[str, int] = defaultdict(int)
        for src in bucket.cache_files:
            ns = src.parent.name
            dst = bucket_root / "cache" / ns / src.name
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            cache_ns_counts[ns] += 1

        # Copy meeting notes
        if bucket.meeting_notes:
            (bucket_root / "meeting-notes").mkdir()
            for mn in bucket.meeting_notes:
                dst = bucket_root / "meeting-notes" / mn.name
                shutil.copy2(mn, dst)

        # Copy the report markdown (if present)
        report_basename: str | None = None
        if bucket.report_markdown is not None:
            dst = bucket_root / "report.md"
            shutil.copy2(bucket.report_markdown, dst)
            report_basename = bucket.report_markdown.name
            overall_totals["reportsFound"] += 1

        # Write the manifest
        manifest = build_bucket_manifest(
            bucket, dict(cache_ns_counts), len(bucket.meeting_notes), report_basename
        )
        (bucket_root / "MANIFEST.json").write_text(
            json.dumps(manifest, indent=2, sort_keys=True)
        )

        overall_totals["cacheFiles"] += sum(cache_ns_counts.values())
        overall_totals["meetingNotes"] += len(bucket.meeting_notes)

        top_level_readme_lines.extend(
            [
                f"### `{bucket.label}` — {bucket.start} to {bucket.end}",
                "",
                f"- cache files: {sum(cache_ns_counts.values())} "
                f"({', '.join(f'{k}={v}' for k, v in sorted(cache_ns_counts.items())) or 'none'})",
                f"- meeting notes: {len(bucket.meeting_notes)}",
                f"- generated report: {report_basename or 'MISSING'}",
                "",
            ]
        )

    top_level_readme_lines.extend(
        [
            "## Totals",
            "",
            f"- cache files: {overall_totals['cacheFiles']}",
            f"- meeting notes: {overall_totals['meetingNotes']}",
            f"- reports: {overall_totals['reportsFound']}/{args.weeks}",
            "",
        ]
    )

    (args.output / "README.md").write_text("\n".join(top_level_readme_lines))

    relative_output = (
        args.output.relative_to(REPO_ROOT)
        if args.output.is_absolute() and args.output.is_relative_to(REPO_ROOT)
        else args.output
    )
    print(
        f"\n[done] Wrote {overall_totals['cacheFiles']} cache files, "
        f"{overall_totals['meetingNotes']} meeting notes, "
        f"{overall_totals['reportsFound']}/{args.weeks} reports "
        f"to {relative_output}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
