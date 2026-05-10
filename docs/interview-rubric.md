# Interview Rubric — AI-Collaboration Coding Interviews

**Rubric version:** 1.0.0

This rubric describes the 9 dimensions along which an AI observer and a human
hiring manager will jointly examine a candidate's behavior during a
live-observed coding interview.

It is an **observation framework, not a scoring framework**. There are no
scoring levels (no Strong Hire / Mixed / No Hire bands per dimension; no
numerical scores; no weighted totals). The AI produces narrative observations
and raw measurements; the hiring manager produces the categorical decision in
sign-off. See `interview-classification-rationale.md` for why the system is
deliberately scoreless.

The dimensions are organized into two thematic groups (process / outcome)
**for navigation only**. There is no weighting, and the groups are not summed.

---

## Process dimensions

How the candidate works with the AI.

### 1. Upfront design & decomposition

- **id:** `upfront-design`
- **Evidence mode:** llm-judge
- **What it observes:** Whether the candidate plans and decomposes the problem
  before prompting, or prompts straight into code.
- **Observation output:** Narrative observation (1–3 sentences) plus cited
  evidence excerpts. AI reasoning chain preserved alongside the observation.
- **Measurement output:** None.

### 2. Context engineering

- **id:** `context-engineering`
- **Evidence mode:** hybrid
- **What it observes:** How effectively the candidate primes the AI with
  relevant repository context, constraints, and intent before each significant
  prompt (CLAUDE.md, glossary terms, file paths, examples).
- **Observation output:** Narrative observation plus reasoning.
- **Measurement output:** Raw signal counts (e.g. CLAUDE.md references in
  prompts, glossary terms used, files referenced explicitly).

### 3. Critical evaluation / "tasting"

- **id:** `critical-evaluation`
- **Evidence mode:** llm-judge
- **What it observes:** Whether the candidate reads, interrogates, and
  challenges AI-generated code rather than accepting it on faith.
- **Observation output:** Narrative observation plus cited diff excerpts
  showing kept-vs-rejected suggestions. Reasoning chain preserved.
- **Measurement output:** None.

### 4. Verification discipline

- **id:** `verification`
- **Evidence mode:** deterministic
- **What it observes:** Frequency and rigor of test runs, type checks, and
  manual verification interleaved between AI exchanges.
- **Observation output:** None (deterministic facts only).
- **Measurement output:** Test run count, interleaving with prompts, diff/grep
  commands, final test state.

### 5. Course-correction

- **id:** `course-correction`
- **Evidence mode:** hybrid
- **What it observes:** How the candidate notices, names, and recovers from
  AI mistakes or their own missteps mid-task.
- **Observation output:** Narrative observation plus reasoning.
- **Measurement output:** Detected signals — git resets, prompt re-asks, file
  rollbacks with timestamps.

### 6. Risk awareness

- **id:** `risk-awareness`
- **Evidence mode:** deterministic
- **What it observes:** Recognition of destructive operations, security
  implications, and reversibility before acting on AI suggestions.
- **Observation output:** None (deterministic facts only).
- **Measurement output:** Detected destructive commands, pause-before-Enter
  timing, irreversible-action attempts.

---

## Outcome dimensions

What the candidate produced.

### 7. Architectural quality

- **id:** `architectural-quality`
- **Evidence mode:** llm-judge
- **What it observes:** Whether the final code reflects sound modularity,
  naming, and separation of concerns.
- **Observation output:** Narrative observation on the final artifact plus
  cited code excerpts. Reasoning chain preserved.
- **Measurement output:** None.

### 8. Test pass / spec satisfaction

- **id:** `test-pass`
- **Evidence mode:** deterministic
- **What it observes:** Whether the candidate's submitted solution passes the
  role-specific acceptance tests.
- **Observation output:** None (deterministic facts only).
- **Measurement output:** Pass/fail per acceptance criterion.

### 9. Throughput

- **id:** `throughput`
- **Evidence mode:** deterministic
- **What it observes:** Volume of meaningful progress within the time-box,
  measured as commits, completed features, or tests passed.
- **Observation output:** None (deterministic facts only).
- **Measurement output:** Timestamps from terminal recording, git, and agent
  log; time-to-first-passing-test; commits within time-box.

---

## Evidence mode summary

| Mode | Count | Dimensions |
|---|---|---|
| Deterministic | 4 | verification, risk-awareness, test-pass, throughput |
| Hybrid | 2 | context-engineering, course-correction |
| LLM-judge | 3 | upfront-design, critical-evaluation, architectural-quality |

## Output shape

Observation and Measurement records emitted per dimension. Combined into a
per-candidate `summary.md` (Tier 1, ~1–2 pages) and `audit.md` / `audit.json`
(Tier 2, full reasoning). See the implementation plan for the JSON schema.

No `score`, no `weighted_total`, no `raw_total`, no `band` is produced at any
tier. Validation rejects LLM responses that include such fields.
