# Jira Ticket Volume — Derivation Methodology & Integration Plan

**Status:** Handoff draft
**Author:** Generated from the `T9-Box Prep.xlsx` data-fill session, 2026-06-15
**Audience:** The agent picking up implementation of Jira ticket-volume support in the teamhero CLI + TUI

---

## 0. TL;DR

We need teamhero to report, **per member per reporting window, the number of Jira tickets that member completed** — exactly the way it already reports PRs merged and Lines of Code (LOC). In the source spreadsheet this is the **"Tickets"** column that sits next to **"PR"** and **"LoC"** for each weekly bucket.

This document has two halves:

- **Part A — Derivation methodology**: precisely how the ticket counts were computed by hand for the spreadsheet, including every definitional decision and the non-obvious gotchas (permission scoping, status semantics, date bucketing, name matching). Treat this as the spec for what the code must reproduce.
- **Part B — Implementation plan**: how to build it into the existing architecture. The good news: there is already a first-class port — `TaskTrackerProvider` — explicitly designed for "Asana, Jira, etc." The Asana integration is a complete, working reference implementation of that port. Jira is a second implementation of the same seam. **LOC is the reference for how a per-member numeric metric flows into the report; Asana is the reference for how a task tracker is wired.**

---

## Part A — How the Jira data was derived

### A.1 The question we are answering

> For each engineer, how many Jira tickets did they **complete** in a given week?

"Completed" was defined as: the issue is in a **Done status category** and its **resolution date** falls within the week. This matches the spreadsheet's intent ("this would be DONE tickets").

### A.2 Definitional decisions (these are the spec)

1. **"Done" = `statusCategory = Done`, not a single status name.**
   Different Jira projects use different done-status *names*: the `PT` project uses **"Done"**, the `SPVR` project uses **"Closed"**. Both map to the built-in **status category** `Done` (Jira category key `done`, id `3`). Filtering on a literal `status = "Done"` silently drops every project that calls it "Closed" (and vice-versa). **Always filter on the category.**

2. **Completion timestamp = `resolutiondate` (JQL field `resolved`).**
   Jira sets `resolutiondate` when an issue transitions into a resolved/done state. We verified there were **zero** Done-category issues with an empty `resolutiondate` in the window, so `resolved` fully captures completions for this instance. (If a future project moves issues to Done *without* setting a resolution, those would be missed — see A.7 "Risks".)

3. **Attribution = `assignee` at time of export.**
   A ticket counts for the person it is assigned to. We match that person to the roster (see A.6).

4. **Weekly bucketing = 7-day half-open intervals `[start, start+7)`.**
   The spreadsheet's column headers are `May 1–8`, `May 8–15`, `May 15–22`, `May 22–29`, `May 29–Jun 5`, `Jun 5–10`. These are 7-day buckets keyed on a Thursday cadence. The last label ("Jun 5–10") is just truncated at the data-pull date; for consistency it is treated as `[Jun 5, Jun 12)`. A ticket resolved at `2026-05-08T00:00` belongs to the **second** bucket, never the first. Half-open intervals prevent double-counting on boundaries.

   | Spreadsheet column | Week label | Interval (inclusive start, exclusive end) |
   |---|---|---|
   | **N**  | May 1–8     | `[2026-05-01, 2026-05-08)` |
   | **Q**  | May 8–15    | `[2026-05-08, 2026-05-15)` |
   | **T**  | May 15–22   | `[2026-05-15, 2026-05-22)` |
   | **W**  | May 22–29   | `[2026-05-22, 2026-05-29)` |
   | **Z**  | May 29–Jun 5| `[2026-05-29, 2026-06-05)` |
   | **AC** | Jun 5–10    | `[2026-06-05, 2026-06-12)` |

   (Columns N/Q/T/W/Z/AC are the "Tickets" sub-columns; each week is a 3-column group of `PR | Tickets | LoC`.)

5. **Bucketing is done on the *local* resolution date.** The export renders timestamps like `01/May/26 5:55 AM` in the viewer's timezone; we bucket on that displayed calendar date. The production implementation should bucket on a **single, explicit timezone** (see Part B / date-utils) to stay deterministic — the repo already standardizes on UTC-with-buffer via `src/lib/date-utils.ts`.

