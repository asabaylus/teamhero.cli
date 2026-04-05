---
name: maintenance
description: Run the TeamHero codebase maintenance workflow — updates dependencies, builds, runs tests (TypeScript and Go), fixes lint errors, runs security scan, and produces a results report. Use this skill whenever the user says "run maintenance", "just maintenance", "maintenance check", "update dependencies", "run the maintenance script", or wants to ensure the project is healthy (build/test/lint all passing). Also trigger when the user asks to "update all packages", "make sure everything passes", or "run a security scan".
---

# TeamHero Maintenance

Run the full maintenance pipeline for the TeamHero codebase. The goal is to get every step — dependency update, build, TypeScript tests, Go tests, lint, and security scan — to a passing state, auto-fixing issues along the way.

## Why this workflow exists

TeamHero has a TypeScript CLI (built with tsup) and a Go TUI. Dependencies drift, formatting standards evolve, and biome's auto-fixer can resolve most lint issues mechanically. This skill codifies the exact sequence that keeps the codebase healthy without manual intervention — update deps, verify the build, confirm tests pass, clean up lint, and scan for leaked secrets. It also catches cases where auto-fixes break tests (e.g., biome converting value imports to type-only imports) so you can revert those specific changes before committing.

## Step 1 — Update dependencies

```bash
bun update
```

This updates all packages to the latest semver-compatible versions. Note the output — it will list which packages changed and their version bumps. If any major version bumps appear, stop and flag them to the user as potential breaking changes before proceeding.

## Step 2 — Build

```bash
bun run build
```

This runs `tsup` (TypeScript) and `go build` (Go TUI) via a single command. If the build fails, stop and report the error — build failures are blocking and must be resolved before continuing.

## Step 3 — Run TypeScript tests

```bash
bun run test
```

Record the results: number of test files, tests passed/failed/skipped, and duration. If tests fail, investigate before moving on — the failure may be pre-existing or may have been introduced by the dependency update in Step 1.

## Step 4 — Run Go tests

```bash
cd tui && go test ./...
```

The Go TUI lives in the `tui/` directory. Run its test suite separately since `bun run test` only covers TypeScript (vitest). Record pass/fail and any error output.

## Step 5 — Lint check

```bash
bun run lint
```

This runs `biome check .` against the codebase. If lint passes, skip to Step 7.

## Step 6 — Auto-fix lint errors

If lint failed, auto-fix with:

```bash
npx biome check --fix --unsafe .
```

Then re-check if any errors remain:

```bash
npx biome check . 2>&1 | grep -E '(Found|━━━━)' | grep -v '^check'
```

### Handling remaining errors

If errors persist after auto-fix, categorize them:

- **Format/organizeImports errors in source files** — These should have been fixed by `--fix --unsafe`. If they reappear, a hook or watcher may be reverting files. Re-run the fix and verify immediately.
- **Lint rule violations in source code** (e.g., `noNonNullAssertion`, `noExplicitAny`) — If these are pre-existing and widespread, disable the rule in `biome.json` rather than rewriting dozens of files. Add them under `linter.rules.<category>.<rule>: "off"`.
- **Errors in generated/config files** — Add the directories to `biome.json`'s `files.ignore` list (e.g., `.beads/`, `coverage/`, `.claude/`).

### Critical: verify tests still pass after lint fixes

Biome's auto-fixer can introduce breaking changes. The most common one: `useImportType` converts value imports (classes used at runtime) to type-only imports, which causes `TypeError` at runtime. After applying lint fixes, always re-run both test suites:

```bash
bun run test
cd tui && go test ./...
```

If tests fail after lint fixes, check `git diff` on the failing files for import changes. Revert any `import type` conversions that broke runtime usage, and consider disabling `useImportType` in `biome.json`.

## Step 7 — Security scan (varlock)

```bash
npx varlock scan
```

This scans the codebase for leaked secrets and sensitive config values that shouldn't be in plaintext. The env schema at `.env.schema` defines what's considered sensitive. If the scan finds issues, report them to the user immediately — security findings are blocking.

For staged-only scanning (useful in pre-commit): `npx varlock scan --staged`

## Step 8 — Write the results report

Write a structured report to `docs/maintenance_results.md` with:

- Timestamp and branch name
- Table of step results (PASS/FAIL for each step: deps, build, TS tests, Go tests, lint, security scan)
- Overall status
- Dependency updates (package, old version, new version)
- Any fixes applied (biome config changes, auto-formatting, reverted fixes)
- Security scan results
- Test coverage summary if available

## Step 9 — Report to user

Output a results table to the console so the user can see the status at a glance:

```
## Maintenance Results — YYYY-MM-DD

| Step              | Status | Details                          |
|-------------------|--------|----------------------------------|
| bun update        | PASS   | 6 packages updated               |
| bun run build     | PASS   | TS + Go compiled cleanly         |
| TS tests          | PASS   | 1219 passed, 3 skipped           |
| Go tests          | PASS   | ok (10.0s)                       |
| bun run lint      | PASS   | 180 files, 0 errors              |
| varlock scan      | PASS   | No sensitive values found        |
```

Fill in the actual values from each step. Use FAIL for any step that didn't pass and include the relevant error summary in the Details column. After the table, list any dependency version changes and fixes applied. Then offer to commit the changes if everything passes.
