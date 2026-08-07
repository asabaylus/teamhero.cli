# Plan: Story Points Completed Per Developer in the Team Hero Audit

Implementation plan for the `teamhero.cli` repo. **Do not implement yet — this is a plan
for review.** It is written to be handed to a coding agent working in the repo; it
references real files, types, and conventions found in the codebase.

---

## 0. Decision required before coding (read first)

Team Hero currently has **no Jira integration**. Its task tracker is **Asana**
(`src/services/asana.service.ts`), and the only mention of Jira in the codebase is a
placeholder comment in `src/models/user-identity.ts` (`// Future: jira?: JiraAccount;`).
The story points this feature must report live in **Jira** (e.g. PT
`customfield_10617`, SPVR `customfield_10005`).

So there are two realities; pick one before building:

- **Reality A — points live in Jira (recommended, assumed by this plan).** The team's
  story points are on Jira issues. This requires adding a **new Jira data source** that
  fetches issues *resolved in the window* with their assignee and story-point value, and
  attributing them to the same Person the git/PR metrics use. Bigger lift, but it's where
  the data is.
- **Reality B — points live in Asana.** If dev story points are actually an Asana custom
  field, skip the Jira source and instead extend the existing Asana path
  (`fetchTasksForAssignee` already pulls per-assignee completed tasks; it just doesn't
  request or extract `custom_fields`). Much smaller lift — see Appendix A.

Everything below assumes **Reality A**. If B is true, jump to Appendix A.

## 0.1 Define the metric precisely (confirm with stakeholder)

"Story points completed by a developer" needs an unambiguous definition the code can
implement:

- **Which issues count?** Issues whose resolution/Done transition falls inside the report
  window (`resolutiondate >= start AND resolutiondate <= end`). Use resolution date, not
  created/updated.
- **Credited to whom?** Default: the issue's **assignee** at time of fetch. Note the edge
  case: the person who *closed* an issue can differ from the assignee. If "who did the
  work" matters more than "who it's assigned to," derive the closer from the changelog
  instead — flag this as a config choice; default to assignee for simplicity.
- **Which projects?** A configured set of Jira project keys (e.g. SPVR, PT, PLAT, LABS,
  WORKS, FOZ). Each may store points in a different field — see §3.
- **Issue types?** Default to the work units that carry points (Story, Task); skip Epics
  and Sub-tasks to avoid double-counting, mirroring the Jira estimation convention.

---

## 1. Architecture fit

Follow the existing ports-and-adapters shape. **All port interfaces go in
`src/core/types.ts`** (do not create new types files — per repo CLAUDE.md). New code slots
in as:

- A new **port**: `StoryPointProvider` in `src/core/types.ts`.
- A new **adapter**: `src/adapters/jira/` implementing it (client + mapping + field
  resolution).
- A **cache decorator**: `src/adapters/cache/cached-story-point-provider.ts`, namespace
  `"storypoints"`, mirroring `cached-task-tracker.ts`.
- Aggregation into the existing per-developer metric set and report renderer.
- Wiring in `ReportService.generateReport()` (`src/services/report.service.ts`) as an
  optional step gated by a new data-source flag.

Use `getEnv()` from `src/lib/env.ts` (never `process.env` directly), `consola` for logging
(never `console.log`), and the date helpers in `src/lib/date-utils.ts`.

---

## 2. The port interface (`src/core/types.ts`)

Add:

```ts
export interface StoryPointProvider {
  readonly enabled: boolean;
  // Returns story points completed in the window, keyed by canonical Person id.
  fetchCompletedStoryPoints(
    members: TaskTrackerMemberInput[],   // reuse existing member input shape
    window: ReportingWindow,             // existing { startISO, endISO }
    options: StoryPointOptions,
  ): Promise<Map<string, StoryPointResult>>;
}

export interface StoryPointOptions {
  projects: string[];                    // Jira project keys to include
  issueTypes?: string[];                 // default ["Story","Task"]
  creditBy?: "assignee" | "resolver";    // default "assignee"
}

export interface StoryPointResult {
  status: "matched" | "no-match" | "disabled";
  totalPoints: number;
  byProject: Record<string, number>;     // points per project, for breakdowns
  issueCount: number;
  unmatchedAssignees?: string[];         // diagnostics
}
```

Keep `StoryPointResult` keyed the same way `MemberTaskSummary` is so it merges cleanly into
`ReportMemberMetrics`.

---

## 3. Jira adapter (`src/adapters/jira/`)

### 3.1 Client + auth
- New client (REST v3 + JQL search), constructed like the Asana service (raw HTTPS with
  retry/backoff is consistent with `asana.service.ts`, or Octokit-style if a lib is
  already approved — note the repo policy: **zero new npm deps without approval**, so
  prefer native `https`).
