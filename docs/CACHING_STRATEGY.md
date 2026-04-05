# Caching Strategy: Design Proposal

## Problem Statement

Every TeamHero report run currently re-fetches all data from remote sources (GitHub, Asana, Google Drive) and re-processes it through AI — even when the same date range was queried minutes earlier. This creates two compounding costs:

1. **Fetch cost** — hundreds of GitHub API calls, Asana queries, and Drive reads per run
2. **AI cost** — per-member OpenAI calls (~2s cooldown each), team highlights, visible wins extraction, and optional audit — all repeated verbatim

For a 20-person team across 50 repos, a single report run can make 400+ API calls and 25+ OpenAI requests. Running the same report twice doubles all of that for zero incremental value.

### Design goals

- **Historical immutability** — data for a completed week (e.g., Feb 10–16) should never need re-fetching
- **Selective refresh** — "I updated an Asana task, refresh just Asana" without re-fetching GitHub
- **Two-venue reuse** — the same fetched data should serve both the main report and future features (dashboards, trend analysis, ad-hoc queries)
- **Zero new dependencies** — per project policy, the cache must use filesystem JSON (no SQLite, Redis, etc.)

---

## Two Approaches Compared

### Approach A: Monolithic Cache (single JSON per report run)

Store one large file per report execution containing everything: raw GitHub data, Asana tasks, meeting notes, and AI outputs.

```
~/.cache/teamhero/reports/
  acme-corp_2025-02-10_2025-02-16_abc123.json   ← ~2-5 MB per run
```

The file would contain the full `ReportRenderInput` shape (or a superset of it) — the assembled object that currently gets passed to `AIService.generateFinalReport()`.

**Advantages:**
- Simple implementation — one read/write per run
- Easy to reason about — "this file IS the report state"
- Trivial cache invalidation — delete the file, re-run everything

**Disadvantages:**
- **All-or-nothing invalidation** — refreshing Asana data forces re-fetching GitHub too
- **No cross-config reuse** — same GitHub data can't be shared between a "full report" and a "git-only report" or between different team/member selections that overlap
- **Bloated files** — raw PR bodies, commit messages, task descriptions, meeting note text all in one file; grows quickly with team size
- **AI outputs entangled with raw data** — can't re-run AI processing on cached raw data without parsing the monolith apart
- **Poor future extensibility** — a dashboard feature would need to deserialize the full report blob just to read GitHub metrics

### Approach B: Source-Partitioned Cache (split by data source)

Store separate cache files per data source, keyed by the parameters that produced them. A thin coordination layer tracks which source caches are available for a given report configuration.

```
~/.cache/teamhero/
  sources/
    github/
      acme-corp/2025-02-10_2025-02-16/
        metrics.json          ← ContributionMetricSet[] + raw PRs/commits
        loc.json              ← LOC stats per repo
    asana/
      acme-corp/2025-02-10_2025-02-16/
        tasks.json            ← Map<login, MemberTaskSummary>
    meeting-notes/
      <folder-ids-hash>/2025-02-10_2025-02-16/
        notes.json            ← NormalizedNote[]
    visible-wins/
      <board-config-hash>/2025-02-10_2025-02-16/
        projects.json         ← ProjectTask[]
        associations.json     ← ProjectNoteAssociation[]
  ai/
    member-highlights/
      <payload-hash>.json     ← per-member AI summary (already exists as individual cache)
    team-highlight/
      <input-hash>.json       ← team highlight text
    visible-wins-extraction/
      <input-hash>.json       ← ProjectAccomplishment[]
  manifest.json               ← index of cached windows + staleness metadata
```

