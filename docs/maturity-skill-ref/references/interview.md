# Phase 1: Org-level interview

Several criteria can't be answered from the codebase alone — they're behavioral, organizational, or policy facts. Phase 1 collects those answers from a human before scoring begins, and persists them to `docs/audits/CONFIG.md` so re-audits can confirm-or-refresh rather than re-interview from scratch.

Read this when running step 3 of *How to run an audit* in `SKILL.md`.

## How to ask the questions — read this carefully

**Phase 1 is a real interview, not a form-dump.** The signal you get back depends entirely on the human actually engaging with each question. If you paste all seven questions in one message and then proceed, the human will skim, give you `n/a` to most, and the audit will be hollow. **Don't do that.**

### The rule

**Ask one question. Stop. Wait for the answer. Only then move to the next question.** This applies even in auto / autonomous modes — the interview is the rare place where blocking on a human is the *correct* behavior, because there is no other source for these answers. Treat each question as a hard checkpoint.

If the user has not yet replied to question N, you may not ask question N+1 and you may not begin evidence gathering. The only exception is if the user explicitly says "skip the rest" or "just score what you can without me" — in which case mark every remaining question `unknown` and proceed.

### Use the structured question UI when it's available

If you have access to a tool that presents the user with a question + a small set of pre-written answer options (in Claude Desktop / Claude Code this is the `AskUserQuestion` tool — the user sees buttons or a list they can click; in other harnesses it may have a different name), **use it for every Phase 1 question**. It dramatically increases response rates and gives you cleaner answers to persist into CONFIG.md.

For each question:

