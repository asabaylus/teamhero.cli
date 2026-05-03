/**
 * Deterministic evidence collectors — one per rubric item.
 *
 * Each implements MaturityProvider and runs against a local repo path. They
 * never throw on missing files; they emit zero or more EvidenceFact records
 * with a positive/neutral/negative signal. The AI scorer takes these facts +
 * interview answers + diagnostic instructions and produces the final score.
 *
 * GitHub-backed checks (PR cadence, branch protection, CI run history) are
 * skipped at git-only tier — the rubric caps items 2/3/9/11 at 0.5 in that
 * case (see references/preflight.md and rubric.ts::tier3Cap).
 */

import { join } from "node:path";
import type { MaturityProvider } from "../../core/types.js";
import { anyFile, fileContains, findFiles, readIfExists } from "./fs-utils.js";
import type {
	AdjacentRepo,
	EvidenceFact,
	EvidenceTier,
	ScopeDescriptor,
} from "./types.js";

interface CollectInput {
	scope: ScopeDescriptor;
	tier: EvidenceTier;
	adjacentRepos: AdjacentRepo[];
}

function localPath(scope: ScopeDescriptor): string | null {
	return scope.localPath ?? null;
}

function fact(
	itemId: number,
	signal: EvidenceFact["signal"],
	summary: string,
	source: string,
	details?: Record<string, unknown>,
): EvidenceFact {
	const result: EvidenceFact = { itemId, signal, summary, source };
	if (details) result.details = details;
	return result;
}

// ---------------------------------------------------------------------------
// Item 1 — Reproducible dev environments
// ---------------------------------------------------------------------------

class ReproducibleDevCollector implements MaturityProvider {
	readonly itemId = 1;

	async collect(input: CollectInput): Promise<EvidenceFact[]> {
		const root = localPath(input.scope);
		if (!root) return [];
		const facts: EvidenceFact[] = [];
		const candidates = [
			".devcontainer",
			"flake.nix",
			"setup.sh",
			"scripts/bootstrap.sh",
			"scripts/setup.sh",
			"Makefile",
			"justfile",
			"docker-compose.yml",
		];
		const found: string[] = [];
		for (const c of candidates) {
			if (
				await anyFile(root, { pathContains: [c.toLowerCase()], maxDepth: 3 })
			) {
				found.push(c);
			}
		}
		if (found.length > 0) {
			facts.push(
				fact(
					1,
					"positive",
					`Bootstrap surface found: ${found.join(", ")}`,
					"reproducible-dev-collector",
					{ found },
				),
			);
		} else {
			facts.push(
				fact(
					1,
					"negative",
					"No devcontainer / flake.nix / bootstrap script detected at the repo root.",
					"reproducible-dev-collector",
				),
			);
		}

		const readme = await readIfExists(join(root, "README.md"));
		if (
			readme &&
			/\b(install|setup|bootstrap|getting started)\b/i.test(readme)
		) {
			facts.push(
				fact(
					1,
					"positive",
					"README documents an install/setup section.",
					"reproducible-dev-collector",
				),
			);
		}
		return facts;
	}
}

// ---------------------------------------------------------------------------
// Item 2 — Sub-day integration cadence (gh-backed; capped at 0.5 on git-only)
// ---------------------------------------------------------------------------

class IntegrationCadenceCollector implements MaturityProvider {
	readonly itemId = 2;

	async collect(input: CollectInput): Promise<EvidenceFact[]> {
		const facts: EvidenceFact[] = [];
		if (input.tier === "git-only") {
			facts.push(
				fact(
					2,
					"neutral",
					"Tier 3 (git-only): cadence approximated from local merge commits — no PR or DORA visibility. Score capped at 0.5.",
					"integration-cadence-collector",
				),
			);
			return facts;
		}
		// Note: actual gh API queries happen in the AI scorer's tool-use layer or
		// via the existing octokit adapter. Here we record that the tier supports it.
		facts.push(
			fact(
				2,
				"neutral",
				`Tier ${input.tier}: PR cadence and CI run history available via GitHub.`,
				"integration-cadence-collector",
			),
		);
		return facts;
	}
}