**Advantages:**
- **Granular invalidation** — refresh Asana without touching GitHub; refresh AI without re-fetching anything
- **Cross-config reuse** — same GitHub metrics serve a full report, a git-only report, a trend comparison, or a future dashboard
- **Independent TTLs** — GitHub metrics for a closed period are permanent; "current week" data expires after 1 hour; meeting notes refresh daily
- **Natural architecture fit** — mirrors the existing ports & adapters pattern; each adapter writes its own cache
- **Two-layer separation** — raw data cache (tier 1) and AI output cache (tier 2) are independent; re-running AI on new prompts reuses fetched data
- **Smaller files** — individual cache files stay under 500 KB even for large teams

**Disadvantages:**
- More files to manage (mitigated by clear directory structure and a manifest)
- Cache coordination logic required (need to check multiple sources before declaring "cache hit")
- Slightly more complex implementation

---

## Recommendation: Approach B (Source-Partitioned) with a Manifest

Approach B is the clear winner for TeamHero's architecture. Here's the concrete design.

---

## Detailed Design

### 1. Cache Key Structure

Every cache entry is keyed by three dimensions:

| Dimension | Purpose | Example |
|-----------|---------|---------|
| **Source** | Which adapter produced the data | `github`, `asana`, `meeting-notes` |
| **Scope** | Org/team/config that scoped the query | `acme-corp`, `folder-abc123` |
| **Window** | Date range | `2025-02-10_2025-02-16` |

For AI outputs, the key is a **content hash** of the input payload (the pattern `IndividualSummaryCache` already uses).

### 2. Cache Tiers

```
┌─────────────────────────────────────────────────────────┐
│  TIER 1: Raw Data Cache                                 │
│  ───────────────────                                    │
│  What: Fetched data from external APIs                  │
│  Key:  (source, scope, window)                          │
│  TTL:  Permanent for historical windows                 │
│        1 hour for "current" windows (endDate ≥ today)   │
│  Size: 100KB–2MB per source per window                  │
│                                                         │
│  Sources:                                               │
│  • github/metrics   — ContributionMetricSet[] + raw     │
│  • github/loc       — LocCacheEntry[] (already exists)  │
│  • asana/tasks      — Map<login, MemberTaskSummary>     │
│  • meeting-notes    — NormalizedNote[]                  │
│  • visible-wins     — ProjectTask[], associations       │
├─────────────────────────────────────────────────────────┤
│  TIER 2: AI Output Cache                                │
│  ───────────────────                                    │
│  What: AI-generated text/structured output              │
│  Key:  SHA-256 of the serialized input payload          │
│  TTL:  Permanent (input hasn't changed = output valid)  │
│  Size: 1KB–50KB per entry                               │
│                                                         │
│  Entries:                                               │
│  • member-highlight/<hash>  — per-member AI summary     │
│  • team-highlight/<hash>    — team highlight text        │
│  • vw-extraction/<hash>     — ProjectAccomplishment[]   │
│  • audit/<hash>             — SectionDiscrepancy[]      │
└─────────────────────────────────────────────────────────┘
```

### 3. Historical vs. Current Window

The key insight: **historical date ranges are immutable**. PRs merged last week won't un-merge. Tasks completed on Feb 12 stay completed. This means:

```
if (window.endDate < today) {
  // Historical — cache is permanent, never expires
  ttl = Infinity;
} else {
  // Current — data is still accumulating
  ttl = 1 hour (configurable via TEAMHERO_CACHE_TTL)
}
```

This single rule eliminates most re-fetching. The typical workflow — "generate last week's report" — becomes a one-fetch operation forever.

### 4. Selective Refresh

When a user knows data changed in one source:

```bash
# Refresh just Asana data for a specific window
teamhero cache clear --source asana --since 2025-02-10 --until 2025-02-16

# Refresh everything for a window
teamhero cache clear --since 2025-02-10 --until 2025-02-16

# Nuclear option
teamhero cache clear --all
```

Because sources are independent files, clearing Asana doesn't touch the GitHub cache. The next report run re-fetches only Asana and reuses the cached GitHub data.

### 5. Manifest File

A lightweight index at `~/.cache/teamhero/manifest.json` tracks what's cached:

