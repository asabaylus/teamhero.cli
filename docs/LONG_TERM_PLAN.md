# Platform Evolution Plan: Teamhero as Open-Core Data Pipeline

**Status:** Proposal
**Date:** 2026-03-12
**Updated:** 2026-03-12
**Context:** Comparison of teamhero's deterministic pipeline approach vs. AI-agent-driven reporting (e.g., Claude Code custom slash commands for standups)

---

## Problem Statement

Teamhero produces high-quality, format-controlled team reports by calling APIs directly in a deterministic pipeline. But it has two friction points that limit adoption:

1. **Setup cost** — Go TUI + TS service + config files + env vars + API tokens
2. **Rigid rendering** — one hardcoded markdown format, not useful to leaders with different reporting preferences

Meanwhile, AI-agent approaches (Claude Code custom slash commands, ChatGPT skills) offer near-zero setup but sacrifice format control, reproducibility, caching, and cross-source analysis.

## Competitive Positioning

### Why GitHub/Copilot Won't Replace This

GitHub will inevitably ship AI-powered team summaries — but they will summarize **GitHub activity only**. They will not deeply integrate with Jira, Asana, or other competing project management tools because:

1. **GitHub Issues/Projects is a competing product.** Microsoft/GitHub has zero incentive to make Jira or Asana look good inside their reporting. They'll integrate with their own tracker.
2. **Atlassian won't help them.** Atlassian built Bitbucket to compete with GitHub. Their API ecosystem favors their own integrations. The existing Jira↔GitHub connector is a shallow "link PRs to tickets" bridge — not a data pipeline.
3. **Asana has no strategic relationship with GitHub.** No one at GitHub is building an Asana adapter.
4. **Historical precedent.** GitHub Copilot features work with GitHub data (repos, PRs, issues, actions). Their team features will summarize GitHub activity, not your Asana board or Google Drive meeting notes.

The same logic applies symmetrically — Atlassian will build reporting for Bitbucket, not GitHub. Linear will build reporting for Linear.

**Teamhero lives in the seam between these ecosystems.** That seam is getting wider as companies adopt more specialized tools (GitHub for code, Linear/Jira for issues, Asana for project management, Notion/Google Docs for meeting notes). No single vendor will unify reporting across their competitors. Teamhero does.

### Positioning Statement

> Your team's work is spread across GitHub, Jira/Asana, meeting notes, and project boards. No single vendor will unify reporting across their competitors. Teamhero does.

### AI Slash Commands Are Complementary, Not Competitive

AI-driven standup tools (Claude `/standup`, custom slash commands) solve a different problem: individual developer convenience. They produce variable-format, ephemeral, single-person summaries. Teamhero solves the **team leader** problem: consistent, cross-source, comparable team reports with institutional memory. The `/standup` user is the developer. The teamhero user is the person who reads 8 developers' updates and synthesizes them for leadership.

## Core Insight

Teamhero's value is not the CLI chrome — it's the **data pipeline and caching layer**. The `ReportRenderInput` data blob is already the internal contract between collection and rendering. Making it the explicit, versioned, publishable artifact unlocks everything.

---

## Architecture: Three Independent Layers

