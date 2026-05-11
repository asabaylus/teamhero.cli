# TeamHero Architecture Documentation

> Generated: 2026-01-24 | Updated: 2026-02-01 | Scan Level: Exhaustive

## Executive Summary

TeamHero is a TypeScript CLI application that generates weekly engineering reports by aggregating data from GitHub (commits, PRs, reviews), Asana (tasks), and OpenAI (AI-generated summaries). The application follows a **Ports and Adapters** (hexagonal) architecture pattern with dependency injection.

---

## System Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Go TUI Layer (tui/)                         │
│  Bubble Tea + Huh? + Lip Gloss                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  forms.go   │  │ progress.go │  │  banner.go / runner.go │  │
│  └──────┬──────┘  └──────┬──────┘  └────────────┬────────────┘  │
│         │                │                      │                │
│         └──────── stdin: JSON config ───────────┘                │
│                  stdout: JSON-lines events                        │
└──────────────────────────┬───────────────────────────────────────┘
                           │ subprocess (bun scripts/run-report.ts)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    TypeScript CLI Layer                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   index.ts  │  │run-report.ts│  │  headless-ui (fallback) │  │
│  └──────┬──────┘  └──────┬──────┘  └────────────┬────────────┘  │
│         │                │                      │                │
└─────────┼────────────────┼──────────────────────┼────────────────┘
          │                │                      │
          ▼                ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Service Layer                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    ReportService                          │   │
│  │  (Orchestrates: scope → metrics → asana → ai → render)   │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐  │
│  │ ScopeService│ │MetricsService│ │ AsanaService│ │ AIService │  │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └─────┬─────┘  │
│         │               │               │               │        │
└─────────┼───────────────┼───────────────┼───────────────┼────────┘
          │               │               │               │
          ▼               ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Adapter Layer                               │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐  │
│  │  gh-provider │ │ loc.rest.ts │ │ HTTP Client │ │ OpenAI SDK│  │
│  │(cached-prov.)│ │ loc.stats.ts│ │   (Asana)   │ │           │  │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └─────┬─────┘  │
│         │               │               │               │        │
└─────────┼───────────────┼───────────────┼───────────────┼────────┘
          │               │               │               │
          ▼               ▼               ▼               ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
    │ GitHub   │   │ GitHub   │   │  Asana   │   │  OpenAI  │
    │   API    │   │ Stats API│   │   API    │   │   API    │
    └──────────┘   └──────────┘   └──────────┘   └──────────┘
```

### Architectural Patterns

1. **TUI / Service Separation**
   - The Go TUI binary handles all interactive UI (forms, progress, styling)
   - TypeScript services run headless, communicating via JSON-lines IPC
   - The Go TUI spawns `bun scripts/run-report.ts` as a subprocess

2. **Ports and Adapters (Hexagonal)**
   - Core interfaces defined in `src/core/types.ts`
   - Multiple adapter implementations (headless-ui, gh-provider vs cached-provider)
   - Enables testing with mock adapters

3. **Dependency Injection**
   - Services receive their dependencies through constructor injection
   - Octokit client, AI service, Asana service passed to ReportService
   - ProgressReporter injected for IPC (JsonLinesProgressDisplay) or terminal (ProgressDisplay)

4. **Service Orchestration**
   - ReportService acts as the main orchestrator
   - Coordinates multiple data sources in specific order
   - Handles cross-cutting concerns (progress, logging)

---

## Directory Structure

```
tui/                        # Go TUI binary (Charm ecosystem)
├── main.go                # Entry point, interactive vs headless mode
├── forms.go               # Huh? multi-step config wizard
├── progress.go            # Bubble Tea progress display
├── banner.go              # Lip Gloss styled output (banners, boxes)
├── runner.go              # Subprocess management (spawns bun service runner)
├── config.go              # Config types + XDG load/save
├── protocol.go            # JSON-lines IPC event types
├── config_test.go         # Go tests
├── Makefile               # Build targets
├── go.mod / go.sum        # Go dependencies