```json
{
  "version": 1,
  "entries": [
    {
      "source": "github",
      "scope": "acme-corp",
      "window": { "start": "2025-02-10", "end": "2025-02-16" },
      "path": "sources/github/acme-corp/2025-02-10_2025-02-16/metrics.json",
      "fetchedAt": "2025-02-17T10:30:00Z",
      "ttl": null,
      "memberCount": 20,
      "repoCount": 47
    },
    {
      "source": "asana",
      "scope": "acme-corp",
      "window": { "start": "2025-02-10", "end": "2025-02-16" },
      "path": "sources/asana/acme-corp/2025-02-10_2025-02-16/tasks.json",
      "fetchedAt": "2025-02-17T10:31:00Z",
      "ttl": null,
      "memberCount": 20
    }
  ]
}
```

The manifest enables:
- Fast "is this cached?" checks without filesystem scanning
- `teamhero cache list` command showing what's stored
- Size/age reporting for cache management

### 6. Integration with Existing Architecture

The cache layer slots in as a **decorator** around each port, requiring zero changes to existing adapters:

```
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│  ReportService   │──────▶│  CachedMetrics   │──────▶│  MetricsService  │
│                  │       │  Provider        │       │  (existing)      │
│                  │       │  (new decorator) │       │                  │
└──────────────────┘       └──────────────────┘       └──────────────────┘
                                   │
                                   ▼
                           ┌──────────────────┐
                           │  SourceCache     │
                           │  (new, shared)   │
                           └──────────────────┘
```

Each cached provider:
1. Checks the manifest for a valid cache entry matching (source, scope, window)
2. If hit → reads the cached JSON, deserializes, returns it
3. If miss → delegates to the real provider, caches the result, updates manifest

This is exactly the pattern `RepoCacheStore` and `IndividualSummaryCache` already use — just generalized.

### 7. What Each Cache File Contains

**`sources/github/{org}/{window}/metrics.json`**
```typescript
{
  version: 1,
  fetchedAt: string,           // ISO timestamp
  window: { start, end },
  scope: { org, memberLogins, repoNames, includeArchived, ... },
  data: {
    members: MetricsCollectionResult["members"],  // per-member metrics + raw PRs/commits
    mergedTotal: number,
    warnings: string[],
    errors: string[]
  }
}
```

**`sources/asana/{org}/{window}/tasks.json`**
```typescript
{
  version: 1,
  fetchedAt: string,
  window: { start, end },
  scope: { memberLogins },
  data: Record<string, MemberTaskSummary>   // keyed by login
}
```

**`sources/meeting-notes/{folderHash}/{window}/notes.json`**
```typescript
{
  version: 1,
  fetchedAt: string,
  window: { start, end },
  scope: { folderIds },
  data: NormalizedNote[]
}
```

**`ai/member-highlights/{payloadHash}.json`**
```typescript
{
  version: 1,
  generatedAt: string,
  inputHash: string,
  login: string,
  summary: string
}
```

### 8. Scope Matching

A cache entry is valid when the stored scope is a **superset** of the requested scope:

- Cached data for "all 50 repos" can serve a request for "just 10 repos" (filter client-side)
- Cached data for "all members" can serve a request for "just 5 members" (filter client-side)
- But cached data for "5 repos" cannot serve a request for "all repos" (missing data)

For simplicity in v1, use **exact scope match** only. Superset matching can be added later as an optimization.

### 9. Implementation Phases

**Phase 1: GitHub Metrics Cache** (highest impact)
- This is the most expensive fetch operation (hundreds of API calls)
- Create `CachedMetricsProvider` as a decorator around `MetricsService`
- Create the shared `SourceCacheStore` utility (generalized from `RepoCacheStore`)
- Add `--no-cache` / `--refresh` flags to CLI

**Phase 2: Asana + Meeting Notes Cache**
- Create `CachedTaskTrackerProvider` and `CachedMeetingNotesProvider`
- Same pattern as Phase 1, different data shapes