- Auth via `getEnv()`: `JIRA_BASE_URL` (e.g. `https://gtpservices.atlassian.net`),
  `JIRA_EMAIL`, `JIRA_API_TOKEN` (basic auth), or a cloud-id + OAuth path if you mirror the
  MCP. Document all in `.env.schema` (varlock `@env-spec`); secrets live in
  `~/.config/teamhero/.env`.

### 3.2 Project → story-point-field map (folds in the earlier requirement)
Story points live in different fields per project and the fields are **not**
interchangeable:
- Company-managed projects (`simplified: false`): `customfield_10005`, JQL name
  `"Story Points[Number]"`.
- Team-managed projects (`simplified: true`, e.g. PT): `customfield_10617`, JQL name
  `"Story point estimate"`.

Implement a resolver with a config-driven map and a default:

```
default:  { fieldId: "customfield_10005", jqlName: "Story Points[Number]" }
overrides:
  PT:     { fieldId: "customfield_10617", jqlName: "Story point estimate" }
```

- Prefer real config (file/env) over hardcoding, but ship the PT override built-in.
- Optional but preferred: auto-detect by reading the project's `simplified` flag /
  field metadata and choosing the team-managed field when `simplified: true`; explicit
  map overrides auto-detection.
- **Two distinct warnings, both written to the log file at WARNING level, deduplicated
  once per project per run, never fatal:**
  - *Project not matched / not found*: no map entry and not auto-detectable, or the Jira
    project 404s. → log it; use default if the project exists, skip if it doesn't.
  - *Field not present*: a field was resolved but isn't on the project's field metadata
    (estimation disabled, wrong id). → log it; that project contributes 0; continue.

### 3.3 Fetch logic
- Build per-project JQL using the resolved `jqlName`:
  `project = <KEY> AND issuetype in (Story, Task) AND statusCategory = Done AND
   resolutiondate >= "<start>" AND resolutiondate <= "<end>"`
  Request fields: `assignee`, the resolved story-point `fieldId`, `resolutiondate`,
  `issuetype`, `key`, and `id`. (`resolutiondate` JQL is timezone-sensitive; align with
  `date-utils` — see §5.)
- Paginate via `nextPageToken`/`startAt` until exhausted.
- **Read-only feature**, so the key-mis-resolution bug that affects *writes* on this Jira
  instance does not apply here — but if any write path is ever added, address issues by
  **numeric id**, not key, and verify by read-back. (Documented for future maintainers.)
- If `creditBy: "resolver"`, additionally pull the changelog to find who performed the
  Done transition; otherwise use `assignee`.

---

## 4. Identity resolution — the crux (`src/models/`, `src/services/identity-resolver.service.ts`)

Team Hero attributes everything to a canonical `Person` resolved from GitHub login / git
email / git name. Jira assignees expose `accountId`, `emailAddress` (often hidden by
privacy settings), and `displayName`. You must bridge Jira → Person or story points won't
land on the right developer.

- Extend the identity model to carry Jira identity. There's already a placeholder in
  `src/models/user-identity.ts`. Add to the identity-map schema (`src/lib/identity-map.ts`,
  `.teamhero/identity-map.example.yaml`):
  ```yaml
  - id: jane-doe
    logins: [janedoe]
    emails: [jane@company.com]
    jira: { accountId: "557058:...", email: jane@company.com }
  ```
- Add a `buildJiraLookup(persons): Map<string, Person>` keyed by Jira `accountId` (most
  reliable) with email/displayName fallbacks — mirror `buildGitHubLookup`/`user-map.ts`.
- Feed unmatched Jira assignees into the existing **reconciliation report** so they surface
  every run (same mechanism that flags unmapped git identities), rather than silently
  dropping points. Populate `StoryPointResult.unmatchedAssignees`.

This is the highest-risk part: without a good mapping, points get misattributed or lost.
Plan for an explicit, human-maintained mapping plus loud diagnostics, not heuristics alone.

---

## 5. Dates & caching (reuse existing infra)

- **Window**: reuse `ReportingWindow` and `src/lib/date-utils.ts`
  (`resolveStartISO`/`resolveEndISO`/`resolveEndEpochMs`). Note `resolveEndISO` adds a
  +2-day UTC buffer for negative-UTC authors; for Jira `resolutiondate` filtering, decide
  whether to filter in JQL (server-side, simplest) or fetch slightly wide and filter
  client-side with `resolveEndEpochMs` for exact inclusivity. Format display dates with
  `formatDateUTC()` to avoid local-tz shift.
