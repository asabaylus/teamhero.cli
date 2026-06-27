# Slice 3 — Org-wide search PR counts through collect()

Labels: ready-for-agent
Type: AFK
Source: docs/prds/2026-06-13-identity-reconciliation.md

> Redaction: tests use the redacted fixtures from Slice 2; no real
> names/logins/orgs in committed files.

## What to build

Make the per-Person PR number authoritative and org-wide, surfaced through the
existing `MetricsProvider.collect()` seam.

End-to-end behavior:
- Count PRs via the GitHub **search API** by author login, all states, created
  within the window, summed across every login belonging to a Person. This
  replaces per-repo pull-list iteration as the source of the PR count; per-repo
  detail may still enrich titles where needed.
- Report PRs split into **merged** and **closed-unmerged**; never emit a single
  "closed" number.
- A Person's legacy account with zero PRs must not distort the count; an active
  login's PRs are counted in full regardless of how many repos they span or how
  deep the history goes (no pagination truncation of the count).
- Validate output against the Slice 2 golden fixture (the 22→26 case).

Verifiable on its own: `collect()` returns correct merged/closed-unmerged PR
counts per Person for fixtured search responses.

## Acceptance criteria

- [ ] PR counts come from the GitHub search API by author, all states, created
      in window.
- [ ] Counts sum across all logins of a Person.
- [ ] `prsMerged` and `prsClosedUnmerged` reported distinctly; no single
      "closed" figure.
- [ ] The 22→26 fragmented-lead case resolves to the search number.
- [ ] A zero-PR legacy account does not inflate or deflate the Person's count.
- [ ] Output matches the Slice 2 golden fixture for PRs.
- [ ] Unit tests at the `collect()` seam with fixtured search responses.

## Blocked by

- Slice 1 — Identity foundation: Person model + IdentityResolver