// ---------------------------------------------------------------------------
// Item 3 — Testability
// ---------------------------------------------------------------------------

class TestabilityCollector implements MaturityProvider {
	readonly itemId = 3;

	async collect(input: CollectInput): Promise<EvidenceFact[]> {
		const root = localPath(input.scope);
		if (!root) return [];
		const facts: EvidenceFact[] = [];

		const testFiles = await findFiles(root, {
			nameRegex:
				/\.(test|spec)\.(ts|js|tsx|jsx|py|go|rs)$|.+_test\.go$|.*Tests\.cs$/,
			maxDepth: 5,
			limit: 500,
		});
		if (testFiles.length === 0) {
			facts.push(
				fact(
					3,
					"negative",
					"No test files (*.spec.*, *.test.*, *_test.go, *Tests.cs) found.",
					"testability-collector",
				),
			);
		} else {
			facts.push(
				fact(
					3,
					"positive",
					`${testFiles.length} test file(s) detected.`,
					"testability-collector",
					{ count: testFiles.length, sample: testFiles.slice(0, 5) },
				),
			);
		}

		// Detect CI continue-on-error / always-true tricks (worker-script grep on workflow files)
		const workflows = await findFiles(root, {
			pathContains: [".github/workflows"],
			maxDepth: 5,
		});
		for (const wf of workflows) {
			if (
				await fileContains(
					join(root, wf),
					/(\|\|\s*true\b|continue-on-error:\s*true)/,
				)
			) {
				facts.push(
					fact(
						3,
						"negative",
						`CI workflow swallows test failures: ${wf}`,
						"testability-collector",
					),
				);
				break;
			}
		}

		if (input.tier === "git-only") {
			facts.push(
				fact(
					3,
					"neutral",
					"Tier 3 (git-only): no CI flake/fail-rate visibility. Score capped at 0.5.",
					"testability-collector",
				),
			);
		}

		return facts;
	}
}

// ---------------------------------------------------------------------------
// Item 4 — Observability
// ---------------------------------------------------------------------------

class ObservabilityCollector implements MaturityProvider {
	readonly itemId = 4;

	async collect(input: CollectInput): Promise<EvidenceFact[]> {
		const root = localPath(input.scope);
		if (!root) return [];
		const facts: EvidenceFact[] = [];

		const obsLibPattern =
			/OpenTelemetry|opentelemetry|Microsoft\.ApplicationInsights|datadog|@datadog|prom-client|prometheus|grafana|loki|tempo|sentry|honeycomb|newrelic|splunk/i;
		const manifestNames = [
			"package.json",
			"go.mod",
			"Cargo.toml",
			"requirements.txt",
			"pyproject.toml",
			"pom.xml",
			"build.gradle",
			"build.gradle.kts",
		];
		const found: string[] = [];
		for (const m of manifestNames) {
			if (await fileContains(join(root, m), obsLibPattern)) {
				found.push(m);
			}
		}
		if (found.length > 0) {
			facts.push(
				fact(
					4,
					"positive",
					`Observability libraries referenced in: ${found.join(", ")}`,
					"observability-collector",
				),
			);
		} else {
			facts.push(
				fact(
					4,
					"negative",
					"No telemetry libraries (OTel/Datadog/Sentry/Prometheus/etc.) detected in dependency manifests.",
					"observability-collector",
				),
			);
		}

		const runbooks = await findFiles(root, {
			pathContains: ["runbook", "incident", "/sli", "/slo", "ops/"],
			maxDepth: 5,
			limit: 50,
		});
		if (runbooks.length > 0) {
			facts.push(
				fact(
					4,
					"positive",
					`Runbook/SLI/SLO docs present: ${runbooks.slice(0, 3).join(", ")}`,
					"observability-collector",
					{ count: runbooks.length },
				),
			);
		}

		const dashboards = await findFiles(root, {
			pathContains: ["grafana", "dashboards", "alerts"],
			nameRegex: /\.(json|yml|yaml|libsonnet|jsonnet)$/,
			maxDepth: 5,
		});
		if (dashboards.length > 0) {
			facts.push(
				fact(
					4,
					"positive",
					`Committed dashboards/alerts: ${dashboards.length} file(s).`,
					"observability-collector",
				),
			);
		}

		return facts;
	}
}

