---
name: agent-maturity-assessment
description: Run the Agent Maturity Assessment via Team Hero — a 12-criterion diagnostic for engineering organization readiness in the AI-agentic coding era. Items score 0/0.5/1 across four weighted categories (engineering basics 1.0×, knowledge & context 1.5×, AI governance & quality 1.25×, hiring 1.0×), producing a weighted percentage and a raw /12. Use whenever the user wants to audit, diagnose, or score an engineering organization, team, repo, or recently acquired company for AI readiness. Trigger on phrases like "agent maturity", "agent readiness", "AI maturity", "engineering org health", "engineering maturity", "audit the team", "score this repo", "diagnose dev experience", "is this team ready for AI", "is this team modern", "how healthy is this org", or any onboarding-era assessment. Produces a scored audit with item-level evidence, category subtotals, weighted overall score, top fixes, and strengths to preserve.
---

# Run an Agent Maturity Assessment via Team Hero

Team Hero ships a first-class implementation of the Agent Maturity Assessment.
It scores a 12-criterion diagnostic across four weighted categories using a
hybrid pipeline: deterministic detectors gather evidence from the local repo /
GitHub / Asana, a Phase-1 interview captures the org-level signals that aren't
visible in code, and an AI scorer (OpenAI Responses API + strict JSON schema)
produces the final scores, evidence sentences (≤25 words each), top-3 fixes,
and strengths to preserve.

## Detect runtime mode

1. **Binary mode (preferred when available)** — If `teamhero` (or `teamhero-tui`)
   is installed and the user has `OPENAI_API_KEY` configured, use Path A.
2. **Pure-Claude fallback** — Otherwise fall back to the standalone
   `anthropic-skills:agent-maturity-assessment` skill if available, or to
   running the rubric manually using the references below.

```bash
teamhero --version 2>/dev/null || teamhero-tui --version 2>/dev/null
```

## Path A — Team Hero binary mode

### Step 1: Ensure credentials

```bash
teamhero doctor                    # confirms ~/.config/teamhero/.env is healthy
```

If `OPENAI_API_KEY` is missing, ask the user to run `teamhero setup` (or write
the key into `~/.config/teamhero/.env`).

### Step 2: Pick the scope

Ask the user one of:
- A **local repo path** they want audited (default: `cwd`).
- A **GitHub org** name — for an org-wide audit.
- **Both** — when the user wants to assess an org and a representative checkout.

### Step 3: Run the assessment

Headless invocation (preferred when running on behalf of the user):

```bash
# Local repo audit, no interview, dry-run for a quick smoke test
teamhero assess --headless --path . --dry-run

# Real audit against a local repo with interview answers in a JSON file
teamhero assess --headless --path . \
  --interview-answers /path/to/answers.json \
  --audit-output ./audit.md

# Org-wide audit
teamhero assess --headless --target-org acme \
  --interview-answers /path/to/answers.json
```

Interactive (the user walks through scope + the 7 Phase-1 questions one at a
time in the TUI):

```bash
teamhero assess
```

### Step 4: Surface the result

The runner emits two files:
- `<audit-output>.md` — full audit using the canonical template (per-category
  tables, summary, maturity-scale row marker, top-3 fixes, strengths,
  adjacent repos consulted, notes for re-audit).
- `<audit-output>.json` — full data including item scores, evidence facts,
  rubric version, and tier.

Read the markdown back to the user — do not just say "done." Highlight the
band (Excellent / Healthy / Functional but slow / Significant dysfunction /
Triage), the weighted percentage, and the top-3 fixes.

### Notes on the interview

Phase-1 has 7 questions about org-level facts the repo can't answer (AI
tooling, hiring, DORA visibility, design discipline, evals, blast-radius
red-teaming, adjacent repos). The skill's invariant is **one question at a
time** — do not pre-answer or batch them. In `--headless` mode, supply
`--interview-answers <file.json>` with shape:

```json
{
  "q1": "Company-paid Claude with policy",
  "q2": "AI allowed in interviews, interviewers trained",
  "q3": "DORA tracked via Grafana",
  "q4": "Consistent ADR step before agent code",
  "q5": "LLMs in dev loop, tracked in retro metrics",
  "q6": "Worst-case red-teamed, rollbacks documented",
  "q7": "unknown"
}
```

Use `"unknown"` (or `"I don't know"`) to mark a question as unanswered — the
linked criterion will be scored `n/a` and excluded from numerator and max.

### Tier behavior

The runner auto-detects the evidence tier (`gh` CLI authenticated → Tier 1,
GitHub MCP available → Tier 2, git+filesystem only → Tier 3). At Tier 3,
items 2, 3, 9, and 11 are capped at 0.5 because GitHub-side evidence is
needed to award 1.0 confidently.

Override with `--evidence-tier {auto|gh|github-mcp|git-only}` when needed.

## Path B — Pure-Claude fallback

If the binary is not available, defer to the standalone skill bundle (e.g.,
`anthropic-skills:agent-maturity-assessment`) which contains the same rubric,
interview, output template, and preflight references but runs entirely from
within Claude.

## Reference: the rubric

The Team Hero implementation hardcodes the rubric at
`src/services/maturity/rubric.ts` (RUBRIC_VERSION export). The 12 items map
to 4 categories:

| # | Item | Category | Weight |
|---|------|----------|--------|
| 1 | Reproducible dev environments | A. Engineering basics | 1.0× |
| 2 | Sub-day integration cadence with measured outcomes | A. Engineering basics | 1.0× |
| 3 | Testability and the agent inner loop | A. Engineering basics | 1.0× |
| 4 | Observability before features | A. Engineering basics | 1.0× |
| 5 | Design discipline as a first-class practice | B. Knowledge & context | 1.5× |
| 6 | Codebase composed of deep modules | B. Knowledge & context | 1.5× |
| 7 | Repo-local agent context | B. Knowledge & context | 1.5× |
| 8 | Sanctioned, governed AI tooling | C. AI governance & quality | 1.25× |
| 9 | Human review on every PR | C. AI governance & quality | 1.25× |
| 10 | Evals for AI-touched code paths | C. AI governance & quality | 1.25× |
| 11 | Blast-radius controls for agent actions | C. AI governance & quality | 1.25× |
| 12 | Interviews assess judgment under AI augmentation | D. Hiring | 1.0× |

Maximum weighted score: 14.5. Bands: 90%+ Excellent · 75–89% Healthy ·
60–74% Functional but slow · 40–59% Significant dysfunction · <40% Triage.
