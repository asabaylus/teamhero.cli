# Criteria reference

Full text of all 12 criteria for the Agent Maturity Assessment: score levels, repo checks, diagnostic commands, and rationale per item. Read this when gathering evidence (step 5 of *How to run an audit* in `SKILL.md`).

Each item scores **1.0** (pass), **0.5** (partial), or **0.0** (fail). Be conservative: if it’s not visibly true, it’s 0.5. If there’s no evidence at all, it’s 0. If a criterion can’t be assessed from the repo and the user indicated unknown in Phase 1, score it `n/a` (see *Unknown ≠ failing* in `SKILL.md`).

## Category A — Engineering basics (weight 1.0×)

Non-negotiable foundations. Failure here multiplies risk on everything else.

### 1. Reproducible dev environments

- 1.0 — Clone-to-green-build in <30 min via devcontainer, Nix, or a single setup script. Same path works for an agent.
- 0.5 — README exists but bootstrap takes >2 hours or has known broken steps.
- 0.0 — “Ask Bob, he knows the trick.”

**Repo check:** `.devcontainer/`, `flake.nix`, `setup.sh`, or equivalent. Run it from a clean machine.

**Diagnostic commands:**

- `ls .devcontainer/ flake.nix setup.sh scripts/bootstrap* 2>/dev/null` — bootstrap surface
- `time bash <bootstrap-script>` on a clean machine to verify the <30 min claim
- `gh repo view <org>/<bootstrap-deps-repo> 2>/dev/null` for any external bootstrap repo identified during scope mapping

**Why it matters:** Onboarding latency is the first multiplier on team velocity, and agents need bootstrappable environments too. If a human can’t get green in 30 minutes, an agent definitely can’t.

### 2. Sub-day integration cadence with measured outcomes

- 1.0 — Code integrates to mainline at least daily. PRs are small and merge sub-day. All four DORA metrics (deployment frequency, lead time, change-fail rate, MTTR) are tracked and visible. Branching model can be trunk-based, GitHub flow, or short-lived Git flow — what matters is the absence of long-lived branches and the presence of measured integration discipline.
- 0.5 — Some metrics tracked, but cadence is weekly, PRs sit for days, or feature branches routinely outlive a sprint.
- 0.0 — Long-lived feature branches as the norm, release trains measured in months, no metrics.

**Repo check:** age distribution of merged PRs over the last 90 days; presence of any DORA dashboard.

**Diagnostic commands:**

- `gh pr list --state merged --limit 200 --search "merged:>$(date -d '90 days ago' +%Y-%m-%d)" --json mergedAt,createdAt,additions,deletions,reviews,author` — cadence + lead time + PR size + review counts in one call
- `gh api "repos/{owner}/{repo}/branches?per_page=100" --paginate --jq '.[] | {name, last_commit_sha: .commit.sha}'` then resolve commit dates → branch staleness distribution
- `gh run list --workflow=deploy*.yml --limit 100 --json conclusion,createdAt,name --branch <default>` — deployment frequency proxy and change-fail rate (failed conclusions / total)
- For monorepos with deploys in adjacent infra/CD repos: rerun the `gh run list` against `<org>/<cd-repo>`

**Combine with Phase 1 Q3** (DORA visibility): repo evidence covers cadence; the interview answer covers whether the four metrics are *actually visible to the team*.

**Why it matters:** Integration cadence is the leading indicator of engineering performance. With agents in the loop the case is stronger — agents work fastest when changes validate against current main immediately, and long-lived branches accumulate integration debt humans have to resolve later.

### 3. Testability and the agent inner loop

- 1.0 — The application is *built* to be tested: real seams (DI, ports/adapters, deep modules with clean interfaces) so behaviors can be verified at module boundaries without spinning up the world. Unit tests are sub-second; the full suite runs in minutes; flaky tests are treated as bugs and fixed within a sprint. A single command runs the suite headlessly with machine-parseable output. TDD-style inner loops — write the test, make it pass, refactor — are the *default* mode of working with AI.
- 0.5 — Tests exist and mostly run, but the application has known untestable areas, the suite is slow enough to break flow, flaky tests get re-run rather than fixed, or TDD with agents is occasional rather than default.
- 0.0 — Manual QA, flaky-and-ignored test suite, or no seams in the application — agents can technically run `npm test` but the signal is garbage.

**Repo check:** run the suite, time it, check failure rate over the last 50 CI runs; sample a recent feature PR and look at whether tests were written before or after the implementation.