### A.3 The canonical query

```jql
resolved >= "2026-05-01" AND resolved < "2026-06-12" AND statusCategory = Done ORDER BY resolved ASC
```

Per-person, per-week counting is then a `GROUP BY (assignee, week-bucket)` over the result set. There is no JQL aggregation in the MCP tool, so we fetch the issues and tally client-side.

### A.4 ⚠️ The critical gotcha: API/app visibility ≠ user visibility

This is the single most important lesson for the implementation, because it will silently produce **wrong (under-counted) numbers** if mishandled.

- The Atlassian MCP server (3LO OAuth) authenticated as the user, yet `searchJiraIssuesUsingJql` could only see **7 of the instance's projects**. The engineering boards where most work lives — **`SPVR`, `PLAT`, `ELS`, `FOZ`, `WAT`, `WORKS`** — were **invisible to the token**, even though the *same human account* could see them in the Jira web UI.
- Symptoms that confirm this failure mode:
  - `getVisibleJiraProjects` returns a subset of the projects you know exist.
  - `project = SPVR` returns `{issues: [], isLast: true}` — **empty, not an error**.
  - `getJiraIssue SPVR-1` → `"Issue does not exist or you do not have permission to see it."`
  - The same JQL in the Jira UI returns rows; via the API it returns 0.
- **Root cause:** an org-level **app-access / data-security policy** (Atlassian Admin → Security → Data security policies, and/or per-project *Apps* access for team-managed projects) restricts which *apps* may read which projects, independently of the user's own browse permission. Re-authorizing the user did **not** widen it.
- **Net effect on the first pass:** the API saw only **58** Done tickets / 5 people. The reality (via a full export) was **807** Done tickets across the whole roster — a >10× undercount. Three of the five visible people happened to all be on the "Labs" team; every Core/Platform engineer read as a false zero.

**Implication for the product:** if teamhero pulls Jira via an OAuth app / MCP, it must (a) enumerate visible projects and **surface which projects it can and cannot see**, and (b) treat "0 tickets for an active engineer" as a smell worth a warning, not a silent zero. A **Jira API token / Personal Access Token tied to a service account with org-wide browse permission** is the more reliable production path than a per-user OAuth app subject to app-access policies. See Part B / auth.

### A.5 How we ultimately got complete data

Because the app couldn't see the engineering projects, we exported as the **user** (who can see everything) and processed the file locally:

1. In Jira issue search, ran the canonical JQL (A.3).
2. **Export → Export Excel CSV (all fields)** → `GTP.csv` (~22.7k rows = the full instance, not just the window — the UI export ignored the JQL filter, so we re-filtered locally).
3. Filtered locally to rows where `Status Category == "Done"` **and** `Resolved` parses into the window, then tallied by `(Assignee, week bucket)`.

The relevant CSV columns (by first-occurrence header name — the export repeats many header names like `Labels`, `Sprint`, `Watchers`, so resolve columns by first index):

| Field | Header | Notes |
|---|---|---|
| Assignee display name | `Assignee` | used for roster matching |
| Assignee account id | `Assignee Id` | stable key; prefer this if roster carries it |
| Status name | `Status` | e.g. "Done", "Closed" |
| Status category | `Status Category` | filter on `== "Done"` |
| Project key | `Project key` | e.g. `SPVR`, `PT`, `PLAT` |
| Resolution timestamp | `Resolved` | format `%d/%b/%y %I:%M %p`, e.g. `01/May/26 5:55 AM` |

### A.6 Roster matching (names are messy)

The spreadsheet roster carries **display names only** (no account ids). Matching Jira assignees to roster rows required:

- Case/space normalization (`AHMED SOHAIL` → `Ahmed Sohail`).
- An explicit **alias map** for spelling/formal-name differences found in this dataset:
  - `Eric Spieguel` (roster) ↔ `Eric Spiguel` (Jira)
  - `Don Porter` ↔ `Donald Porter`
  - `Chris Cavazos` ↔ `Christopher Cavazos`