**Phase 3: AI Output Cache**
- Generalize the existing `IndividualSummaryCache` pattern
- Add content-addressed caching for team highlights and visible wins extraction
- This is the phase where "re-running with a new AI prompt" becomes fast because raw data is already cached

**Phase 4: Cache Management CLI**
- `teamhero cache list` — show cached windows and sizes
- `teamhero cache clear --source <source>` — selective invalidation
- `teamhero cache clear --before <date>` — prune old entries
- Integration with `teamhero doctor` for cache health checks

### 10. Configuration

```bash
# TTL for "current" windows (end date includes today). Default: 3600 (1 hour)
TEAMHERO_CACHE_TTL=3600

# Disable caching entirely (useful for debugging)
TEAMHERO_CACHE_DISABLED=1

# Maximum total cache size in MB. Oldest entries evicted first. Default: 500
TEAMHERO_CACHE_MAX_SIZE_MB=500
```

### 11. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Stale data served silently | Progress bar shows "Using cached GitHub data (fetched 2h ago)" — visible to user |
| Cache corruption | Version field in every file; invalid/unreadable files treated as cache miss |
| Disk space growth | `TEAMHERO_CACHE_MAX_SIZE_MB` + LRU eviction + `cache clear` CLI |
| Scope mismatch bugs | Exact scope match in v1; conservative "cache miss on any doubt" policy |
| Breaking changes to data shapes | Version field bumped on schema change; old versions treated as miss |

---

## Why Not Approach A?

The monolithic approach fails the core use cases:

1. **"I updated one Asana task"** → must re-fetch GitHub, Google Drive, and re-run all AI. With Approach B, only the Asana cache is invalidated.

2. **"Generate the same report for a different team"** → GitHub metrics for the org are the same, but Approach A can't reuse them because the monolith key includes team selection.

3. **"Build a trends dashboard from historical reports"** → Approach A requires deserializing multi-MB report blobs and extracting metrics. Approach B has them in clean, small, typed files.

4. **"Re-run AI with improved prompts"** → Approach A entangles AI output with raw data. Approach B's two-tier design means raw data stays cached while AI outputs are invalidated independently.

The only scenario where Approach A wins is "I want the absolute simplest possible implementation" — but the existing codebase already has three different cache implementations (`RepoCacheStore`, `IndividualSummaryCache`, `LocCacheStore`), so the team is clearly comfortable with cache management code. Approach B generalizes what already exists rather than introducing a competing pattern.

---

## Summary

| | Approach A (Monolith) | Approach B (Partitioned) |
|---|---|---|
| Invalidation granularity | All or nothing | Per-source |
| Cross-config reuse | None | Full |
| AI re-run on cached data | Not possible | Native |
| Future extensibility | Poor | Excellent |
| Implementation complexity | Low | Medium (but builds on existing patterns) |
| Files on disk | 1 per run | ~5-8 per window |
| Fits existing architecture | Competing pattern | Generalizes existing caches |
| **Recommendation** | | **This one** |

---

## Comparison with PR #18 ("Smart Caching")

PR #18 (`b8d504f`) implemented a working version of caching. This section
analyzes how it aligns with, diverges from, and informs the design above.

### What PR #18 Built

PR #18 delivered six components in a single commit:

1. **`FileSystemCacheStore<T>`** — a generic, namespace-partitioned, JSON-envelope
   cache with TTL support, version checks, and `get/set/has/remove/clear/list` ops.
   Cache keys are 16-char truncated SHA-256 hashes computed from sorted key-value
   pairs via `computeCacheHash()`.

2. **Three decorator providers** — `CachedMetricsProvider`, `CachedTaskTrackerProvider`,
   `CachedVisibleWinsProvider` — each wrapping the real provider with read-through
   caching. Each uses its own namespace (`metrics`, `tasks`, `visible-wins`).

3. **`RunHistoryStore`** — persists full serialized `ReportRenderInput` snapshots
   indexed by org/endDate, with automatic pruning (default 20 runs).