**Diagnostic commands:**

- `time <test-command>` (e.g. `time pnpm test`, `time dotnet test`) — full suite duration
- `find . -name "*.test.*" -o -name "*.spec.*" -o -name "*Tests.cs" 2>/dev/null | wc -l` — test file count as a sanity floor
- `gh run list --workflow=ci.yml --limit 50 --json conclusion --jq '[.[] | .conclusion] | group_by(.) | map({status: .[0], count: length})'` — flake/fail rate
- `grep -rE "\\|\\|\\s*true|continue-on-error:\\s*true" .github/workflows/ 2>/dev/null` — CI swallowing failures (any hit = item probably 0.0 regardless of test count)
- For QA in adjacent repo (e.g. `<org>/qa-e2e`): `gh repo view <org>/<qa-repo>` and inspect its CI run history the same way

**Why it matters:** Humans can reason around bad tests (“yeah, that test is garbage, but I know the code works”). Agents can’t — they follow the signal. The test suite is the rate limit on agent throughput; agents without fast, trustworthy feedback outrun their headlights and produce thrash.

### 4. Observability before features

- 1.0 — Structured logs, distributed traces, error budgets defined, on-call with runbooks. New features ship instrumented.
- 0.5 — Logs and metrics exist but tracing is partial; runbooks stale.
- 0.0 — “We grep CloudWatch when something breaks.”

**Repo check:** OTel libraries in deps, dashboards exist, error budget docs, recency of last runbook update.

**Diagnostic commands:**

- `grep -rEh "OpenTelemetry|opentelemetry|Microsoft\\.ApplicationInsights|datadog|prometheus|grafana|loki|tempo|sentry|honeycomb|newrelic|splunk" --include="*.csproj" --include="package.json" --include="go.mod" --include="requirements*.txt" --include="Cargo.toml" --include="pom.xml" --include="build.gradle*" 2>/dev/null` — instrumentation / agent libs (Grafana itself is viz; this catches the Grafana Cloud agent, faro SDK, Loki/Tempo clients that feed it)
- `find . \( -path "*/grafana/*.json" -o -path "*/dashboards/*.json" -o -name "*.libsonnet" -o -path "*/prometheus/*.yml" -o -path "*/alerts/*.yml" \) -not -path "*/node_modules/*" 2>/dev/null` — committed Grafana dashboards, Jsonnet, Prometheus alert rules
- `find . -ipath "*runbook*" -o -ipath "*incident*" -o -ipath "*sli*" -o -ipath "*slo*" 2>/dev/null` — runbook / SLO presence
- `git log --since="180 days ago" --oneline -- docs/runbooks/ docs/ops/ 2>/dev/null | wc -l` — recency of operational docs
- For dashboards/alerts in an adjacent repo (e.g. `<org>/observability`, `<org>/grafana-dashboards`): rerun the dashboard-file `find` there — score across both

**Why it matters:** You can’t fix what you can’t see. AI accelerates ship rate, which accelerates incident rate — observability is the safety net that makes acceleration survivable.

## Category B — Knowledge & context (weight 1.5×)

This is what’s gotten *more* important with LLMs, not less. Agents perform at the level of context the org provides them, and codebase shape determines whether agents can navigate it at all. Weighted highest because this category compounds — a team that gets B right tends to fix everything else.

### 5. Design discipline as a first-class practice

- 1.0 — ADRs are current and dated. ARCHITECTURE.md exists per active repo. A **ubiquitous language glossary** is checked in, referenced in agent context, and the team enforces its terms in code, docs, and conversation. Design happens *before* code generation: agents are pointed at planning skills (e.g., “interview-me-until-shared-understanding” patterns) that force a shared design concept before any code is written. ADR/glossary commits are visible in the last 90 days — design is an ongoing investment, not a one-time write.
- 0.5 — Some design artifacts exist but are stale; ubiquitous language is implicit (people just know the terms); planning happens informally before some agent work but not consistently.
- 0.0 — Tribal knowledge. Architecture lives in one staff engineer’s head. Agents are turned loose without shared design concept and produce confidently wrong code.

**Repo check:** `docs/adr/`, `ARCHITECTURE.md`, glossary or ubiquitous-language file; check git log on those paths for recency; sample an agent-driven PR for evidence of upfront design vs. straight-to-code.

**Diagnostic commands:**

