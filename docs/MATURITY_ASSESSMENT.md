# Agent Maturity Assessment

Score an engineering organization against the 12-criterion **Agent Maturity Assessment** — a diagnostic for whether an org is ready to ship safely with humans and agents working in parallel on a codebase that doesn't degrade with every iteration.

```bash
teamhero assess
```

The deliverable is a written audit (`teamhero-maturity-<scope>-<date>.md`) plus a `.json` sidecar. The audit shows a per-category score table, a weighted percentage, a maturity band, the top-3 fixes, strengths to preserve, and notes for re-audit.

---

## What gets scored

Twelve items across four weighted categories:

| # | Item | Category | Weight |
|---|------|----------|:---:|
| 1 | Reproducible dev environments | A. Engineering basics | 1.0× |
| 2 | Sub-day integration cadence with measured outcomes | A. Engineering basics | 1.0× |
| 3 | Testability and the agent inner loop | A. Engineering basics | 1.0× |
| 4 | Observability before features | A. Engineering basics | 1.0× |
| 5 | Design discipline as a first-class practice | B. Knowledge & context | **1.5×** |
| 6 | Codebase composed of deep modules | B. Knowledge & context | **1.5×** |
| 7 | Repo-local agent context | B. Knowledge & context | **1.5×** |
| 8 | Sanctioned, governed AI tooling | C. AI governance & quality | 1.25× |
| 9 | Human review on every PR | C. AI governance & quality | 1.25× |
| 10 | Evals for AI-touched code paths | C. AI governance & quality | 1.25× |
| 11 | Blast-radius controls for agent actions | C. AI governance & quality | 1.25× |
| 12 | Interviews assess judgment under AI augmentation | D. Hiring | 1.0× |

