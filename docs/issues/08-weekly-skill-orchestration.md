# Slice 8 — Weekly skill (orchestration)

Labels: ready-for-agent
Type: AFK
Source: docs/prds/2026-06-13-identity-reconciliation.md

> Redaction: skill and its tests contain no real names/logins/orgs; real
> identity map and workbook are read from gitignored local data at run time.

## What to build

A repeatable weekly flow that reproduces the spreadsheet update unattended,
ready to be scheduled. Orchestration only — no new business logic.

End-to-end behavior:
- Sequence: scope (all org repos) → `collect()` (reconciled metrics) →
  reconciliation report → spreadsheet writer → emit updated workbook + report.
- Each run appends the next week's PR/code-LoC block and refreshes the current
  month's commit column; re-running a week is idempotent.
- Renders the caveat that these counts are a coarse sanity check, not a
  performance metric.
- Determinstic path uses the search API; browser cross-check is optional and not
  required for the unattended run.

Verifiable on its own: a contract test of the skill's flags and output shape,
plus a dry-run producing an updated workbook + reconciliation report from
fixtures.

## Acceptance criteria

- [ ] Skill sequences scope → collect → reconcile → write → emit.
- [ ] Weekly run appends the next week block and refreshes current-month
      commits.
- [ ] Re-running the same week is idempotent.
- [ ] Sanity-check caveat rendered on output.
- [ ] Unattended path is deterministic (search API; no required browser step).
- [ ] Contract test covers flags/output shape; no business-logic assertions in
      the skill.

## Blocked by

- Slice 6 — Structured reconciliation report output
- Slice 7 — Spreadsheet writer (pure module)
