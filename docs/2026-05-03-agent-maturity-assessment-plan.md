# Plan — First-class Agent Maturity Assessment in Team Hero

## Context

Team Hero today produces a weekly developer-contribution **report**. We're adding a sibling deliverable: an **Agent Maturity Assessment** — a 12-criterion diagnostic that scores an engineering organization for AI-agentic-coding readiness, producing a weighted % and raw /12 score, item-level evidence, top fixes, strengths, and a maturity band.

The complete skill (rubric, interview questions, output template, preflight tier system, multi-repo handling) was extracted from `C:\Users\Asa\Desktop\agent-maturity-assessment.zip` and is the source of truth for the rubric content. Reference copies live at `docs/maturity-skill-ref/` for review during implementation; the implementation will hardcode the rubric in TS so the binary doesn't depend on those reference files at runtime.

This is a first-class feature: a new `assess` top-level command in both the CLI (`teamhero assess …`) and the Go TUI (sibling to `report` / `setup` / `doctor`), with interactive (wizard) and headless modes, hybrid scoring (deterministic detectors + AI judgment), JSON + markdown output, caching, and an updatable on-disk audit history.

## Scope decisions (already confirmed)

- **Rubric source:** hardcoded in TS (`src/services/maturity/rubric.ts`) — single source of truth, versioned with the code, includes a `RUBRIC_VERSION` so cached results invalidate when criteria change.
- **Inputs (all four):** GitHub org/repos (reuses Team Hero's existing GitHub fetchers), local repo path (`--path`), free-text questionnaire (the 7 Phase-1 interview questions, presented one at a time in the TUI), Asana signals (reuse existing Asana adapter for Q5 dev-loop tracking signals).
- **Output shape:** new top-level command. `teamhero-maturity-<scope>-<YYYY-MM-DD>.md` + matching `.json`. Results are also appended to `docs/audits/CONFIG.md` (interview answers) and `docs/audits/<scope>-<date>.md` (the audit) when run inside a repo.
- **Scoring:** hybrid. Deterministic detectors run first against the local repo + GitHub data; an AI pass (OpenAI Responses API, `text.format.json_schema` strict) takes the deterministic evidence + interview answers and produces final scores, evidence sentences (≤25 words per the template), top-3 fixes, and strengths.

## Architecture

The existing pattern: TS CLI → spawns Go TUI binary → Go TUI either runs interactive wizard or invokes the TS service via JSON-lines stdin/stdout. We follow that pattern exactly.

```
teamhero assess [flags]   (TS Commander wrapper, src/cli/index.ts)
        ↓ spawns
tui/teamhero-tui assess [flags]   (Go subcommand, tui/main.go + tui/assess.go)
        ↓ wizard or headless → marshal AssessConfig as JSON
        ↓ subprocess: scripts/run-assess.ts (or compiled service binary)
        ↓ JSON-lines events on stdout: progress | interview-question | interview-answer | result | error
src/services/maturity/maturity.service.ts   (orchestrator)
        ├── PreflightProbe (gh / GitHub MCP / git-only tier detection)
        ├── EvidenceCollector (deterministic detectors per item)
        ├── AdjacentRepoDetector (multi-repo scope)
        ├── InterviewCoordinator (round-trips questions through TUI)
        ├── AIScorer (OpenAI Responses API, strict JSON schema)
        └── AuditWriter (markdown + JSON output, CONFIG.md update)
```

A novel piece: the **interview round-trip**. Today the TUI is upstream of the service (it spawns it). For the maturity assessment, the service needs answers from the human *during* its run — one question at a time, blocking. We add two new event types to the JSON-lines protocol: `interview-question` (service → TUI) and the existing stdin channel is reused for `interview-answer` (TUI → service). The Go side renders each question via a `huh` prompt with the suggested option set + free-text override, then writes the answer back over stdin as a JSON line. In headless mode, the service reads pre-supplied answers from `docs/audits/CONFIG.md` (or `--interview-answers <path>`), or marks every question `unknown` and proceeds.

## Files to create

### TypeScript service layer

| File | Purpose |
|------|---------|
| `src/services/maturity/rubric.ts` | Hardcoded 12-criterion rubric (id, title, category, weight, score levels, repo checks, diagnostic commands, why-it-matters). Exports `RUBRIC_VERSION` for cache busting. |
| `src/services/maturity/interview.ts` | The 7 Phase-1 questions (verbatim), suggested option sets, criterion mapping. |
| `src/services/maturity/preflight.ts` | Tier detection (gh / GitHub MCP / git-only). Returns `EvidenceTier`. |
| `src/services/maturity/evidence-collectors.ts` | Per-item deterministic detectors. Each item has a collector that runs the diagnostic commands from `criteria.md` and emits `EvidenceFact` records. |
| `src/services/maturity/adjacent-repos.ts` | Multi-repo scope detection (parse `.github/workflows/`, `infra/`, submodules, doc references). |
| `src/services/maturity/maturity.service.ts` | Orchestrator. Composes preflight → adjacent repos → evidence collection → interview round-trip → AI scoring → write output. Mirrors `report.service.ts` shape. |
| `src/services/maturity/ai-scorer.ts` | AI integration (Responses API + strict json_schema). Builds prompt from rubric + collected evidence + interview answers. |
| `src/services/maturity/audit-writer.ts` | Renders the audit markdown using the exact output template; writes JSON sibling. Updates `docs/audits/CONFIG.md` if the run is inside a repo. |
| `src/services/maturity/maturity-prompts.ts` | The AI prompt builder + `MATURITY_ASSESSMENT_SCHEMA` (json_schema for strict mode). |
| `src/services/maturity/scoring.ts` | Pure scoring math: weighted sum, band classification, `n/a` handling. |
| `src/services/maturity/types.ts` | `AssessCommandInput`, `AssessResult`, `EvidenceFact`, `ItemScore`, `EvidenceTier`, `InterviewAnswer`, etc. (Note: per CLAUDE.md, *port interfaces* go in `src/core/types.ts`; concrete value types specific to this feature live here.) |
| `scripts/run-assess.ts` | Headless service runner — sibling to `scripts/run-report.ts`. Reads `AssessCommandInput` from stdin, emits JSON-lines events. |
| `tests/unit/services/maturity/*.spec.ts` | Per-module unit tests (`bun:test`, `.spec.ts`). |
| `tests/integration/maturity-end-to-end.spec.ts` | Headless run against a fixture repo, assert output structure. |
| `tests/contract/cli.assess.spec.ts` | Verify `teamhero assess` registers and forwards args to the TUI binary. |

### Port interfaces (added to existing file)

Add to `src/core/types.ts`:
- `MaturityProvider` — interface for an evidence collector (one per criterion).
- `InterviewTransport` — interface for asking questions (TUI-backed in normal runs, file-backed for headless).
- `AuditStore` — interface for reading/writing `docs/audits/CONFIG.md`.

### Go TUI layer

| File | Purpose |
|------|---------|
| `tui/assess.go` | New subcommand entrypoint: `runAssessInteractive()`, `runAssessHeadless()`, `printAssessUsage()`. |
| `tui/assess_wizard.go` | Wizard for the `assess` flow: scope picker (org / local repo / both), scope target inputs, options (date window, output path), and the interview round-trip handler. |
| `tui/assess_config.go` | `AssessConfig` struct + load/save (separate from `ReportConfig` to avoid coupling the two flows; saved at `~/.config/teamhero/assess-config.json`). |
| `tui/assess_runner.go` | Service-runner glue: marshals `AssessConfig`, spawns `scripts/run-assess.ts` (or `teamhero-service --mode=assess`), handles bidirectional JSON-lines (questions over stdin). |
| `tui/assess_progress.go` | Progress display for the assess run — reuses existing `progressModel` shape but with assess-specific step list. |
| `tui/assess_preview.go` | Tabbed preview of the audit output (Audit / Evidence / JSON Data tabs). Reuses Glamour like `preview.go`. |
| `tui/assess_test.go` | Subcommand routing, wizard transitions, event handling. |
| `tui/assess_runner_test.go` | Bidirectional protocol tests with a fake subprocess. |

### Files to modify

| File | Change |
|------|--------|
| `src/cli/index.ts` | Register `assess` subcommand (delegates to TUI binary, mirrors the `report` block at lines 146–166). Add `assess` to the `subcommands` arrays at lines 157 and 223. |
| `tui/main.go` | Add `"assess"` to the subcommand-detection block at lines 134–138. Add `case "assess":` to the help-routing switch at lines 148–158 and the dispatch switch at lines 181–195. |
| `tui/flags.go` | Add `--scope-mode` (org/local/both), `--path` (local repo path), `--target-org`, `--target-repos`, `--rubric-version` (read-only flag for diagnostics), `--interview-answers <file>`, `--evidence-tier <auto|gh|mcp|git>`, `--audit-output <path>`. Headless flags only — interactive flow uses the wizard. |
| `tui/protocol.go` | Add `InterviewQuestionEvent` (service → TUI) and `InterviewAnswerEvent` (TUI → service). Extend `GenericEvent` with the new fields (`questionId`, `questionText`, `options`, `allowFreeText`). |
| `tui/runner.go` | Generalize `RunServiceRunner` to support bidirectional stdin (currently stdin is one-shot config JSON, then closed). Add `RunAssessServiceRunner` that keeps stdin open for answer events; or expose a shared helper. |
| `claude-plugin/skills/agent-maturity-assessment/SKILL.md` | New skill that documents how to invoke `teamhero assess` (parallel to `generate-report` and `maintenance` skills). Include both binary mode and a fallback that calls the bundled Anthropic skill if the binary isn't installed. |
| `docs/ARCHITECTURE.md` | Add a "Maturity Assessment" section documenting the new flow. |
| `.env.schema` | No changes needed — reuses existing `GITHUB_PERSONAL_ACCESS_TOKEN`, `OPENAI_API_KEY`, `ASANA_API_TOKEN`. |
| `justfile` | Add `just assess <args>` recipe for convenience. |
| `README.md` | Add a short "Run a maturity assessment" section. |

## Existing utilities to reuse (do not recreate)

- `src/lib/env.ts::getEnv()` — credential lookup. Per CLAUDE.md, never use `process.env` directly.
- `src/lib/octokit.ts::loadOctokitFromEnv()` — GitHub client (Tier 1 evidence).
- `src/services/asana.service.ts` — Asana data for Q5 dev-loop signals.
- `src/lib/paths.ts::cacheDir()`, `configDir()` — XDG-compliant paths.
- `src/lib/date-utils.ts` — date boundary handling (audits don't strictly need a date window but the cache key benefits).
- `src/adapters/cache/` — existing `FileSystemCacheStore<T>` pattern. New namespace: `~/.cache/teamhero/data-cache/maturity-assessment/`. Cache key includes `RUBRIC_VERSION`, scope (org+repos+path), evidence tier, and interview-answers-hash so changes invalidate.
- `src/lib/json-lines-progress.ts` — JSON-lines emit helpers; extend with `interview-question` event.
- `tui/progress.go` — `progressModel` Bubble Tea integration; `assess_progress.go` reuses the pattern.
- `tui/preview.go` — Glamour markdown preview; `assess_preview.go` mirrors it.
- `tui/forms.go` — `huh` form helpers (`boolSelect`, `validateDate`, `splitCSV`).
- `src/services/ai.service.ts` — OpenAI Responses API call pattern; the new `ai-scorer.ts` follows the same shape (cache the call, log to `ai-batches.log`, use `text.format.json_schema` with `strict: true`).
- `src/lib/renderer-registry.ts` — pattern reference only (we don't register the audit as a report renderer; the audit writer is standalone).
- `tests/helpers/mocked.ts` — test utility for `mock.module()` setups.

## Detailed flow

### 1. CLI invocation
`teamhero assess --org acme --path . --until 2026-05-03 --headless` → `src/cli/index.ts` spawns `tui/teamhero-tui assess <args...>`.

### 2. Go TUI dispatch
`main.go` detects `"assess"` subcommand, parses flags via `flags.go`. If `isHeadless()` → `runAssessHeadless()`; else → `runAssessInteractive()` which runs the wizard, then calls `runAssessHeadless()` with the wizard's config.

### 3. Wizard (interactive only)
`assess_wizard.go` collects:
1. **Scope mode** — Org / local repo / both. (`huh.Select`)
2. **Org name + repo list** if org-mode. Reuses the existing scope-discovery flow (`tui/discover.go`) — same shape as the report wizard.
3. **Local repo path** if local-mode. Defaults to `cwd`. Validate that it's a git repo.
4. **Audit output path** — defaults to `./teamhero-maturity-<scope>-<date>.md`.
5. **Confirmation screen** showing planned scope + adjacent repos detected.
The wizard does **not** ask interview questions yet — those happen during the run, after preflight, so the user sees them in context with progress feedback.

### 4. Subprocess launch & preflight
`assess_runner.go` marshals `AssessConfig` as JSON, spawns `scripts/run-assess.ts` (or compiled service), pipes stdin/stdout. The service:
1. Loads `getEnv()` credentials.
2. Runs `preflight.ts::detectTier()` — checks `gh auth status`, MCP availability (env-var hint: `TEAMHERO_GITHUB_MCP=1`), or falls back to git-only.
3. Emits `progress` event: `{ step: "preflight", status: "complete", message: "Tier 1 (gh)" }`.
4. Reads `docs/audits/CONFIG.md` if running against a local repo to seed prior interview answers.

### 5. Adjacent repo detection
`adjacent-repos.ts` runs the four detection greps from `preflight.md` against the local checkout (or shallow-clones the primary repo if org-mode without `--path`). Surfaces a list to the TUI as a `progress` event with the repo names for transparency.

### 6. Interview round-trip
For each Phase-1 question that doesn't have a fresh answer in CONFIG.md:
1. Service emits `interview-question` event with the question text + suggested options.
2. Go TUI pauses the progress display, renders a `huh.Select` (with free-text "Other" option), captures the answer.
3. Go TUI writes `{"type":"interview-answer","questionId":"q1","value":"…"}` to the subprocess stdin.
4. Service receives, validates, persists in memory, advances to next question.
5. Headless mode: service reads `--interview-answers` JSON file, falls back to `unknown` per the rules in `interview.md`.

### 7. Evidence collection
`evidence-collectors.ts` runs each criterion's deterministic detector (12 collectors). Each emits a `progress` event with the item id and a structured `EvidenceFact[]` payload. Tier-3 (git-only) collectors cap items #2, #3, #9, #11 at 0.5 per the preflight rules.

Asana-backed Q5 signals: if `ASANA_API_TOKEN` is present and the user said "tracked in Asana" in Q5, the collector queries the existing `AsanaService` for AI-related task labels/projects.

### 8. AI scoring
`ai-scorer.ts` builds a single Responses-API call: rubric (full criterion text + score levels), evidence per item, interview answers, scope description. Uses `text.format.json_schema` with `strict: true`. Schema: `{ items: ItemScore[12], topFixes: Fix[3], strengths: string[], oneLineTake: string, notesForReaudit: string[] }` where `ItemScore = { id, score: 0|0.5|1|"n/a", whyThisScore: string }` and the prompt enforces `whyThisScore ≤ 25 words, single sentence`.

A second sanity-check pass runs `scoring.ts::computeWeightedScore()` on the AI's per-item scores to compute the weighted % and band — we don't trust the AI for arithmetic.

### 9. Audit output
`audit-writer.ts` renders the markdown using the exact template from `output-template.md` (table per category, summary, maturity-scale row marker, top fixes, strengths, adjacent repos consulted, notes for re-audit). Writes:
- `<output-path>.md`
- `<output-path>.json` (full data: scope, tier, rubric version, item scores, evidence, prompts hash for reproducibility)
- Updates `docs/audits/CONFIG.md` with the confirmed/updated interview answers (only when run inside a git repo).

### 10. Caching
Cache key: `sha256(rubricVersion + scope + evidenceTier + interviewAnswersHash + sinceUntil)`. Stored at `~/.cache/teamhero/data-cache/maturity-assessment/<key>.json`. `--flush-cache maturity` invalidates. The wizard offers "use cached audit" if a fresh one (≤ 7 days) exists.

### 11. TUI preview
After the run, `assess_preview.go` opens a tabbed Glamour preview: **Audit** (rendered markdown), **Evidence** (per-item raw evidence JSON), **JSON Data** (full report). User can `q` to quit, `e` to open in `$EDITOR`.

## Verification

1. **Unit tests** — `just test tests/unit/services/maturity/` should pass; each scoring/collector module has its own `.spec.ts` with golden-file fixtures for representative repos (a high-maturity sample, a low-maturity sample, a tier-3 sample).
2. **Go unit tests** — `cd tui && go test ./...` should pass; `assess_test.go` covers subcommand routing, wizard state machine, interview round-trip protocol against a fake subprocess.
3. **Integration test** — `tests/integration/maturity-end-to-end.spec.ts` runs `scripts/run-assess.ts` with a stubbed AI client (returns a fixed schema-valid response), against a fixture repo, asserts the output markdown matches a golden file (modulo dates).
4. **Live smoke test** — Run against this repo:
   ```bash
   just build-all
   teamhero assess --headless --path . --interview-answers tests/fixtures/maturity/teamhero-answers.json --no-confirm
   ```
   Expect a `teamhero-maturity-teamhero-cli-2026-05-03.md` file in cwd, weighted score in the "Healthy" band, item #7 scoring 1.0 (this repo has CLAUDE.md / AGENTS.md).
5. **Live interactive smoke** — `teamhero assess` (no flags), walk through the wizard, see the 7 questions appear one at a time with `huh` UI.
6. **Coverage** — TS coverage thresholds (85% lines/funcs/stmts, 80% branches per CLAUDE.md) hold for the new `src/services/maturity/` directory; Go coverage stays ≥ 85% for `tui/`.
7. **Lint + security** — `bun run lint` clean, `npx varlock scan` clean.
8. **Docs** — `docs/maturity-skill-ref/` is a build-time reference only; remove from git after the rubric is encoded into `rubric.ts`, OR move to `docs/maturity-skill-ref/README.md` documenting that the rubric is the canonical version while keeping the original SKILL.md/criteria.md/etc. for human readers.

## Sequencing (suggested implementation order)

1. **TS scaffolding** — `rubric.ts`, `types.ts`, `scoring.ts` (pure, easy to test, small).
2. **Audit writer** — `audit-writer.ts` driven by hand-built fixture data; iterate until output matches the template byte-for-byte.
3. **Evidence collectors** — start with the easy 4 (items 1, 7 — repo-file presence; items 5, 6 — file globs). Add gh-based collectors (2, 3, 9, 11) once tier-1 plumbing is in.
4. **Preflight + adjacent repos** — small, isolated.
5. **AI scorer + prompts** — Responses API integration with strict JSON schema; cache + log.
6. **Service runner** — `scripts/run-assess.ts` glues 1–5 together with JSON-lines emit.
7. **Go TUI subcommand** — `assess.go`, `assess_config.go`, headless mode first.
8. **Bidirectional protocol** — `protocol.go` event types, `runner.go` stdin extension, integration test.
9. **Wizard + preview** — `assess_wizard.go`, `assess_preview.go` last (smallest user-facing surface).
10. **Skill + docs + justfile + README**.

## Open questions / risks

- **Bidirectional stdin** is the biggest unknown — the existing `RunServiceRunner` closes stdin after sending config. Option A: keep stdin open for the lifetime of the subprocess (preferred). Option B: use a named pipe / Unix socket (more code). I'll prototype A first; if Bun's stdin handling causes issues we can fall back to B.
- **Anthropic skill conflict** — there's a global `anthropic-skills:agent-maturity-assessment` skill that does the same thing in pure-Claude mode (no binary). The new `claude-plugin/skills/agent-maturity-assessment/SKILL.md` should mention both paths so users in Co-Work / Claude Code without the Team Hero binary still get a working assessment via the Anthropic skill.
- **AI determinism** — even with strict schema, score values can drift between runs. The cache hash includes inputs, so re-running with same inputs returns identical results. For "movement matters more than absolute level" (per the skill), this is acceptable.
- **Local-repo path semantics** — when `--path .` is used inside this very repo, does the assessment count `docs/maturity-skill-ref/` as evidence of item #7 (repo-local agent context)? Probably yes — the rubric says "skill files checked into the repo" qualifies. We'll let the AI judge based on the evidence.
