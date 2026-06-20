# Slice 6 — Structured reconciliation report output

Labels: ready-for-agent
Type: AFK
Source: docs/prds/2026-06-13-identity-reconciliation.md

> Redaction: tests use redacted fixtures; no real names/logins/orgs committed.

## What to build

A first-class, structured reconciliation report so the identity map's gaps are
visible every run.

End-to-end behavior:
- Extend `MetricsCollectionResult` with a structured `reconciliation` field
  (evolving the existing free-text warnings) carrying: unmapped emails/logins
  with their commit/PR counts ("map these"), every Person with more than one
  login (duplicate-account flag), raw external emails not verified on their
  account ("ask contributor to fix git config"), and any repo that hit a fetch
  cap during commit enumeration.
- Surface the report through `collect()` and render it on output.

Verifiable on its own: `collect()` returns a populated reconciliation report for
fixtured inputs containing unmapped identities, a duplicate-login Person, an
unverified external email, and a capped repo.

## Acceptance criteria

- [ ] `reconciliation` field added to the collection result with the four
      categories.
- [ ] Unmapped emails/logins listed with counts.
- [ ] Persons with >1 login flagged as duplicate accounts.
- [ ] Raw external emails not verified on their account flagged.
- [ ] Repos that hit a fetch cap flagged.
- [ ] Report rendered on output.
- [ ] Unit tests at the `collect()` seam exercising all four categories.

## Blocked by

- Slice 3 — Org-wide search PR counts through collect()
- Slice 4 — Monthly commits via per-repo email-matched enumeration