1. Frame the question itself (verbatim from the list below — don't paraphrase, the wording is calibrated).
2. Provide 3-4 answer options that map cleanly to the score levels for the corresponding criterion. Always include an "I don't know / not sure" option — that maps to `n/a`, never `0`.
3. Allow a free-text override so the user can give nuance the options miss.

If no structured-question tool is available in this harness, fall back to plain chat — but still **one question per message, and wait for the reply before sending the next one**.

### Suggested option sets

These are starting points — adapt the wording to the org if you have context, but keep the spread of "good / partial / bad / unknown" intact.

|Q#|Suggested options                                                                                                                                                                                                                                                                                                                                                                          |
|--|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|1 |• Company-paid managed seats + documented data-handling policy<br>• Company-paid seats but governance is loose / no written policy<br>• Mostly personal accounts or free tier; no policy<br>• I don't know                                                                                                                                                                                   |
|2 |• AI allowed in interviews, interviewers trained to assess judgment with AI<br>• AI allowed but assessment is informal / uncalibrated<br>• AI banned, or interviews don't really test technical judgment<br>• I don't know                                                                                                                                                                   |
|3 |• All four DORA metrics tracked on a dashboard the team actually uses<br>• Some DORA metrics tracked but not actively watched<br>• Not really tracked / vibes-based<br>• I don't know                                                                                                                                                                                                        |
|4 |• Consistent upfront design step (ADR / spec / shared-understanding) before agent code<br>• Some engineers do it, others prompt straight into code<br>• No design step — agents are pointed at problems and turned loose<br>• I don't know                                                                                                                                                   |
|5 |• LLMs in product with offline evals + prod telemetry<br>• LLMs in dev loop with tracked metrics — any deliberate tracking counts (Asana, spreadsheet, sprint retro numbers, GitHub label analysis, etc.)<br>• LLMs used but purely gut-feel — no numbers anyone could point to<br>• No LLMs in product or dev loop<br>• I don't know                                                                                                                                                        |
|6 |• Worst-case agent scenarios have been red-teamed; rollback paths documented<br>• Some controls in place but no explicit red-teaming<br>• No red-teaming; agents share human-equivalent prod creds<br>• I don't know                                                                                                                                                                         |
|7 |• Yes — list the repos<br>• No, scope is just the primary repo(s) you've found<br>• I don't know                                                                                                                                                                                                                                                                                             |

## Behavior on each run

1. **Read `docs/audits/CONFIG.md`** for an `## Org-level answers` section.
2. **If the section exists**, present each stored answer to the user verbatim, with the `last_updated` date, and ask: *"Still accurate? (yes / updated answer / I don't know)"*. For confirmation-or-refresh you may batch the stored answers into a single review message — that's a different mode from a fresh interview, because the user is *editing* known state rather than producing it cold.
3. **For any question without a stored answer** (or where the user said the stored answer is no longer accurate), conduct the fresh interview using the **one-question-at-a-time** rule above.
4. **For any question with no stored answer and no fresh answer either** (user says "I don't know"), record the answer as `unknown` in CONFIG.md and score the mapped criterion as `n/a` for this run.
5. **After scoring, write back** the confirmed/updated answers to `docs/audits/CONFIG.md` under `## Org-level answers`, with `last_updated: <today>`. If CONFIG.md doesn't exist, create a minimal version with just this section and add a line to *Notes for re-audit* recommending the user run `setup-agent-maturity-assessment` for full setup.

## Questions to ask (verbatim, in order, one at a time)

Before the first question, send a short framing message: *"I'm going to ask 7 quick questions one at a time — they cover the parts of the audit that aren't visible in the repo. 'I don't know' or 'n/a' is a valid answer to any of them and will mark that criterion as not assessed, not failed."*

1. What AI tooling do engineers actually use day-to-day (Claude, Copilot, Cursor, etc.)? Is it company-paid with managed accounts, or are people using personal accounts or free tiers? Is there a documented policy on what data can be sent to third-party AI providers?
2. Do technical interviews allow candidates to use AI, and are interviewers trained to evaluate *how well* they use it (critique, decomposition, catching wrong outputs)? Or is AI either banned or effectively unassessed?
3. Are all four DORA metrics (deployment frequency, lead time, change failure rate, MTTR) actively tracked and visible to the team — e.g., a dashboard engineers actually look at? Or are some tracked in theory but not used?
4. When engineers hand work to AI agents, is there a consistent upfront design step (ADR, shared-understanding session, spec) before code generation? Or is it ad hoc — some engineers do it, others prompt straight into code?
5. Are LLMs in the product (user-facing features), in the dev loop only, or both? If in the product: is there an offline eval suite plus production telemetry? If dev-loop only: is AI impact tracked deliberately — even a spreadsheet, Asana board, or sprint retro metric counts — or is it purely gut-feel with no numbers anyone could point to?
6. Has anyone explicitly red-teamed a worst-case agent scenario in prod (bad migration, runaway infra change, secret exfiltration)? Are rollback paths for agent-triggered writes documented?
7. Are there adjacent repos I should treat as in-scope that automated detection might miss — e.g., an internal handbook, security/IT policy repo, org-wide `.github` repo, shared skill library?

## Internal mapping (for scoring — do not show to the user)

|Q#|Criterion                            |How to combine with repo evidence                                                                                                                |
|--|-------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
|1 |C8 — Sanctioned AI tooling           |Primary signal. Cross-check `<org>/.github` policies if reachable.                                                                               |
|2 |D12 — Judgment under AI augmentation |Primary signal. Cross-check rubric repo if reachable.                                                                                            |
|3 |A2 — Sub-day integration cadence     |Combine with `gh pr list` / `gh run list` evidence. Repo evidence covers cadence; interview covers metric *visibility*.                          |
|4 |B5 — Design discipline               |Combine with ADR / glossary file evidence. Files prove artifacts exist; interview proves design happens *before* code.                           |
|5 |C10 — Evals for AI-touched code paths|Repo evidence covers product-side evals (`evals/`, `benchmarks/`); interview covers dev-loop measurement, which rarely lives in the repo.        |
|6 |C11 — Blast-radius controls          |Combine with OIDC / IAM / branch-protection grep evidence. Files prove technical posture; interview proves the scenario has been thought through.|
|7 |Scope expansion                      |Merge into the adjacent-repo detection list before evidence gathering. Not a scored criterion.                                                   |

If the user answers "I don't know" to any question, score the mapped criterion as `n/a`, exclude it from numerator and max, and add a line to *Notes for re-audit* in the audit output describing exactly what info would resolve it.

## CONFIG.md storage format

Append to or create `docs/audits/CONFIG.md`:

```markdown
## Org-level answers

last_updated: 2026-05-02

### AI tooling (Q1)
<answer text>

### Hiring (Q2)
<answer text>

### DORA visibility (Q3)
<answer text>

### Design before code (Q4)
<answer text>

### Eval coverage (Q5)
<answer text>

### Blast-radius red-teaming (Q6)
<answer text>

### Out-of-band adjacent repos (Q7)
<answer text>
```

Use `unknown` as the answer text when the user said "I don't know". Do not delete previous answers — update in place so the file's git history shows movement over time.