- **Cache**: add `src/adapters/cache/cached-story-point-provider.ts` modeled on
  `cached-task-tracker.ts` — `FileSystemCacheStore` with namespace `"storypoints"`,
  `computeCacheHash` over `{ org, since, until, members, projects, fieldMapVersion }`.
  Make closed windows permanent (`permanent: new Date(until) < new Date()`). Wire a new
  flush target so `--flush-cache storypoints` (and `all`) invalidates it.

---

## 6. Aggregation & rendering

- Add `storyPointsCompleted?: number` (and optionally `storyPointsByProject`) to
  `ContributionMetricSet` (`src/models/metrics.ts`) and to `ReportMemberMetrics`
  (`src/lib/report-renderer.ts`).
- Merge `StoryPointResult` into each member in `ReportService.toReportMemberMetrics(...)`,
  keyed by Person/login.
- Render a **Story Points** column in the at-a-glance table in `report-renderer.ts`. There
  are **two header variants** (with and without in-progress columns) and matching row
  loops — update **all four** sites. Add the column to the `executive` and `individual`
  templates in the renderer registry as appropriate. Keep the `detailed` template's AI
  final-report path working (it post-processes the structured report; ensure the new field
  is included in the data passed to `ai.generateFinalReport`).

---

## 7. Config, CLI, sections

- Extend `ReportCommandInput` (`src/cli/index.ts`): add `dataSources.jira: boolean` to
  `ReportSectionsSelection`, and a `storyPoints` config block
  (`{ projects: string[]; issueTypes?: string[]; creditBy?: ... }`).
- Add CLI flags consistent with existing ones: `--sources` should accept `jira`;
  `--sections` should accept `story-points` (or fold into `individual`). **Watch the
  existing `--sources` vs `--sections` distinction** (documented in repo CLAUDE.md — easy
  to confuse: sources = which APIs are called; sections = what's rendered).
- Gate the whole feature behind `dataSources.jira` so existing reports are byte-for-byte
  unchanged when it's off.

---

## 8. Error handling (follow the repo's three-layer pattern)

In-report placeholder → end-of-report appendix → CLI stderr after `progress.cleanup()`.
Surface: Jira auth failures, project/field warnings (§3.2), unmatched assignees (§4), and
partial failures (one project down shouldn't sink the report). Never let a Jira hiccup
abort a git/Asana report.

---

## 9. Testing (bun:test, per repo conventions)

- Framework is **`bun:test`**, files are **`.spec.ts`**, run with `bun run test`
  (per-file isolation). Use `mock.module()` with the real-module spread, `afterAll(() =>
  mock.restore())`, `setSystemTime()` for time, and the `mocked()` helper. Don't call
  `mock.restore()` in `beforeEach`.
- New specs: Jira client (mock HTTP — assert JQL built with the right `jqlName`,
  pagination, retry); field resolver (company vs team-managed vs default+warning vs
  field-absent+warning; assert dedup — N issues ⇒ ≤1 warning of each type); Jira→Person
  lookup (accountId/email/name, unmatched diagnostics); aggregation merge; renderer column
  (both table variants); cache decorator (hit/miss, closed-window permanence, flush).
- Meet coverage gates (TS: 85% lines/functions/statements, 80% branches). Every
  non-trivial change ships with tests. Use `/land` to commit/push/PR (never manual git).

---

## 10. Rollout

1. Land the Jira client + field resolver + tests (no report wiring) behind the flag.
2. Land identity-map Jira support + lookup + reconciliation surfacing.
3. Land aggregation + renderer column.
4. Land cache decorator + flush wiring.
5. Dogfood on a known window/project (e.g. PT) and compare totals against the Jira board's
   own sum before enabling by default.

## 11. Out of scope / follow-ups
- Writing story points back to Jira (this feature is read-only).
- Sprint-level velocity (the separate velocity skill covers project-level dem-cap).
- Historical backfill of identity maps — needs a one-time human pass.

---

## Appendix A — If story points live in Asana (Reality B)

Much smaller. No Jira source, no new identity bridge (Asana↔Person matching already exists
in `asana.service.ts` via email/name).

1. `fetchTasksForAssignee` (`asana.service.ts` ~line 513) requests
   `opt_fields: "name,completed,completed_at,...,notes"` — add
   `custom_fields,custom_fields.name,custom_fields.number_value,custom_fields.display_value,custom_fields.type`.
   The board adapter (`src/adapters/asana/board-adapter.ts` ~lines 73–147) already shows
   the extraction pattern; reuse it.
2. Add `customFields` (and/or a typed `storyPoints?: number`) to `TaskSummary`
   (`src/core/types.ts`) and populate it in `summarizeTasks`.
3. Make the field name configurable (`ASANA_STORY_POINTS_FIELD`, default "Story Points").
4. Sum per member over completed-in-window tasks; merge into `ReportMemberMetrics`;
   render the column (§6). Same testing/rendering work as Reality A, minus the Jira client
   and identity bridge.
