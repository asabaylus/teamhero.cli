# Slice 7 — Spreadsheet writer (pure module)

Labels: ready-for-agent
Type: AFK
Source: docs/prds/2026-06-13-identity-reconciliation.md

> Redaction: tests run against a REDACTED copy of the tracking-sheet fixture.
> The real workbook stays in gitignored local data; no real names/logins
> committed.

## What to build

A pure module that takes per-Person metrics plus the existing workbook and
produces an updated Data sheet for the operator to re-upload (direct cloud write
is out of scope).

End-to-end behavior:
- Write corrected weekly **PR** and **code-LoC** cells from the reconciled
  metrics.
- Append **monthly commit columns** to the right of the existing weekly blocks,
  one value per engineer row.
- Recompute row totals; leave the **Tickets** column untouched.
- Be **idempotent**: re-writing the same week overwrites rather than duplicates.
- Produce the updated workbook (or a cell-level change set) locally.

Verifiable on its own: given metrics + a redacted workbook fixture, the module
emits the expected updated workbook / cell diff.

## Acceptance criteria

- [ ] Corrected weekly PR and code-LoC cells written from reconciled metrics.
- [ ] Monthly commit columns appended; one value per engineer row.
- [ ] Row totals recomputed.
- [ ] Tickets column left unchanged.
- [ ] Re-running the same week overwrites rather than duplicating (idempotent).
- [ ] Updated workbook / change set produced locally for manual re-upload.
- [ ] Unit tests against a redacted tracking-sheet fixture.

## Blocked by

- Slice 3 — Org-wide search PR counts through collect()
- Slice 4 — Monthly commits via per-repo email-matched enumeration
- Slice 5 — Code-LoC filtering (raw vs code)
