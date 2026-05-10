# Plan — Candidate Interview Grader

> **Status:** Design landed via grilling session 2026-05-09 (revised same day across multiple architectural and product refinements; final ethical revision drops all numerical scoring in favor of observations + raw measurements). **All open questions are resolved.** Implementation should begin only when the user gives explicit go-ahead.

## Context

We are adding a **candidate-screening tool** that surfaces structured observations about how engineers collaborate with generative AI during a live-observed coding interview. The tool produces:

- A per-candidate two-tier audit (lightweight observation summary + drill-down audit log), and
- A cohort-level summary that lists all candidates for a role with sign-off status — no comparative ranking.

This feature is the **implementation side of maturity criterion D12** ("Interviews assess judgment under AI augmentation") from the Agent Maturity Assessment work on `claude/condescending-tereshkova-88a936`. A team that ships this feature is *how* a team scores 1.0 on D12.

Strategically, it joins `report` and `assess` as the third pillar of an **engineering-org-effectiveness suite**:

| Tool | What it produces | Granularity |
|---|---|---|
| `teamhero report` | Team output / activity report | Per-team, per-window |
| `teamhero assess` | Org readiness for agentic AI (12 criteria, scored) | Per-org, scored |
| `teamhero interview` *(this feature)* | Per-candidate AI-collaboration observations (9 dimensions, no scores) | Per-candidate, observed |

Note: `assess` produces scores because it scores an *organization* (a non-human entity); `interview` does NOT produce scores because it observes a *person*. The ethical floor for evaluating humans is higher.

## TL;DR — Headline Decisions