// ---------------------------------------------------------------------------
// Item 5 — Design discipline
// ---------------------------------------------------------------------------

class DesignDisciplineCollector implements MaturityProvider {
	readonly itemId = 5;

	async collect(input: CollectInput): Promise<EvidenceFact[]> {
		const root = localPath(input.scope);
		if (!root) return [];
		const facts: EvidenceFact[] = [];

		const adrs = await findFiles(root, {
			pathContains: ["adr", "architecture-decision"],
			nameRegex: /\.md$/i,
			maxDepth: 5,
		});
		if (adrs.length > 0) {
			facts.push(
				fact(
					5,
					"positive",
					`Architecture decision records found (${adrs.length}).`,
					"design-discipline-collector",
					{ count: adrs.length, sample: adrs.slice(0, 3) },
				),
			);
		}

		const archMd = await readIfExists(join(root, "ARCHITECTURE.md"));
		if (archMd && archMd.length > 200) {
			facts.push(
				fact(
					5,
					"positive",
					"ARCHITECTURE.md present and non-trivial.",
					"design-discipline-collector",
				),
			);
		} else if (archMd) {
			facts.push(
				fact(
					5,
					"neutral",
					"ARCHITECTURE.md present but very short.",
					"design-discipline-collector",
				),
			);
		}

		const docsArch = await findFiles(root, {
			pathContains: ["docs/architecture", "docs/design"],
			nameRegex: /\.md$/i,
			maxDepth: 5,
		});
		if (docsArch.length > 0) {
			facts.push(
				fact(
					5,
					"positive",
					`Design docs under docs/: ${docsArch.length} file(s).`,
					"design-discipline-collector",
				),
			);
		}

		const glossary = await anyFile(root, {
			nameRegex: /^(GLOSSARY|UBIQUITOUS-LANGUAGE|TERMS)\.md$/i,
			maxDepth: 4,
		});
		if (glossary) {
			facts.push(
				fact(
					5,
					"positive",
					"Glossary / ubiquitous-language file checked in.",
					"design-discipline-collector",
				),
			);
		}

		if (adrs.length === 0 && !archMd && docsArch.length === 0) {
			facts.push(
				fact(
					5,
					"negative",
					"No ADRs, ARCHITECTURE.md, or design docs detected.",
					"design-discipline-collector",
				),
			);
		}

		return facts;
	}
}

// ---------------------------------------------------------------------------
// Item 6 — Deep modules
// ---------------------------------------------------------------------------

class DeepModulesCollector implements MaturityProvider {
	readonly itemId = 6;

	async collect(input: CollectInput): Promise<EvidenceFact[]> {
		const root = localPath(input.scope);
		if (!root) return [];
		const facts: EvidenceFact[] = [];
		const sourceFiles = await findFiles(root, {
			nameRegex: /\.(ts|tsx|js|jsx|go|py|rs|cs|java|kt)$/,
			maxDepth: 6,
			limit: 2000,
		});
		facts.push(
			fact(
				6,
				"neutral",
				`Source files indexed: ${sourceFiles.length}. Module-shape judgment requires AI review of file size distribution.`,
				"deep-modules-collector",
				{ count: sourceFiles.length },
			),
		);
		// Surface a god-file warning: any source file with extreme path depth or a
		// neighbour heuristic. We emit just the count summary; the AI judges shape.
		return facts;
	}
}

// ---------------------------------------------------------------------------
// Item 7 — Repo-local agent context
// ---------------------------------------------------------------------------

class AgentContextCollector implements MaturityProvider {
	readonly itemId = 7;

