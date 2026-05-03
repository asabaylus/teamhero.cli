import type { MaturityBand, RubricCategory, RubricItem } from "./types.js";

export { RUBRIC_VERSION } from "./types.js";

export const RUBRIC_CATEGORIES: ReadonlyArray<RubricCategory> = [
	{
		id: "A",
		title: "Engineering basics",
		weight: 1.0,
		maxRaw: 4,
		maxWeighted: 4.0,
		itemIds: [1, 2, 3, 4],
	},
	{
		id: "B",
		title: "Knowledge & context",
		weight: 1.5,
		maxRaw: 3,
		maxWeighted: 4.5,
		itemIds: [5, 6, 7],
	},
	{
		id: "C",
		title: "AI governance & quality",
		weight: 1.25,
		maxRaw: 4,
		maxWeighted: 5.0,
		itemIds: [8, 9, 10, 11],
	},
	{
		id: "D",
		title: "Hiring",
		weight: 1.0,
		maxRaw: 1,
		maxWeighted: 1.0,
		itemIds: [12],
	},
] as const;

export const MAX_RAW_SCORE = 12;
export const MAX_WEIGHTED_SCORE = 14.5;

export const MATURITY_BANDS: ReadonlyArray<MaturityBand> = [
	{
		name: "Excellent",
		min: 90,
		max: Infinity,
		rangeLabel: "90%+",
		interpretation:
			"Genuinely rare. Confirm with a second pass — first audits often score too generously.",
	},
	{
		name: "Healthy",
		min: 75,
		max: 89.9999,
		rangeLabel: "75–89%",
		interpretation: "Targeted fixes will compound.",
	},
	{
		name: "Functional but slow",
		min: 60,
		max: 74.9999,
		rangeLabel: "60–74%",
		interpretation:
			"Real risk of being out-shipped by AI-native competitors. Where most orgs actually live.",
	},
	{
		name: "Significant dysfunction",
		min: 40,
		max: 59.9999,
		rangeLabel: "40–59%",
		interpretation: "Treat as a turnaround.",
	},
	{
		name: "Triage",
		min: -Infinity,
		max: 39.9999,
		rangeLabel: "<40%",
		interpretation: "Stop new feature work until basics are in.",
	},
] as const;