src/
├── cli/                    # Entry point and user interaction
│   ├── index.ts           # Commander.js CLI definition
│   └── prompts.ts         # [deprecated] Legacy Gum-based prompts
│
├── core/                   # Domain abstractions (ports)
│   ├── types.ts           # FetchOptions, RepoProvider, SelectionUI interfaces
│   └── select-and-run.ts  # Repository selection orchestration
│
├── services/              # Business logic layer (unchanged)
│   ├── report.service.ts          # Main orchestrator
│   ├── metrics.service.ts         # GitHub commit/PR collection
│   ├── scope.service.ts           # Org/repo/member resolution
│   ├── asana.service.ts           # Asana task integration
│   ├── ai.service.ts              # OpenAI highlights/summaries
│   ├── ai-prompts.ts              # Prompt templates
│   ├── auth.service.ts            # Token-based authentication
│   ├── individual-activity.service.ts   # Contributor payload builder
│   └── individual-summarizer.service.ts # Batch summarization driver
│
├── adapters/              # External interface implementations
│   ├── github/
│   │   ├── gh-provider.ts      # GitHub repo listing
│   │   └── cached-provider.ts  # Decorator with cache
│   ├── ui/
│   │   ├── gum-ui.ts           # [deprecated] Legacy Gum TUI adapter
│   │   └── headless-ui.ts      # Non-interactive/CI mode
│   ├── meeting-notes/
│   │   ├── filesystem-adapter.ts  # Local filesystem meeting notes
│   │   └── google-meet-parser.ts  # Google Meet transcript parsing
│   └── cache/
│       ├── repo-cache.ts       # Repository list cache
│       └── loc-cache.ts        # Lines-of-code cache
│
├── models/                # Domain entities
│   ├── member.ts          # GitHub user
│   ├── organization.ts    # GitHub org
│   ├── repository.ts      # Repository metadata
│   ├── metrics.ts         # ContributionMetricSet
│   ├── asana.ts           # Asana task types
│   ├── individual-summary.ts # AI summary payload
│   ├── user-identity.ts   # Cross-platform user mapping
│   └── ...                # Additional models
│
├── metrics/               # Lines of Code calculations
│   ├── loc.rest.ts        # Per-PR/commit approach
│   └── loc.stats.ts       # GitHub stats API approach
│
└── lib/                   # Shared utilities
    ├── octokit.ts         # GitHub client factory
    ├── progress.ts        # Terminal progress display + ProgressReporter interface
    ├── json-lines-progress.ts # JSON-lines IPC progress reporter
    ├── tui-resolver.ts    # Go TUI binary resolver
    ├── gum-resolver.ts    # [deprecated] Legacy Gum binary resolver
    ├── report-renderer.ts # Final markdown generation
    ├── user-map.ts        # USER_MAP env parsing
    ├── google-oauth.ts    # Google OAuth client utilities
    ├── google-drive-client.ts # Google Drive API client
    ├── individual-cache.ts# Summary caching
    └── ...                # Additional utilities

scripts/
├── run-report.ts          # Headless service runner (JSON-lines IPC)
├── google-auth.ts         # Google OAuth flow (Drive token acquisition)
├── gum-report.ts          # [deprecated] Legacy Gum-based report script
├── bootstrap.sh           # One-command setup (Bun + Go + deps + build)
├── install.sh             # Link CLI wrapper to PATH
└── postinstall.ts         # Build Go TUI binary on npm install
```

---

## Data Flow

### Report Generation Pipeline

```
1. CLI Parsing
   ├── Parse command-line arguments
   ├── Load environment variables
   └── Prompt for missing inputs (interactive mode)
           │
           ▼
2. Scope Resolution (ScopeService)
   ├── Fetch organization metadata
   ├── List repositories (with caching)
   └── Resolve team/member filters
           │
           ▼
3. Metrics Collection (MetricsService)
   ├── Iterate through repositories
   ├── Collect commit stats per member
   ├── Collect PR stats per member
   └── Aggregate review activity
           │
           ▼
4. LOC Enhancement (Optional)
   ├── loc.stats.ts: GitHub contributor stats API
   └── loc.rest.ts: Direct commit/PR analysis
           │
           ▼
5. Asana Integration (AsanaService)
   ├── Match GitHub users to Asana users
   ├── Fetch tasks within time window
   └── Collect task comments
           │
           ▼
6. AI Summary Generation (AIService)
   ├── Generate team highlight (overview)
   ├── Generate per-member highlights
   └── Generate individual summaries
           │
           ▼
7. Report Rendering
   ├── Build ReportRenderInput structure
   ├── Generate markdown via report-renderer.ts
   └── Write to disk
