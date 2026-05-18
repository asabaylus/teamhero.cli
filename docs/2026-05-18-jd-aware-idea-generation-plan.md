# JD-Aware Idea Generation for the Interview Bootstrap Wizard

> **Status:** Design approved 2026-05-18. Ready for implementation planning.
>
> **Scope:** Two surgical additions to the interview bootstrap wizard's idea-suggestion step:
> 1. Feed the attached job description into the idea-generation prompt when the hiring manager has opted in.
> 2. Add a "Generate a fresh set…" affordance to the idea picker so the manager can re-roll if no idea fits.

## Context

The interview bootstrap wizard (`tui/interview_bootstrap_*.go`) lets a hiring manager configure a coding-interview project. When the manager picks "Suggest project ideas for me" on the feature-source step, the TUI calls the OpenAI Responses API and renders 3–5 ideas as a `huh.Select`.

Today's idea-generation pipeline has two gaps:

1. **The JD body is not in the prompt.** The wizard already collects a JD path and a `jdInfluencesProject` yes/no toggle. But `IdeaProfile` (the prompt input) only carries scalar role-config fields: `Role`, `RoleTitle`, `Stack`, `Domain`, `Feature`, `TimeBoxMinutes`, `ProjectMode`. The JD content never reaches `buildIdeaPrompt`. As a result, ideas don't reflect the company's industry or product surface even when the manager has explicitly opted to share the JD.