Each item scores **1.0** (pass), **0.5** (partial), **0.0** (fail), or **n/a** (genuinely doesn't apply / unknowable from context). Weighted total max: **14.5**.

### Maturity bands

| Band | Range | Interpretation |
|---|---|---|
| **Excellent** | 90%+ | Rare. Confirm with a second pass — first audits often over-score. |
| **Healthy** | 75–89% | Targeted fixes will compound. |
| **Functional but slow** | 60–74% | Real risk of being out-shipped by AI-native competitors. |
| **Significant dysfunction** | 40–59% | Treat as a turnaround. |
| **Triage** | <40% | Stop new feature work until basics are in. |

The bar to clear: **≥11/12 raw and ≥80% weighted.**

---

## Two ways to run

### Interactive TUI

```bash
teamhero assess
```

Same framed two-pane layout as `teamhero report`:
1. **Scope wizard** — pick local repo / GitHub org / both, set display name, confirm.
2. **Progress display** — step list with ✔/✖/○ icons, monotonic progress bar, right-pane configuration summary, the same Bubble Tea program throughout.
3. **Phase-1 interview** — the 7 questions appear **one at a time** as a `huh` select in the left pane (the right pane keeps showing the config summary). Each has a small set of pre-written options plus an "Other (type your own)" free-text option. `I don't know` maps to `n/a` for the linked criterion.
4. **Audit preview** — tabbed Glamour-rendered viewer (Audit / Evidence / JSON Data).

### Headless / scripted

```bash
# Smoke test (no OpenAI call — placeholder scores)
teamhero assess --headless --path . --dry-run

# Real audit of the current repo, with interview answers supplied up front
teamhero assess --headless --path . --interview-answers ./answers.json

# Org-wide audit
teamhero assess --headless --target-org acme --interview-answers ./answers.json

# Both — assess an org and a representative local checkout in one run
teamhero assess --headless \
  --target-org acme --path . \
  --interview-answers ./answers.json
```

When `--interview-answers` is omitted in headless mode, the runner reads `docs/audits/CONFIG.md` (if it exists in the repo). Anything still missing is recorded as `unknown` and the linked criterion is scored `n/a`.

---

## Phase-1 interview

Seven questions cover the parts of the audit that aren't visible in the repo. The wording is **verbatim from the upstream skill** — don't paraphrase.

| Q# | Question | Linked criterion |
|----|----------|---|
| 1 | What AI tooling do engineers actually use day-to-day? Is it company-paid? Is there a data-handling policy? | #8 Sanctioned AI tooling (primary) |
| 2 | Do interviews allow candidates to use AI and assess judgment under AI? | #12 Hiring (primary) |
| 3 | Are all four DORA metrics tracked and visible to the team? | #2 Cadence (combined) |
| 4 | Is there a consistent upfront design step before agent code generation? | #5 Design discipline (combined) |
| 5 | LLMs in product / dev loop? With evals or just gut feel? | #10 Evals (combined) |
| 6 | Has anyone red-teamed worst-case agent scenarios in prod? | #11 Blast-radius (combined) |
| 7 | Adjacent repos detection might miss (handbook, .github, skills, etc.)? | scope expansion |

### `answers.json` shape

```json
{
  "q1": "Company-paid Claude with documented policy",
  "q2": "AI allowed; interviewers trained to assess judgment with AI",
  "q3": "DORA tracked via Grafana the team checks daily",
  "q4": "Consistent ADR step before agent code",
  "q5": "LLMs in dev loop; tracked via sprint retro metrics",
  "q6": "unknown",
  "q7": "No"
}
```

Use `"unknown"` (or `"I don't know"`) to mark a question as unanswered.

---

## Evidence tiers

The runner auto-detects the highest-fidelity evidence path available.

| Tier | Detection | What's available |
|---|---|---|
| **1 — `gh` CLI** | `gh auth status` succeeds | Full GitHub API: PR cadence, lead time, review depth, branch protection, environment protection rules, deployment runs |
| **2 — GitHub MCP** | `TEAMHERO_GITHUB_MCP=1` env var set | Equivalent fidelity routed through an MCP server |
| **3 — git-only** | Inside a git repo, no `gh` or MCP | Local filesystem + `git log` only. Items #2, #3, #9, #11 are **capped at 0.5** because GitHub-side evidence isn't observable. |

Override with `--evidence-tier auto|gh|github-mcp|git-only`.

---

## CLI reference

### Scope flags

| Flag | Purpose |
|---|---|
| `--scope-mode {org\|local-repo\|both}` | Override scope (auto-inferred from other flags) |
| `--target-org <name>` | GitHub org name (org or both modes) |
| `--target-repos <list>` | Comma-separated repo names — narrows the scope inside the org |
| `--path <path>` | Local repo path (local-repo or both modes) |
| `--display-name <name>` | Override the audit's scope display name |

### Run flags

| Flag | Default | Purpose |
|---|---|---|
| `--headless` | auto | Skip the wizard; auto-detected in CI / piped stdin |
| `--evidence-tier <tier>` | `auto` | Pin the evidence tier |
| `--interview-answers <file>` | (none) | JSON file with pre-supplied Phase-1 answers |
| `--audit-output <path>` | timestamped, cwd | Override output file path |
| `--audit-output-format {markdown\|json\|both}` | `both` | Output format |
| `--dry-run` | false | Skip the AI scorer; emit a placeholder audit |
| `--flush-assess-cache` | false | Flush cached assessment(s) before running |
| `--show-assess-config` | false | Print saved configuration as JSON and exit |

Run `teamhero assess --help` for the full list.

---

## How scoring works

1. **Preflight** auto-detects the evidence tier.
2. **Adjacent repo detection** scans workflow `uses:`, Terraform module sources, submodules, and README cross-refs to find sibling repos. Surfaced in the audit's *Adjacent repos consulted* section.
3. **Phase-1 interview** captures the 7 org-level answers (interactively, from `--interview-answers`, or from `docs/audits/CONFIG.md` if it exists). Confirmed answers are written back to `CONFIG.md` after every successful run.
4. **Evidence** — 12 deterministic detectors run against the local repo and emit structured facts (positive / neutral / negative signal) per criterion.
5. **AI scoring** — OpenAI Responses API with `text.format.json_schema` strict mode receives the rubric, evidence, and interview answers; returns per-item scores, ≤25-word evidence sentences, top-3 fixes, and strengths.
6. **Tier-3 caps** — on git-only audits, items 2/3/9/11 are post-hoc capped at 0.5 even if the AI awarded 1.0 (because GitHub-side evidence isn't observable).
7. **Audit writer** renders the markdown using the canonical template and a `.json` sidecar with the full artifact (rubric version, evidence facts, category subtotals).
8. **CONFIG.md round-trip** — confirmed interview answers persist to `docs/audits/CONFIG.md` so re-audits can confirm-or-refresh rather than re-interview cold.

---

## Output

Two files written to the current directory (or `--audit-output`):

- `teamhero-maturity-<scope>-<date>.md` — full audit using the canonical template
- `teamhero-maturity-<scope>-<date>.json` — full data (rubric version, item scores, evidence facts, category subtotals, interview answers)

### Audit structure

1. **Summary** — raw score, weighted %, band, evidence tier, one-line take
2. **Maturity scale** — band table with ◉ marking the current audit
3. **Scores** — four per-category tables (A/B/C/D) with item, score, and `whyThisScore` (≤25 words each)
4. **Top 3 fixes** — highest-leverage items scoring <1.0, with suggested owners
5. **Strengths to preserve** — what's already working
6. **Adjacent repos consulted**
7. **Notes for re-audit** — calibration warnings, items scored `n/a`, what would resolve them

---

## Configuration

Saved settings live at `~/.config/teamhero/assess-config.json` after each interactive run; headless mode reuses them. Inspect with:

```bash
teamhero assess --show-assess-config
```

### Environment variables

Beyond the core credentials (`OPENAI_API_KEY`, `GITHUB_PERSONAL_ACCESS_TOKEN`), the assess command honors:

| Variable | Purpose |
|---|---|
| `MATURITY_AI_MODEL` | Override AI model for the scorer (falls back to `AI_MODEL`, default `gpt-5-mini`) |
| `TEAMHERO_GITHUB_MCP=1` | Tells the runner a GitHub MCP server is connected → choose Tier 2 instead of git-only |

---

## Re-audit cadence

Re-run **quarterly** against the same org to track movement. Movement matters more than absolute level — the first audit is the baseline, trends are the signal. The runner persists Phase-1 answers to `docs/audits/CONFIG.md` so re-audits can confirm-or-refresh instead of re-interviewing cold.

---

## Troubleshooting

**"OPENAI_API_KEY required for maturity assessment AI scoring"** — set the key in `~/.config/teamhero/.env` (via `teamhero setup`) or pass `--dry-run` for a placeholder audit.

**Wizard runs but no questions appear in interactive mode** — confirm you're running the latest binary (`just build-all` from the project root, or download a fresh release). Earlier builds released the alt-screen for each question; the current build hosts the form inside the framed layout.

**Items 2/3/9/11 scored 0.5 even though the team is great at them** — you're on Tier 3 (git-only). Run `gh auth login` first, or run from a sandbox with `TEAMHERO_GITHUB_MCP=1` set, to unlock the full GitHub-side evidence path.

**Audit shows `unknown` for everything** — `--interview-answers` file path was wrong, or the file's keys don't match `q1`–`q7`. Verify the JSON shape.

---

## See also

- [`claude-plugin/skills/agent-maturity-assessment/SKILL.md`](../claude-plugin/skills/agent-maturity-assessment/SKILL.md) — Claude Code plugin skill that documents how to invoke `teamhero assess` from Claude
- [`share/skills/agent-maturity-assessment/`](../share/skills/agent-maturity-assessment/) — self-contained shareable skill bundle (works in any Claude harness without the binary)
- [`docs/maturity-skill-ref/`](maturity-skill-ref/) — canonical upstream skill reference (criteria, interview, output-template, preflight)
- `src/services/maturity/rubric.ts` — hardcoded 12-criterion rubric (the canonical source for what the runner scores)