```

---

## Key Components

### ReportService (src/services/report.service.ts)

The main orchestrator that coordinates all data collection and report generation:

```typescript
interface ReportCoordinator {
  generateReport(options: ReportOptions): Promise<ReportResult>;
}
```

**Key responsibilities:**
- Scope collection (org, repos, members)
- Metrics collection with progress updates
- LOC metrics (optional)
- Asana task integration (optional)
- AI highlight generation
- Individual summary generation with cooling periods
- Final report rendering

### MetricsService (src/services/metrics.service.ts)

Collects GitHub metrics for each contributor:

```typescript
class MetricsService {
  collect(params: CollectParams): Promise<CollectionResult>;
  collectCommitTotals(params): Promise<MemberCommitStats[]>;
  collectPullRequestTotals(params): Promise<MemberPRStats[]>;
}
```

**Key features:**
- Paginated API calls
- Rate limit handling
- Error recovery per repository
- Progress callbacks

### AIService (src/services/ai.service.ts)

Generates AI-powered summaries using OpenAI:

```typescript
class AIService {
  generateTeamHighlight(context): Promise<string>;
  generateMemberHighlights(context): Promise<Map<string, string>>;
  generateIndividualSummaries(payloads): Promise<SummaryResult[]>;
}
```

**Key features:**
- Flex processing support (cost optimization)
- Comprehensive rate limit error messages
- Retry logic for transient failures
- Temperature/token configuration

### AsanaService (src/services/asana.service.ts)

Integrates Asana task data:

```typescript
class AsanaService {
  fetchMemberTasks(members, window): Promise<Map<string, MemberAsanaSummary>>;
}
```

**Key features:**
- User matching (email, name, explicit overrides)
- Task pagination
- Comment collection
- Redirect handling for Asana API

### MaturityService (src/services/maturity/maturity.service.ts)

Orchestrates the Agent Maturity Assessment — a parallel feature to `ReportService` that scores an engineering org against a 12-criterion rubric.

```typescript
class MaturityService {
  run(input: AssessCommandInput): Promise<AssessResult>;
}
```

**Pipeline:**
1. **Preflight** — auto-detects evidence tier (`gh` CLI / GitHub MCP / git-only)
2. **Adjacent repos** — scans workflow `uses:`, Terraform sources, submodules, README cross-refs
3. **Phase-1 interview** — 7 verbatim questions over a bidirectional JSON-lines stdin protocol (interactive mode) or pre-supplied via JSON file (headless mode)
4. **Evidence collection** — 12 deterministic detectors, one per criterion (`MaturityProvider` port in `src/core/types.ts`)
5. **AI scoring** — OpenAI Responses API with `text.format.json_schema` strict mode; tier-3 caps on items 2/3/9/11 enforced post-hoc
6. **Audit writer** — renders canonical-template markdown + JSON sidecar; round-trips confirmed interview answers to `docs/audits/CONFIG.md`

The hardcoded rubric lives in `src/services/maturity/rubric.ts` (`RUBRIC_VERSION` participates in the cache key). The TUI integration is in `tui/assess_*.go` and uses the same framed two-pane layout as the report flow. See [Maturity Assessment Reference](MATURITY_ASSESSMENT.md) for full details.

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_PERSONAL_ACCESS_TOKEN` | Yes | GitHub API authentication |
| `OPENAI_API_KEY` | Yes | OpenAI API for summaries |
| `ASANA_API_TOKEN` | No | Asana integration |
| `ASANA_WORKSPACE_GID` | No | Asana workspace |
| `GOOGLE_DRIVE_FOLDER_IDS` | No | Comma-separated Drive folder IDs (auto-discovers if empty) |
| `GOOGLE_DRIVE_INCLUDE_TRANSCRIPTS` | No | Include meeting transcripts (default: true) |
| `USER_MAP` | No | JSON cross-platform user mapping |
| `TEAMHERO_HEADLESS` | No | Skip interactive prompts |
| `TEAMHERO_NO_TUI` | No | Skip Go TUI build during postinstall |
| `TEAMHERO_TUI_PATH` | No | Custom Go TUI binary path |
| `TEAMHERO_BUN_PATH` | No | Custom Bun binary path (used by Go TUI) |
| `TEAMHERO_INDIVIDUAL_BATCH_SIZE` | No | Batch size for summaries (default: 5) |

> **Note:** Google Drive OAuth tokens are stored at `~/.config/teamhero/google-tokens.json`, managed by `teamhero setup`.

### User Map Format

```json
{
  "user_id": {
    "name": "Display Name",
    "email": "user@company.com",
    "github": { "login": "github_username" },
    "asana": {
      "email": "asana_email@company.com",
      "userGid": "1234567890"
    }
  }
}
```

---

## Caching Strategy

### Repository Cache (`~/.config/teamhero/repos-cache.json`)

- Caches repository lists by organization + filter options
- Key: org + includePrivate + includeArchived + sortBy
- Used by CachedRepoProvider

### LOC Cache (`~/.cache/teamhero/loc/*.json`)

- Per-repository contributor statistics
- Avoids repeated GitHub stats API calls
- Manual clearing via `bun run scripts/clear-individual-cache.ts`

### Individual Summary Cache (Working Directory)

- Caches AI-generated summaries per contributor
- Format: `{login}.summary.json`
- Includes payload, status, usage metrics

