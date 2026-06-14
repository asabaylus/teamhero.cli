# Metrics Methodology

How Team Hero derives each per-engineer metric, so the numbers can be trusted and
reproduced. This is the authoritative definition; it tracks the design in the
Contributor Identity Reconciliation PRD (`docs/prds/2026-06-13-identity-reconciliation.md`)
and ADR-0001 (`docs/adr/0001-person-identity-model.md`).

> **Redaction:** this document uses placeholders only ("the org", "Vendor Pod",
> Person A/B, `login-a`). Real identities live exclusively in gitignored local
> data (`.teamhero/local/`).

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

### Tracked PRs — `prsMerged` and `prsClosedUnmerged`

Counted **org-wide via the GitHub search API** by author login
(`type:pr author:<login> org:<org> created:START..END`), all states, created
within the window, **summed across every login** belonging to the Person
(`src/lib/pr-search.ts`). PR authors are always real logins, so search is
authoritative — this replaces per-repo pull-list iteration, which undercounted
(a lead read 22 vs an actual 26 because PRs in unscanned repos or beyond the page
cap were dropped).

- **Merged**: closed with `merged_at` set.
- **Closed-unmerged**: closed with no `merged_at`. Reported **distinctly** — a
  single "closed" figure is never emitted, so abandoned PRs aren't counted as
  delivered work.
- A Person's legacy account contributing zero PRs neither inflates nor deflates
  the count.

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

## Included vs excluded

**Included:** all org repositories; all of a Person's logins, emails, and names;
external collaborators (e.g. a Vendor Pod) alongside org members.

**Excluded:** merge / web-flow commits; generated and data files (the exclusion
set above) from codeLoc; GitHub's unverified-email attribution shortcut (we
attribute locally instead); and the **Tickets** column of the tracking
spreadsheet (task-tracker reconciliation is out of scope).

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
