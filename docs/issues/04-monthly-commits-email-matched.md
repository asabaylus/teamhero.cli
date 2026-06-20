# Slice 4 — Monthly commits via per-repo email-matched enumeration

Labels: ready-for-agent
Type: AFK
Source: docs/prds/2026-06-13-identity-reconciliation.md

> Redaction: tests use redacted fixtures; no real names/logins/orgs committed.

## What to build

A monthly commit count per Person that correctly captures commits made under
unverified emails — the case GitHub's own attribution drops.

End-to-end behavior:
- Enumerate commits across **all** org repos for the window (reusing the
  existing scope enumeration), and attribute each commit by **author
  email/name matched locally** against the Person — never by GitHub's author
  attribution.
- Exclude merge commits (parent count ≥ 2, or committer is the GitHub noreply
  merge identity) from commits-authored.
- Aggregate counts by calendar month and expose them on the contribution metric
  set (`commitsByMonth`), surfaced through `collect()`.
- Remove the previous pagination cap; any repo that still truncates is recorded
  for the reconciliation report (Slice 6).
- Validate against the Slice 2 golden fixture (a fragmented contributor's legacy
  commits roll up to the right Person).

Verifiable on its own: `collect()` returns correct monthly commit totals per
Person for fixtured commit responses, including unverified-email commits.

## Acceptance criteria

- [ ] Commits enumerated across all org repos for the window.
- [ ] Attribution is by local email/name match, capturing unverified-email
      commits.
- [ ] Merge commits excluded from commits-authored.
- [ ] Counts aggregated by calendar month on the metric set.
- [ ] Pagination cap removed; truncated repos recorded for reconciliation.
- [ ] A fragmented contributor's legacy commits roll up to the correct Person.
- [ ] Output matches the Slice 2 golden fixture for monthly commits.
- [ ] Unit tests at the `collect()` seam with fixtured commit responses.

## Blocked by

- Slice 1 — Identity foundation: Person model + IdentityResolver