- `find . -ipath "*adr*" -name "*.md" 2>/dev/null | head; find . -iname "ARCHITECTURE.md" -o -iname "GLOSSARY.md" -o -iname "*ubiquitous*" 2>/dev/null` — design surface
- `git log --since="90 days ago" --oneline -- docs/adr/ ARCHITECTURE.md 2>/dev/null | wc -l` — ongoing investment vs. one-time write
- For ADRs in a central docs repo: `gh api "repos/<org>/<docs-repo>/contents/adr" --jq '.[].name'`

**Combine with Phase 1 Q4** (design before code): files prove artifacts exist; the interview answer proves design happens *before* code generation in practice.

**Why it matters:** Specs-to-code without design discipline produces software entropy — each iteration makes the codebase worse. Investing in design daily is what keeps tactical AI execution aligned with strategic intent. The ubiquitous language is the bridge between domain experts, engineers, and agents — without it, every translation step introduces drift.

### 6. Codebase composed of deep modules

- 1.0 — The codebase is structured as **deep modules**: few large modules, each with substantial functionality hidden behind a simple, stable interface. Public interfaces are small and intentional; implementations can be sizeable but encapsulated. When agents add code, they add it inside an existing deep module’s boundary or create a new module with a clear interface — they don’t sprinkle helpers across the codebase.
- 0.5 — Some areas well-modularized; others are shallow / sprinkly. Agents tend to add code in surface-level helpers rather than respecting boundaries. A handful of god-classes exist but are known and bounded.
- 0.0 — Sprawling shallow modules with leaky interfaces; 4000-line god files alongside 30-line helper files with no clear pattern. Agents can’t navigate the module map and produce code that crosses arbitrary boundaries.

**Repo check:** file size distribution, public API surface per module, sample two random modules and see whether you can summarize each one’s purpose in a sentence; drop one into an LLM and ask it to explain.

**Why it matters:** AI excels at filling in implementation when given a clean interface; it produces sprawl when given no constraints. Deep modules give agents the right *shape* of problem to solve. Shallow codebases compound entropy with every agent-driven change.

### 7. Repo-local agent context

- 1.0 — `CLAUDE.md` / `AGENTS.md` / skill files checked into the repo. Team-level prompt and skill libraries are versioned. Agents joining the team get the same onboarding humans get. Agent context references the ubiquitous language and the module map (items 5 + 6).
- 0.5 — Some individuals have personal CLAUDE.md files; nothing shared at the repo level.
- 0.0 — No agent context anywhere; people copy-paste instructions into chat each time.

**Repo check:** `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.cursor/rules/`, `.skills/`, or equivalent. Read one — does it teach the agent something the engineer wouldn’t have to be told?

**Diagnostic commands:**

- `find . -maxdepth 4 \( -iname "CLAUDE.md" -o -iname "AGENTS.md" -o -name ".claude" -o -name ".cursor" -o -name ".skills" -o -name "memory-bank" \) -not -path "./node_modules/*" -not -path "./.git/*" 2>/dev/null` — agent-context surface
- For each found file/dir: `wc -l` and `git log -1 --format="%ar" -- <path>` to gauge depth and recency
- For shared agent context in adjacent repo (e.g. `<org>/claude-skills`, `<org>/.github`): `gh repo view <org>/<repo>` and check whether this repo references it

**Why it matters:** Agents perform at the level of context the repo provides them. Ad-hoc personal prompts mean each engineer’s agent operates at a different standard; checked-in context means everyone (and every agent) gets the same baseline.

## Category C — AI governance & quality (weight 1.25×)

The new control plane.

### 8. Sanctioned, governed AI tooling

- 1.0 — Approved model list, ZDR posture documented, secrets scanning on agent outputs, clear policy on what can / can’t be sent to third parties, paid seats budgeted.
- 0.5 — Tooling is paid for but governance is loose; or governance is tight but everyone uses personal accounts anyway.
- 0.0 — Shadow AI. People paste prod data into free-tier chatbots.

**Diagnostic:** primary signal is the user interview answer (Phase 1 Q1). Cross-check against any policy docs in `<org>/.github` or an internal handbook if reachable. If the user said “I don’t know”, score `n/a`.

**Why it matters:** Shadow AI is shadow IT with worse confidentiality and IP risk. Governance now is cheaper than recovering from a leak later.

### 9. Human review on every PR regardless of authorship

- 1.0 — AI-generated code is reviewed by a human who understands it well enough to defend it in a postmortem. “The agent wrote it” is not a shield.
- 0.5 — Reviews happen but are cursory; AI-authored PRs get rubber-stamped.
- 0.0 — Auto-merge on agent PRs, or no review process at all.

