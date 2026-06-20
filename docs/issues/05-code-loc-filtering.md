# Slice 5 — Code-LoC filtering (raw vs code)

Labels: ready-for-agent
Type: AFK
Source: docs/prds/2026-06-13-identity-reconciliation.md

> Redaction: tests use redacted fixtures; no real names/logins/orgs committed.

## What to build

A line-of-code number that reflects hand-written code rather than checked-in
data/generated files.

End-to-end behavior:
- Over authored (non-merge) commits, sum additions/deletions with
  generated/data files excluded by a single, centrally-defined exclusion set:
  `*.csv`, `*.json`, `*.lock`, `uv.lock`, `pnpm-lock.yaml`, `*.ipynb`, `*.txt`,
  `*tokenizer*`, `*.bin`, `*.onnx`, model artifacts, vendored OpenAPI specs,
  `**/migrations/*.Designer.cs`.
- Report both **rawLoc** and **codeLoc** distinctly on the contribution metric
  set, surfaced through `collect()`.
- A row dominated by data files (e.g. ~1.16M raw lines from a single week of
  JSON/CSV/tokenizer artifacts) reports a much smaller code-LoC.
- Validate against the Slice 2 golden fixture.

Verifiable on its own: `collect()` returns `rawLoc` and `codeLoc` per Person for
fixtured commit/file-stat responses, with data files excluded from code-LoC.

## Acceptance criteria

- [ ] Exclusion set defined in one place and reused.
- [ ] `rawLoc` and `codeLoc` reported distinctly.
- [ ] Data/generated files excluded from `codeLoc`; merge commits excluded.
- [ ] The ~1.16M-raw case yields a far smaller `codeLoc`.
- [ ] Output matches the Slice 2 golden fixture for LoC.
- [ ] Unit tests at the `collect()` seam with fixtured file-stat responses.

## Blocked by

- Slice 4 — Monthly commits via per-repo email-matched enumeration
