---
name: teamhero-weekly
description: Update the weekly engineering tracking spreadsheet with reconciled, accurate per-engineer GitHub metrics — org-wide PR counts (merged vs closed-unmerged), monthly commit counts, and hand-written code LoC, each rolled up to a canonical Person across all their git names, emails, and GitHub accounts. Use this when the user wants to run the weekly metrics update, refresh the tracking sheet, reconcile contributor identities, or asks anything about the per-engineer PR/commit/LoC numbers and how they were derived.
---

# teamhero-weekly — bounded-context skill

This skill is the conversational wrapper for the weekly metrics flow exposed by
the `teamhero weekly` CLI. It translates the user's intent into the right
invocation and surfaces results in plain English. **It contains no business
logic of its own** — all reconciliation and metric logic lives in
`src/services/metrics.service.ts`, `src/services/identity-resolver.service.ts`,
and the pure helpers under `src/lib/` (`pr-search`, `commit-attribution`,
`code-loc`, `spreadsheet-writer`). This skill only routes.

The bounded context is **keeping the tracking spreadsheet accurate, weekly**.
Anything outside that (hiring → `teamhero-interview`; the full narrative report →
`teamhero report`) belongs to a different skill.

## Always present this caveat to the user

Before showing numbers, state plainly: **these per-engineer PR / commit / LoC
counts are a coarse, gameable sanity check — not a performance metric.** They
exist to catch data-quality problems and gross anomalies, not to rank people.
Manage on outcomes. (See `docs/METRICS_METHODOLOGY.md`.)

## What it does (the flow)

`teamhero weekly` sequences, with no new business logic in this skill:

1. **Scope** — resolve the org, all its repositories, and members.
2. **Collect** — org-wide PR counts via the GitHub search API (merged vs
   closed-unmerged), per-repo email-matched monthly commits (merge commits
   excluded), and raw-vs-code LoC over authored commits.
3. **Reconcile** — resolve every commit/PR to a canonical **Person** via the
   identity map, and emit a reconciliation report: unmapped emails/logins,
   duplicate accounts (a Person with >1 login), unverified external emails, and
   any repo that hit a fetch cap.
4. **Write** — write corrected weekly **PR** and **code-LoC** cells into the
   Data sheet, append the current month's **commit** column, recompute totals,
   and leave the **Tickets** column untouched. Re-running a week overwrites
   rather than duplicates (idempotent).
5. **Emit** — produce the updated workbook locally for the operator to
   re-upload, plus the reconciliation report.

## Routing

| User intent | Invocation |
|---|---|
| Run this week's update | `teamhero weekly --since <YYYY-MM-DD> --until <YYYY-MM-DD>` |
| Re-run a week (idempotent) | same command with the same window |
| Just the reconciliation report | `teamhero weekly --reconcile-only` |
| Dry run (no workbook write) | `teamhero weekly --dry-run` |

## Local-only data (redaction)

Real identities and the real workbook are read at run time **only** from
gitignored local data:

- Identity map: `.teamhero/local/identity-map.yaml`
- Tracking workbook: `tests/fixtures/local/` (or the operator's configured path)

This skill and its outputs must never contain real names, logins, or org names.
When reporting results conversationally, refer to people by role/initials unless
the user is clearly the data owner reviewing their own org. The committed example
map (`.teamhero/identity-map.example.yaml`) uses placeholders only.

## After a run

- Summarize the reconciliation report first: how many identities need mapping,
  any duplicate accounts, any capped repos — these gate trust in the numbers.
- Then point the user to the updated workbook for re-upload.
- If any Person reads zero, distinguish a real zero from an unmapped identity
  (the latter appears in the reconciliation report, never as a zero Person).