4. **`DeltaReportService`** — computes per-member velocity deltas and a narrative
   summary by comparing current metrics against a historical snapshot.

5. **Unified JSONL log** — consolidates cache hit/miss/flush events, AI metadata,
   and run lifecycle into a single `logs/teamhero.log`.

6. **TUI/CLI integration** — `--flush-cache` flag (accepts `all` or comma-separated
   source names), `wsCacheCheck` wizard state for interactive cache control, and
   `wsReuse → wsConfirmRun` shortcut for repeat runs.

### Where PR #18 Aligns with This Design

The alignment is remarkably strong — PR #18 independently arrived at the same
core architecture:

| Design Principle | This Document | PR #18 |
|---|---|---|
| Source-partitioned (not monolithic) | Yes — separate files per source | Yes — separate namespaces per source |
| Decorator pattern over ports | Yes — `CachedMetricsProvider` wraps `MetricsProvider` | Identical — same class names, same pattern |
| Closed-window optimization | Yes — `endDate < today → permanent` | Yes — `new Date(until) < new Date() → permanent: true` |
| Content-addressed AI cache | Yes — SHA-256 of input payload | Partially — `computeCacheHash` exists but not applied to AI outputs |
| Selective flush by source | Yes — `--source asana` | Yes — `flushSources: CacheSourceType[]` |
| Zero new dependencies | Yes | Yes — pure `node:fs` + `node:crypto` |
| Version field for schema evolution | Yes | Yes — `envelope.version === 1` check |

**Verdict:** The foundational caching layer in PR #18 is exactly what this design
calls for. `FileSystemCacheStore` and the three decorator providers can be adopted
directly.

### Where PR #18 Diverges — and What to Adjust

#### 1. Cache key granularity (moderate concern)

PR #18's `CachedMetricsProvider` hashes only `{ org, since, until }`:

```typescript
const inputHash = computeCacheHash({
  org: options.organization.login,
  since: options.since,
  until: options.until,
});
```

This means two runs for the same org + window but **different member/repo
selections** will incorrectly share a cache entry. If Run A fetches for 5
repos and Run B requests all 50, Run B gets Run A's partial data.

**Fix:** Include scope-defining fields in the hash:

```typescript
const inputHash = computeCacheHash({
  org: options.organization.login,
  since: options.since,
  until: options.until,
  members: options.members.map(m => m.login).sort().join(","),
  repos: options.repositories.map(r => r.name).sort().join(","),
});
```

(The task tracker cache in PR #18 already does this correctly — it includes
`members` in its hash. The metrics cache should follow the same pattern.)

#### 2. No manifest / discoverability layer

PR #18 uses flat hash-named files (`{16-char-hex}.json`) in namespace
directories. This works for cache operations but makes it impossible to
answer "what windows are cached?" without deserializing every file.

**Fix:** Add the manifest layer described in Section 5 above — or, more
pragmatically, extend `FileSystemCacheStore.list()` to return richer
metadata (it already reads all envelopes; just expose the scope/window
info from within them). This can be deferred to Phase 4 (cache management CLI).

#### 3. Run history snapshots are monolithic

`RunHistoryStore` saves the **full** `ReportRenderInput` as a single JSON file
per run. This is the monolithic pattern from Approach A applied at the snapshot
layer. For trend analysis or dashboards, you'd need to deserialize multi-MB blobs.

However, this serves a different purpose than the source cache — it's a
**historical record of what was reported**, not a reusable data store. The
design above doesn't have an equivalent, and it's a genuinely useful addition
for the delta/velocity feature.

**Recommendation:** Keep `RunHistoryStore` as-is for its intended purpose
(cross-period delta comparison). Don't conflate it with the source cache.
The two systems serve different needs and can coexist cleanly.

#### 4. AI output caching gap

PR #18 caches raw data fetching (Tier 1 in this design) but does **not** cache
AI outputs (Tier 2). Member highlights, team highlights, and visible wins
extraction are still re-generated every run even when the input data hasn't
changed.

