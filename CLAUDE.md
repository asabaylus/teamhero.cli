# CLAUDE.md — Gotchas & Non-Obvious Rules

Only rules you can't learn by reading the code. When you discover something
surprising while working, add it here.

## Build, Test, Run

```bash
# Build
just build-all                  # TypeScript CLI + Go TUI
just tui-build                  # Go TUI only

# Test
just test-all                   # TS + Go tests
just test                       # TS only (bun test, per-file isolation)
just tui-test                   # Go only
bun test tests/unit/cache/      # Specific test directory (fast, no isolation)

# Run a real report (headless, non-interactive)
teamhero report --headless --foreground --no-confirm
teamhero report --headless --foreground --sections loc --since 2026-02-24 --until 2026-02-28
teamhero report --headless --foreground --flush-cache loc  # Force re-fetch LOC

# Useful flags
#   --sources git,asana            Limit DATA SOURCES (only "git" and "asana" are valid)
#   --sections loc,individual,visible-wins,discrepancy-log  Limit REPORT SECTIONS
#   --flush-cache all|loc|metrics  Invalidate cache before run
#   --since/--until YYYY-MM-DD    Date range
#   --foreground                   Direct I/O (required for agents — no event piping)
#   --no-confirm                   Skip confirmation prompt

# ⚠️  --sources vs --sections (easy to confuse)
#   --sources    controls which APIs are called: "git" | "asana"
#   --sections   controls which report sections are rendered: "loc" | "individual" |
#                "visible-wins" | "discrepancy-log"
#   LOC is a SECTION, not a source. GitHub is called automatically when "loc" is a section.
#   WRONG: --sources loc     (silently ignored — "loc" is not a valid source)
#   RIGHT: --sections loc    (renders only the LOC section; GitHub pulled as needed)
```

- `teamhero` is a shell alias for the Go TUI binary (`tui/teamhero-tui`)
- Headless mode auto-detects in CI, piped stdin, or via `--headless` / `TEAMHERO_HEADLESS=1`
- Saved config lives at `~/.config/teamhero/config.json` (from interactive runs)
- Cache lives at `~/.cache/teamhero/data-cache/{namespace}/`
- Unified log at `~/.cache/teamhero/logs/teamhero.log` (JSONL)
- Pre-existing TS type errors exist outside cache/LOC files — filter `tsc` output to your files

## OpenAI API (Easy to Get Wrong)

- Use the **Responses API** (`client.responses.create()`) — NOT Chat Completions
- Structured output: `text.format` with `json_schema` + `strict: true` — no fallback JSON parsing, no markdown fence stripping
- Some older code (member highlights in `ai.service.ts`) does ad-hoc JSON parsing — don't follow that pattern

## Architecture Traps

- ALL port interfaces go in `src/core/types.ts` — never create new types files
- Use `getEnv()` from `src/lib/env.ts` — not `process.env` directly (many older files violate this; fix when you touch them)
- Use `consola` for logging — never `console.log` (CLI layer has legacy violations)
- `@inquirer/prompts` is being removed — do not use in new code

## TUI: Gum Is Legacy

- The Go TUI in `tui/` is now primary; `src/adapters/ui/gum-ui.ts` is a deprecated fallback
- If modifying Gum code: `spawn()` with `GUM_TTY=/dev/tty` — never `execSync`

## Date & Timezone Handling

- All date boundary logic lives in `src/lib/date-utils.ts` — use `resolveStartISO()`, `resolveEndISO()`, `resolveEndEpochMs()`, `formatDateUTC()`
- **Never** use `T23:59:59Z` to mean "end of day" — it misses negative-UTC timezones
- Bare `--until YYYY-MM-DD` dates get a +2 day UTC buffer via `resolveEndISO()` to capture author dates from all timezones (UTC-12 through UTC+14)
- Always format display dates with `formatDateUTC()` to prevent local-timezone shift (UTC-3 would show Feb 21 instead of Feb 22 for midnight UTC dates)
- GitHub Commits API `until` param is exclusive and filters by **author date** — not committer date

## Error Handling Pattern

- Three layers: in-report placeholder → end-of-report appendix → CLI stderr (after `progress.cleanup()` so it doesn't break the TUI)

## Testing Gotcha

- Test suffix is `.spec.ts` — some legacy files use `.test.ts`, don't follow them
- Tests use `bun:test` (NOT vitest) — import `describe/it/expect/mock/spyOn` from `"bun:test"`
- `mock.module()` leaks across files in the same process — `bun run test` uses per-file isolation via `scripts/run-tests.sh`; `bun test` runs fast but may have cross-file failures
- Never call `mock.restore()` in `beforeEach`/`afterEach` — it undoes `mock.module()` registrations; use `.mockClear()` on individual mocks instead
- Always add `afterAll(() => { mock.restore(); })` in files that use `mock.module()`
- When using `mock.module()`, always spread the real module's exports: `import * as mod from "path"; mock.module("path", () => ({ ...mod, fn: mock() }))`
- `vi.mocked()` replacement: use `mocked()` from `tests/helpers/mocked.ts`
- Bun has `setSystemTime()` (standalone import from `bun:test`), NOT `mock.setSystemTime()`
- Bun does NOT support `advanceTimersByTime` — use real timers with small delays for timer-dependent tests

## Testing Policy

- Every non-trivial source change must include corresponding test additions/updates
- New TS files get a `.spec.ts` in the matching `tests/` subdirectory
- New Go files get a `_test.go` in the same package
- Deleted source files get their test file deleted in the same commit
- CI blocks merges when coverage drops below threshold (TS: 85% lines/functions/statements, 80% branches; Go: 85% block)
- Test our code, not library dependencies — mock at boundaries, verify our logic handles responses/errors correctly

## Environment Variables

- All env vars are documented in `.env.schema` (varlock `@env-spec` format) — this is the single source of truth
- Actual secrets live at `~/.config/teamhero/.env` (never in the project root)
- Scan for leaked secrets: `npx varlock scan` (or `npx varlock scan --staged` in pre-commit)
- The `.env.schema` is safe for AI tools — it contains types and descriptions but never secret values

## Landing Changes

- Always use `/land` to commit, push, and open PRs — never do these steps manually.

## Project Policy

- Zero new npm dependencies without explicit approval