---

## Error Handling

### API Error Strategies

| Service | Strategy |
|---------|----------|
| GitHub (Octokit) | Retry plugin + throttling plugin |
| GitHub (LOC REST) | FetchPool (5 concurrent) + 3 retries |
| Asana | Status code checks + redirect following |
| OpenAI | Rate limit detection + 5xx retry |

### Error Propagation

- Services wrap errors with contextual messages
- ReportService collects warnings/errors for report footer
- CLI displays user-friendly messages

---

## Testing Strategy

- **Framework:** Vitest
- **Test locations:** `tests/unit/`, `tests/integration/`, `tests/contract/`
- **Test suffix:** `.spec.ts` (never `.test.ts`)
- **Structure:** `describe`/`it`/`expect`, tests mirror source paths
- **Mocking:** `vi.spyOn()` for private methods, `vi.fn().mockResolvedValue()` for stubs
- Architecture supports testing via dependency injection

### Existing Tests

| Directory | Files |
|-----------|-------|
| `tests/unit/` | 9 (asana, date-utils, metrics, perf, select-and-run, headless-ui, contributor-report, report.renderer, json-lines-progress) |
| `tests/integration/` | 3 (report.window, report.filters, report.basic) |
| `tests/contract/` | 2 (cli.flags, report.template) |
| `tui/` (Go) | 1 (config_test.go — config, protocol, serialization) |

---

## Build & Deployment

### Build Process

```bash
bun run build              # TypeScript CLI (tsup → dist/)
cd tui && go build -o teamhero-tui .  # Go TUI binary
```

Or build everything at once:

```bash
just build-all
```

### Installation

```bash
just install               # Full bootstrap: deps + build + link
bun run install:local      # Or just link the CLI wrapper
```

### CLI Usage

```bash
teamhero report --org <org> --since <date> --until <date>
```

---

## Dependencies Summary

### Production Dependencies

| Package | Purpose |
|---------|---------|
| `@octokit/rest` | GitHub API client |
| `@octokit/plugin-retry` | Automatic retry |
| `@octokit/plugin-throttling` | Rate limit handling |
| `openai` | OpenAI API SDK |
| `commander` | CLI argument parsing |
| `chalk`, `boxen`, `cli-spinners` | Terminal formatting (legacy; Go TUI uses Lip Gloss) |
| `consola` | Logging |
| `dotenv` | Environment variables |
| `env-paths` | XDG config paths |

### Development Dependencies

| Package | Purpose |
|---------|---------|
| `typescript` | Type checking |
| `tsup` | Bundling |
| `vitest` | Testing |
| `@biomejs/biome` | Linting/formatting |

---

## File Statistics

| Directory | Files | Total Lines |
|-----------|-------|-------------|
| `tui/` (Go) | 7 | ~800 |
| `src/services` | 9 | ~4,500 |
| `src/cli` | 2 | ~1,200 |
| `src/lib` | 12 | ~2,100 |
| `src/adapters` | 6 | ~600 |
| `src/models` | 12 | ~500 |
| `src/metrics` | 2 | ~570 |
| `src/core` | 2 | ~150 |
| **Total** | **52** | **~10,400** |

---

## Visible Wins

A report section that extracts executive-oriented accomplishment bullets from meeting notes, attributed to Asana projects.

**Key architectural decisions:**
- `AsanaService.fetchFromPath()` — public wrapper for new board adapter
- Single-pass AI extraction — all projects in one API call
- Inline conditional block in `generateReport()` — no section registry yet
- `json_schema` + `strict: true` only — no fallback parsing
- Go TUI (Charm ecosystem) replaced Gum shell-outs — `@inquirer/prompts` fully removed
- New env vars: `ASANA_PROJECT_GID`, `ASANA_SECTION_GID`, `ASANA_SECTION_NAME`, `MEETING_NOTES_DIR`, `MEETING_NOTES_PROVIDER`, `VISIBLE_WINS_AI_MODEL`, `GOOGLE_DRIVE_FOLDER_IDS`, `GOOGLE_DRIVE_INCLUDE_TRANSCRIPTS`

**New components:**
- `src/adapters/asana/board-adapter.ts` — ProjectBoardProvider
- `src/adapters/meeting-notes/filesystem-adapter.ts` — MeetingNotesProvider
- `src/adapters/meeting-notes/google-meet-parser.ts` — Markdown parsing
- `src/lib/google-oauth.ts` — Google OAuth client utilities
- `src/lib/google-drive-client.ts` — Google Drive API client
- `scripts/google-auth.ts` — OAuth flow for Drive token acquisition
- `src/models/visible-wins.ts` — Domain types

