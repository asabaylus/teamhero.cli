# Slice 9 — Methodology document

Labels: ready-for-agent
Type: AFK
Source: docs/prds/2026-06-13-identity-reconciliation.md

> Redaction: the document uses placeholders only; no real names/logins/orgs.

## What to build

`docs/METRICS_METHODOLOGY.md` — the authoritative explanation of how every
metric is derived, so anyone can trust and reproduce the numbers.

End-to-end behavior, the document must cover:
- **Methodology**: the Person model and identity-map reconciliation (how many
  names/emails/logins collapse to one human).
- **Metrics collection**: PRs via org-wide search by author (all states, split
  merged vs closed-unmerged); commits via per-repo email-matched enumeration
  aggregated monthly; LoC over authored commits.
- **What's included**: org-wide repos, external collaborators, all of a Person's
  logins.
- **What's excluded**: merge commits, generated/data files (with the exclusion
  set), unverified-attribution shortcuts, the Tickets column.
- **How it's derived**: the end-to-end pipeline and where the reconciliation
  report surfaces gaps.
- **Caveat**: these counts are a coarse, gameable sanity check, not a
  performance metric.

Verifiable on its own: the document exists, is internally consistent with the
shipped metric definitions, and uses placeholders only.

## Acceptance criteria

- [ ] `docs/METRICS_METHODOLOGY.md` created.
- [ ] Covers methodology, collection, inclusions, exclusions, and derivation per
      metric.
- [ ] Metric definitions match what slices 3–5 actually ship.
- [ ] Exclusion set documented.
- [ ] Sanity-check caveat included.
- [ ] Contains no real names/logins/orgs.

## Blocked by

- Slice 3 — Org-wide search PR counts through collect()
- Slice 4 — Monthly commits via per-repo email-matched enumeration
- Slice 5 — Code-LoC filtering (raw vs code)