	async collect(input: CollectInput): Promise<EvidenceFact[]> {
		const root = localPath(input.scope);
		if (!root) return [];
		const facts: EvidenceFact[] = [];
		const contextFiles = [
			"CLAUDE.md",
			"AGENTS.md",
			".cursor/rules",
			".cursorrules",
			".github/copilot-instructions.md",
			"memory-bank",
		];
		const found: string[] = [];
		for (const candidate of contextFiles) {
			if (
				await anyFile(root, {
					pathContains: [candidate.toLowerCase()],
					maxDepth: 4,
				})
			) {
				found.push(candidate);
			}
		}
		const skillsDir = await findFiles(root, {
			pathContains: [".claude/skills", "claude-plugin/skills", ".skills"],
			nameRegex: /SKILL\.md$/i,
			maxDepth: 5,
		});
		if (skillsDir.length > 0) {
			found.push(`${skillsDir.length} repo-local skill(s)`);
		}
		if (found.length > 0) {
			facts.push(
				fact(
					7,
					"positive",
					`Repo-local agent context: ${found.join(", ")}.`,
					"agent-context-collector",
				),
			);
		} else {
			facts.push(
				fact(
					7,
					"negative",
					"No CLAUDE.md / AGENTS.md / .cursor / repo-local skills detected.",
					"agent-context-collector",
				),
			);
		}
		return facts;
	}
}

// ---------------------------------------------------------------------------
// Item 8 — Sanctioned AI tooling (primary signal: interview)
// ---------------------------------------------------------------------------

class SanctionedAiCollector implements MaturityProvider {
	readonly itemId = 8;

	async collect(_input: CollectInput): Promise<EvidenceFact[]> {
		const facts: EvidenceFact[] = [];
		facts.push(
			fact(
				8,
				"neutral",
				"Item 8 is scored primarily from interview Q1. Any policy doc evidence will be cross-checked.",
				"sanctioned-ai-collector",
			),
		);
		return facts;
	}
}

// ---------------------------------------------------------------------------
// Item 9 — Human review on every PR (gh-backed; cap at 0.5 on git-only)
// ---------------------------------------------------------------------------

class HumanReviewCollector implements MaturityProvider {
	readonly itemId = 9;

	async collect(input: CollectInput): Promise<EvidenceFact[]> {
		const root = localPath(input.scope);
		const facts: EvidenceFact[] = [];
		if (root) {
			const codeowners =
				(await readIfExists(join(root, "CODEOWNERS"))) ??
				(await readIfExists(join(root, ".github", "CODEOWNERS"))) ??
				(await readIfExists(join(root, "docs", "CODEOWNERS")));
			if (codeowners) {
				facts.push(
					fact(
						9,
						"positive",
						"CODEOWNERS file present.",
						"human-review-collector",
					),
				);
			} else {
				facts.push(
					fact(
						9,
						"neutral",
						"No CODEOWNERS file detected.",
						"human-review-collector",
					),
				);
			}
		}
		if (input.tier === "git-only") {
			facts.push(
				fact(
					9,
					"neutral",
					"Tier 3 (git-only): no branch-protection or review-depth visibility. Score capped at 0.5.",
					"human-review-collector",
				),
			);
		}
		return facts;
	}
}

// ---------------------------------------------------------------------------
// Item 10 — Evals for AI-touched paths
// ---------------------------------------------------------------------------

class EvalsCollector implements MaturityProvider {
	readonly itemId = 10;

	async collect(input: CollectInput): Promise<EvidenceFact[]> {
		const root = localPath(input.scope);
		if (!root) return [];
		const facts: EvidenceFact[] = [];
		const evalDirs = await findFiles(root, {
			pathContains: ["/evals/", "/benchmarks/", "/eval-suite/"],
			maxDepth: 5,
			limit: 50,
		});
		if (evalDirs.length > 0) {
			facts.push(
				fact(
					10,
					"positive",
					`Eval / benchmark surface detected (${evalDirs.length} file(s)).`,
					"evals-collector",
				),
			);
		} else {
			facts.push(
				fact(
					10,
					"neutral",
					"No evals/ or benchmarks/ directory detected. Item also depends on interview Q5.",
					"evals-collector",
				),
			);
		}
		return facts;
	}
}