For a 20-person team, this means ~22 OpenAI API calls ($2–5+ per run depending
on model tier) that could be eliminated.

**Fix:** Apply the same `computeCacheHash` pattern to AI inputs — this is
Phase 3 in the implementation plan. The individual summary cache
(`IndividualSummaryCache`) already demonstrates this exact approach; generalize
it to all AI call sites.

#### 5. Unified log path concern

The unified log writes to `logs/teamhero.log` relative to `process.cwd()`,
which means it lands in whatever directory the user happened to run from.
The existing `run-log.ts` already uses `cacheDir()` for its output path.

**Fix:** Move the unified log to `cacheDir()` to match the existing pattern
and avoid polluting the working directory.

#### 6. TTL values

| Source | PR #18 TTL | This Design | Notes |
|--------|-----------|-------------|-------|
| GitHub metrics | 4 hours | 1 hour (current) / permanent (historical) | PR #18 already has the closed-window permanent optimization, so 4h only applies to "current" windows |
| Asana tasks | 1 hour | 1 hour | Aligned |
| Visible wins | 2 hours | 1 hour | Minor — tasks and notes change at roughly the same frequency |
| AI outputs | N/A | Permanent (content-addressed) | Not implemented in PR #18 |

The TTL values are reasonable. The 4-hour metrics TTL for current windows is
arguably better than 1 hour for typical usage patterns (reports generated a
few times per day, not per hour). This is a tuning decision, not a design issue.

### Summary: Build on PR #18, Don't Replace It

PR #18's implementation is a strong foundation that aligns with the source-
partitioned architecture. The recommended path forward:

| Action | Effort | Impact |
|--------|--------|--------|
| Merge PR #18's `FileSystemCacheStore` + 3 decorators as-is | Low | Eliminates re-fetching immediately |
| Fix metrics cache key to include members/repos | Small patch | Prevents scope mismatch bugs |
| Add AI output caching (Tier 2) on top | Medium | Eliminates redundant OpenAI costs |
| Add manifest/CLI for cache management | Medium | Enables `cache list` / `cache clear --source` |
| Move unified log to `cacheDir()` | Trivial | Avoids cwd pollution |
| Keep `RunHistoryStore` for delta comparisons | None (keep as-is) | Free velocity trends from snapshots |

The only parts of this design doc that PR #18 doesn't already cover are the
manifest layer (Section 5), AI output caching (Tier 2), and the cache
management CLI (Phase 4). Everything else is implemented and tested.

---

## Per-Repo LOC Caching (Implemented)

The original `CachedLocCollector` hashed ALL repos into a single cache key.
Adding one repo invalidated the entire LOC cache. This has been fixed:

**Before:** `computeCacheHash({ org, since, until, repos: sorted-repos-joined })`
— one cache entry for all repos. Change the repo list → cache miss for everything.

**After:** Each repo is cached independently under namespace `loc-repo`:
`computeCacheHash({ org, repo, since, until })` → one file per repo per window.

**Key files:**
- `src/adapters/cache/cached-loc-collector.ts` — per-repo cache loop + merge
- `src/metrics/loc.rest.ts` — exports `collectRepoCommits`, `listOrgRepos`,
  `parseRepoFullName`, `REPO_CONCURRENCY`
- `tests/unit/cache/cached-loc-collector.spec.ts` — 8 tests

**Behavior:**
1. Resolve target repos (from `input.repos` or `listOrgRepos`)
2. For each repo: check per-repo cache → hit returns immediately, miss calls `collectRepoCommits`
3. Merge all per-repo maps (additive: sum additions/deletions/commit_count per login)
4. Sort by net descending, login ascending
5. Bounded concurrency (`REPO_CONCURRENCY = 3`)

**Flush:** Source type is still `"loc"` — `--flush-cache loc` invalidates all per-repo entries.
Old `"loc"` namespace entries (pre-migration) expire naturally via TTL.