export const RUBRIC_ITEMS: ReadonlyArray<RubricItem> = [
	{
		id: 1,
		slug: "reproducible-dev-environments",
		title: "Reproducible dev environments",
		categoryId: "A",
		scoreLevels: {
			one: "Clone-to-green-build in <30 min via devcontainer, Nix, or a single setup script. Same path works for an agent.",
			half: "README exists but bootstrap takes >2 hours or has known broken steps.",
			zero: "“Ask Bob, he knows the trick.”",
		},
		repoCheck:
			"`.devcontainer/`, `flake.nix`, `setup.sh`, or equivalent. Run it from a clean machine.",
		diagnosticCommands: [
			"ls .devcontainer/ flake.nix setup.sh scripts/bootstrap* 2>/dev/null",
			"time bash <bootstrap-script> on a clean machine to verify the <30 min claim",
		],
		whyItMatters:
			"Onboarding latency is the first multiplier on team velocity, and agents need bootstrappable environments too. If a human can't get green in 30 minutes, an agent definitely can't.",
	},
	{
		id: 2,
		slug: "sub-day-integration-cadence",
		title: "Sub-day integration cadence with measured outcomes",
		categoryId: "A",
		scoreLevels: {
			one: "Code integrates to mainline at least daily. PRs are small and merge sub-day. All four DORA metrics tracked and visible.",
			half: "Some metrics tracked, but cadence is weekly, PRs sit for days, or feature branches routinely outlive a sprint.",
			zero: "Long-lived feature branches as the norm, release trains measured in months, no metrics.",
		},
		repoCheck:
			"Age distribution of merged PRs over the last 90 days; presence of any DORA dashboard.",
		diagnosticCommands: [
			"gh pr list --state merged --limit 200 --search 'merged:>$(date -d \"90 days ago\" +%Y-%m-%d)' --json mergedAt,createdAt,additions,deletions,reviews,author",
			"gh run list --workflow=deploy*.yml --limit 100 --json conclusion,createdAt,name --branch <default>",
		],
		whyItMatters:
			"Integration cadence is the leading indicator of engineering performance. Agents work fastest when changes validate against current main immediately; long-lived branches accumulate integration debt humans have to resolve later.",
		interviewLink: { questionId: "q3", mode: "combine" },
		tier3Cap: true,
	},
	{
		id: 3,
		slug: "testability-and-agent-inner-loop",
		title: "Testability and the agent inner loop",
		categoryId: "A",
		scoreLevels: {
			one: "App is built to be tested (DI, ports/adapters, deep modules). Unit tests sub-second; full suite in minutes; flakes treated as bugs. TDD with agents is the default.",
			half: "Tests exist and mostly run, but known untestable areas, slow suite, flakes re-run rather than fixed, or TDD is occasional.",
			zero: "Manual QA, flaky-and-ignored test suite, or no seams in the application.",
		},
		repoCheck:
			"Run the suite, time it, check failure rate over the last 50 CI runs; sample a recent feature PR and look at whether tests were written before or after the implementation.",
		diagnosticCommands: [
			"time <test-command> (e.g. time pnpm test, time dotnet test)",
			"find . -name '*.test.*' -o -name '*.spec.*' -o -name '*Tests.cs' 2>/dev/null | wc -l",
			"gh run list --workflow=ci.yml --limit 50 --json conclusion --jq '[.[] | .conclusion] | group_by(.) | map({status: .[0], count: length})'",
			"grep -rE '\\\\|\\\\|\\\\s*true|continue-on-error:\\\\s*true' .github/workflows/ 2>/dev/null",
		],
		whyItMatters:
			"Humans can reason around bad tests; agents can't — they follow the signal. The test suite is the rate limit on agent throughput.",
		tier3Cap: true,
	},
	{
		id: 4,
		slug: "observability-before-features",
		title: "Observability before features",
		categoryId: "A",
		scoreLevels: {
			one: "Structured logs, distributed traces, error budgets defined, on-call with runbooks. New features ship instrumented.",
			half: "Logs and metrics exist but tracing is partial; runbooks stale.",
			zero: "“We grep CloudWatch when something breaks.”",
		},
		repoCheck:
			"OTel libraries in deps, dashboards exist, error budget docs, recency of last runbook update.",
		diagnosticCommands: [
			"grep -rEh 'OpenTelemetry|opentelemetry|Microsoft\\\\.ApplicationInsights|datadog|prometheus|grafana|loki|tempo|sentry|honeycomb|newrelic|splunk' --include='*.csproj' --include='package.json' --include='go.mod' --include='requirements*.txt' --include='Cargo.toml' 2>/dev/null",
			"find . -ipath '*runbook*' -o -ipath '*incident*' -o -ipath '*sli*' -o -ipath '*slo*' 2>/dev/null",
		],
		whyItMatters:
			"You can't fix what you can't see. AI accelerates ship rate, which accelerates incident rate — observability is the safety net that makes acceleration survivable.",
	},
	{
		id: 5,
		slug: "design-discipline",
		title: "Design discipline as a first-class practice",
		categoryId: "B",
		scoreLevels: {
			one: "ADRs current and dated. ARCHITECTURE.md exists per active repo. Ubiquitous-language glossary checked in and referenced in agent context. Design happens before code generation.",
			half: "Some design artifacts exist but are stale; ubiquitous language is implicit; planning is informal and inconsistent.",
			zero: "Tribal knowledge. Architecture lives in one staff engineer's head. Agents are turned loose without shared design concept.",
		},
		repoCheck:
			"`docs/adr/`, `ARCHITECTURE.md`, glossary or ubiquitous-language file; check git log on those paths for recency; sample an agent-driven PR for evidence of upfront design vs. straight-to-code.",
		diagnosticCommands: [
			"find . -ipath '*adr*' -name '*.md' 2>/dev/null | head",
			"find . -iname 'ARCHITECTURE.md' -o -iname 'GLOSSARY.md' -o -iname '*ubiquitous*' 2>/dev/null",
			"git log --since='90 days ago' --oneline -- docs/adr/ ARCHITECTURE.md 2>/dev/null | wc -l",
		],
		whyItMatters:
			"Specs-to-code without design discipline produces software entropy. Investing in design daily keeps tactical AI execution aligned with strategic intent. The ubiquitous language is the bridge between domain experts, engineers, and agents.",
		interviewLink: { questionId: "q4", mode: "combine" },
	},
	{
		id: 6,
		slug: "deep-modules",
		title: "Codebase composed of deep modules",
		categoryId: "B",
		scoreLevels: {
			one: "Codebase is structured as deep modules: few large modules, each with substantial functionality hidden behind a simple, stable interface.",
			half: "Some areas well-modularized; others are shallow / sprinkly. A handful of god-classes exist but are known and bounded.",
			zero: "Sprawling shallow modules with leaky interfaces; 4000-line god files alongside 30-line helper files with no clear pattern.",
		},
		repoCheck:
			"File size distribution, public API surface per module, sample two random modules and see whether you can summarize each one's purpose in a sentence.",
		diagnosticCommands: [
			"find . -type f \\( -name '*.ts' -o -name '*.go' -o -name '*.py' -o -name '*.rs' -o -name '*.cs' \\) -not -path '*/node_modules/*' -not -path '*/.git/*' -exec wc -l {} + | sort -nr | head -30",
		],
		whyItMatters:
			"AI excels at filling in implementation when given a clean interface; it produces sprawl when given no constraints. Deep modules give agents the right shape of problem to solve.",
	},
	{
		id: 7,
		slug: "repo-local-agent-context",
		title: "Repo-local agent context",
		categoryId: "B",
		scoreLevels: {
			one: "`CLAUDE.md` / `AGENTS.md` / skill files checked into the repo. Team-level prompt and skill libraries are versioned. Agents joining the team get the same onboarding humans get.",
			half: "Some individuals have personal CLAUDE.md files; nothing shared at the repo level.",
			zero: "No agent context anywhere; people copy-paste instructions into chat each time.",
		},
		repoCheck:
			"`CLAUDE.md`, `AGENTS.md`, `.claude/`, `.cursor/rules/`, `.skills/`, or equivalent. Read one — does it teach the agent something the engineer wouldn't have to be told?",
		diagnosticCommands: [
			"find . -maxdepth 4 \\( -iname 'CLAUDE.md' -o -iname 'AGENTS.md' -o -name '.claude' -o -name '.cursor' -o -name '.skills' -o -name 'memory-bank' \\) -not -path './node_modules/*' -not -path './.git/*' 2>/dev/null",
		],
		whyItMatters:
			"Agents perform at the level of context the repo provides them. Ad-hoc personal prompts mean each engineer's agent operates at a different standard; checked-in context means everyone (and every agent) gets the same baseline.",
	},
	{
		id: 8,
		slug: "sanctioned-ai-tooling",
		title: "Sanctioned, governed AI tooling",
		categoryId: "C",
		scoreLevels: {
			one: "Approved model list, ZDR posture documented, secrets scanning on agent outputs, clear policy on what can / can't be sent to third parties, paid seats budgeted.",
			half: "Tooling is paid for but governance is loose; or governance is tight but everyone uses personal accounts anyway.",
			zero: "Shadow AI. People paste prod data into free-tier chatbots.",
		},
		diagnosticCommands: [
			"Cross-check against any policy docs in <org>/.github or an internal handbook if reachable.",
		],
		whyItMatters:
			"Shadow AI is shadow IT with worse confidentiality and IP risk. Governance now is cheaper than recovering from a leak later.",
		interviewLink: { questionId: "q1", mode: "primary" },
	},
	{
		id: 9,
		slug: "human-review-on-every-pr",
		title: "Human review on every PR",
		categoryId: "C",
		scoreLevels: {
			one: "AI-generated code is reviewed by a human who understands it well enough to defend it in a postmortem. “The agent wrote it” is not a shield.",
			half: "Reviews happen but are cursory; AI-authored PRs get rubber-stamped.",
			zero: "Auto-merge on agent PRs, or no review process at all.",
		},
		repoCheck:
			"PR review settings, review depth on a sample of recent AI-tagged PRs.",
		diagnosticCommands: [
			"find . -name 'CODEOWNERS' 2>/dev/null",
			"gh api 'repos/{owner}/{repo}/branches/<default>/protection' 2>/dev/null",
			"gh pr list --state merged --limit 50 --json reviews,author,additions,deletions",
		],
		whyItMatters:
			"AI-authored code that no human can defend is technical debt with no owner. Review discipline is what keeps the org accountable for what it ships.",
		tier3Cap: true,
	},
	{
		id: 10,
		slug: "evals-for-ai-touched-paths",
		title: "Evals for AI-touched code paths",
		categoryId: "C",
		scoreLevels: {
			one: "If LLMs are in the product → offline eval suite + prod telemetry. If LLMs are in the dev loop → adoption, throughput, and defect rate measured honestly.",
			half: "Vibes-based confidence; some metrics but no rigor.",
			zero: "No evals, no measurement, no idea if the AI helps or hurts.",
		},
		repoCheck: "`evals/`, `benchmarks/`, internal AI tooling dashboards.",
		diagnosticCommands: [
			"find . -type d \\( -name 'evals' -o -name 'benchmarks' \\) 2>/dev/null",
		],
		whyItMatters:
			"Without evals, you can't tell whether AI is helping or hurting. Evals are also the only way to catch silent regressions in AI-driven product features.",
		interviewLink: { questionId: "q5", mode: "combine" },
	},
	{
		id: 11,
		slug: "blast-radius-controls",
		title: "Blast-radius controls for agent actions",
		categoryId: "C",
		scoreLevels: {
			one: "Scoped credentials per agent, dry-run modes, audit logs of every agent-triggered write, documented rollback paths. Worst-case scenarios red-teamed.",
			half: "Some controls exist but are inconsistent; audit logs partial.",
			zero: "Agents have prod write access via human-equivalent creds; no audit trail.",
		},
		diagnosticCommands: [
			"grep -rEh 'azure/login@|aws-actions/configure-aws-credentials@|google-github-actions/auth@' .github/workflows/ 2>/dev/null",
			"gh api 'repos/{owner}/{repo}/environments' --jq '.environments[] | {name: .name, has_protection: (.protection_rules | length > 0)}' 2>/dev/null",
			"find infra/ terraform/ -name '*.tf' 2>/dev/null | xargs grep -lE 'service_account|workload_identity|managed_identity|user_assigned_identity' 2>/dev/null",
		],
		whyItMatters:
			"Autonomous agents will eventually do something stupid. The question is whether the blast radius is bounded by design or by luck.",
		interviewLink: { questionId: "q6", mode: "combine" },
		tier3Cap: true,
	},
	{
		id: 12,
		slug: "judgment-under-ai-augmentation",
		title: "Interviews assess judgment under AI augmentation",
		categoryId: "D",
		scoreLevels: {
			one: "Candidates use AI in interviews and are evaluated on critique, decomposition, recognizing wrong answers, and shipping correct work.",
			half: "AI is allowed but interviewers don't know how to assess its use; or it's banned for “purity” reasons.",
			zero: "Old-style whiteboard-only interviews; or no real technical bar at all.",
		},
		diagnosticCommands: [
			"If a rubric is reachable in an internal repo, cross-check.",
		],
		whyItMatters:
			"Hiring is a forward-looking bet. The skill that matters in the AI-agentic era isn't “can write code without AI” — it's “can use AI well.”",
		interviewLink: { questionId: "q2", mode: "primary" },
	},
] as const;

export function getRubricItem(id: number): RubricItem {
	const item = RUBRIC_ITEMS.find((i) => i.id === id);
	if (!item) {
		throw new Error(`Unknown rubric item: ${id}`);
	}
	return item;
}

export function getCategory(id: "A" | "B" | "C" | "D"): RubricCategory {
	const cat = RUBRIC_CATEGORIES.find((c) => c.id === id);
	if (!cat) {
		throw new Error(`Unknown category: ${id}`);
	}
	return cat;
}