- **Exclusions:** Jira assignees not on the roster were dropped (e.g. `Annu Singh` the manager, `Matthew Tate`, `Germán Dotta`, plus 142 *unassigned* tickets). The implementation should make "unassigned" and "assignee-not-in-roster" **explicit, reported buckets**, never silently merged into someone.

**Lesson for the product:** match on a **stable identifier (Atlassian `accountId`)**, not display name. The repo already has a `USER_MAP` mechanism (`src/lib/user-map.ts`, `parseUserMap`) used by Asana to map a GitHub login → Asana user via email/name/gid overrides. Jira should reuse the same `UserMap` with an `accountId`/email override path rather than re-inventing fuzzy name matching.

### A.7 Risks / things that will bite the implementation

- **App-access scoping (A.4)** — the big one. Validate project visibility explicitly.
- **Done-without-resolution** — if any project transitions to Done without setting a resolution, `resolved` misses it. A more robust definition is `status CHANGED TO <done-category statuses> DURING (window)` via changelog, but that is heavier and per-status-name. For this instance, `resolved` was provably complete; revisit if a new project violates it.
- **Reopened/re-resolved issues** — `resolutiondate` reflects the *latest* resolution; a reopened-then-redone ticket counts in the later week only. Acceptable for weekly throughput.
- **Sub-tasks** — the canonical query counts all issue types including sub-tasks. Decide whether sub-tasks should count as "tickets" (currently: yes). Make it a config toggle.
- **Timezone bucketing** — bucket on a single explicit tz (UTC) to be deterministic; do not rely on the exporter's locale.
- **GDPR / assignee-by-email** — Jira Cloud generally **rejects `assignee = "email@x"`** in JQL (returns nothing) and requires `assignee = "<accountId>"`. Do not match assignees by email in JQL; resolve to accountId first (`lookupJiraAccountId` / user search), or filter client-side.

---

## Part B — Building it into teamhero (CLI + TUI)

### B.1 The seam already exists

`src/core/types.ts` defines the port (comment literally says "Asana, Jira, etc."):

```ts
export interface TaskSummary {
  gid: string;                 // -> Jira issue key, e.g. "SPVR-19640"
  name: string;                // -> issue summary
  status: "completed" | "incomplete";
  completedAt?: string | null; // -> resolutiondate (ISO)
  dueOn?: string | null;
  dueAt?: string | null;
  permalinkUrl?: string | null;// -> browse URL
  description?: string | null;
  comments?: string[];
}

export interface MemberTaskSummary {
  status: "matched" | "no-match" | "disabled";
  matchType?: "email" | "name";
  tasks: TaskSummary[];
  message?: string;
}

export interface TaskTrackerProvider {
  readonly enabled: boolean;
  fetchTasksForMembers(
    members: TaskTrackerMemberInput[],   // { login, displayName }
    window: ReportingWindow,             // { startISO, endISO }
  ): Promise<Map<string, MemberTaskSummary>>;
}
```

**The ticket count for a member in a window is `summary.tasks.length`** (tasks are already filtered to "completed within window"). That is the exact analog of "PRs merged" and "LOC" — a per-member number derived from the same `ReportingWindow`.

> Per the architecture rules in `CLAUDE.md`: **all port interfaces live in `src/core/types.ts`** — do not create new types files. If Jira needs extra fields on `TaskSummary` (e.g. `projectKey`, `issueType`, `assigneeAccountId`), add them there as optional fields.

### B.2 Reference implementations to mirror