```
┌──────────────────────────────────────────────────────┐
│                   FRONTENDS (pick one)               │
│                                                      │
│  ┌─────────┐   ┌──────────┐   ┌───────────────────┐ │
│  │ Go TUI  │   │ MCP      │   │ Claude/GPT Skill  │ │
│  │ (kept)  │   │ Server   │   │ (markdown prompt) │ │
│  └────┬────┘   └────┬─────┘   └────────┬──────────┘ │
└───────┼──────────────┼──────────────────┼────────────┘
        │              │                  │
        ▼              ▼                  ▼
┌──────────────────────────────────────────────────────┐
│              PIPELINE (unchanged)                    │
│                                                      │
│  Scope → Metrics → LOC → Tasks → Visible Wins → AI  │
│                     ↓                                │
│              ReportRenderInput                       │
│              (the stable data blob)                  │
│                     │                                │
│              ┌──────┴──────┐                         │
│              │  Snapshot   │  ← run history, deltas  │
│              │  Store      │    all work on this     │
│              └──────┬──────┘    layer                │
└─────────────────────┼────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────┐
│              RENDERERS (pluggable)                   │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐ │
│  │"detailed"│  │"executive│  │ "custom-template"  │ │
│  │ (current │  │  summary"│  │ (user-defined)     │ │
│  │  default)│  │          │  │                    │ │
│  └──────────┘  └──────────┘  └────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

---

## The Data Blob as API Contract

### Current State

`ReportRenderInput` is defined in `src/lib/report-renderer.ts` (lines 58-93). It contains:

- Org/team identification
- Date window
- Per-member metrics (commits, PRs, LOC, reviews, AI summaries)
- Global/team highlights
- Visible wins (project accomplishments)
- Discrepancy report (cross-source audit)
- Period deltas (velocity trends)
- Roadmap entries

The blob is already:
- Fully JSON-serializable (Map→Record conversion in `report-serializer.ts`)
- Free of email PII (uses GitHub logins + display names)
- Truncated for evidence text (8KB cap)
- Used by `--output-format json` and internal snapshots

### Required Changes

**1. Add schema version to the blob**

```typescript
export interface ReportRenderInput {
  schemaVersion: 1;           // NEW — required for SaaS migrations
  orgSlug: string;
  // ... everything else unchanged
}
```

**2. Fix snapshot saving (bug)**

`RunHistoryStore.save()` exists and is tested, but is **never called in production code**. Period deltas always fall back to re-fetching from GitHub APIs. Wire `save()` into the report completion path in `report.service.ts`.

**3. Add blob checksum to snapshot metadata**

```typescript
export interface RunSnapshotMeta {
  runId: string;
  blobSchemaVersion: number;  // NEW
  checksum: string;           // NEW — SHA256 for dedup during SaaS sync
  // ... existing fields
}
```

---

## MCP Server Design

Expose the pipeline as composable tools via Model Context Protocol. The port interfaces in `src/core/types.ts` map naturally to MCP tools.

### Tier 1: Data Collection (stateless, cacheable, credential-gated)

| Tool | Input | Output |
|---|---|---|
| `teamhero_get_scope` | org + filters | org, repos[], members[] |
| `teamhero_collect_metrics` | scope + date range | commits, PRs, reviews per member |
| `teamhero_collect_loc` | org, repos, date range | lines added/deleted per member |
| `teamhero_fetch_tasks` | members + date range | Asana tasks per member |
| `teamhero_fetch_visible_wins` | date range + board config | projects, notes, associations |

### Tier 2: AI Enhancement (optional, cacheable)

| Tool | Input | Output |
|---|---|---|
| `teamhero_generate_highlights` | member metrics | AI summary per member |
| `teamhero_extract_accomplishments` | visible wins data | structured accomplishments |
| `teamhero_audit_discrepancies` | full report data | cross-source inconsistencies |

### Tier 3: Rendering (pure functions, no credentials, instant)

| Tool | Input | Output |
|---|---|---|
| `teamhero_render_report` | ReportRenderInput + template name | formatted markdown |
| `teamhero_generate_report` | full config (end-to-end) | complete report |

### Implementation

- New entry point: `src/mcp/server.ts` (~200-300 lines wrapping existing services)
- Tool schemas derived from existing TypeScript types
- Credential resolution from MCP config instead of env vars
- Estimated effort: ~half a day with Claude Code

---

## Pluggable Renderers

### Design

```typescript
interface ReportRenderer {
  name: string;
  description: string;
  render(input: ReportRenderInput): string;
}
```

### Built-in Renderers (ship on day one)

The renderer abstraction is only credible if multiple renderers ship from the start. Two is the minimum to prove the pattern; three covers the primary personas.

| Name | Description | Audience | Day-One? |
|---|---|---|---|
| `detailed` | Current CTO format (default) | Exacting stakeholders | Yes (exists) |
| `executive` | 1-page board summary — team highlight, velocity trends, top accomplishments, key risks. No per-member detail. | Board/exec meetings, skip-level updates | Yes (required) |
| `individual` | Single-member view — one person's commits, PRs, LOC, AI summary, tasks | Standups, 1:1 prep | Yes |

The `executive` template is critical for open-source adoption. Most eng managers evaluating the tool will want a board-ready summary, not a 10-page detailed report. Shipping without it would undercut the "pluggable renderers" story.

### User-Defined Renderers

Template files in `~/.config/teamhero/templates/{name}.md` using Handlebars/Mustache. Selected via `--template <name>` CLI flag.

---

## Frontend Comparison

| User Persona | Frontend | Renderer | Context Cost |
|---|---|---|---|
| Eng manager (CLI user) | Go TUI | `detailed` | Zero |
| Developer in Claude Code | MCP | `individual` | Moderate |
| PM asking ChatGPT | MCP via GPT Action | `executive` | Moderate |
| CI/cron automation | CLI `--headless` | any | Zero |
| Enterprise (custom format) | any | custom template | Varies |

The TUI remains the "batteries included" zero-context-cost experience. MCP is the composable-tools experience. Both produce the same data blob.

---

## Open-Core / SaaS Strategy

### Open Source (free)

- Full pipeline with caching
- All renderers (built-in + custom templates)
- All frontends (TUI, MCP, CLI)
- Local snapshot storage + period-over-period deltas

### SaaS (paid) — future

- **Blob persistence** — time-series storage of all runs
- **Trend analytics** — velocity trends, anomaly detection across months/quarters
- **1:1 talking points** — AI-generated per-member discussion starters from longitudinal data
- **Team health dashboards** — burnout risk, contribution pattern shifts
- **Cross-team benchmarking** — multi-org comparisons
- **Custom renderer editor** — visual template builder with org-wide standardization
- **Sync command** — `teamhero sync` uploads blobs to SaaS endpoint

### Value Ladder

| Capability | Single blob (free) | Multiple blobs over time (SaaS) |
|---|---|---|
| Weekly report | Yes | — |
| Week-over-week delta | Yes (local, 2 blobs) | — |
| 6-month member trajectory | — | Yes |
| 1:1 talking points | — | Yes |
| Burnout risk signals | — | Yes |
| Reorg impact analysis | — | Yes |
| Cross-team benchmarking | — | Yes (multi-org) |

---

## Implementation Priorities

Development is done with Claude Code as implementation partner, which collapses typical solo-dev estimates significantly.

### Phase 1: Foundation (~1-2 hours)

Prerequisites for everything else. Low risk, high leverage.

1. Add `schemaVersion: 1` to `ReportRenderInput`
2. Fix snapshot saving (wire `RunHistoryStore.save()` into report completion)
3. Add `blobSchemaVersion` + `checksum` to `RunSnapshotMeta`

### Phase 2: Open-Source Differentiators (~1 day)

The renderer abstraction + day-one templates. This is what makes the open-source project credible to other engineering leaders.

4. Renderer abstraction — extract into registry, add `--template` flag
5. `executive` renderer (board-ready 1-pager) — **must ship with initial release**
6. `individual` renderer (single-member view for standups/1:1s)
7. User-defined template support (Handlebars/Mustache)

### Phase 3: AI Platform Integration (~1 day)

MCP server + Claude Code skill. Makes teamhero usable from within AI coding assistants without sacrificing format control or caching.

8. MCP server (`src/mcp/server.ts`)
9. Claude Code skill (`.claude/skills/teamhero/SKILL.md`)
10. `bin/teamhero-mcp` entry point + npm publishability

### Phase 4: SaaS Foundation (separate timeline)

Requires infrastructure, auth, billing, and customer development. Not a Claude Code task. Gate on open-source adoption signals before investing here.

11. `teamhero sync` CLI command (upload blob to API)
12. Blob storage API (versioned, with schema migration)
13. Longitudinal query API (member trajectory, team trends)
14. 1:1 talking point generator (AI over longitudinal member data)
15. Team health dashboard

---

## References

- [Claude Code Slash Commands Docs](https://code.claude.com/docs/en/slash-commands)
- [Claude Code Skills Docs](https://code.claude.com/docs/en/skills)
- [Community Standup Command](https://dev.to/ayan_putatunda_5c1b3d6952/building-a-claude-code-slash-command-that-writes-your-daily-standup-updates-2lgm)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [Feature Request: Cross-project daily report (claude-code #29585)](https://github.com/anthropics/claude-code/issues/29585)