// ---------------------------------------------------------------------------
// Item 11 — Blast-radius controls
// ---------------------------------------------------------------------------

class BlastRadiusCollector implements MaturityProvider {
	readonly itemId = 11;

	async collect(input: CollectInput): Promise<EvidenceFact[]> {
		const root = localPath(input.scope);
		if (!root) return [];
		const facts: EvidenceFact[] = [];

		const workflowFiles = await findFiles(root, {
			pathContains: [".github/workflows"],
			maxDepth: 4,
		});
		let oidcCount = 0;
		let secretsKeyCount = 0;
		const oidcPattern =
			/azure\/login@|aws-actions\/configure-aws-credentials@|google-github-actions\/auth@/;
		const longLivedSecretsPattern =
			/secrets\.AWS_ACCESS_KEY_ID|secrets\.AZURE_CLIENT_SECRET|secrets\.GCP_KEY/;
		for (const wf of workflowFiles) {
			if (await fileContains(join(root, wf), oidcPattern)) oidcCount++;
			if (await fileContains(join(root, wf), longLivedSecretsPattern))
				secretsKeyCount++;
		}
		if (oidcCount > 0) {
			facts.push(
				fact(
					11,
					"positive",
					`OIDC-based auth in CI workflows (${oidcCount} workflow(s)).`,
					"blast-radius-collector",
				),
			);
		}
		if (secretsKeyCount > 0) {
			facts.push(
				fact(
					11,
					"negative",
					`Long-lived cloud creds via repo secrets in ${secretsKeyCount} workflow(s).`,
					"blast-radius-collector",
				),
			);
		}

		const tfFiles = await findFiles(root, {
			pathContains: ["infra/", "terraform/"],
			nameRegex: /\.tf$/,
			maxDepth: 6,
			limit: 100,
		});
		if (tfFiles.length > 0) {
			facts.push(
				fact(
					11,
					"positive",
					`Terraform/infrastructure-as-code present (${tfFiles.length} file(s)).`,
					"blast-radius-collector",
				),
			);
		}

		if (input.tier === "git-only") {
			facts.push(
				fact(
					11,
					"neutral",
					"Tier 3 (git-only): no environment-protection visibility. Score capped at 0.5.",
					"blast-radius-collector",
				),
			);
		}

		return facts;
	}
}

// ---------------------------------------------------------------------------
// Item 12 — Judgment under AI augmentation (primary: interview Q2)
// ---------------------------------------------------------------------------

class HiringCollector implements MaturityProvider {
	readonly itemId = 12;

	async collect(_input: CollectInput): Promise<EvidenceFact[]> {
		const facts: EvidenceFact[] = [];
		facts.push(
			fact(
				12,
				"neutral",
				"Item 12 is scored primarily from interview Q2.",
				"hiring-collector",
			),
		);
		return facts;
	}
}

export function defaultCollectors(): MaturityProvider[] {
	return [
		new ReproducibleDevCollector(),
		new IntegrationCadenceCollector(),
		new TestabilityCollector(),
		new ObservabilityCollector(),
		new DesignDisciplineCollector(),
		new DeepModulesCollector(),
		new AgentContextCollector(),
		new SanctionedAiCollector(),
		new HumanReviewCollector(),
		new EvalsCollector(),
		new BlastRadiusCollector(),
		new HiringCollector(),
	];
}

export async function runAllCollectors(
	collectors: MaturityProvider[],
	input: CollectInput,
): Promise<EvidenceFact[]> {
	const facts: EvidenceFact[] = [];
	for (const c of collectors) {
		try {
			const f = await c.collect(input);
			facts.push(...f);
		} catch (err) {
			facts.push({
				itemId: c.itemId,
				signal: "neutral",
				summary: `Collector for item ${c.itemId} threw: ${(err as Error).message}`,
				source: "evidence-collectors",
			});
		}
	}
	return facts;
}