2. **There is no "regenerate" affordance.** If none of the returned ideas fit, the manager has to back up multiple steps (or accept an idea they don't want and edit it later). The picker has no first-class way to ask for a fresh batch.

This design closes both gaps with the smallest possible surface change.

## Decisions

1. **JD flows into the prompt only when `jdProvided == "yes"` AND `jdInfluencesProject == "yes"`.** Honors the existing toggle semantics ("JD informs review only" vs "JD shapes what the candidate sees"). The toggle is the user's explicit consent; we don't override it.

2. **Regenerate appears as the final option in the existing `huh.Select`** ("↻ Generate a fresh set…"), not as a separate button or keybinding. Zero new widgets, zero new keybindings, full discoverability.

3. **Each regeneration accumulates previously-shown titles as anti-examples** in the prompt. A third regeneration sees titles from batches one and two; this prevents the model from re-emitting near-duplicates as the manager keeps re-rolling.

4. **No regeneration cap.** ~$0.001 of gpt-5-mini tokens per regen; 15–45s of wall time is its own throttle.

5. **Company section of the JD anchors the business domain of generated ideas.** The prompt instructs the model to read the company/about paragraph (the "about the company" block that opens most JDs) and ground the project's domain in that company's industry. Without this explicit instruction, ideas drift to generic SaaS / e-commerce examples even with the JD attached.

6. **JD attachment is independent of the regenerate path.** A regenerate request reuses whatever JD state the wizard already has; the manager doesn't get re-prompted for a JD.

## Architecture & Data Flow

### `IdeaProfile` gains two fields

In `tui/interview_bootstrap_ideas.go`:

```go
type IdeaProfile struct {
    // ...existing fields...
    JobDescription  string   // body, only when both JD flags = yes
    RejectedTitles  []string // accumulates across regenerations
}
```

### `buildIdeaPrompt` gains two conditional blocks

When `JobDescription != ""`:

- **Drop** the existing `Domain: %s` line (the wizard skips the Domain step when a JD is attached, so this line would render with an empty value).
- **Emit** a "Business domain: derive this from the company/about section at the top of the job description below — that paragraph describes the company's industry and product surface. The ideas must be plausible projects for an engineer at that specific company, not generic SaaS examples." instruction.
- **Append** the JD body inside `--- JOB DESCRIPTION ---` / `--- END JOB DESCRIPTION ---` markers.

When `len(RejectedTitles) > 0`:

- **Append** a final line: `Do not repeat or rephrase any of these previously-shown ideas: <comma-separated titles>. Vary the sub-problem within the same domain.`

The fetcher (`openAIIdeaFetcher.Fetch`), response schema (`ideasResponseSchema`), and response parsing (`parseIdeasResponse`) are unchanged. The prompt is the only thing that grows.

### Wizard state machine — three changes in `interview_bootstrap_tea.go`

**(1) Sentinel option in `buildForm()` for `ibStepIdeaSelect`:**

After the loop that builds the per-idea options, append one more `huh.Option[int]` with value `len(d.ideas)` and label `"↻ Generate a fresh set…"`. The select still binds to `d.ideaSelected int`; the sentinel is "the index one past the last real idea."

**(2) Intercept the sentinel in `advance()`:**

```go
if m.step == ibStepIdeaSelect {
    if m.data.ideaSelected == len(m.data.ideas) {
        for _, idea := range m.data.ideas {
            m.data.rejectedTitles = append(m.data.rejectedTitles, idea.Title)
        }
        m.data.ideas = nil
        m.data.ideaSelected = 0
        m.step = ibStepIdeaFetching
        m.form = nil
        return m, tea.Batch(m.spin.Tick, m.fetchIdeasCmd())
    }
    m.commitSelectedIdea()
}
```

The regenerate path bypasses `nextStep()` entirely — we set the step explicitly to `ibStepIdeaFetching` and return the same spinner + Cmd combo the initial fetch uses. The existing `ideasFetchedMsg` handler lands the new batch and re-enters `advance()` from `ibStepIdeaFetching`, which routes back to `ibStepIdeaSelect` via the existing `nextStep()` table.

**(3) Pass new fields into the profile in `fetchIdeasCmd()`:**

```go
profile := IdeaProfile{
    // ...existing fields...
    JobDescription: m.readJDIfInfluencing(),
    RejectedTitles: append([]string(nil), m.data.rejectedTitles...),
}
```

`readJDIfInfluencing()` is a new method on the model:

- Returns `""` unless both `data.jdProvided == "yes"` AND `data.jdInfluencesProject == "yes"`.
- Reads the file at `data.jdPath`. On read error, returns `""` (degrades to no-JD behavior — we don't fail the whole fetch over a JD read).

### `interviewBootstrapData` gains one field

```go
type interviewBootstrapData struct {
    // ...existing fields...
    rejectedTitles []string
}
```

This is the only new state slot. `data.ideas` continues to hold the current batch; `data.ideaSelected` continues to be the picked index.

## Error Handling

The existing error path is preserved:

- If a fetch (initial OR regenerate) errors, `ideaFetchErr` is set and the picker renders the existing "Idea generation failed — press enter to continue" note.
- The manager can press Esc to back up and try again (existing wizard navigation).
- A JD read error degrades silently to the no-JD prompt — it does NOT block the fetch. Rationale: the JD is enrichment, not a blocker; a torn-down JD shouldn't prevent the manager from completing the wizard.

## Testing

All Go tests under `tui/`, following the existing `interview_bootstrap_*_test.go` patterns.

### `interview_bootstrap_ideas_test.go` (prompt-shape; no network)

| Test | Asserts |
|---|---|
| `TestBuildIdeaPrompt_WithJD_EmitsCompanyDomainInstruction` | When `JobDescription != ""`, the prompt contains the phrase "company/about section" AND a `--- JOB DESCRIPTION ---` block wrapping the body |
| `TestBuildIdeaPrompt_WithJD_OmitsExplicitDomainLine` | When `JobDescription != ""`, the prompt does NOT contain `"Domain: "` as a literal line |
| `TestBuildIdeaPrompt_WithoutJD_KeepsExistingShape` | When `JobDescription == ""`, the prompt is byte-identical to today's prompt for the same other inputs (regression guard) |
| `TestBuildIdeaPrompt_WithRejectedTitles_EmitsAntiExamples` | When `RejectedTitles` is non-empty, the prompt contains `"Do not repeat or rephrase"` followed by each title |
| `TestBuildIdeaPrompt_WithoutRejectedTitles_OmitsAntiExamples` | When `RejectedTitles` is empty, the anti-example clause is absent |
| `TestBuildIdeaPrompt_JDAndRejections_BothPresent` | Both blocks coexist correctly when both fields are set |

### `interview_bootstrap_tea_test.go` (wizard state machine; uses `stubIdeaFetcher`)

| Test | Asserts |
|---|---|
| `TestInterviewBootstrap_IdeaSelect_SentinelTriggersRefetch` | When `data.ideaSelected == len(data.ideas)` and `advance()` runs from `ibStepIdeaSelect`: `data.ideas` is cleared, `data.rejectedTitles` contains all prior titles, `m.step == ibStepIdeaFetching`, returned `tea.Cmd` is non-nil |
| `TestInterviewBootstrap_IdeaSelect_RealPickStillCommits` | When `data.ideaSelected` is a valid idea index, the existing commit-to-feature path still runs |
| `TestInterviewBootstrap_Regenerate_AccumulatesRejectedTitles` | After two regenerations, `rejectedTitles` contains titles from BOTH prior batches |
| `TestInterviewBootstrap_ReadJD_OnlyWhenInfluencingYes` | Table-driven: jdProvided × jdInfluencesProject; only `(yes, yes)` returns the file body; other combinations return `""` |
| `TestInterviewBootstrap_ReadJD_DegradesOnReadError` | When `jdPath` points at a nonexistent file, `readJDIfInfluencing()` returns `""` and does not panic |
| `TestInterviewBootstrap_IdeaSelectForm_HasSentinelRow` | The form built for `ibStepIdeaSelect` exposes `len(data.ideas)+1` options; the last option's label contains "Generate a fresh set" |

### Existing tests stay green

- `TestInterviewBootstrap_Screenshot_WritesGolden` walks a step path that does not exercise the idea-select branch — no golden churn expected.
- `TestInterviewBootstrap_CommitSelectedIdea_WritesToFeature` and `TestInterviewBootstrap_NextStep_FeatureSourceSuggestRoutesToFetch` continue to cover the non-regenerate happy path.

### Manual smoke

`scripts/manual-test-interview.sh` already exercises the bootstrap wizard end-to-end. The new affordances are reachable through the existing wizard with no script changes:

1. Run the wizard, attach a JD, set `jdInfluencesProject = yes`, pick "Suggest project ideas for me".
2. Verify the returned ideas reflect the JD's company domain.
3. Pick "↻ Generate a fresh set…" twice; verify each batch differs from the prior batches.

## Out of Scope

- **Token-budget management for very large JDs.** Typical JDs are 500–1,500 words; gpt-5-mini's context window absorbs that without truncation. If JDs grow to multi-thousand-word documents in the future, add truncation then.
- **Mixing real picks with regenerate** (e.g., "keep these two, re-roll the rest"). Adds wizard complexity without clear demand; defer until a manager asks for it.
- **Regenerate cap or cost telemetry.** Per-call cost is ~$0.001; the time-to-render is its own throttle.
- **Re-prompting for a JD on regenerate.** Once the manager has answered the JD questions, those answers carry through every regenerate request.
- **Surfacing the JD-influenced status on the picker screen.** A small "based on JD" hint would be nice but is non-load-bearing; can be added later if user feedback requests it.

## File Touches

- `tui/interview_bootstrap_ideas.go` — `IdeaProfile` struct, `buildIdeaPrompt` body.
- `tui/interview_bootstrap_tea.go` — `interviewBootstrapData`, `advance()`, `fetchIdeasCmd()`, `buildForm()` case for `ibStepIdeaSelect`, new `readJDIfInfluencing()` method.
- `tui/interview_bootstrap_ideas_test.go` — six new tests.
- `tui/interview_bootstrap_tea_test.go` — six new tests.

No new files, no new packages, no new dependencies.