| Concern | Reference file | What to copy |
|---|---|---|
| Task tracker port impl | `src/services/asana.service.ts` (`AsanaService implements TaskTrackerProvider`) | overall shape: `enabled` getter, member-matching, per-assignee fetch, window filtering, `summarizeTasks`, HTTP+retry+pagination |
| Caching decorator | `src/adapters/cache/cached-task-tracker.ts` (`CachedTaskTrackerProvider`) | wrap the Jira provider unchanged; namespace `"tasks"`, TTL 1h, hash on `{startISO,endISO,members}` |
| DI / wiring | `src/lib/service-factory.ts` | the `if (asanaToken) { ... taskTracker = new CachedTaskTrackerProvider(asanaService, ...) }` block |
| Consumption in report | `src/services/report.service.ts` (`this.taskTracker.fetchTasksForMembers(...)` ~line 1930) | how counts feed the report |
| Per-member numeric metric → report (THE LOC REFERENCE) | `src/metrics/loc.rest.ts`, `src/metrics/loc.stats.ts`, `src/adapters/cache/cached-loc-collector.ts`, and the `loc` section rendering | how a numeric per-member metric is collected, cached (`CacheSourceType` `"loc"`), and rendered as a section |
| Date handling | `src/lib/date-utils.ts` | `resolveStartISO`, `resolveEndISO`, `resolveEndEpochMs`, `formatDateUTC` — **use these, never hand-roll `T23:59:59Z`** |
| Identity mapping | `src/lib/user-map.ts` (`parseUserMap`, `convertToAsanaOverrides`) | add `convertToJiraOverrides` / accountId override path |

### B.3 New code to write

1. **`src/services/jira.service.ts`** — `export class JiraService implements TaskTrackerProvider`.
   - **Auth:** read `JIRA_API_TOKEN` + `JIRA_EMAIL` + `JIRA_BASE_URL` (or `JIRA_CLOUD_ID`) from `getEnv()` (never `process.env` directly — see `CLAUDE.md`). Use HTTP Basic `email:token` against the Jira Cloud REST API `https://<site>.atlassian.net/rest/api/3/...`. A **service-account API token with org-wide browse** sidesteps the app-access scoping in A.4. (Optionally also support the MCP/OAuth path, but warn on restricted visibility.)
   - **`enabled`:** `Boolean(token && baseUrl)`.
   - **Resolve cloudId / base URL** once; cache it.
   - **Member match → accountId:** for each `TaskTrackerMemberInput`, resolve an Atlassian `accountId` via `UserMap` override → else user search (`/rest/api/3/user/search?query=<email|name>`). Cache a directory per run like `AsanaService` caches `WorkspaceUserDirectory`. **Do not put email into JQL** (A.7).
   - **Fetch completed issues:** `POST /rest/api/3/search/jql` (or GET `/search`) with:
     ```
     jql: assignee = "<accountId>" AND statusCategory = Done AND resolved >= "<startISO>" AND resolved < "<endExclusiveISO>"
     fields: ["summary","status","resolutiondate","assignee","project","issuetype"]
     ```
     Paginate via `nextPageToken` (new endpoint) or `startAt`/`maxResults` (legacy) until exhausted.
   - **Map to `TaskSummary`:** `gid = issue.key`, `name = fields.summary`, `status = "completed"`, `completedAt = fields.resolutiondate`, `permalinkUrl = <base>/browse/<key>`. Consider adding optional `projectKey`/`assigneeAccountId` to `TaskSummary` in `types.ts`.
   - **Window filter:** rely on JQL `resolved` bounds; still re-assert client-side using `date-utils` for safety, mirroring `AsanaService.isTaskWithinWindow`.
   - **Pagination/Retry/429:** copy the `paginate`/`get`/`httpGet` + `MAX_RETRIES` + `retry-after` pattern from `AsanaService`.

2. **`src/lib/user-map.ts`** — add a Jira override converter (`accountId`, `email`, `displayName`).

3. **Wire into `src/lib/service-factory.ts`** — mirror the Asana block:
   ```ts
   let jiraToken = getEnv("JIRA_API_TOKEN");
   if (jiraToken) {
     const jira = new JiraService({ token: jiraToken, email: getEnv("JIRA_EMAIL"), baseUrl: getEnv("JIRA_BASE_URL"), logger: logger.withTag("jira"), userMap });
     taskTracker = new CachedTaskTrackerProvider(jira, options.cacheOptions ?? {});
   }
   ```
   **Decision needed:** today `taskTracker` is a single slot. If both Asana **and** Jira can be active, either (a) introduce a composite `TaskTrackerProvider` that fans out and merges per-member summaries, or (b) make the report distinguish "Asana tasks" vs "Jira tickets" as separate metrics. For the spreadsheet use-case (Tickets column), **Jira is the ticket source**; keep it as its own metric distinct from Asana "tasks".

