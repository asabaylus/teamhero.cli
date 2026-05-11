---
name: teamhero-interview
description: Run candidate AI-collaboration coding interviews end-to-end — configure a role and generate the project (bootstrap), review a single candidate's submission with structured observations (review), produce a cohort roll-up across all candidates for a role (cohort). Use this when the user wants to set up an interview, evaluate a candidate's submitted repo, see the full cohort for a role, or asks anything about hiring through the `teamhero interview` CLI.
---

# teamhero-interview — bounded-context skill

This skill is the conversational wrapper for the `teamhero interview` CLI. It
translates the user's natural-language intent into the right verb invocation
and surfaces results back in plain English. **It contains no business logic
of its own.** All hiring-specific logic lives in `src/services/interview/`
in the teamhero.cli repo; this skill only routes.

The bounded context is hiring: configure a role, evaluate a candidate,
review a cohort. Anything outside that belongs to a different skill or no
skill at all.

## Ethical framing — always present these to the user

Before running review or cohort, remind the user of the three commitments
that govern this tool. These are not boilerplate; they shape how the
output should be read:

1. **Observations, not scores.** The tool produces narrative observations
   and raw measurements per dimension, never numerical scores. The hiring
   decision is the human's.
2. **AI bias diversification, not elimination.** The AI carries its own
   biases (training-data, RLHF preference-tuning, name/demographic-cue,
   verbosity-preference). Its perspective is *different* from any
   individual reviewer's, not unbiased.
3. **Human-in-the-loop is mandatory.** Every audit requires a human
   sign-off with a manager-written reasoning summary in their own words
   before the audit is considered complete.

If a user asks the skill to "score the candidate" or "rank these
candidates," redirect: explain the tool does not produce scores, then
offer to render the observations + measurements + sign-off status, which
is the appropriate output for the request.

## Available verbs

### Production verbs (MVP)

#### `teamhero interview bootstrap`
Configures a role and generates the candidate coding project.

**Interactive wizard (primary path for humans in a terminal session).** When
the user is at a TTY and not scripting, recommend they just run:

```
teamhero interview bootstrap
```

with no flags. They will be walked through role slug, stack, domain, feature,
time-box, project mode, analysis mode, and rubric mode (with conditional
follow-ups for custom prompt or job-description file). The wizard hands the
chosen configuration to the same validator the headless path uses.

**Headless flags (agents and CI use this form).** If the user is scripting,
asks for a one-liner, or is invoking via an agent like Claude Code, use the
explicit flag list:

```
teamhero interview bootstrap --headless \
  --role <slug> --stack <stack> --domain <domain> --feature "<one-line spec>" \
  --time-box <minutes> \
  --mode-project A|B \
  --mode-analysis ai-assisted|human-only \
  --mode-rubric default|custom|default+jd \
  --output-dir <path> \
  [--jd-path <md-file>] [--custom-prompt "<text>"] [--role-title "<title>"]
```

When user says: "set up an interview for a senior backend role", "create a
new role", "I need a coding project for candidates", "bootstrap a hiring
round" → run bootstrap.

#### `teamhero interview review <repo-url>`
Reviews a single candidate's submitted repository.

```
teamhero interview review --candidate "Jane Doe" --repo <url> \
  [--transcript <file>] [--interviewer-notes <file>] \
  [--session-recording-url <url>] [--session-platform zoom|teams|meet|other] \
  [--session-date YYYY-MM-DD] [--output-dir <path>]
```

When user says: "review Alice's submission", "evaluate this candidate's
repo", "produce the audit for X" → run review.

Always print the ADVISORY warning banner before reporting results, and
always end by reminding the user the audit is not complete until they
write the sign-off section with their own categorical recommendation
and reasoning summary.

#### `teamhero interview cohort --role <slug>`
Produces a `COHORT.md` roll-up of all candidates for a role.

```
teamhero interview cohort --role <slug> [--order alphabetical|chronological]
```

When user says: "show me the cohort", "list all candidates for the
backend role", "roll up the interviews" → run cohort.

### Stubs (v1.5; not yet implemented)

- `teamhero interview list-roles` — show all configured roles.
- `teamhero interview list-candidates --role <slug>` — show all candidates
  for a role.

If the user asks for these, explain they are planned for v1.5 and offer
the workaround (`ls docs/interviews/`).

## Cohort orchestration — when invoked conversationally

If the user says "review the whole cohort" or "review all candidates for
role X":

1. Locate the role config (typically `docs/interviews/<slug>/role-config.json`
   or `<slug>/role-config.json` in the project root). If candidate URLs are
   listed there, use them. Otherwise ask the user for the list.
2. For each candidate URL the user provides:
   a. Ask the user which transcript file (if any) belongs to that candidate.
      Look in `~/Downloads/`, the project's `transcripts/` directory, or
      anywhere the user indicates. Do NOT guess — ask.
   b. Invoke `teamhero interview review --candidate "<name>" --repo <url> \
        --transcript <path>` and capture the audit.
   c. Report which audit was written (path).
3. After all candidates are reviewed, invoke `teamhero interview cohort
   --role <slug>` and report the path to `COHORT.md`.
4. Remind the user that **each candidate's audit needs a separate sign-off
   from the manager** before it counts as complete, and that no hiring
   decision should be made from the cohort report alone.

## Output style

- Always include the path(s) to written audits/cohort files.
- Never reproduce the AI observer's narrative observations in chat verbatim
  without also including a pointer to the audit.md (the reasoning chain is
  preserved there for a reason — managers should read the full chain, not
  just the summary).
- If a review run fails, surface the failure list literally; do not
  paraphrase the diagnostic.

## What NOT to do

- **Do not produce scores.** If a user prompt would result in a numerical
  rating ("rate Alice 7/10 on context engineering"), refuse and explain.
- **Do not bypass the privacy gate.** If start.sh refuses because
  PRIVACY_RELEASE.md is unsigned, do not work around it — explain to the
  user that the candidate must sign first.
- **Do not feed session_recording_url to the AI observer.** The CLI
  already enforces this; do not paste meeting links into prompt fields.
- **Do not generate any code or schema changes that re-introduce score
  fields.** Slices 1–4 deliberately strip them; the strict json_schema
  validates them out; doing so would violate the tool's ethics floor.
