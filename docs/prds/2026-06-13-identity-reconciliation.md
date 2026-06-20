# PRD: Contributor Identity Reconciliation & Accurate Metrics

Status: Complete (shipped in PR #16, merged to main; this doc is the historical design record)
Date: 2026-06-13
Related: `CONTEXT.md` (glossary), `docs/adr/0001-person-identity-model.md`,
`docs/plans/2026-06-13-identity-reconciliation.md`

> **Redaction rule:** this document contains NO company-specific names, logins,
> or org/company names. Real values live only in gitignored local data
> (`.teamhero/local/`, `tests/fixtures/local/`). Placeholders used: "the org",
> "Vendor Pod", Person A/B/C/D, `login-a` … etc.

## Problem Statement

Team Hero produces per-engineer engineering metrics from GitHub, surfaced in CLI
reports and an external tracking spreadsheet. Today those numbers are wrong in
two independent ways, and the errors are large enough to mislead about who is
contributing:

- **My PR counts undercount real work.** A lead's PRs read as 22 in the
  spreadsheet but the org-wide search shows 26. PRs are collected by walking each
  repo's pull list (capped at 5 pages, matched to a single login), so any PR in
  an unscanned repo or beyond the page cap silently disappears.
- **One human is split across many identities.** A single person commits under
  multiple author names, multiple emails, and even multiple GitHub accounts (an
  active login plus a legacy account). Because the model keys on exactly one
  login, their work is fragmented and sometimes shows zero despite hundreds of
  commits.
- **Line-of-code numbers are dominated by data files.** A row can show ~1.16M
  lines in a single week because checked-in `*.json`/`*.csv`/tokenizer artifacts
  are counted as code.
- **There is no monthly commit signal**, and no repeatable, auditable way to keep
  the spreadsheet current week over week.

A contributor showing zero is currently indistinguishable from a contributor we
simply failed to attribute — and that ambiguity has produced incorrect
conclusions about individual performance, especially for an external Vendor Pod.

## Solution

Resolve every commit and pull request to a canonical **Person** and compute
precise, well-defined metrics per Person, then keep the tracking spreadsheet
accurate on a weekly cadence.

- A **Person** unifies many git author names, emails, and GitHub logins via a
  human-maintained **identity map** (real entries kept in local, gitignored
  data).
- **Tracked PRs** are counted org-wide via the GitHub search API by author,
  matching what a human sees in the browser.
- **Commits** are enumerated per repo across all org repos and attributed by
  author email/name matched locally (never by GitHub's own attribution, which
  zeroes out unverified emails), excluding merge commits.
- **LoC** is filtered to hand-written code, excluding generated/data files.
- A **reconciliation report** surfaces every unmapped identity, duplicate
  account, and unverified external email so the map stays current.
- A **weekly skill** reproduces the spreadsheet update unattended, and a
  **methodology document** explains exactly how every number is derived.

The numbers are explicitly labelled a coarse sanity check, not a performance
score.

## User Stories

1. As an engineering leader, I want each person's work unified across all their
   git names, emails, and GitHub accounts, so that one human appears once with a
   correct total.
2. As an engineering leader, I want a contributor who has hundreds of commits to
   never read as zero, so that I don't draw false conclusions about their output.
3. As an engineering leader, I want weekly PR counts to match the org-wide GitHub
   search, so that the spreadsheet agrees with what I can verify in the browser.
4. As an engineering leader, I want PRs counted across every org repo, so that
   work in a repo I forgot to list is not silently dropped.
5. As an engineering leader, I want a PR in a large/active repo to count even
   when it falls beyond the old pagination cap, so that high performers aren't
   truncated.
6. As an engineering leader, I want two author names on the same email collapsed
   into one Person, so that a personal handle and a real name aren't two rows.
7. As an engineering leader, I want one person's multiple emails unioned onto a
   single Person, so that their work isn't split into part-time-looking buckets.
8. As an engineering leader, I want commits under an unverified external email
   still attributed to the right Person, so that GitHub's inability to link the
   email doesn't erase the work.
9. As an engineering leader, I want a person with two GitHub accounts mapped to
   one Person and flagged as a duplicate, so that I can drive account cleanup.
10. As an engineering leader, I want a legacy account's commits attributed but its
    zero PRs to not distort the PR column, so that historical and current
    activity are both represented correctly.
11. As an engineering leader, I want `<digits>+login@users.noreply.github.com`
    parsed to its login automatically, so that well-configured commits seed the
    identity map without manual effort.
12. As an engineering leader, I want merge-button commits excluded from
    commits-authored and LoC, so that whoever clicks "merge" isn't credited with
    authoring the code.
13. As an engineering leader, I want a bare display-name that is neither a real
    name nor an account to never become its own Person, so that ghost rows don't
    appear.
14. As an engineering leader, I want external collaborators included alongside org
    members, so that Vendor Pod contractors are never silently dropped from
    org-wide views.
15. As an engineering leader, I want monthly commit counts per engineer, so that I
    have a cadence-appropriate volume signal next to weekly PRs.
16. As an engineering leader, I want LoC limited to hand-written code, so that a
    checked-in data file doesn't inflate someone to a million lines.
17. As an engineering leader, I want raw LoC and code LoC reported distinctly, so
    that I can see how much of a total was data versus code.
18. As an engineering leader, I want PRs merged and PRs closed-unmerged reported
    separately, so that abandoned PRs aren't counted as delivered work.
19. As an engineering leader, I want a reconciliation report each run listing
    unmapped emails/logins with counts, so that I know exactly what to add to the
    identity map.
20. As an engineering leader, I want the report to flag every Person with more
    than one login, so that duplicate accounts get cleaned up.
21. As an engineering leader, I want the report to flag raw external emails not
    verified on their account, so that I can ask contributors to fix their git
    config.
22. As an engineering leader, I want any commit repo that hit a fetch cap flagged,
    so that I know when a number might be incomplete.
23. As an operator, I want the corrected PR, code-LoC, and monthly-commit values
    written into the tracking spreadsheet's Data sheet, so that the shared sheet
    reflects reality.
24. As an operator, I want monthly commit columns appended alongside the existing
    weekly blocks, so that the sheet's layout stays familiar.
25. As an operator, I want each weekly run to append the next week's block and
    refresh the current month's commits, so that history accumulates correctly.
26. As an operator, I want re-running for the same week to overwrite rather than
    duplicate, so that the update is idempotent.
27. As an operator, I want the Tickets column left untouched, so that the
    GitHub-focused change doesn't disturb task-tracker data.
28. As an operator, I want to verify a sample of people against the GitHub web UI
    before trusting a run, so that I can catch auth-scope or private-repo gaps.
29. As an operator, I want a one-time golden set of verified numbers saved as a
    fixture, so that the engine has an acceptance oracle and I get corrected sheet
    values immediately.
30. As an operator, I want the corrected workbook produced locally for me to
    re-upload, so that I control what lands in the shared sheet.
31. As a future maintainer, I want a methodology document describing what each
    metric includes, excludes, and how it's derived, so that anyone can trust and
    reproduce the numbers.
32. As a future maintainer, I want the identity map version-described and easy to
    edit, so that I can keep it current as new git configs appear.
33. As a future maintainer, I want all committed files free of company-specific
    names, so that the open repository leaks no internal identities.
34. As a report consumer, I want a caveat rendered on outputs that these counts
    are a sanity check and not a performance metric, so that they aren't misused
    to rank people.
35. As an agent resuming this work, I want the plan and progress persisted in the
    repo, so that I can continue across sessions without losing context.

## Implementation Decisions

- **Person model replaces single-login identity.** The canonical identity becomes
  a Person carrying `logins[]`, `emails[]`, and `names[]`. The previous
  single-login user-identity shape is replaced (no backward compatibility
  required). Resolution unions every commit/PR onto the Person whose login, email,
  or name set matches, using union-find so transitive links merge. See ADR-0001.

- **New `IdentityResolver` port** (declared in the central port-interfaces module,
  per repo convention that all ports live there). It is a pure resolver: given raw
  commit/PR identity fields plus the identity map, it returns the canonical Person
  (or routes the identity to a needs-mapping queue). It never instantiates a
  Person from a bare name. Noreply emails of the form
  `<digits>+login@users.noreply.github.com` are parsed to their login and may
  auto-seed the map. `MetricsProvider` consumes this resolver.

- **`MetricsProvider.collect()` is the orchestration seam** and changes behavior:
  - **PRs**: counted org-wide via the GitHub **search API** by author login, all
    states, created within the window. The previous per-repo pull-list iteration
    is no longer the source of the PR count. Per-repo PR detail may still enrich
    titles where needed, but the authoritative count comes from search.
    PRs are reported split into **merged** and **closed-unmerged**; a single
    "closed" number is never emitted.
  - **Commits**: enumerated per repo across **all** org repos for the window
    (reusing the existing scope enumeration), attributed by author email/name
    matched locally to a Person. **Merge commits are excluded** (parent count ≥ 2,
    or committer is the GitHub noreply merge identity). The previous page cap is
    removed; any repo that still truncates is flagged.
  - **LoC**: summed over authored (non-merge) commits with generated/data files
    excluded. Both **raw LoC** and **code LoC** are reported.

- **Metric-shape change** to the contribution metric set: add monthly commit
  counts (`commitsByMonth` keyed by calendar month), `codeLoc` distinct from
  `rawLoc`, and `prsClosedUnmerged` distinct from `prsMerged`.

- **Structured reconciliation output** is added to the metrics collection result
  (extending the existing warnings concept into a structured `reconciliation`
  field): unmapped emails/logins with counts, Persons with more than one login
  (duplicate-account flag), raw external emails not verified on their account, and
  repos that hit a fetch cap.

- **LoC exclusion set**: `*.csv`, `*.json`, `*.lock`, `uv.lock`,
  `pnpm-lock.yaml`, `*.ipynb`, `*.txt`, `*tokenizer*`, `*.bin`, `*.onnx`, model
  artifacts, vendored OpenAPI specs, `**/migrations/*.Designer.cs`. The exclusion
  set lives in one place so it can evolve.

- **Identity map** is human-maintained and seeded from the spreadsheet roster
  (name + login per row) augmented with the known fragmented-contributor cases and
  noreply-parsed logins. Real entries are stored only in gitignored local data;
  any committed example uses placeholders.

- **Spreadsheet writer** is a new, pure module: given per-Person metrics and the
  existing workbook, it produces an updated workbook (or a cell-level change set)
  for the Data sheet. It writes corrected weekly PR and code-LoC cells, appends
  monthly commit columns, recomputes totals, leaves Tickets untouched, and is
  idempotent for a re-run of the same week. Output is produced locally for manual
  re-upload (direct cloud write is deferred).

- **Verification**: the search API is the authoritative collection path
  everywhere. During interactive/golden-fixture runs, a computer-use harness is
  the verification oracle (read the GitHub search pages and cross-check). For
  unattended/scheduled runs, browser automation is an optional cross-check; the
  scheduled path stays deterministic on the API.

- **Weekly skill** is orchestration only — it sequences scope → collect →
  reconcile → write workbook → emit reconciliation report. It contains no new
  business logic; all logic lives behind the ports above.

- **Caveat** text is rendered on outputs labelling the metrics a coarse,
  gameable sanity check rather than a performance score.

## Testing Decisions

- **Test external behavior, not implementation.** Assert the metrics and
  reconciliation output of a port given fixtured inputs — never internal call
  shapes or private helpers.

- **`IdentityResolver` (unit).** Drive the eight identity cases through the
  resolver with crafted identities: two names on one email collapse; multiple
  emails union; an unverified external email still resolves via the map; two
  logins map to one Person and raise a duplicate flag; a noreply email parses to
  its login; a merge identity is classed as non-authoring; a bare name never
  becomes a Person; an external collaborator is included. Assert resolved Person
  and review-queue routing.

- **`MetricsProvider.collect()` (unit, top seam).** With fixtured GitHub search +
  commit responses and a fixed identity map, assert: org-search PR counts (the
  22-vs-26 case resolves to the search number); merged vs closed-unmerged split;
  monthly commit totals attributed across fragmented identities; merge commits
  excluded from commits-authored and LoC; raw LoC dominated by data files yields a
  much smaller code LoC; reconciliation lists unmapped identities, duplicate
  logins, and capped repos. Prior art: existing metrics specs under
  `tests/unit/metrics/` and the REST-API metrics spec.

- **Spreadsheet writer (unit).** Against a redacted copy of the tracking-sheet
  fixture, assert corrected PR/code-LoC cells, appended monthly commit columns,
  recomputed totals, untouched Tickets, and idempotent re-write of the same week.
  Prior art: fixture-driven tests under `tests/fixtures/` and snapshot specs.

- **Golden fixture.** The hand-verified per-Person numbers for the period are the
  acceptance oracle for `collect()`. Real values live in gitignored local
  fixtures; a redacted/synthetic variant is committed for CI.

- **Weekly skill (contract).** Contract-test flags and output shape like the
  existing `tests/contract/` suite; no business-logic assertions here.

## Out of Scope

- **Tickets / task-tracker reconciliation.** The Tickets column and Asana
  attribution are untouched in this effort.
- **Direct cloud write to the hosted spreadsheet.** The workbook is produced
  locally for manual re-upload; an automated cloud-write integration is deferred.
- **Changing contributors' real git config or GitHub accounts.** Guidance is
  issued separately; the tool must work despite bad config.
- **Performance-rating or ranking logic.** These metrics are a sanity signal only.
- **Backfilling GitHub's own attribution** for historical commits — GitHub will
  not re-attribute past commits, which is precisely why the identity-map approach
  is required.

## Further Notes

- **Redaction gate:** no committed file may contain real names, logins, or
  org/company names. Real identity data and golden fixtures live only under the
  gitignored local paths; a redaction check should run before any commit.
- **Sequencing** (see the plan doc): identity map → golden fixture
  (computer-use verified) → engine to match the fixture → write the workbook →
  weekly skill → methodology document.
- **Publishing:** this PRD is stored as a repo file. The org-scoped issue tool
  cannot reach this personal repository and no triage vocabulary was provided, so
  the conventional `ready-for-agent` issue label is recorded here in the status
  line rather than applied via the tracker.