4. **CLI flags** — `src/cli/index.ts` currently models `dataSources: { git: boolean; asana: boolean }`. Add `jira: boolean`. Per `CLAUDE.md`, `--sources` selects DATA SOURCES (`git`, `asana`, → add `jira`) and `--sections` selects report SECTIONS. The ticket count is a **column/metric**, surfaced wherever PR/LOC are; if it warrants its own section, register it like the `loc` section.

5. **TUI** — the Go TUI in `tui/` is primary. Add Jira to the source-selection screen and surface the per-member ticket count alongside PR/LOC. (Mirror however `loc`/`asana` are presented; Go files need `_test.go` in the same package per policy.)

6. **Env schema** — add to `.env.schema` (the single source of truth, varlock `@env-spec`): `JIRA_API_TOKEN`, `JIRA_EMAIL`, `JIRA_BASE_URL` (and/or `JIRA_CLOUD_ID`). Real secrets live in `~/.config/teamhero/.env`, never the repo. Run `npx varlock scan` before committing.

### B.4 Caching

Reuse `CachedTaskTrackerProvider` as-is (namespace `"tasks"`). If Jira becomes a separate metric from Asana, give it its own `CacheSourceType` (e.g. add `"jira-tickets"` to the union in `types.ts`) so `--flush-cache` can target it independently, mirroring how `"loc"` is flushable on its own.

### B.5 Definition of "ticket count" in code

```
ticketCount(member, window) = fetchTasksForMembers([member], window).get(member.login).tasks.length
```

To reproduce the spreadsheet's six weekly columns, call once per weekly `ReportingWindow` (six windows), or fetch the whole span once and bucket by `completedAt` using `date-utils` — the latter is one API pass and is preferred (it's also how the LOC collector batches).

### B.6 Testing (required — see `CLAUDE.md`)

- New TS file `src/services/jira.service.ts` ⇒ `tests/unit/services/jira.service.spec.ts` (suffix `.spec.ts`, `bun:test`, `mock.module` with full real-module spread + `afterAll(() => mock.restore())`).
- Cover: `enabled` gating; accountId resolution via `UserMap` and via user-search fallback; `statusCategory = Done` (assert "Closed"-named statuses still count); window boundary (half-open) bucketing; pagination; 429 retry; the **no-match** and **unassigned** buckets; and the **restricted-visibility warning** path (A.4).
- Mock at the HTTP boundary; test our logic, not Jira.
- Coverage gate: TS 85% lines/functions/statements, 80% branches.

### B.7 Suggested task breakdown (tracer-bullet slices)

1. `JiraService.enabled` + auth/baseUrl resolution + a single `/myself` smoke call. (Vertical slice, no report wiring.)
2. accountId resolution (UserMap + user-search) with tests.
3. `fetchTasksForMembers` happy path (one member, one window) + `TaskSummary` mapping + pagination.
4. `statusCategory = Done` correctness across "Done"/"Closed" + window bucketing + 429/retry.
5. Wire into `service-factory` + `CachedTaskTrackerProvider`; add `--sources jira`.
6. Report/section surfacing of the ticket count next to PR/LOC.
7. TUI source toggle + display.
8. Visibility/permission diagnostics: enumerate visible projects, warn on projects the token cannot see, warn on active members with zero tickets.

---

## Appendix — Verified facts from the derivation run

- Instance: `gtpservices.atlassian.net`, cloudId `611ab3c3-802d-4c97-a0c2-82a8d10ad9cf`.
- Done-category status example ids: `Done` (id 11634/11814), `Closed` — both `statusCategory.key = "done"`, id `3`.
- Window total via full export: **807** Done tickets; via the scope-limited API token: **58** (the A.4 undercount).
- Projects that were **invisible** to the OAuth/MCP token but present in the export: `SPVR`, `PLAT`, `ELS`, `FOZ`, `WAT`, `WORKS` (plus `MATT`). Visible to the token: `LABS, MATT, PBV, PSC, PT, SDIW, SWTP`.
- Final per-member weekly counts were written into `tests/fixtures/T9-Box Prep.xlsx` columns N/Q/T/W/Z/AC (+ AF total); 30 roster members non-zero, 7 genuine zeros.
