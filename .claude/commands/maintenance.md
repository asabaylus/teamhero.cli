# Agentic Maintenance Analysis

You are analyzing the results of a TeamHero codebase maintenance run that was just executed by the `--maintenance` hook.

## Context

This command is part of the three-mode install/maintain system using `just`:

| Mode | Command | Description |
|------|---------|-------------|
| **Deterministic** | `just cldm` | Runs maintenance hooks and exits — no AI analysis |
| **Agentic** | `just cldmm` | Hooks run, then this `/maintenance` command analyzes results |

For manual maintenance without Claude Code, use the individual `just` recipes:
- `just build` — rebuild CLI
- `just test` — run tests
- `just lint` — run Biome linting

## Instructions

1. Read the maintenance log at `.claude/hooks/setup.maintenance.log`
2. Analyze each step for pass/fail:
   - **bun install** — dependency updates
   - **bun run build** — compilation
   - **bun run test** — test suite
   - **bun run lint** — Biome linting
3. Write a structured results report to `docs/maintenance_results.md` with:
   - Timestamp
   - Step-by-step results (pass/fail with details)
   - Any errors, warnings, or test failures
   - Dependency changes (if any new packages were added/updated)
   - Recommended actions for any failures
4. Report the overall status to the user

## Failure Handling

If any step failed:
- Extract the relevant error output from the log
- Identify the root cause if possible
- Suggest specific fix commands or actions
- Prioritize: lint and test failures are informational; build failures are blocking

## Output Format

Use clear markdown formatting. Be concise — focus on what passed, what failed, and actionable next steps.
