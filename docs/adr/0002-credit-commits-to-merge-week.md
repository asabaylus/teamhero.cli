# 2. Credit pull request commits to the week the pull request merged

Date: 2026-11-15
Status: Accepted
Decided by: the engineering manager

## Context

A pull request's commits can be placed in a reporting week in several ways, and TeamHero has
used more than one of them:

1. **Before `3e45ba7`:** every commit of a pull request counted in any week the pull request was
   opened, merged, or closed in, or was still open and updated in. One pull request could put the
   same commits in two weeks, and closing a stale branch moved old commits into the week it closed.
2. **`3e45ba7` (2026-10-19):** each commit counted in the week its author date fell in. That fixed
   the stale-branch case but credited unmerged work, and it changed the meaning of the Commits
   column without a decision. The 2026-10-17 – 10-23 week dropped from 525 to 181 commits for one
   engineer when it was regenerated, which broke comparison with every archived week.

Neither is the rule the manager uses to read the report.

## Decision

**A pull request's commits are credited to the week the pull request merged — all of them,
whenever they were written.**

- A pull request that merged **into the default branch** in the window contributes every one of
  its commits. A pull request merged into any other branch (a stacked PR into a feature branch, a
  promotion PR into a release branch) contributes none: its commits are credited when they reach
  the default branch, so crediting them earlier counts them twice, often for the wrong person.
- Each pull request counts once, even when GitHub lists it on two pages during one run. All of
  its commits count, across every page of its commit list (GitHub lists at most 250).
- A pull request that was only opened, closed without merging, or updated in the window
  contributes **no** commits. Its commits count later, in the week it merges, or never.
- Commit author and committer dates are **never** used to place a pull request's commits.
- Commits pushed straight to the default branch, outside any pull request, still count by their
  own commit date, as before.
- A default-branch commit that arrived through a merged pull request — a squash commit, a rebased
  copy, or a merge commit — is **never** counted. Its pull request already counts the work, and
  those copies carry new SHAs, so de-duplicating by SHA cannot catch them. GitHub GraphQL
  `associatedPullRequests` (merged, base = the default branch) identifies them.
- The Commits count is **uncapped**. `TEAMHERO_MAX_HIGHLIGHTS_PER_MEMBER` only limits the sample of
  commits given to narrative sections; it never limits the count.

## Consequences

- Commits measure delivered work, the same way PRs Merged does, so the two columns move together.
- An engineer's commits on a long-lived branch appear all at once in the merge week. That is
  intended.
- Weeks generated before this decision used one of the earlier rules. Comparing across that
  boundary needs the affected weeks regenerated.

## Guard

`tests/unit/metrics.rest-api.spec.ts` — "commit credit follows the pull request's merge week" and
"commit count is uncapped and counts merged pull request work once". They fail under both earlier
rules, under a capped count, when default-branch copies of merged pull requests are counted, when
a pull request merged into another branch credits commits, when a pull request with more than 100
commits is cut short, and when a pull request listed twice is counted twice. Change this rule only with a new ADR from the manager.
