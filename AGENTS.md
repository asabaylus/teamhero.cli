# AGENTS.md — Onboarding for AI Agents

Quick-start reference. See [CLAUDE.md](./CLAUDE.md) for non-obvious gotchas
that you **will** get wrong without reading it.

## Quick Commands

| Action | Command |
|--------|---------|
| Build | `bun run build` |
| Test | `bun run test` |
| Lint | `bun run lint` |
| Dev report | `bun run report` |
| TUI build | `bun run tui:build` |

## Running Reports

Saved config from previous interactive runs lives at `~/.config/teamhero/config.json`.
Headless mode loads it automatically — no need to pass `--org` if it exists.

```bash
# Inspect saved config (org, members, repos, date range)
teamhero report --show-config

# Rerun with saved config, updated dates
teamhero report --headless --since YYYY-MM-DD --until YYYY-MM-DD

# Override specific fields
teamhero report --headless --org other-org --members alice,bob
```

## Project Shape

```
src/
  core/types.ts        <- all port interfaces (see CLAUDE.md)
  adapters/{integration}/  <- implement port interfaces
  services/*.service.ts    <- orchestrate adapters
  lib/                     <- shared utilities
  models/                  <- domain data types
  cli/                     <- CLI entry point (commander)
  metrics/                 <- LOC/stats collection
tests/
  unit/                <- mirrors src/ paths, *.spec.ts
  integration/         <- end-to-end report tests
  contract/            <- CLI flag/template contracts
  fixtures/            <- shared mock data
tui/                   <- Go binary (Charm ecosystem) - primary TUI
scripts/               <- dev/ops scripts
```

## Key Patterns (Discoverable from Code)

- **Ports & Adapters** architecture - interfaces in `types.ts`, implementations in `adapters/`
- **ESM-only** - `.js` extensions on all imports, named exports only, no default exports
- **Biome** for lint + format - no ESLint/Prettier
- **consola** for logging - see CLAUDE.md for why not `console.log`
- **Vitest** with `describe`/`it`/`expect` - tests in `tests/` not alongside source

## Setup Modes (Claude Code)

| Mode | Command | Description |
|------|---------|-------------|
| Deterministic | `just cldi` | Runs hook scripts and exits |
| Agentic | `just cldii` | Hooks + Claude analyzes logs |
| Interactive | `just cldit` | Hooks + Claude asks questions |
| Maintenance | `just cldm` / `just cldmm` | Deterministic / Agentic maintenance |

Logs: `.claude/hooks/setup.init.log`, `.claude/hooks/setup.maintenance.log`

## What Will Trip You Up

Read [CLAUDE.md](./CLAUDE.md) - especially:
- OpenAI uses **Responses API**, not Chat Completions
- Port interfaces go in `src/core/types.ts` only - never new files
- Gum TUI is **deprecated** - Go TUI in `tui/` is primary
- `getEnv()` not `process.env`
- `.spec.ts` not `.test.ts`
- No new npm deps without approval

<!-- BEGIN BEADS INTEGRATION -->
## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Git-friendly: Auto-syncs to JSONL for version control
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

### Quick Start

**Check for ready work:**

```bash
bd ready --json
```

**Create new issues:**

```bash
bd create "Issue title" --description="Detailed context" -t bug|feature|task -p 0-4 --json
bd create "Issue title" --description="What this issue is about" -p 1 --deps discovered-from:bd-123 --json
```

**Claim and update:**

```bash
bd update bd-42 --status in_progress --json
bd update bd-42 --priority 1 --json
```

**Complete work:**

```bash
bd close bd-42 --reason "Completed" --json
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task**: `bd update <id> --status in_progress`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked issue:
   - `bd create "Found bug" --description="Details about what was found" -p 1 --deps discovered-from:<parent-id>`
5. **Complete**: `bd close <id> --reason "Done"`

### Auto-Sync

bd automatically syncs with git:

- Exports to `.beads/issues.jsonl` after changes (5s debounce)
- Imports from JSONL when newer (e.g., after `git pull`)
- No manual export/import needed!

### Important Rules

- ✅ Use bd for ALL task tracking
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `bd ready` before asking "what should I work on?"
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems

For more details, see README.md and docs/QUICKSTART.md.

<!-- END BEADS INTEGRATION -->

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
