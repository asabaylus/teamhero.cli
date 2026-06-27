# Slice 2 — Golden fixture + verification oracle

Labels: ready-for-agent
Type: HITL (requires computer-use verification + human judgement)
Source: docs/prds/2026-06-13-identity-reconciliation.md

> Redaction: real verified numbers and identities live ONLY in gitignored
> `tests/fixtures/local/` and `.teamhero/local/`. The committed fixture is a
> redacted/synthetic variant using placeholders.

## What to build

The hand-verified acceptance oracle that downstream engine slices (3–5) must
reproduce, and which doubles as the corrected spreadsheet data.

End-to-end behavior:
- For the current reporting period, verify per-Person PR counts, monthly commit
  counts, and code-LoC using the GitHub search API as the authoritative source
  and **computer use** (Claude Code harness) to read the GitHub search pages as
  an independent cross-check.
- Resolve the known fragmented contributors through the Slice 1 identity map so
  each human appears once with correct totals (e.g. the lead whose org-search
  PRs read 26, not the spreadsheet's 22).
- Save the real verified numbers to gitignored local fixtures; commit a
  redacted/synthetic variant in the standard expected-fixtures location for CI.
- Record any discrepancy between the API number and the web-UI number so
  auth-scope/private-repo gaps are caught before the engine is trusted.

Verifiable on its own: a fixture file of per-Person expected metrics plus a
short verification note showing API vs web-UI agreement.

## Acceptance criteria

- [ ] Per-Person expected PR / monthly-commit / code-LoC values produced for the
      period.
- [ ] Each value cross-checked via computer use against the GitHub search UI;
      mismatches noted and explained.
- [ ] Fragmented contributors resolve to one Person each with correct totals.
- [ ] Real numbers saved to gitignored local fixtures.
- [ ] A redacted/synthetic fixture variant committed as the acceptance oracle.
- [ ] Verification note records API-vs-UI agreement per spot-checked Person.

## Blocked by

- Slice 1 — Identity foundation: Person model + IdentityResolver
