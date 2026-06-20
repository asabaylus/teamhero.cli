# Plan: Contributor Identity Reconciliation & Accurate Tracking-Spreadsheet Metrics

Date: 2026-06-13
Status: Complete (shipped in PR #16, merged to main; this doc is the historical design record)
State file: `.teamhero/plan-state.json` (machine-readable progress for handoff)

> **Redaction rule:** committed files contain NO company-specific names, logins,
> or org/company names. Real values live only in gitignored local data
> (`.teamhero/local/`, `tests/fixtures/local/`); see the local redaction key.
> Placeholders: the org, Vendor Pod, Person A/B/C/D, `login-a` … etc.

This plan is self-contained for any agent/session resuming the work. Decisions
below were settled in a grilling session; see `CONTEXT.md` (glossary) and
`docs/adr/0001-person-identity-model.md` (rationale).

## Objectives

1. Update & verify corrected data in the **tracking spreadsheet** (PRs,
   monthly commits, filtered LoC). Tickets are out of scope.
2. Create a **scheduled weekly skill** that reproduces the sheet updates.
3. Correct Team Hero CLI data collection so reports are accurate, verified
   against the real roster (Playwright cross-check).

## Settled decisions

| Topic | Decision |
|---|---|
| Tracked PR | Org-wide GitHub **search API** by author login, all states, created-in-window. Fixes per-repo undercount (one lead 22→26). |
| Identity model | Replace single-login `UserIdentity` with **Person** `{logins[], emails[], names[]}`, union-find resolution. No back-compat. |
| Verification | Search API = authoritative collection everywhere. **Computer use** (Claude Code harness) is the verification oracle during interactive/golden-fixture runs. **Playwright** is the optional automatable cross-check for unattended/scheduled runs. |
| Sheet write | Edit **local .xlsx**, human re-uploads (Graph API deferred). |
| Monthly commits | New per-month commit columns appended to the **Data** sheet. |
| Commit collection | **Per-repo enumeration across all org repos**, attribute by **author email/name matched locally**, exclude merge commits, caps removed. |
| LoC | **Replace** weekly LoC with filtered **code-LoC** (exclusion globs). |
| Tickets | Out of scope; leave untouched. |
| Identity map seed | Roster from Data sheet (col A name, col L login) + spec-doc fragments + noreply-login parsing, stored in gitignored local data. Reconciliation report surfaces gaps. |
| Weekly skill | Append a new week block each run, refresh current-month commits, idempotent re-runs. |
| Plan storage | This doc + `.teamhero/plan-state.json`, committed to git. |

## Exclusion globs (code-LoC)

`*.csv`, `*.json`, `*.lock`, `uv.lock`, `pnpm-lock.yaml`, `*.ipynb`, `*.txt`,
`*tokenizer*`, `*.bin`, `*.onnx`, model artifacts, vendored OpenAPI specs,
`**/migrations/*.Designer.cs`. Report raw vs code LoC distinctly; headline code LoC.

## Sequence (golden-fixture-first)

1. **Identity map** — build the identity map (real entries in gitignored
   `.teamhero/local/identity-map.yaml`): seed from the Data-sheet roster, augment
   with the fragmented-contributor cases from the spec docs, parse noreply
   logins. (Unblocks everything.)
2. **Golden fixture** — hand-verify per-Person PR / monthly-commit / code-LoC
   numbers for the current period using the search API + Playwright. Save real
   values to gitignored `tests/fixtures/local/`; commit only a redacted/synthetic
   variant. This *is* the corrected sheet data **and** the engine's acceptance test.
3. **Engine** — implement Person model; switch PRs to org-search; commits to
   per-repo email-matched enumeration with merge exclusion; LoC glob filtering;
   reconciliation report. Done when output == golden fixture.
4. **Sheet update** — write corrected PR/LoC + new monthly-commit columns into
   the local `T9-Box Prep.xlsx`; re-upload.
5. **Weekly skill** — package the flow (append week block, refresh month commits,
   idempotent) for scheduled execution.
6. **Methodology doc** — `docs/METRICS_METHODOLOGY.md`: methodology, metrics
   collection, what's included, what's excluded, how each is derived.

## Acceptance criteria

- Person A (lead) rolls up to one Person (`login-a`); PR count matches org search
  (e.g. 26, not 22). Two author names collapse by email; no Person named after a
  bare handle.
- Person B: one Person, `login-b` + legacy account flagged as duplicate; legacy
  account's commits attributed, but its 0 PRs don't inflate the PR column.
- Person C: commits across the raw email + the noreply login roll up.
- `<digits>+login@users.noreply.github.com` parses to `login`.
- Merge commits excluded from commits-authored and LoC.
- A data-dominated row (~1.16M raw LoC) reports code-LoC far lower.
- Person D: PRs merged ≈17 / closed-unmerged ≈11, never a single "closed = 28".
- No real contributor reported at zero; unmapped identities go to a review queue.
- Engine output matches the golden fixture; Playwright cross-check agrees.

## Caveat (render on outputs)

Per-developer commit/PR/LoC counts are a coarse, gameable **sanity check, not a
performance metric** — especially for vendor pods. Manage on outcomes.
