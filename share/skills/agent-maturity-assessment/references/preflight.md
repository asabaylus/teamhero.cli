# Environment preflight & multi-repo scope

Read this when running steps 2 (preflight) and 4 (adjacent repo mapping) of *How to run an audit* in `SKILL.md`.

## Environment preflight

**First, read `docs/audits/CONFIG.md` if it exists.** That file is scaffolded by the `setup-agent-maturity-assessment` skill and declares the GitHub auth method, the canonical org/repo/branch, the pre-approved list of adjacent repos in scope, and the audit cadence. When it’s present, use its declared values as the source of truth — skip the runtime probes below for the parts CONFIG.md already answers, and treat the runtime probes as drift-detection only.

If CONFIG.md is **missing** or its declared auth method fails the probe (e.g. CONFIG says “gh” but `gh auth status` errors), fall back to the full preflight below and surface the gap in *Notes for re-audit* so the user can re-run `setup-agent-maturity-assessment` later.

The diagnostic commands assume `gh` CLI is in `$PATH` and authenticated. In a sandboxed runtime (e.g. Cowork) this is often not true even if `gh` is installed on the host. Run this preflight before scoring and select the tier:

```bash
# Tier 1 — gh CLI authenticated → highest fidelity (full GitHub API access)
command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1 && echo "tier=1 gh"

# Tier 2 — GitHub MCP server connected → equivalent fidelity via MCP tools
# (Detect via host capabilities; in Claude Code, look for tools named like
#  list_pull_requests, get_workflow_runs, get_branch_protection.)

# Tier 3 — git + filesystem only → reduced fidelity
git -C . rev-parse --is-inside-work-tree >/dev/null 2>&1 && echo "tier=3 git-only"
```

### Tier behavior

|Tier                    |Available                                         |Use for                                                                                                                                          |
|------------------------|--------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
|1. `gh` authenticated   |All `gh pr list`, `gh api`, `gh run list` commands|Default. Highest-fidelity audits.                                                                                                                |
|2. GitHub MCP           |Equivalent MCP-routed tools                       |Use when running in a sandbox where `gh` isn’t on the host but a GitHub MCP is connected.                                                        |
|3. git + filesystem only|`git log`, `find`, `grep`                         |Fallback. Items 2, 3, 9, 11 score against approximations (merge commits as PR proxies, no branch-protection visibility, no review-depth metrics).|

**At Tier 3, the audit MUST:**

- State “Tier 3 (git-only) audit — limited GitHub-side evidence” in the Summary’s *One-line take*.
- Add an entry to *Notes for re-audit* listing which items were scored against fallback evidence and what to re-verify when running at Tier 1.
- Never auto-promote a Tier 3 score to 1.0 on items 2, 3, 9, or 11 — the missing GitHub-side data could pull them down. Cap those at 0.5 unless filesystem evidence alone is sufficient.

**To upgrade Tier 3 → Tier 1 in Cowork (or any sandbox):** add a GitHub MCP server. Cowork’s curated MCP registry doesn’t currently bundle one, so add it as a custom MCP via Settings → MCP Servers, pointing at GitHub’s official `github/github-mcp-server` (remote-hostable) or Anthropic’s reference implementation. Auth flows through your GitHub OAuth/PAT scoped to the orgs you want to audit — no creds touch the sandbox.

### Optional — host-side probe script

When the sandbox is stuck at Tier 3 but the user has `gh` on their host, ask them to run this and paste the output back. The audit can incorporate the results without any creds entering the sandbox.

```bash
#!/usr/bin/env bash
# audit-gh-probe.sh — run on host, paste output to Claude
set -euo pipefail
REPO="${1:?usage: audit-gh-probe.sh <owner/repo>}"
SINCE="$(date -d '90 days ago' +%Y-%m-%d 2>/dev/null || date -v-90d +%Y-%m-%d)"

echo "### gh-pr-list (cadence + lead time + review depth) ###"
gh pr list --repo "$REPO" --state merged --limit 200 \
  --search "merged:>$SINCE" \
  --json number,mergedAt,createdAt,additions,deletions,reviews,author

echo "### gh-branch-protection ###"
gh api "repos/$REPO/branches/$(gh repo view "$REPO" --json defaultBranchRef --jq .defaultBranchRef.name)/protection" 2>&1 || true

echo "### gh-environments ###"
gh api "repos/$REPO/environments" --jq '.environments[] | {name, has_protection: (.protection_rules | length > 0)}' 2>&1 || true

echo "### gh-deploy-runs ###"
gh run list --repo "$REPO" --workflow=deploy --limit 100 \
  --json conclusion,createdAt,name 2>&1 || true

echo "### gh-ci-runs (flake/fail rate) ###"
gh run list --repo "$REPO" --workflow=ci.yml --limit 50 \
  --json conclusion 2>&1 || true
```

## Handling multi-repo scope

A real engineering org doesn’t fit in one repo. CI workflow templates, Terraform/OpenTofu modules, QA / E2E suites, runbooks and dashboards, and shared agent-context skill libraries frequently live in adjacent repos. Auditing only the primary repo under-scores items that depend on those external sources.

**If `docs/audits/CONFIG.md` exists, use its `## Adjacent repos` table as the seed list** — those repos are already approved to be in scope. Re-run the detection commands below only as **drift detection** to catch new adjacent repos that have been added since the last setup. Surface any new findings in the audit’s *Adjacent repos consulted* section and recommend a re-run of `setup-agent-maturity-assessment` if the list has grown.

If CONFIG.md is missing, run the full detection from scratch.

### Detection — run these from the primary repo before scoring

```bash
# 1. External GitHub Actions referenced from this repo's workflows
grep -rhE "uses:\s*[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+" .github/workflows/ 2>/dev/null \
  | grep -oE "[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+(@[a-zA-Z0-9_.-]+)?" | sort -u

# 2. Terraform / OpenTofu modules sourced from external Git
grep -rhE "source\s*=\s*\".*\"" infra/ terraform/ 2>/dev/null \
  | grep -E "git::|github\.com/" | sort -u

# 3. Submodules
git submodule status 2>/dev/null

# 4. Generic cross-repo references in docs and scripts
grep -rEh "github\.com/[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+" \
  docs/ scripts/ .github/ README.md 2>/dev/null \
  | grep -oE "github\.com/[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+" | sort -u
```

### For each adjacent repo discovered

- Score the relevant criterion *across both repos*. Examples: if reusable workflows live in `<org>/ci-templates`, item #2 (cadence) and item #9 (review) evidence comes from both. If Terraform modules live in `<org>/infra-modules`, item #11 (blast-radius) needs both.
- Use `gh repo view <org>/<repo>` and targeted `gh api`/`gh search` calls to inspect — don’t clone unless necessary.
- If access is blocked (private repo, no permission), score against what’s visible and flag in *Notes for re-audit*.
- List every adjacent repo consulted in the audit’s *Adjacent repos consulted* section so a re-auditor can reproduce.

**Org-level criteria (#8 governance, #12 hiring) are inherently outside any one repo.** Look for them in `<org>/.github` policy repo, internal handbook, IT/security docs. If you can’t reach those, mark `n/a` with the reason. Phase 1 question 7 is intended to surface these out-of-band sources from the human before evidence gathering.