1. **Build the skill, don't buy.** None of TestGorilla / Eximius / Coderbyte / HackerEarth / Glider.ai / CoderPad / Codility Cody ship rubric-based AI-collaboration assessment. Codility Cody is the closest commercial fit (provides runtime + transcript) but lacks the analyzer.
2. **Kit + service, not hosted sandbox.** Build effort drops ~85% (from 3–4 months to 3–4 weeks).
3. **Candidate uses their own stack.** Live observation by the interviewer absorbs cheating risk. Interviewer-side captures audio transcript via Granola/Fireflies/Otter.
4. **$50 gift card per candidate** covers any token / subscription expense regardless of stack.
5. **macOS / Linux / WSL only at MVP.**
6. **DDD namespace: `teamhero interview <verb>`.** All interview-related actions live under a single bounded-context command.
7. **One skill handles the entire bounded context.** `~/.claude/skills/teamhero-interview/SKILL.md` — a thin wrapper that knows about all verbs and invokes the CLI accordingly. **The skill must handle all of the things we need to do within the interview** — exactly one skill, not one per verb.
8. **Two project modes per role:** (A) AI-bootstrapped extension project, or (B) greenfield from brief. Hiring manager chooses at bootstrap time.
9. **Time box presets** 60 / 90 / 120 min, fixed per-project.
10. **CLI is load-bearing; skill is thin wrapper.** Same pattern as `agent-maturity-assessment` skill wrapping `teamhero assess`.
11. **Hybrid evidence collection per dimension:** 4 deterministic (raw measurements), 2 hybrid (measurements + narrative observation), 3 LLM-judge (narrative observation only).
12. **One mega-call** to the Responses API generates narrative observations across all LLM-judge dimensions in a single strict `json_schema` request, with cited evidence excerpts. **No scores are produced — only observations and evidence.**
13. **Two-tier output:** lightweight `summary.md` (hiring manager's first read, observation-formatted) + drill-down `audit.md` + `audit.json` + raw `evidence/`.
14. **TUI parity required:** the implementer MUST mirror existing `tui/report*.go` and `tui/assess*.go` patterns. Hard requirement, not stylistic preference.
15. **Standalone classification-rationale document** (`docs/interview-classification-rationale.md`) explains the methodology — including why we collect observations rather than scores — for hiring-decision defensibility.
16. **AI analysis is opt-in per role.** Bootstrap wizard asks the hiring manager whether they want AI-assisted observation generation or human-only review. The hiring manager — not the tool — decides which review style this role uses.
17. **AI output is advisory, never determinative.** The TUI, every audit document, and the cohort summary MUST prominently display a human-stakes warning. The candidate is a person; the hiring manager's professional evaluation is the primary, first, and most important factor.
18. **No numerical scoring; observations and raw measurements only.** No per-dimension scores, no weighted total, no high/mid/low band, no ranking math. The AI produces narrative observations per LLM-judge dimension and raw measurements per deterministic dimension. The hiring manager evaluates the observations and evidence and makes all comparative judgments themselves. **This is an ethical decision driven by cognitive anchoring, false precision, comparative drift, bias amplification, and legal exposure concerns** — see the [Why Observations, Not Scores](#why-observations-not-scores) section for the full rationale. The rubric becomes a structured evaluation lens, not a measurement instrument; this aligns with how Matt Pocock teaches good AI-coding practices — through observation and pattern recognition, not numerical reduction.
19. **No pre-production calibration against past hires.** The rubric IS the methodology framework; the LLM produces observations within that framework; the human signs off.
20. **Three rubric modes per role**, selected by the hiring manager at bootstrap time:
    - **Custom prompt** — manager provides their own observation prompt
    - **Default rubric** — canonical 9-dimension framework, no JD
    - **Default rubric + job description** — canonical framework + markdown JD as additional context
21. **Job description as input** — markdown only at MVP (no URL fetching, no PDF parsing).
22. **Two-step cohort workflow at MVP, skill-orchestrated.** Step 1: per-candidate observation generation. Step 2: cohort summary roll-up.
23. **Local disk only at MVP, no cloud storage.**
24. **Privacy release as a kit gate.** Candidate must complete `PRIVACY_RELEASE.md` before `start.sh` will proceed.
25. **Retention is manager-discretion.** No automated retention policy enforced by the tool.
26. **Session recording URL captured in frontmatter.** Live-session video stays at the conferencing platform; URL is reference material for the human reviewer only — NOT fed to the LLM.

## Why Observations, Not Scores

The decision to produce observations rather than scores is **the central ethical commitment of this feature.** It is also the decision that makes the tool genuinely useful rather than performatively rigorous.

### What scoring would have introduced

We considered (and initially designed) a scoring system: per-dimension scores of 1.0 / 0.5 / 0.0, a weighted total in the 0.0–1.0 range, and a high / mid / low band classification. We built robust safeguards: opt-in mode, human-stakes warning banners, mandatory sign-off, defensibility documentation. The safeguards mitigate harm but do not eliminate it. Five problems remained:

1. **Cognitive anchoring.** A reviewer who sees "0.6" forms an impression before reading the evidence. Reading is sequential; judgment is not. The framing of "advisory" doesn't undo the anchoring effect — research on numerical anchoring is robust across decades. Even careful reviewers are influenced by the number they saw first.

2. **False precision.** We rejected pre-production calibration. The score, however well-structured the rubric, would be — fundamentally — an LLM's vibe check expressed as a number. Presenting unreliable judgment with three significant figures (or even one) implies measurement quality the methodology does not have. False precision is worse than no precision because it triggers the human's "this looks rigorous" heuristic.

3. **Comparative drift.** We tried to prevent comparative ranking by removing score-ordering from the cohort view. But two `summary.md` files side by side that show "0.7" vs "0.85" invite comparison regardless of how we frame the cohort view. You cannot tell humans not to compare numbers in front of them. The compactness of a numerical score makes it cognitively cheap to compare; the cost of choosing not to compare doesn't enter.

4. **Bias amplification at scale.** Numerical scoring across many candidates enables averaging, thresholding, filtering, and other operations where systemic bias compounds. Even when not intended, the existence of comparable numbers invites operations that amplify whatever bias the rubric encodes. This is exactly the failure mode regulators have flagged in algorithmic hiring tools (NYC Local Law 144, EU AI Act high-risk classification).

5. **Legal exposure asymmetry.** "The AI scored her at 0.6 and we didn't hire her" is a legally fraught artifact. "The AI noted she didn't write tests after accepting AI-suggested code, and we didn't hire her based on multiple factors" is much more defensible. The first invites the discrimination challenge "is the AI biased?" The second invites the challenge "did the human make a fair decision?" — easier to defend with the human's own reasoning artifacts.

### What observations provide instead

Observations + evidence + raw measurements provide **all the value of the rubric structure without these harms.** Compare:

> "She scored 0.7 on architectural quality."

vs.

> "The candidate added the new rate-limiting feature inside the existing `middleware/` module, respecting the existing public interface. However, two helper functions ended up in a new top-level `utils.ts` file rather than within an existing deep module. Tests cover the new behavior but not the helper functions. Cited excerpts: prompt at 00:34:21, file diff at commit `a3f9c0b`."

The second is harder for the AI to produce, more useful for the human, more defensible legally, more ethical, more actionable, and more aligned with how engineers actually develop AI-collaboration skill. The number adds nothing the observation does not already convey better.

### Alignment with how AI-coding practices are actually taught

The rubric's 9 dimensions are grounded in the framing Matt Pocock and other AI-coding educators have articulated: context engineering, "tasting" output for quality, knowing when to drive vs. delegate, treating AI as a junior engineer you mentor and verify. **Pocock does not teach these practices through scoring.** He teaches through observation and pattern recognition — by demonstrating examples of strong and weak practice, articulating the principles, letting engineers internalize the patterns through repeated exposure.

A tool that surfaces observations against a structured rubric is doing exactly what Pocock-style teaching does: structured pattern recognition. A tool that reduces those observations to a number is doing something different — and arguably less useful for the engineer being evaluated, the engineer doing the evaluation, and the integrity of the practice.

### The AI as a structurally different perspective — NOT a "non-biased" perspective

A common (and wrong) framing of AI-assisted hiring tools is that the AI provides a "non-biased" or "objective" viewpoint that compensates for human bias. **This claim is factually incorrect** and the design here does not rest on it.

LLMs trained via RLHF carry systematic biases:

- **Training-data bias** — overrepresentation of certain demographics, languages, and cultural contexts in the training corpus
- **Preference-tuning bias** — the human raters during fine-tuning encode their own demographic and aesthetic preferences into the model's "what is preferred" signal
- **Sycophancy bias** — LLMs are trained to agree with their user, which can subtly slant observations toward what the prompt or framing implies the user expects
- **Familiarity bias** — the model is more familiar with mainstream tools and patterns, which disadvantages candidates using less-mainstream alternatives
- **Verbosity preference** — models tend to view verbose output more favorably than concise output, even when concise is better engineering
- **Name and demographic-cue bias** — empirically documented disparate treatment of candidates based on name alone, even when other inputs are identical

The honest claim about what this tool provides is **bias diversification, not bias elimination**:

- The AI's biases are *different* from any individual hiring manager's biases
- Different biases mean the *overlap set* of biases is smaller than either alone — biases the manager has but the AI doesn't get caught by the AI's perspective; biases the AI has but the manager doesn't get caught by the manager's
- Two imperfect perspectives covering different blind spots is better than one

However:

- AI bias is **systematic across all candidates** (every candidate gets evaluated by the same biased model), while individual manager biases are local
- This means AI bias scales harm more efficiently than human bias
- The observations-not-scores design is one mitigation — numbers compound bias; observations let humans interrogate the reasoning
- The mandatory sign-off, the human-in-the-loop framing, and the reasoning-preserved-in-summary all reinforce that the AI's output is one biased perspective being offered alongside another biased perspective, NOT a corrective ground truth

The classification-rationale doc must capture this honestly. A defense of the methodology that claims "the AI is unbiased" is indefensible when challenged because it is factually wrong. The defensible claim is: "the AI provides a structurally different perspective with different biases, used as one input to a human-led decision process."

### What the human reviewer keeps

The hiring manager's role becomes more demanding, not less. Without a number to anchor on, the manager must:

- Read the observations
- Examine the evidence
- Form their own judgment about each dimension
- Weigh dimensions against each other based on the role's needs
- Make a `Hire / Hire with notes / No hire` recommendation

This is harder than reading a score. It is also exactly what professional hiring judgment looks like. The tool does not replace the manager's thinking; it gives the manager structured material to think with.

### What we lose

| What we lose | Acceptable trade-off? |
|---|---|
| Compactness — cohort view is several lines per candidate, not a single row of numbers | Yes. Hiring decisions should not be one-row-scannable. |
| Apparent rigor of a numerical artifact | Yes. The apparent rigor was misleading; the underlying judgment was not numerical. |
| Override-pattern tracking via score deltas (was a quality-floor mechanism for scoring) | Yes. Replaced with qualitative tracking: when the manager's hire/no-hire diverges from the AI's narrative slant, flag for rubric review. |
| The maturity-assessment-style "score / total / band" output familiarity | Acceptable. The `assess` command scores an organization; `interview` observes a person. Different ethical floor justifies different output. |

### What we keep

- The 9-dimension rubric as a structured evaluation lens
- Cited evidence excerpts pulled from agent log, terminal recording, transcript, and repo
- Raw measurements presented as facts (test counts, timing, destructive-op detection)
- Two-tier output (summary + drill-down audit)
- Privacy release, sign-off step, warning banner
- Single source of truth for the rubric framework
- Comparable rigor across candidates — through structure, not through numbers

## Why Build Lost the Buy Comparison

| Vendor | Candidate uses agent during session | Transcript / prompt log | Automated AI-collab analysis | Defensible-by-design |
|---|---|---|---|---|
| TestGorilla | ❌ AI is the *interviewer* | n/a | n/a | n/a |
| Eximius | ❌ Resume / chat-voice screening | n/a | n/a | n/a |
| HackerEarth | ❌ AI is the *interviewer* | Replay exists; AI-prompt logging not specified | Not documented | Not documented |
| Glider.ai | ⚠️ "AI Assistant" is a hint bot, not a coding agent | Session replay | Not documented | Not documented |
| Coderbyte | ✅ Agent mode (Claude/GPT can edit/create files) | Not documented for AI prompts | Not documented | Not documented |
| **CoderPad** | ✅ AI-enabled IDE | Keystroke playback + prompt history | Not documented (philosophy only) | Not documented |
| **Codility Cody** | ✅ Chat / Agent / Autocomplete; gpt-4o-mini, gpt-5-mini | Full transcripts in post-interview report | ❌ Manual review only — provides scores, not observations | ❌ Score-based |

**Gap nobody fills:** structured AI-generated observations (no scores) on AI-collaboration practices, with cited evidence and a documented human-in-the-loop protocol. Closest commercial fits all produce numerical scores with limited safeguards.

## The Rubric (9 dimensions, two thematic groups)

The rubric is grounded in maturity criteria one level down (org → per-engineer):

### Process dimensions

| # | Dimension | What it observes | Maturity criterion lineage |
|---|---|---|---|
| 1 | **Upfront design & decomposition** | Whether the candidate plans and decomposes before prompting, or prompts straight into code. | B5 |
| 2 | **Context engineering** | Whether the candidate feeds repo context (CLAUDE.md, glossary, file paths, constraints) to the agent. | B7 + Pocock |
| 3 | **Critical evaluation / "tasting"** | Whether the candidate catches AI errors before running them. Whether they reject hallucinated APIs or bad logic. | C9 + Pocock |
| 4 | **Verification discipline** | Whether the candidate writes/runs tests, reads diffs, checks outputs. Or accept-and-pray. | C9 + C10 |
| 5 | **Course-correction** | When stuck, whether the candidate rolls back, reframes, switches approaches. Or thrashes. | Pocock |
| 6 | **Risk awareness** | Whether the candidate pauses on destructive operations. Whether they prefer reversible actions. | C11 |

### Outcome dimensions

| # | Dimension | What it observes | Maturity criterion lineage |
|---|---|---|---|
| 7 | **Architectural quality** | The final artifact: deep modules, clean interfaces, sprawl. | B6 |
| 8 | **Test pass / spec satisfaction** | Whether the work meets the brief. Whether tests pass. | C10 |
| 9 | **Throughput** | Time-to-working solution; how the candidate paced their work. | — |

The dimensions are grouped thematically (process / outcome) for organization, but **there is no weighting** — that would imply scores can be combined, and we don't produce scores. The hiring manager weighs dimensions against each other in their own judgment, informed by the role's needs.

## Evidence Collection Strategy

Each rubric dimension generates evidence using one of three approaches. The output is observations and measurements, not scores.

### Hybrid classification per dimension

| # | Dimension | Approach | Output produced |
|---|---|---|---|
| 1 | Upfront design & decomposition | **LLM-judge** | Narrative observation (1–3 sentences) + cited evidence excerpts |
| 2 | Context engineering | **Hybrid** | Raw signal counts (e.g. "3 CLAUDE.md references in prompts; 7 glossary terms used") + narrative observation |
| 3 | Critical evaluation / "tasting" | **LLM-judge** | Narrative observation + cited diff excerpts showing kept-vs-rejected suggestions |
| 4 | Verification discipline | **Deterministic** | Raw measurements as facts: test-run counts, frequency, interleaving with prompts |
| 5 | Course-correction | **Hybrid** | Detected signals (git resets, prompt re-asks, file rollbacks) + narrative observation |
| 6 | Risk awareness | **Deterministic** | Raw measurements as facts: detected destructive commands, pause-before-Enter timing |
| 7 | Architectural quality | **LLM-judge** | Narrative observation on the final artifact + cited code excerpts |
| 8 | Test pass / spec satisfaction | **Deterministic** | Raw measurements as facts: pass/fail per acceptance criterion |
| 9 | Throughput | **Deterministic** | Raw measurements as facts: timestamps from asciinema + git + agent log |

Totals: **4 deterministic (4, 6, 8, 9), 2 hybrid (2, 5), 3 LLM-judge (1, 3, 7)**.

### Call structure: single mega-call

All LLM-judge dimensions (and the LLM half of hybrid dimensions) generate observations in **one OpenAI Responses API call** using strict `json_schema` returning an array of `Observation` objects. Same shape pattern as the maturity assessment AI scorer (`src/services/maturity/ai-scorer.ts`), but the produced artifacts are observations and reasoning rather than scores.

Rationale unchanged from the prior design: prompt-cache hits perfectly across the rubric definition + evidence package; holistic context (the LLM sees all dimensions at once); single trace; ~5× cheaper than per-dimension calls.

Deterministic dimensions skip the LLM call entirely; their outputs are computed from extracted signals and presented as plain facts.

### Prompt-level guard against interviewer-bias injection

The audio transcript and interviewer notes feed the LLM observer. A biased interviewer remark (e.g., "she seemed nervous," "he was hesitant") can propagate into the AI's narrative observation if not guarded against. The observation prompt MUST include the following instruction verbatim (or a close paraphrase):

> "The audio transcript and interviewer notes are provided as context about what was happening during the session. Treat the interviewer's verbal commentary as situational context only — do NOT weight it as evidence of the candidate's skill, competence, or character. Your observations must be grounded in the candidate's *actions* (prompts they wrote, tools they used, code they produced, tests they ran, decisions they made) — not in the interviewer's framing of those actions. If an interviewer remark could be interpreted multiple ways, do not let it bias your observation; rely on the directly observable artifacts (interview.log, terminal.cast, repo state)."

This instruction tightens the input/output boundary so interviewer bias doesn't compound into AI bias. Implementation: add this paragraph to the LLM-observer prompt template. Validate by inspecting the first 10 candidates' observations for any phrasing that echoes interviewer commentary verbatim — if found, tighten the instruction further.

### Strict JSON schema (for the Responses API call)

```typescript
type Observation = {
  dimension_id: string;            // e.g. "context-engineering"
  observation: string;             // narrative, 1-3 sentences — primary artifact
  reasoning: string;               // unconstrained text; chain-of-thought — preserved in BOTH tiers
  evidence_excerpts: Array<{       // cited evidence supporting the observation
    timestamp?: string;            // ISO8601 if from terminal.cast / interview.log
    source: "terminal.cast" | "interview.log" | "transcript" | "git" | "repo";
    content: string;               // the cited excerpt (truncated to ~200 chars in summary; full in audit)
  }>;
  caveats?: string;                // optional; populated when the observation is uncertain
};

type Measurement = {
  dimension_id: string;
  facts: Array<{                   // raw measurements presented as facts
    label: string;                 // e.g. "Test runs total"
    value: string | number;        // e.g. 5 or "8/8 passing"
    context?: string;              // optional surrounding info
  }>;
};

type GradeResult = {
  rubric_version: string;
  candidate_id: string;
  role_slug: string;
  observed_at: string;             // ISO8601 — note: not "scored_at"
  observations: Observation[];     // for LLM-judge and hybrid dims
  measurements: Measurement[];     // for deterministic and hybrid dims
};
```

Note what's NOT in the schema: `score`, `weighted_total`, `raw_total`, `band`, `signal_count`. The LLM is instructed never to produce a numerical assessment of the candidate. If a future prompt drift produces one anyway, validation rejects the response.

The `reasoning` field is preserved in BOTH tiers (summary and audit). This is intentional: showing the AI's chain-of-thought lets the manager interrogate "why did the AI reach this observation?" without drilling into a separate file. It also reinforces transparency — observations are presented alongside their reasoning so the manager can weigh both. Trade-off: `summary.md` becomes longer (~3–4 pages instead of 1–2). This is acceptable; observation-based output is necessarily longer than score-based output, and we already accepted that trade-off when dropping numerical scoring.

## Two-Tier Output and Defensibility

### Per-candidate output layout

```
docs/interviews/<role-slug>/<candidate>-<date>/
├── summary.md          ← TIER 1: lightweight (~1–2 pages)
│                         Per-dim observation + measurements + cited evidence excerpts.
│                         Sign-off section. Hiring manager reads first.
├── audit.md            ← TIER 2: full reasoning trace per dimension
│                         + complete evidence excerpts + raw signal values
│                         + LLM chain-of-thought reasoning text. Opens only if questions arise.
├── audit.json          ← TIER 2: machine-readable; same content as audit.md
└── evidence/           ← TIER 2: raw inputs preserved verbatim
    ├── interview.log
    ├── terminal.cast
    ├── transcript.txt
    ├── PRIVACY_RELEASE.md (signed)
    └── interviewer-notes.md (if provided)
```

Single observation generation run produces both tiers; no double work.

### Cohort-level output

The cohort summary lists candidates with sign-off status only — no scores, no totals, no ordering by anything that implies ranking.

```
docs/interviews/<role-slug>/COHORT.md
```

Format — one row per candidate, alphabetical or chronological order:

```markdown
⚠ THIS REPORT IS ADVISORY. Hiring decisions are made by humans using
  professional judgment. The candidate is a person, not a score. ...

# Cohort: Senior Backend Engineer (2026 Q2)

| Candidate    | Interviewed   | Sign-off       | Recommendation         | Audit                                              |
|--------------|---------------|----------------|------------------------|----------------------------------------------------|
| Alice Chen   | 2026-05-12    | ✅ Reviewed     | Hire with notes        | [link to summary.md](alice-2026-05-12/summary.md)  |
| Bob Park     | 2026-05-13    | ⏳ Pending      | —                      | [link to summary.md](bob-2026-05-13/summary.md)    |
| Carol Singh  | 2026-05-14    | ✅ Reviewed     | Hire                   | [link to summary.md](carol-2026-05-14/summary.md)  |
```

Hiring manager clicks through to per-candidate `summary.md` for the per-dimension observations. The cohort view has zero numerical content. The `Recommendation` column is the manager's categorical choice from sign-off (Hire / Hire with notes / No hire), not anything the AI produced.

### Per-candidate `summary.md` template

```markdown
---
tags: [hiring, candidate, <role-slug>]
candidate: <candidate-name>
role: <role-slug>
date: <YYYY-MM-DD>
rubric_version: <version>
rubric_mode: default | custom | default-with-jd
signed_off: true | false
session_recording_url: <zoom/teams/meet link, optional>
session_platform: zoom | teams | meet | other | none
session_date: <YYYY-MM-DD, optional>
---

⚠ THIS AUDIT IS ADVISORY. Hiring decisions are made by humans using
  professional judgment. The candidate is a person, not a score.
  This rubric is one factor among many; your evaluation is the
  primary, first, and most important basis for your decision.

# Candidate observations: <candidate-name>

## Process dimensions

### 1. Upfront design & decomposition
**Observation:** [LLM narrative, 1-3 sentences]
**Reasoning:** [LLM chain-of-thought explaining the observation]
**Evidence:**
- [excerpt 1, with source citation]
- [excerpt 2, with source citation]

### 2. Context engineering
**Measurements:**
- CLAUDE.md references in prompts: [n]
- Glossary terms used in prompts: [n]
- Files referenced explicitly in prompts: [n]
**Observation:** [LLM narrative]
**Reasoning:** [LLM chain-of-thought]
**Evidence:**
- [excerpts]

### 3. Critical evaluation / "tasting"
**Observation:** [LLM narrative]
**Reasoning:** [LLM chain-of-thought]
**Evidence:**
- [diff excerpts showing kept-vs-rejected suggestions]

### 4. Verification discipline
**Measurements:**
- Test runs: [n] total, interleaved with [m] prompts
- Diff/grep commands: [n]
- Final test state: [pass/fail counts]

### 5. Course-correction
**Detected signals:**
- Git resets: [n], at [timestamps]
- Prompt re-asks: [n]
- File rollbacks: [n]
**Observation:** [LLM narrative]
**Reasoning:** [LLM chain-of-thought]
**Evidence:**
- [excerpts]

### 6. Risk awareness
**Measurements:**
- Destructive commands detected: [list of commands + timestamps + pause durations]

## Outcome dimensions

### 7. Architectural quality
**Observation:** [LLM narrative on the final artifact]
**Reasoning:** [LLM chain-of-thought]
**Evidence:**
- [code excerpts]

### 8. Test pass / spec satisfaction
**Measurements:**
- Acceptance criteria: [n/m passing]
- Test suite: [n/m passing]

### 9. Throughput
**Measurements:**
- Total elapsed: [HH:MM]
- Time to first passing test: [HH:MM]

## Reviewer sign-off

I have personally reviewed this audit, weighed it alongside my own
professional evaluation of the candidate, and made my hiring
recommendation based on my judgment — not solely on the rubric
observations.

Reviewer name:    ___________________________
Date:             ___________________________
Recommendation:   [ ] Hire   [ ] Hire with notes   [ ] No hire

**Reasoning summary (required, written in your own words):**
Why did you reach this recommendation? What did you weigh most heavily?
Was there anything in the AI's observations you disagreed with, and why?

[ ____________________________________________________________________ ]
[ ____________________________________________________________________ ]
[ ____________________________________________________________________ ]

Additional notes (optional):
[ ____________________________________________________________________ ]

---
*The reasoning summary is required to complete sign-off. The TUI will not
accept a blank field. Its purpose is to ensure the manager has genuinely
engaged with the audit rather than rubber-stamping the AI's observations.*

---
*Generated using rubric v<version>; see [interview-classification-rationale.md](../../interview-classification-rationale.md) for methodology.*
```

### Defensibility document

`docs/interview-classification-rationale.md` covers, for each of the 9 dimensions:

- Why it's classified as deterministic / hybrid / LLM-judge
- What signals are extracted, in what order
- The kinds of observations the LLM is instructed to produce
- Known limitations and observed failure modes
- Version history

**Top-section preamble** establishes the human-in-the-loop principle and the rationale for observations-not-scores before any methodology details. Auditors should encounter the ethical framing first.

## Privacy, Consent, and Storage

[unchanged from prior version — see Privacy Release wording, local-disk-only storage, Obsidian conventions, retention guidance, right-to-erasure]

### Candidate consent (privacy release)

The kit includes `PRIVACY_RELEASE.md` — a consent template that the candidate must complete before `start.sh` will proceed. Default placeholder wording:

```markdown
# Submission Consent

By submitting this work and participating in this interview session, I grant
[Company Name] a non-exclusive, royalty-free license to retain, review, and
analyze:

- This submission, including any captured logs, transcripts, screen recordings,
  and terminal recordings.
- The full audio and video recording of the live interview session conducted
  via [Zoom / Microsoft Teams / Google Meet / other platform], for the purpose
  of evaluating my candidacy.

I acknowledge that:

- Submissions and session recordings may be reviewed by Company personnel.
- AI tools may be used to generate observations about my AI-collaboration
  practices, with all observations reviewed by humans before any hiring
  decision is made.
- AI tools will NOT produce numerical scores about me; they produce
  observations and citations of evidence that humans evaluate.
- AI tools will NOT be given access to the session video recording — it is
  reserved for human reviewer reference.
- **My submission and recordings will NOT be used to train any AI models.**
  Submitted artifacts are used only for the purpose of evaluating my
  candidacy for this role.
- This evaluation does not create an employment relationship.
- I may request deletion of my submission and any associated recordings at any
  time after the evaluation process concludes.
- **If I believe the evaluation contains factual errors or unfair characterization,
  I may contact [Company contact email] within 30 days of receiving a hiring
  decision to request review.** A human reviewer will respond and document
  any corrections.

Signed:    ___________________________
Date:      ___________________________
```

**The kit ships this file marked "REVIEW WITH LEGAL BEFORE USE."**

### Storage: local disk only at MVP

| Artifact | Location | Persistence |
|---|---|---|
| Candidate cloned repos | `~/.cache/teamhero/interview-clones/<candidate-slug>/` | Temporary — deleted after observation generation |
| Per-candidate audits | `<output-dir>/<role-slug>/<candidate>-<date>/{summary.md, audit.md, audit.json, evidence/}` | Persistent — at manager-configured path |
| Cohort summary | `<output-dir>/<role-slug>/COHORT.md` | Persistent |
| Role config | `<output-dir>/<role-slug>/role.json` | Persistent |
| Privacy release | Inside candidate's audit `evidence/` directory | Persistent — preserved as legal record |

`<output-dir>` is configured by the hiring manager at bootstrap time. Default is the teamhero project's `docs/interviews/`, but can point anywhere on local disk — including Obsidian vault subfolders, NAS shares, encrypted volumes, etc.

### Obsidian-friendly conventions

- **YAML frontmatter** on `summary.md` and `audit.md` (see template above) — Obsidian indexes these
- **Wikilinks** between artifacts where helpful
- **Internal-link relative paths** so files render in any markdown viewer

### Retention and right-to-erasure

Manager-discretion. Tool ships with guidance: retain at least until the hiring decision is finalized; longer retention follows company HR policy. GDPR right-to-erasure is trivial — manager deletes the candidate's audit folder.

## Architecture

### Three audiences, three flows

| Audience | When | Tool used | Frequency |
|---|---|---|---|
| **Hiring manager** | Once per role (before candidates start) | `teamhero interview bootstrap` (wizard) | 1× per role |
| **Candidate** | During the interview session | The kit's `start.sh` / `end.sh` | 1× per candidate |
| **Interviewer** | After each candidate's session | `teamhero interview grade` | 1× per candidate |

### CLI namespace (DDD-organized)

```
teamhero interview                   # (no verb) → prints help + verb menu
teamhero interview bootstrap         # MVP: bootstrap a role's project
teamhero interview grade             # MVP: produce observations for a single candidate
teamhero interview cohort            # MVP: produce cohort summary roll-up for a role
teamhero interview list-roles        # v1.5
teamhero interview list-candidates   # v1.5
```

Cohort iteration across candidates is orchestrated by the **`teamhero-interview` Claude skill**, not by a CLI batch mode.

### Repo / module layout

```
src/services/interview/              ← all interview logic, organized by verb
├── bootstrap/
│   ├── project-generator.ts
│   ├── validator.ts
│   └── prompts.ts
├── observe/                         ← formerly "grade/" — observation generation, not scoring
│   ├── evidence-collectors.ts       # per-input adapters (asciinema, JSONL, markdown, audio)
│   ├── deterministic-extractors.ts  # raw measurements for the 4 deterministic dims
│   ├── ai-observer.ts               # mega-call to Responses API for LLM-judge dimensions
│   └── prompts.ts                   # observation-generation prompt + GRADE_RESULT schema
├── cohort/
│   ├── summary.ts                   # cohort listing — no ranking math
│   └── audit-store.ts               # cohort persistence (COHORT.md per role)
└── shared/
    ├── rubric.ts                    # single source of truth, RUBRIC_VERSION
    ├── audit-writer.ts              # both tiers from the same GradeResult
    └── types.ts

scripts/run-interview-bootstrap.ts
scripts/run-interview-grade.ts       ← still named "grade" for CLI familiarity, despite producing observations

tui/interview.go
tui/interview_bootstrap_*.go
tui/interview_grade_*.go             ← UI displays observations, not scores
tui/interview_cohort_*.go

teamhero-interview-kit/              ← candidate-facing recording/logging kit
├── start.sh
├── end.sh
├── INTERVIEW_RULES.md
├── RUBRIC_OVERVIEW.md               ← plain-language summary of the 9 dimensions for the candidate
├── PRIVACY_RELEASE.md               ← placeholder consent template
└── .claude/
    ├── settings.json
    └── CLAUDE.md

~/.claude/skills/teamhero-interview/SKILL.md

docs/
├── 2026-05-09-candidate-interview-grader-plan.md   ← THIS FILE
├── interview-rubric.md                              ← formal rubric (9 dims, observation framework)
├── interview-classification-rationale.md            ← defensibility doc, leads with ethics preamble
└── interviews/<role-slug>/                          ← per-role audit outputs
```

Note the `observe/` subdirectory naming — the architectural code reflects that we're observing, not scoring. The CLI verb stays `grade` for user familiarity (matches the surface area of `teamhero assess`), but internally the verbiage is consistent: observations, not scores.

### The single skill

There is exactly **one** skill for the whole interview domain. It must handle **everything** the engineering manager and interviewer need to do — bootstrap, observation generation, cohort viewing, listing roles/candidates. No business logic in the skill — all logic lives in `src/services/interview/`.

## TUI Implementation Constraints

The implementer **MUST** mirror the existing `report` and `assess` TUI patterns. Before writing any new TUI code, review and match:

| Concern | Reference file(s) | Pattern to preserve |
|---|---|---|
| Wizard layout | `tui/report_wizard.go`, `tui/assess_config.go` | `huh` form prompts, single-column flow, consistent labeling |
| Progress display | `tui/assess_progress.go` | Phase-based framed display, consistent styling |
| Preview tabs | `tui/assess_preview.go`, `tui/preview.go` | Tabbed layout, Glamour-rendered markdown |
| Color scheme & styling | All existing `tui/*.go` | Same lipgloss palette, borders, padding, spacing |
| Headless mode | `src/cli/index.ts` (`report`, `assess` flags) | Same `--headless --foreground --no-confirm` shape |
| JSON-lines protocol | `tui/assess_protocol.go`, `scripts/run-assess.ts` | Same bidirectional event types, line-buffered transport |
| **Human-stakes warning banner** | new — see [Why Observations, Not Scores](#why-observations-not-scores) | High-visibility banner at top of every observation-display screen; cannot be suppressed |
| **Sign-off field rendering** | new | Always rendered at end of `summary.md`; cohort viewer surfaces missing sign-offs |
| **No numerical artifacts in TUI** | new | TUI displays observations and measurements; no scores, no totals, no bands. If a developer is tempted to render a number, double-check it's a *measurement* (e.g. "5 test runs"), not a *score* (e.g. "0.7 architectural quality"). |
| **Sign-off requires manager-written reasoning summary** | new | The sign-off form must include a non-blank free-text field where the manager writes (in their own words) why they reached their recommendation. The TUI rejects empty submission. Forces engagement; prevents rubber-stamping. |

This is an **explicit guard**. AI-driven implementations of new commands have historically lost TUI fidelity. Treat as hard requirement, not stylistic preference.

## Project Bootstrap Modes

When the hiring manager runs `teamhero interview bootstrap`, they choose modes per role.

### Wizard prompt sequence

1. Role title
2. Stack
3. Domain
4. Feature to add
5. **Project mode**: (A) AI-bootstrap extension or (B) Greenfield brief
6. Time box (60 / 90 / 120 / custom)
7. **Analysis mode**: AI-assisted observation generation, or human-only review
8. **Rubric mode**:
   - **Custom prompt** — manager's own observation prompt
   - **Default rubric** — canonical 9-dim framework
   - **Default rubric + job description** — canonical framework + markdown JD
9. **Job description path** (only if rubric mode includes JD)
10. Output directory

Project mode, analysis mode, and rubric mode are first-class active choices — no defaults.

### Mode A: AI-bootstrap extension project (recommended for IC roles)

The bootstrap wizard uses the OpenAI Responses API with a prompt encoding the rubric's structural requirements:

- README.md, CLAUDE.md (agent context + module map), GLOSSARY.md (5–8 ubiquitous-language terms)
- Deep-module structure (≥2 well-encapsulated modules with clean interfaces)
- Deliberate "shallow vs deep" architectural trap
- Failing-but-skipped tests describing the new feature (5–8 acceptance criteria)
- All existing tests passing
- ~400–700 LOC total
- Idiomatic for the chosen stack

Wizard validates structural checks; regenerates up to 3× on failure.

### Mode B: Greenfield from brief (recommended for staff/architect roles)

Wizard generates a `BRIEF.md` template; no starter code; candidate creates everything from scratch. Tests bootstrap discipline.

### Mode coverage of rubric dimensions

[unchanged from prior version — Mode A tests "uses provided context discipline" strongly; Mode B tests "bootstraps own context discipline" strongly]

## Time Box

Configurable per-project (set during bootstrap, fixed for all candidates of that role):

| Preset | Duration | Recommended for |
|---|---|---|
| Focused | 60 min | Smaller scaffolds, junior screens |
| **Standard (default)** | 90 min | Most scaffolds, senior IC and team-lead screens |
| Extended | 120 min | Larger scaffolds, senior architect / staff screens |

Time-box is fixed per-project, not per-candidate.

## End-to-end Flow

### Hiring manager (1× per role)

```
$ teamhero interview bootstrap
[wizard prompts as above]
[service generates per-role repo via Responses API + validates structural requirements]
$ cd <output-dir> && git push -u origin main
```

### Candidate (1× per session)

```
$ git clone <per-role-repo> && cd <repo>
$ # read INTERVIEW_RULES.md and RUBRIC_OVERVIEW.md so you know the rules
$ # and the dimensions you'll be evaluated on
$ # edit PRIVACY_RELEASE.md to sign
$ ./start.sh                         # checks privacy release signed → asciinema + hooks
[code the interview using their own AI stack]
$ ./end.sh                           # stop recording, commit
$ git push (their fork)
```

### Interviewer (1× per candidate)

```
$ teamhero interview grade <candidate-fork-url> \
    --transcript <granola.txt> \
    [--recording <loom.mp4>] \
    [--interviewer-notes <notes.md>] \
    [--session-recording-url <zoom-or-teams-or-meet-link>] \
    [--session-platform zoom|teams|meet|other] \
    [--mode ai-assisted|human-only]
[evidence-collectors → deterministic-extractors + ai-observer (mega-call) → audit-writer]
[outputs: docs/interviews/<role-slug>/<candidate>-<date>/{summary.md, audit.md, audit.json, evidence/}]
[appends to docs/interviews/<role-slug>/COHORT.md]
```

## Inputs the Grader Consumes

| Input | Source | Captures | Required? | Used by |
|---|---|---|---|---|
| Git repo (with no-squash hygiene) | Candidate's GitHub fork | Final artifact, commit chronology | ✅ Required | LLM observer + deterministic extractors |
| `interview.log` | Claude Code hooks (or per-tool native log) | Verbatim prompts, tool calls, AI responses | ✅ Required | Both |
| `terminal.cast` | `asciinema rec` (started by `start.sh`) | Every command, every output, with timing | ✅ Required | Both |
| Audio transcript | Granola / Fireflies / Otter (interviewer-side) | Verbalized planning, course-correction commentary | ✅ Required | LLM observer |
| Screen recording | Loom / Zoom recording | Multimodal context for non-Claude-Code tools | ⚠️ Optional | LLM observer (if provided) |
| Interviewer notes | Structured form | Metacognitive signal automation can't extract | ⚠️ Optional | LLM observer (if provided) |
| **Session recording URL** | Zoom / Teams / Meet platform recording link | Full live-session video — interviewer-candidate dynamics, body language, pressure handling | ⚠️ Optional | **Human reviewer reference only — NOT fed to LLM** |

**Session recording URL is intentionally scoped as human-reviewer reference material, not LLM input.** The recording's value is for the human sign-off step, particularly for borderline interpretations of observations — questions like "did the candidate handle pressure well?" are answered by watching, not by transcript-reading.

## Funding Model

**$50 gift card per candidate.** Universal coverage across all AI tools. Zero infrastructure burden. Net positive on hiring brand. Tool-choice signal stays pure.

## Out of Scope for MVP

- **Numerical scoring of any kind.** Per ethical decision in [Why Observations, Not Scores](#why-observations-not-scores).
- **Comparative ranking math.** Same reasoning.
- **Windows-native support.** WSL is the documented path.
- **Hosted runtime / sandbox.**
- **API-key provisioning for candidates.** Replaced by gift card.
- **Replay UI.** Use raw asciinema playback + the audit tier markdown at MVP.
- **Real-time cheat detection.** Live observation absorbs the cheating risk.
- **Per-role rubric customization beyond default presets.** Single rubric framework at MVP plus the three rubric modes from #20.
- **`teamhero interview list-roles | list-candidates`.** Deferred to v1.5.
- **Cross-role comparison.** Tool stays within-role.
- **Per-dimension calls (vs mega-call).** Mega-call is canonical.
- **Cloud storage / multi-manager sync.** Local disk only at MVP.
- **Candidate-facing audit access.** Candidates do NOT receive the audit by default — only the appeal channel (privacy release) is provided. **Important caveat:** GDPR Article 15 may require disclosure for EU/UK candidates. The classification-rationale doc must call this out so the company knows to revisit if hiring expands to GDPR jurisdictions. Withholding access in those jurisdictions is the legal risk, not granting it.
- **Multi-model evaluation (bias diversification across LLMs).** Deferred to v1.5+. Currently single-model (Opus 4.7).
- **Periodic anonymized bias audit of accumulated observations.** Deferred to v1.5+. Worth planning the data structure now to support it later.

## Open Questions

All open questions are resolved. Implementation can begin when the user gives explicit go-ahead.

## Next Steps — Deferred Until Explicit Go-Ahead

1. Write the formal rubric document (`docs/interview-rubric.md`) — observation framework per dimension, no scoring levels.
2. Write the classification-rationale document (`docs/interview-classification-rationale.md`) — defensibility doc explaining the methodology. **Top-section preamble must establish the observations-not-scores ethical principle, the bias-diversification framing (NOT bias-elimination), and the human-in-the-loop framing before any technical details.** Must also include: (a) explicit acknowledgment that candidates do not receive the audit by default, with a flag that GDPR Article 15 may require disclosure for EU/UK candidates and the company should revisit when expanding internationally; (b) the appeal mechanism documented in the privacy release; (c) the single-model bias limitation and the v1.5 plan for multi-model evaluation.
3. Spec the bootstrap prompt template encoding scaffold requirements.
4. Build `teamhero-interview-kit/` (~2 days). Start macOS/Linux/WSL only.
5. Build `src/services/interview/{bootstrap,observe,cohort,shared}/` and `teamhero interview` CLI subcommand (~2–3 weeks). Lean heavily on the `agent-maturity-assessment` patterns. **TUI must mirror `tui/report*.go` and `tui/assess*.go` exactly. Crucially: TUI must NOT display numerical scores, totals, or bands — only observations and raw measurements.**
6. Build the `~/.claude/skills/teamhero-interview/SKILL.md` skill — single skill for the whole bounded context.
7. Pilot with first batch of real candidates. Manually spot-check observation output for the first 10. Refine the observation prompt based on observed failure modes (e.g., LLM accidentally producing a numerical assessment despite instructions — validation must reject this). Update the classification-rationale doc when the prompt changes meaningfully.
8. v1.5: add `list-roles | list-candidates` verbs.

## References

- `claude/condescending-tereshkova-88a936` branch — Agent Maturity Assessment implementation; this feature reuses much of its scaffolding.
- `docs/2026-05-03-agent-maturity-assessment-plan.md` — sibling plan; same architectural pattern. Note: `assess` produces scores because it scores an organization (a non-human entity); `interview` produces observations because it observes a person (different ethical floor).
- `docs/maturity-skill-ref/references/criteria.md` — full maturity rubric; the 9-dimension interview framework maps to a subset (B5, B6, B7, C9, C10, C11, D12).
- `tui/assess_progress.go`, `tui/assess_config.go`, `tui/assess_preview.go`, `tui/assess_protocol.go` — TUI pattern references.
- `src/services/maturity/ai-scorer.ts` — pattern reference for mega-call to OpenAI Responses API with strict json_schema.
- Matt Pocock — external authority on AI-coding skills for engineers; framing referenced throughout the rubric (context engineering, "tasting" output, knowing when to drive vs delegate). His teaching approach — observation and pattern recognition over numerical reduction — is the model the observation-output approach follows.
