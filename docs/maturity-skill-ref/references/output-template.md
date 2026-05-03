# Audit output template

Read this when running step 7 of *How to run an audit* in `SKILL.md`. Always produce this exact structure. The per-criterion tables ARE the report — they should be readable in one pass, especially when comparing audits across multiple repos.

## Rules for filling out the score tables

- Fill in every row. Use `n/a` with a one-line reason if an item genuinely doesn’t apply to the scope or the user marked the corresponding Phase 1 answer as unknown (then exclude that item from both numerator and max in the score math).
- The *Why this score* column is **one sentence, ≤ 25 words**. State the single most decisive piece of evidence — the thing that pushed the score up or down. No bullet lists, no multi-clause sentences stitched with semicolons, no “but also” hedging.
- If you have more to say, save it for *Top 3 fixes*, *Strengths to preserve*, or *Notes for re-audit*. The table is for the verdict, not the working.
- Score in the column as `0`, `0.5`, `1`, or `n/a` — nothing else.

## Template

```markdown
# Agent Maturity Assessment — <scope> — <YYYY-MM-DD>

## Summary
- Raw score: X / 12
- Weighted score: XX.X%
- Band: **<band name>** (<band % range>)
- Evidence tier: **<1: gh / 2: GitHub MCP / 3: git-only>** (see references/preflight.md)
- One-line take: <single sentence>

### Maturity scale (where this audit lands)

| Band | % range | This audit |
|------|---------|:----------:|
| Excellent | 90%+ | |
| Healthy | 75–89% | |
| Functional but slow | 60–74% | |
| Significant dysfunction | 40–59% | |
| Triage | <40% | |

Mark the row this audit falls in with `◉` in the right column; leave the others blank. This makes relative position visible at a glance and survives copy-paste to Slack / a doc / a slide.

## Scores

### A. Engineering basics (weight 1.0×)
| # | Item | Score | Why this score |
|---|------|-------|----------------|
| 1 | Reproducible dev environments | 0/0.5/1 | <one sentence, ≤ 25 words> |
| 2 | Sub-day integration cadence with measured outcomes | 0/0.5/1 | <one sentence, ≤ 25 words> |
| 3 | Testability and agent inner loop | 0/0.5/1 | <one sentence, ≤ 25 words> |
| 4 | Observability before features | 0/0.5/1 | <one sentence, ≤ 25 words> |

Subtotal: X.X × 1.00 = X.X / 4.00

### B. Knowledge & context (weight 1.5×)
| # | Item | Score | Why this score |
|---|------|-------|----------------|
| 5 | Design discipline as a practice | 0/0.5/1 | <one sentence, ≤ 25 words> |
| 6 | Codebase composed of deep modules | 0/0.5/1 | <one sentence, ≤ 25 words> |
| 7 | Repo-local agent context | 0/0.5/1 | <one sentence, ≤ 25 words> |

Subtotal: X.X × 1.50 = X.X / 4.50

### C. AI governance & quality (weight 1.25×)
| # | Item | Score | Why this score |
|---|------|-------|----------------|
| 8 | Sanctioned, governed AI tooling | 0/0.5/1 | <one sentence, ≤ 25 words> |
| 9 | Human review on every PR | 0/0.5/1 | <one sentence, ≤ 25 words> |
| 10 | Evals for AI-touched code paths | 0/0.5/1 | <one sentence, ≤ 25 words> |
| 11 | Blast-radius controls for agents | 0/0.5/1 | <one sentence, ≤ 25 words> |

Subtotal: X.X × 1.25 = X.X / 5.00

### D. Hiring (weight 1.0×)
| # | Item | Score | Why this score |
|---|------|-------|----------------|
| 12 | Judgment under AI augmentation | 0/0.5/1 | <one sentence, ≤ 25 words> |

Subtotal: X.X × 1.00 = X.X / 1.00

## Top 3 fixes (highest leverage)
1. **<item>** — why this one, what good looks like, suggested owner.
2. **<item>** — …
3. **<item>** — …

## Strengths to preserve
- <thing the team is doing right that shouldn't get broken during change>
- <ditto>

## Adjacent repos consulted
- `<org>/<repo>` — <one-line: why it was relevant, e.g., "Reusable workflow `org/ci-templates/.github/workflows/deploy.yml` referenced by this repo's deploy.yml">
- `<org>/<repo>` — …

(If none: write "None — all evidence within scope repo.")

## Notes for re-audit
- <calibration notes, things to recheck next quarter>
- <items scored n/a and what info would resolve them>
```

## Worked example of a “Why this score” cell

Do not include this in actual audits — it’s a calibration example for getting the cell length right.

|Quality   |Cell content                                                                                                                                                                                                                           |
|----------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|Too long  |`pnpm -r test resolves to nothing — no package implements test. ci.yml line 80: dotnet test || true with comment 'no real tests yet'. Zero test files anywhere. Architecture is testable in principle but the inner loop runs nothing.`|
|Too vague |`No tests exist.`                                                                                                                                                                                                                      |
|Right size|`CI runs dotnet test || true, no test files exist anywhere, and the architecture's seams sit unused.`                                                                                                                                  |