# 1. Person identity model (multi-login, email-matched commits)

Date: 2026-06-13
Status: Accepted

## Context

Team Hero metrics mis-attribute contributors. The legacy `UserIdentity`
(`src/models/user-identity.ts`) holds exactly one `github.login` per person and
keys all lookups on it. Real contributors span multiple git author names,
emails, and even multiple GitHub accounts (e.g. one person with an active login
plus a legacy account; another committing under two author names from one
personal email).

Two independent failure modes were confirmed:

1. **Identity fragmentation** — one human split across names/emails/logins.
2. **Collection-method drift** — PR counts came from per-repo `pulls.list`
   iteration (capped at 5 pages, matched on a single login), which diverges from
   the org-wide `is:pr author:X` search that reflects reality (one lead showed
   22 vs an actual 26).

## Decision

Replace single-login `UserIdentity` with a canonical **Person** carrying
`logins[]`, `emails[]`, `names[]`. Resolution unions every commit/PR onto the
Person whose login, email, or name set matches (union-find).

- **PRs**: counted org-wide via the GitHub **search API** by author login, all
  states, created in window. PR authors are always real logins, so search is
  authoritative and fixes the per-repo undercount.
- **Commits**: enumerated **per repo** across all org repos and attributed by
  **author email/name matched locally** against the Person — never by GitHub's
  author attribution, which zeroes out unverified emails (the exact bug). Merge
  commits (≥2 parents or committer `GitHub <noreply>`) are excluded.
- Back-compat with the old single-login env shape is **not** preserved.

## Consequences

- Accurate attribution for fragmented identities and consistent org-wide counts.
- Commit enumeration across all org repos is the heaviest API job; the weekly
  skill must budget for it, and the reconciliation report flags capped repos and
  unmatched emails.
- A version-controlled identity map must be maintained as new git configs appear
  (real entries kept in local, gitignored data only).