**Repo check:** PR review settings, review depth on a sample of recent AI-tagged PRs.

**Diagnostic commands:**

- `find . -name "CODEOWNERS" 2>/dev/null` — review enforcement file
- `gh api "repos/{owner}/{repo}/branches/<default>/protection" 2>/dev/null` — branch protection rules (auth scope permitting)
- `gh pr list --state merged --limit 50 --json reviews,author,additions,deletions --jq '[.[] | {pr: .number, author: .author.login, reviewers: [.reviews[].author.login] | unique, lines: (.additions + .deletions)}]'` — review depth and non-author reviewer presence per PR
- For org-level review policy in `<org>/.github`: `gh api "repos/<org>/.github/contents/" --jq '.[].name'`

**Why it matters:** AI-authored code that no human can defend is technical debt with no owner. Review discipline is what keeps the org accountable for what it ships.

### 10. Evals for AI-touched code paths

- 1.0 — If LLMs are in the product → offline eval suite + prod telemetry. If LLMs are in the dev loop → adoption, throughput, and defect rate measured honestly (not just “everyone loves it”).
- 0.5 — Vibes-based confidence; some metrics but no rigor.
- 0.0 — No evals, no measurement, no idea if the AI helps or hurts.

**Repo check:** `evals/`, `benchmarks/`, internal AI tooling dashboards.

**Combine with Phase 1 Q5** (eval coverage): repo evidence covers product-side evals; the interview answer covers dev-loop measurement, which rarely lives in the repo. If the user said “I don’t know” *and* no `evals/` or `benchmarks/` directory exists, score `n/a`.

**Why it matters:** Without evals, you can’t tell whether AI is helping or hurting — you’re managing on vibes. Evals are also the only way to catch silent regressions in AI-driven product features.

### 11. Blast-radius controls for agent actions

- 1.0 — Scoped credentials per agent, dry-run modes, audit logs of every agent-triggered write, documented rollback paths. The “agent shipped a migration to prod at 2am” scenario has been red-teamed.
- 0.5 — Some controls exist but are inconsistent; audit logs partial.
- 0.0 — Agents have prod write access via human-equivalent creds; no audit trail.

**Diagnostic question:** “what’s the dumbest possible agent action that could break prod, and would we know within 5 minutes?”

**Diagnostic commands:**

- `grep -rEh "azure/login@|aws-actions/configure-aws-credentials@|google-github-actions/auth@" .github/workflows/ 2>/dev/null` — OIDC adoption (presence of `with: client-id:` rather than `secrets.AWS_ACCESS_KEY_ID` is the green flag)
- `gh api "repos/{owner}/{repo}/environments" --jq '.environments[] | {name: .name, has_protection: (.protection_rules | length > 0)}' 2>/dev/null` — env-scoped deploys with reviewers
- `find infra/ terraform/ -name "*.tf" 2>/dev/null | xargs grep -lE "service_account|workload_identity|managed_identity|user_assigned_identity" 2>/dev/null` — scoped per-workload identities
- `grep -rEh "azurerm_role_assignment|google_project_iam|aws_iam_role" infra/ terraform/ 2>/dev/null | wc -l` — IAM blast-radius posture
- For Terraform/IAM in adjacent infra repo (e.g. `<org>/infra`): clone shallow and rerun the same greps there

**Combine with Phase 1 Q6** (red-team posture): files prove technical posture; the interview answer proves the worst-case scenario has been thought through.

**Why it matters:** Autonomous agents will eventually do something stupid. The question is whether the blast radius is bounded by design or by luck.

## Category D — Hiring (weight 1.0×)

### 12. Interviews assess judgment under AI augmentation

- 1.0 — Candidates use AI in interviews and are evaluated on critique, decomposition, recognizing wrong answers, and shipping correct work. The bar is “great judgment with AI”, not “no AI allowed”.
- 0.5 — AI is allowed but interviewers don’t know how to assess its use; or it’s banned for “purity” reasons.
- 0.0 — Old-style whiteboard-only interviews; or no real technical bar at all.

**Diagnostic:** primary signal is the user interview answer (Phase 1 Q2). If a rubric is reachable in an internal repo, cross-check. If the user said “I don’t know”, score `n/a`.

**Why it matters:** Hiring is a forward-looking bet. The skill that matters in the AI-agentic era isn’t “can write code without AI” — it’s “can use AI well.” Interviews that don’t measure that bet on the wrong skill.