# Interview Classification — Methodology and Ethics Rationale

This document accompanies the interview rubric. It exists for two reasons:

1. **Defensibility.** If a hiring decision informed by this tool is ever
   legally challenged, this document is the methodology of record. It states
   what the AI does, what it deliberately does *not* do, and why.
2. **Internal honesty.** Anyone running an interview through this tool should
   read the preamble before they trust any output.

The preamble is binding. The per-dimension methodology details that follow are
descriptions of the implementation; they do not soften, qualify, or contradict
the preamble.

---

## Preamble — Ethical Commitments

These four commitments shape every part of the system. They are non-negotiable
and any change to them requires explicit org sign-off.

### 1. Observations, not scores

The AI does not produce a score for a candidate. It does not produce a
per-dimension score, a weighted total, a band ("Strong Hire / Mixed / No
Hire"), or any other reductive label. The output is:

- **Narrative observations** for dimensions where the LLM is the judge —
  1–3 sentences, paired with the reasoning chain that produced them and the
  cited evidence excerpts that ground them.
- **Raw measurements** for dimensions that are deterministically observable —
  e.g. "ran tests 5 times, interleaved with 12 prompts" presented as a fact.

The categorical decision is the hiring manager's, captured in the sign-off
section of each candidate's `summary.md` (Hire / Hire with notes / No hire).
That decision is *theirs*. The AI's output is one input among many.

**Why this matters:** numerical scoring of humans creates harms that
safeguards (opt-in, banners, sign-off) do not fully address — cognitive
anchoring on a number, false precision without true calibration, comparative
drift across candidates, bias amplification when scores are averaged or
thresholded, and increased legal exposure. Observations + evidence +
measurements provide the structure of a rubric without the harms of a score.

### 2. Bias diversification, NOT bias elimination

This tool **never** claims the AI is "non-biased," "objective," "neutral," or
"bias-free." Those claims are factually wrong and indefensible when
challenged.

LLMs trained via RLHF carry well-documented systematic biases:

- **Training-data bias** — overrepresented demographics, languages, cultural
  contexts in the corpus.
- **Preference-tuning bias** — RLHF raters' demographic and aesthetic
  preferences encoded in the "preferred response" signal.
- **Sycophancy** — LLMs tend to agree with their user, including subtly
  approving of what the framing implies they should approve of.
- **Familiarity bias** — model is more familiar with mainstream tools and
  patterns; less-mainstream alternatives are systematically disadvantaged.
- **Verbosity preference** — verbose output rated more favorably than
  concise output, even when concise is better.
- **Name- and demographic-cue bias** — empirically documented disparate
  treatment based on names alone replicates in LLM evaluators.

The defensible claim about the AI is this: **the AI offers a structurally
different perspective with different biases than the human reviewer.** Two
imperfect perspectives covering different blind spots is genuinely better
than one — but only because the *overlap set* of biases is smaller, not
because either perspective is unbiased.

Critically, AI bias is *systematic across all evaluations* — every candidate
faces the same biased model — while individual reviewer biases are local.
This means AI bias can scale harm more efficiently than individual bias if
deployed without the safeguards in commitment #3.

### 3. Human-in-the-loop is mandatory

Every interview run **requires** a human hiring manager to read the AI's
observations and write a sign-off. The sign-off has three categorical
outcomes (Hire / Hire with notes / No hire) plus a free-form reasoning field
where the manager explains their decision in their own words.

The tool refuses to consider an interview "complete" without this sign-off.
The cohort report displays sign-off status and the manager's recommendation
only — it does not display anything the AI produced as a verdict.

The standing copy at the top of every per-candidate audit and the cohort
report reads:

> ⚠ THIS AUDIT IS ADVISORY. Hiring decisions are made by humans using
> professional judgment. The candidate is a person, not a score. This rubric
> is one factor among many; your evaluation is the primary, first, and most
> important basis for your decision.

This is not boilerplate; it is the load-bearing framing of the tool.

### 4. GDPR Article 15 caveat — candidate audit access (MVP)

GDPR Article 15 ("right of access by the data subject") grants candidates in
the EU/EEA the right to obtain confirmation of, and access to, personal data
processed about them. The observations and measurements this tool produces
about a candidate fall within scope.

**MVP behavior:** candidate-facing audit access is **not** included. The
audit artifacts are stored locally on the hiring manager's disk and shared
only within the company. This is a *deliberate constraint*, not an oversight:
exposing the audit externally introduces legal review burden the MVP cannot
absorb.

**Implications the company must accept when running the tool in EU/EEA
contexts:**

- A candidate filing an Article 15 request must be served via the company's
  existing data-subject-request process. The company is responsible for
  producing the audit artifacts on request, not the tool.
- The candidate must be informed at the start of the interview that AI
  observation is occurring (consent / transparency obligation under Article
  13). This is implemented as the opt-in privacy gate in `bootstrap` and is
  reproduced in the per-candidate `PRIVACY_RELEASE.md`.
- Candidates do not see the AI's narrative observation about them as part of
  the standard hiring process. If a request is made, the audit is shared in
  full — the reasoning chain is preserved precisely so this is possible
  without redaction surprises.

A future enhancement may add a candidate-facing audit-access flow. Until that
is built and legally reviewed, the MVP default stands: company-only access,
candidate-served-on-request via existing processes.

---

## Per-dimension methodology

The implementation details below describe *how* observations and measurements
are produced for each dimension. They do not change anything in the preamble.

### 1. Upfront design & decomposition (`upfront-design`)

**Evidence mode:** llm-judge.

The LLM observer reads the interview log and terminal recording, looking for
evidence of decomposition behavior before the candidate began prompting:
explicit problem framing, identification of constraints, sketching of
interfaces or data flow, alignment on approach.

Output: narrative observation (1–3 sentences), reasoning chain, and 1–3
evidence excerpts cited from the interview log or transcript.

### 2. Context engineering (`context-engineering`)

**Evidence mode:** hybrid.

Deterministic extractor counts: CLAUDE.md references in prompts, glossary
terms used, file paths cited verbatim, examples provided as context.

LLM observer interprets the counts in context: high counts with poor
relevance are different from low counts with high relevance. Narrative
observation pairs with the raw counts.

### 3. Critical evaluation / "tasting" (`critical-evaluation`)

**Evidence mode:** llm-judge.

LLM observer scans the diff stream and prompt log for evidence of the
candidate rejecting, modifying, or pushing back on AI suggestions versus
accepting them verbatim. Reasoning chain preserved alongside the
observation.

### 4. Verification discipline (`verification`)

**Evidence mode:** deterministic.

Deterministic extractor counts: test invocations, type-check invocations,
diff/grep commands, manual verification commands. Reports the count and
interleaving rhythm (e.g. "8 test runs, alternating roughly every other
prompt").

No LLM observation is generated for this dimension. The facts speak for
themselves.

### 5. Course-correction (`course-correction`)

**Evidence mode:** hybrid.

Deterministic extractor detects course-correction signals: `git reset`,
`git checkout --`, file rollbacks, prompt re-asks, abandoned branches.

LLM observer pairs the detected signals with a narrative observation about
whether they reflect productive correction or thrashing.

### 6. Risk awareness (`risk-awareness`)

**Evidence mode:** deterministic.

Deterministic extractor detects destructive operations (`rm -rf`, `git push
--force`, schema-altering migrations, prod-affecting commands) and reports
them with timestamps and the pause-before-Enter duration if available.

No LLM observation is generated. The detected events and timings are the
output.

### 7. Architectural quality (`architectural-quality`)

**Evidence mode:** llm-judge.

LLM observer reads the final repo state and produces a narrative observation
on modularity, naming, separation of concerns, and depth of abstraction.
Reasoning chain preserved. Cited evidence excerpts from the produced code.

### 8. Test pass / spec satisfaction (`test-pass`)

**Evidence mode:** deterministic.

Deterministic extractor runs the role-specific acceptance tests against the
candidate's final repo state and reports pass/fail per acceptance criterion.

No LLM observation is generated. Pass/fail is a fact.

### 9. Throughput (`throughput`)

**Evidence mode:** deterministic.

Deterministic extractor reports timestamps from the terminal recording, git
log, and agent log. Reports time-to-first-passing-test, commits within the
time-box, and total elapsed time. No LLM interpretation.

---

## Interviewer-bias guard (binding)

Audio transcripts and interviewer notes are fed to the LLM observer as
context. A biased interviewer remark ("she seemed nervous", "he was
hesitant") can propagate into the AI's narrative observation if not guarded
against.

The observation prompt MUST include this instruction verbatim:

> The audio transcript and interviewer notes are provided as context about
> what was happening during the session. Treat the interviewer's verbal
> commentary as situational context only — do NOT weight it as evidence of
> the candidate's skill, competence, or character. Your observations must be
> grounded in the candidate's *actions* (prompts they wrote, tools they used,
> code they produced, tests they ran, decisions they made) — not in the
> interviewer's framing of those actions. If an interviewer remark could be
> interpreted multiple ways, do not let it bias your observation; rely on the
> directly observable artifacts (interview.log, terminal.cast, repo state).

Validation: the first 10 candidates run through the tool will have their
observations inspected for phrasing that echoes interviewer commentary
verbatim. If found, the instruction is tightened further before broader use.

---

## Schema-level guard against scoring drift

The LLM is called via the OpenAI Responses API with a strict `json_schema`
that explicitly omits `score`, `weighted_total`, `raw_total`, `band`,
`signal_count`, and similar reductive fields. The schema is `strict: true`,
which means a response containing any unlisted field is rejected at the
provider level — the LLM cannot drift into scoring even if prompted to.

If the schema is ever relaxed, this document and the rubric must be
re-reviewed in the same change. This guard is load-bearing.
