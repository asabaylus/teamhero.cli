# Rubric Overview — What the proctor observes

The proctor is a human observer present for the live session. They watch
your screen and your interactions with the AI agent, take notes against a
structured template, and produce a written report. **There are no
scores.** For each dimension the proctor writes a short narrative
observation (3–5 sentences) or records raw counts as facts. The hiring
manager reads the report and decides — the session is one factor among
many.

## Process dimensions — how you work

These describe your workflow during the session, not the quality of any
specific artifact.

### 1. Upfront design & decomposition
Whether you sketch the problem, name constraints, or talk through the
approach before generating code. Either path is fine; the proctor notes
what you actually do.

### 2. Context engineering
How effectively you give the AI agent the context it needs — pointing at
the right files, citing project conventions, attaching examples. The
proctor records a tally (files referenced, glossary terms invoked) and a
short narrative.

### 3. Critical evaluation of AI output
Whether you read and push back on what the AI produces, or accept it
verbatim. Rejecting, editing, or correcting AI suggestions is a positive
signal — it shows judgment, not unfamiliarity.

### 4. Verification discipline
How often you run tests, read diffs, and check outputs between AI
exchanges. Tally only; no narrative.

### 5. Course correction
How you respond when an approach isn't working — rolling back, reframing
the prompt, switching strategies. The proctor distinguishes productive
correction from thrashing.

### 6. Risk awareness
Whether you notice and pause on destructive or hard-to-reverse operations
(force pushes, `rm -rf`, schema-altering migrations). The proctor logs
any destructive command and the pause/confirm interval.

## Outcome dimensions — what you produced

These describe the final state of your repo at the end of the time-box.

### 7. Architectural quality
A narrative observation on modularity, naming, and separation of concerns
in the final code.

### 8. Test pass / spec satisfaction
Whether the submission passes the acceptance tests for the project.
Recorded as pass/fail per criterion.

### 9. Throughput
How you paced the work — time-to-first-passing-test, total elapsed time,
commit cadence. Recorded as raw timestamps and durations.

---

## Scope of observation

The proctor observes:

- Your screen and the repository under evaluation.
- Your interactions with the AI agent (prompts in, output out).
- Commands you run in the terminal.
- Any think-aloud commentary you choose to offer.

The proctor does not observe:

- Anything outside this repository or the proctored session window.
- Audio or video beyond what the consent form signed at session start
  authorizes.
- Comparisons with other candidates. Each candidate is evaluated
  independently.
- The interviewer's verbal commentary as evidence about you — interviewer
  remarks are situational context only, not judgments about your skill.

## Proctor protocol

- The proctor uses a structured note template (one section per dimension)
  and writes during and immediately after the session.
- The proctor does not coach, hint, or evaluate aloud. Clarifying
  questions about the task itself are answered briefly and without
  leading.
- If the proctor flags a destructive command (Dimension 6), they note it
  silently. They do not intervene unless the operation would damage
  shared infrastructure outside the candidate's sandbox.
- Tooling note: the proctor may capture timestamps from screen recording
  or terminal scrollback after the session to ground Dimensions 4, 6, and
  9. They do not infer intent from a recording — only the live session
  counts as observation.
