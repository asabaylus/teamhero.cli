# Rubric Overview — What the AI observes

The AI observer looks at nine dimensions during your interview. **There are
no scores.** For each dimension the AI either writes a short narrative
observation (3–5 sentences) or reports raw measurements as facts. The
human hiring manager reads the observations and decides — your interview
is one factor among many, and the manager weighs each dimension in their
own judgment.

## Process dimensions — how you work

These dimensions describe your *workflow* during the session, not the
quality of any specific artifact.

### 1. Upfront design & decomposition

Whether you sketch out the problem, identify constraints, or talk through
the approach before generating code. Either path is OK; the AI is
observing what you do, not enforcing a single style.

### 2. Context engineering

How effectively you give the AI agent the context it needs to help you
— e.g. pointing it at the right files, citing project conventions,
attaching examples. Both raw counts (how many files referenced, how
many glossary terms used) and a narrative observation.

### 3. Critical evaluation of AI output

Whether you read and challenge what the AI gives you, or accept it as
written. Rejecting, modifying, or correcting AI suggestions is a
positive signal — it shows judgment, not unfamiliarity.

### 4. Verification discipline

How often you run tests, read diffs, and check outputs between AI
exchanges. Raw counts only; no narrative.

### 5. Course correction

How you respond when an approach isn't working — rolling back, asking
the AI to reframe, switching strategies. Productive correction looks
different from thrashing; the AI tries to distinguish.

### 6. Risk awareness

Whether you notice and pause on destructive or hard-to-reverse
operations (force pushes, `rm -rf`, schema-altering migrations). Raw
counts of any detected destructive commands plus the pause time before
you confirmed.

## Outcome dimensions — what you produced

These dimensions describe the *final state* of your repo at the end of
the time-box.

### 7. Architectural quality

A narrative observation on the modularity, naming, and separation of
concerns in your final code.

### 8. Test pass / spec satisfaction

Whether your submission passes the acceptance tests for the project.
Reported as pass/fail per criterion.

### 9. Throughput

How you paced the work — time-to-first-passing-test, total elapsed
time, commit cadence. Reported as raw timestamps and durations.

---

## What the AI does not observe

- Anything you do outside this repository.
- Video of you or your desktop.
- The interviewer's verbal commentary as evidence about you (the AI is
  explicitly instructed to treat interviewer remarks as situational
  context only, not as judgments about your skill).
- Comparisons with other candidates. Each candidate is observed
  independently.

## Why no scoring

Numerical scores compound bias when averaged across candidates and
anchor reviewers cognitively before they read the evidence. Narrative
observations let the manager interrogate the AI's reasoning instead of
the score. We think this is more honest and more useful, and it's the
ethical floor we are committed to. See
`docs/interview-classification-rationale.md` in the company's
teamhero.cli repo for the full ethics statement.
