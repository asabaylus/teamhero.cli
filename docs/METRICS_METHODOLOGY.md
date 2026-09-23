# Metrics Methodology

How Team Hero derives each per-engineer metric, so the numbers can be trusted and
reproduced. This is the authoritative definition; it tracks the design in the
Contributor Identity Reconciliation PRD (`docs/prds/2026-06-13-identity-reconciliation.md`)
and ADR-0001 (`docs/adr/0001-person-identity-model.md`).

> **Redaction:** this document uses placeholders only ("the org", "Vendor Pod",
> Person A/B, `login-a`). Real identities live exclusively in gitignored local
> data (`.teamhero/local/`).
>
> **Caveat — read this first.** These counts are a **coarse, gameable sanity
> check, not a performance metric.** PRs, commits, and lines of code are easy to
> inflate and say little about impact. Use them to spot data-quality problems and
> gross anomalies, not to rank people. Manage on outcomes.

## The Person model

Every metric rolls up to a **Person** — a single human — not to a GitHub login.
One Person may commit under many author names, many emails, and more than one
GitHub account (e.g. an active login plus a legacy one). A human-maintained
**identity map** (`.teamhero/local/identity-map.yaml`; redacted example at
`.teamhero/identity-map.example.yaml`) lists each Person's logins, emails, and
names.

The resolver (`src/services/identity-resolver.service.ts`) unions map entries
that share any login, email, or name (union-find), so a Person split across
several entries — or owning a second account — collapses into one. Resolution
rules:

- Emails and logins are matched case-insensitively.
- `<digits>+login@users.noreply.github.com` is parsed to its `login`.
- The GitHub merge/web-flow committer (`noreply@github.com`) is classified
  **non-authoring** and never credited.
- A bare display-name never instantiates a Person; an identity matching no
  Person is routed to the reconciliation review queue (never reported as a zero
  Person).

## Metrics

### Pull-request lifecycle activity

Counted **org-wide via the GitHub search API** and summed across every login
belonging to the Person. Each column has an independent event query and date:

- **Opened**: author of a PR whose `created_at` is in the window.
- **Merged**: author of a PR whose `merged_at` is in the window.
- **Closed-unmerged**: author of an unmerged PR whose `closed_at` is in the
  window. Reported distinctly so abandoned PRs are not counted as delivered.

This replaces per-repo pull-list iteration and prevents a PR's current state
from moving an older opening into the week it later merged.

### Commits — `commitsByMonth`

Enumerated **per repo across all org repos** for the window (reusing scope
enumeration) and attributed by **author email/name matched locally** to the
Person — never by GitHub's own attribution, which zeroes out commits made under
an unverified email. Merge commits (parent count ≥ 2, or the GitHub noreply merge
identity) are excluded. Counts are aggregated by calendar month. The previous
pagination cap is removed; any repo that still truncates is recorded for the
reconciliation report.

### Lines of code — `rawLoc` and `codeLoc`

Summed over **authored (non-merge) commits**. Two figures are reported
distinctly (`src/lib/code-loc.ts`):

- **rawLoc**: every changed line.
- **codeLoc**: hand-written code only — checked-in data and generated artifacts
  are excluded, so a single week of JSON/CSV/tokenizer files can't inflate
  someone to ~1.16M lines. **codeLoc is the headline number.**

The exclusion set (centralized so it can evolve): `*.csv`, `*.json`, `*.lock`,
`uv.lock`, `pnpm-lock.yaml`, `*.ipynb`, `*.txt`, `*tokenizer*`, `*.bin`, `*.onnx`,
binary model artifacts (`*.pt`, `*.safetensors`, `*.h5`, `*.gguf`, `*.pb`,
`*.tflite`), vendored OpenAPI/Swagger specs, and `**/migrations/*.Designer.cs`.

### Branch evaluated

Commits, lines of code, and PR targets are all computed from **each repository's
default branch** — the merge target releases ship from. The default branch is
**auto-detected per repo** from GitHub (`default_branch`), so a repo on `master`,
`develop`, `trunk`, or anything else is honoured as-is; it is never assumed to be
`main`. The literal `"main"` is used only as a last-resort fallback when GitHub
reports no default branch at all (effectively an empty repo). There is no
per-repo branch override — if releases ship from a branch that isn't the GitHub
default, set that branch as the repository's default in GitHub settings so it is
picked up.

## Included vs excluded

**Included:** all org repositories; all of a Person's logins, emails, and names;
external collaborators (e.g. a Vendor Pod) alongside org members.

**Excluded:** merge / web-flow commits; generated and data files (the exclusion
set above) from codeLoc; and GitHub's unverified-email attribution shortcut (we
attribute locally instead).

## How it's derived (pipeline)

1. **Scope** — resolve the org, its repositories, and members.
2. **Resolve** — load the identity map and build the `IdentityResolver`.
3. **Collect** (`MetricsProvider.collect()`) — org-search PRs by author; per-repo
   email-matched commits (merges excluded) aggregated monthly; rawLoc/codeLoc
   over authored commits. Every commit and PR is resolved to a Person.
4. **Reconcile** — emit a structured reconciliation report: unmapped
   emails/logins with counts ("map these"), Persons with more than one login
   (duplicate-account flag), raw external emails not verified on their account
   ("ask the contributor to fix their git config"), and any repo that hit a fetch
   cap. This is how the identity map is kept current.
5. **Report / write** — render the metrics (with the caveat above) and write the
   corrected per-Person values into the tracking spreadsheet's Data sheet for
   manual re-upload.

A contributor reading as zero is therefore distinguishable from one we failed to
attribute: real zeros are real, and unattributed identities show up in the
reconciliation report rather than as zero Persons.

## Weekly At-a-Glance event contracts

The deterministic collector and renderer own these values; AI never calculates
a metric. GitHub search qualifiers use the intended calendar window, never the
commit API's timezone buffer.

- **PRs Opened** credits the author by `created_at`.
- **PRs Merged** credits the author by `merged_at`.
- **Closed (not merged)** credits the author by `closed_at` only when unmerged.
  Lifecycle columns are independent: a March opening and July merge count in
  their respective windows.
- **Reviews** credits the reviewer by `submitted_at`, excluding self-reviews and
  bots. Approved, changes-requested, and commented are retained internally.
  Dismissed reviews remain historical submissions and use the commented bucket
  because GitHub mutates their state but preserves their submission timestamp.
- **GitHub Tickets Closed** credits `closed_by`; pull requests are excluded.

Org-wide searches are subject to GitHub's 1,000-result cap. Capped, incomplete,
or failed collection is marked partial/unavailable and rendered as `—`, never as
an authoritative zero.

## Jira completed work

Every project has one completed-work category: `delivery` feeds **Tickets
Closed**, `support` feeds **Support Tickets**, and `excluded` feeds neither. The
default is `delivery`; project-specific issue types may narrow collection.
Sub-tasks are excluded from ticket counts by default. A project has exactly one
category, so no Jira key can reach both columns.

Completion is the issue's first changelog transition into any status in the
site-defined Done category. Candidate JQL is timezone-padded, then exact weekly
placement comes from the full changelog timestamp. Reopening or completing an
issue again does not count it twice. Story Points project from the same completed
item, resolve the field from site metadata/name, and count every issue type
unless explicitly narrowed.

## Observation states

Serialized metrics distinguish `reported` (including a real zero),
`not-requested`, `unavailable`, and `partial`. Unmapped source actors remain in
reconciliation diagnostics with their affected item count; they are never
reassigned or silently converted to a team zero.
