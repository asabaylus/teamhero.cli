---
name: agent-maturity-assessment
description: Run the Agent Maturity Assessment — a 12-criterion diagnostic for engineering organization readiness in the AI-agentic coding era. Items score 0/0.5/1 across four weighted categories (engineering basics 1.0×, knowledge & context 1.5×, AI governance & quality 1.25×, hiring 1.0×), producing a weighted percentage and a raw /12. Use whenever the user wants to audit, diagnose, or score an engineering organization, team, repo, or recently acquired company for AI readiness. Trigger on phrases like "agent maturity", "agent readiness", "AI maturity", "engineering org health", "engineering maturity", "audit the team", "score this repo", "diagnose dev experience", "is this team ready for AI", "is this team modern", "how healthy is this org", or any onboarding-era assessment — even when the user doesn't say "skill". Produces a scored audit with item-level evidence, category subtotals, weighted overall score, top fixes, and strengths to preserve.
---

# Agent Maturity Assessment

A diagnostic for engineering organization health in the AI-agentic coding era. The question this assessment answers: **is this org capable of shipping safely with humans and agents working in parallel, on a codebase that doesn't degrade with every iteration?**

This skill owns the criteria, the scoring rubric, and the audit output format. It runs against either a whole organization or a specific scope (team, product line, repo).

## When to use

- **One-shot audit**: assess an organization's current state during onboarding, or a specific team / repo / acquired company.
- **Recurring**: re-run quarterly against the same org to track movement, or against new sub-teams as they form or get acquired.
- **Spot-check**: a single repo or service can be scored against just the items that apply (note which items were skipped and why).

The artifact is the deliverable. Always produce the written audit using the template in `references/output-template.md` — never just give a verbal summary.

## The 12 criteria at a glance

|# |Item                                              |Category                  |Weight|
|--|--------------------------------------------------|--------------------------|------|
|1 |Reproducible dev environments                     |A. Engineering basics     |1.0×  |
|2 |Sub-day integration cadence with measured outcomes|A. Engineering basics     |1.0×  |
|3 |Testability and the agent inner loop              |A. Engineering basics     |1.0×  |
|4 |Observability before features                     |A. Engineering basics     |1.0×  |
|5 |Design discipline as a first-class practice       |B. Knowledge & context    |1.5×  |
|6 |Codebase composed of deep modules                 |B. Knowledge & context    |1.5×  |
|7 |Repo-local agent context                          |B. Knowledge & context    |1.5×  |
|8 |Sanctioned, governed AI tooling                   |C. AI governance & quality|1.25× |
|9 |Human review on every PR                          |C. AI governance & quality|1.25× |
|10|Evals for AI-touched code paths                   |C. AI governance & quality|1.25× |
|11|Blast-radius controls for agent actions           |C. AI governance & quality|1.25× |
|12|Interviews assess judgment under AI augmentation  |D. Hiring                 |1.0×  |

Each item scores **1.0** (pass), **0.5** (partial), or **0.0** (fail). Be conservative: if it's not visibly true, it's 0.5. If there's no evidence at all, it's 0.

**For full score levels, repo checks, and diagnostic commands per item, read `references/criteria.md`.**

Category B is weighted highest because it compounds — a team that gets B right tends to fix everything else.

## How to run an audit

