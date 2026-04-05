# Report Format Template

Use this template when composing a report directly (MCP connector mode). The report must follow this exact structure and tone.

## 1. Header

```markdown
# Weekly Engineering Summary (YYYY-MM-DD – YYYY-MM-DD)

Processed X PRs across Y repositories, with contributions from Z engineers, N merged during the window.

---
```

- Date range: the `--since` and `--until` dates (default: last 7 days)
- PR count: total PRs opened or updated in the window
- Repository count: distinct repos with activity
- Engineer count: org members with any commits, PRs, or reviews
- Merged count: PRs merged during the window

## 2. Visible Wins & Delivered Outcomes

```markdown
## **This Week's Visible Wins & Delivered Outcomes**

[PROJECT/EPIC NAME]
* Bullet point describing a delivered outcome or key progress, with assignee names.
* Another bullet with context on status or blockers.

[ANOTHER PROJECT]
* ...

---
```

- Group by Asana project or epic name (use brackets: `[PROJECT NAME]`)
- Each bullet: what shipped or progressed, who did it, current status
- Include blockers and next steps when relevant
- Only include projects with meaningful activity in the window
- If no Asana data is available, derive groupings from repository or PR title patterns

## 3. At-a-Glance Summary

```markdown
## **At-a-Glance Summary**
| Developer        | Commits | PRs Opened | PRs Closed | PRs Merged | Lines Added | Lines Deleted | Reviews |
|------------------|--------:|-----------:|-----------:|-----------:|------------:|--------------:|--------:|
| Full Name | 42 | 3 | 1 | 2 | 1500 | 200 | 5 |

> *Note: This table provides a quick view of activity across the team. Reviews are counted as approved, changes requested, or commented.*

---
```

- One row per org member, sorted by commit count descending
- Right-align numeric columns
- Include members with zero activity (all zeros)
- Reviews = count of PR reviews submitted (approved + changes_requested + commented)

## 4. Individual Updates

```markdown
## **Individual Updates**

### Full Name (@github-handle)

Narrative paragraph describing what this engineer shipped during the window. Include specific PRs, commits, and technical context. Write in third person, past tense. Focus on outcomes and impact rather than listing commits. Mention what is shipped vs. still in review.
```

- One H3 subsection per engineer
- Include `@github-handle` after the name
- Write a cohesive narrative paragraph (not bullet points)
- Third person, past tense ("shipped", "delivered", "fixed")
- Reference specific PRs by number where relevant
- For engineers with no activity: "No notable shipped outcomes were delivered by [Name] during [date range]."

## 5. Discrepancy Log

```markdown
## **Discrepancy Log**

> X cross-source discrepancies detected.

### Full Name (@github-handle)

- **Asana**: Done | **GitHub**: PR #123 Open
  - Update Asana task "Task title" to reflect that PR #123 is still open, or merge the PR.
```

- Only include if both GitHub and Asana data are available
- A discrepancy = Asana task marked Done but linked PR is still open (not merged)
- Group by engineer
- Each entry: Asana status, GitHub PR status, task title, actionable remediation
- If no discrepancies found: "No cross-source discrepancies detected."
- If no Asana data: omit this section entirely

## Tone & Style

- Professional, concise, factual
- Avoid superlatives and filler ("great work", "impressive")
- Use specific numbers and PR references
- Technical but accessible to engineering managers
- Bold section headers with `**text**`
- Horizontal rules (`---`) between major sections