1. **Decide scope.** Whole org, one product line, one repo, or one team. Score the appropriate level — don't average across heterogeneous teams. A 14-person backend team and a 3-person ML team should be scored separately.
2. **Environment preflight.** Read `references/preflight.md`. Probe for `gh` CLI / GitHub MCP / git access and select an evidence-fidelity tier before running any diagnostics. **Always announce the tier you're running at** so the audit is reproducible.
3. **Phase 1 — Org-level interview.** Read `references/interview.md` first. Read `docs/audits/CONFIG.md` for stored answers, present them for confirmation or refresh, ask fresh for any missing. Do this before evidence gathering so the answers can inform scoring on items 2, 5, 8, 10, 11, 12. **Critical:** ask one question at a time and wait for the answer before asking the next — even in auto / autonomous modes. Use the structured question UI (e.g., `AskUserQuestion`) when available with the option sets in `references/interview.md`. Dumping all 7 questions in one message and proceeding without answers produces a hollow audit; treat each question as a hard checkpoint.
4. **Map adjacent repos.** Read `references/preflight.md` (multi-repo section). CI templates, Terraform modules, QA suites, runbooks, and shared agent context often live in sibling repos. Capture the list before scoring; merge in any out-of-band repos surfaced by Phase 1 question 7.
5. **Gather evidence per item.** Don't take anyone's word for it. For each item, do at least one of: read the repo (and its adjacents), run the diagnostic commands listed in `references/criteria.md` at the highest fidelity tier available, ask a non-leadership IC the diagnostic question, or check the relevant dashboard/settings page. Combine repo evidence with Phase 1 answers using the mapping table in `references/interview.md`.
6. **Score conservatively.** When in doubt, 0.5. Revise up next quarter if evidence appears. If a Phase 1 answer was "I don't know", score that item `n/a` — never `0`.
7. **Write the audit** using the template in `references/output-template.md`. The artifact is the deliverable. Each "Why this score" cell is one sentence, ≤ 25 words.
8. **Update CONFIG.md** with confirmed/updated Phase 1 answers and today's date (see `references/interview.md` for format).
9. **Decide on distribution.** First audit at a new role is usually best kept internal until the calibration has been validated. Re-run in 90 days.

## Scoring

**Raw score**: sum of all 12 item scores. Max 12.

**Weighted score** (recommended primary metric):

```
A_total = sum(items 1–4)   × 1.00     // max 4.00
B_total = sum(items 5–7)   × 1.50     // max 4.50
C_total = sum(items 8–11)  × 1.25     // max 5.00
D_total = sum(item 12)     × 1.00     // max 1.00
                          ──────────
weighted = A + B + C + D
max      = 14.50
score%   = (weighted / 14.50) × 100
```

If any item is scored `n/a`, drop it from both numerator and max for that audit and note it in the Summary.

**Bands**:

|Band                   |Score %|Interpretation                                                                         |
|-----------------------|-------|---------------------------------------------------------------------------------------|
|Excellent              |90%+   |Genuinely rare. Confirm with a second pass — first audits often score too generously.  |
|Healthy                |75–89% |Targeted fixes will compound.                                                          |
|Functional but slow    |60–74% |Real risk of being out-shipped by AI-native competitors. Where most orgs actually live.|
|Significant dysfunction|40–59% |Treat as a turnaround.                                                                 |
|Triage                 |<40%   |Stop new feature work until basics are in.                                             |

The bar: **<11/12 raw and <80% weighted means there's leverage to capture.**

## Operating principles

- **Score conservatively.** Better to score 0.5 and revise up than to over-score on day one and have to explain why everything got "worse".
- **Evidence beats assertions.** A team that says they have ADRs but the last one was committed two years ago scores 0.5, not 1.0.
- **Unknown ≠ failing.** If a criterion can't be answered from the repo and the human indicates the answer is unknown or out of scope, score it `n/a`, drop it from numerator and max, and note what would resolve it. Do not default to 0 for absence of context.
- **Don't average heterogeneous teams.** Score them separately and report side-by-side.
- **Use it as a conversation tool, not a club.** The point is to find leverage, not to grade people.
- **Re-score quarterly.** Movement matters more than absolute level.
- **Calibrate against itself, not against other companies.** The first audit is the baseline; trends are the signal.

## Adapting the assessment

As organizations mature and the AI tooling landscape shifts, expect items to be added, dropped, or re-weighted. Track changes to the assessment itself (not just individual audits) in an `audits/CHANGELOG.md` so historical scores remain interpretable.

## Reference files

- `references/preflight.md` — Environment preflight, evidence tiers, multi-repo scope handling, host-side probe script.
- `references/criteria.md` — Full text of all 12 criteria: score levels, repo checks, diagnostic commands, why each matters.
- `references/interview.md` — Phase 1 questions, internal Q→criterion mapping, CONFIG.md storage format.
- `references/output-template.md` — Audit output template, rules for filling it out, worked example of a "Why this score" cell.
