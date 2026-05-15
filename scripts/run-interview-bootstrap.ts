#!/usr/bin/env bun
// CLI entry point invoked by the Go TUI for `teamhero interview bootstrap --headless`.
// Reads role-config fields from argv flags, runs the bootstrap orchestrator
// using the OpenAI-backed generator client, and exits with code 0 on success
// or 1 on failure.

import { consola } from "consola";
import { config as loadDotenv } from "dotenv";

// Do not override: CI/production env vars (real OPENAI_API_KEY, etc.) must
// win over anything that happens to be in a local .env.
loadDotenv();

import { OpenAIGeneratorClient } from "../src/services/interview/bootstrap/openai-generator-client.js";
import { runBootstrap } from "../src/services/interview/bootstrap/orchestrator.js";
import type {
	AnalysisMode,
	ProjectMode,
	RoleConfig,
	RubricMode,
} from "../src/services/interview/bootstrap/role-config.js";

interface FlagSpec {
	flag: string;
	target: keyof ParsedFlags;
}

interface ParsedFlags {
	role?: string;
	roleTitle?: string;
	stack?: string;
	domain?: string;
	feature?: string;
	timeBox?: string;
	modeProject?: string;
	modeAnalysis?: string;
	modeRubric?: string;
	jdPath?: string;
	customPrompt?: string;
	projectPrompt?: string;
	outputDir?: string;
	kitDir?: string;
	model?: string;
	maxAttempts?: string;
}

const FLAGS: readonly FlagSpec[] = [
	{ flag: "--role", target: "role" },
	{ flag: "--role-title", target: "roleTitle" },
	{ flag: "--stack", target: "stack" },
	{ flag: "--domain", target: "domain" },
	{ flag: "--feature", target: "feature" },
	{ flag: "--time-box", target: "timeBox" },
	{ flag: "--mode-project", target: "modeProject" },
	{ flag: "--mode-analysis", target: "modeAnalysis" },
	{ flag: "--mode-rubric", target: "modeRubric" },
	{ flag: "--jd-path", target: "jdPath" },
	{ flag: "--custom-prompt", target: "customPrompt" },
	{ flag: "--project-prompt", target: "projectPrompt" },
	{ flag: "--output-dir", target: "outputDir" },
	{ flag: "--kit-dir", target: "kitDir" },
	{ flag: "--model", target: "model" },
	{ flag: "--max-attempts", target: "maxAttempts" },
];

function parseArgs(argv: readonly string[]): ParsedFlags {
	const out: ParsedFlags = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const spec = FLAGS.find((f) => f.flag === arg);
		if (spec && i + 1 < argv.length) {
			out[spec.target] = argv[i + 1];
			i++;
		}
	}
	return out;
}

function buildConfig(flags: ParsedFlags): RoleConfig | string {
	if (!flags.role) return "Missing required flag --role";
	if (!flags.stack) return "Missing required flag --stack";
	if (!flags.domain) return "Missing required flag --domain";
	if (!flags.feature) return "Missing required flag --feature";
	if (!flags.modeProject) return "Missing required flag --mode-project";
	if (!flags.modeAnalysis) return "Missing required flag --mode-analysis";
	if (!flags.modeRubric) return "Missing required flag --mode-rubric";
	if (!flags.outputDir) return "Missing required flag --output-dir";

	const timeBox = Number.parseInt(flags.timeBox ?? "90", 10);
	if (!Number.isFinite(timeBox)) {
		return `--time-box must be an integer number of minutes (got ${String(flags.timeBox)})`;
	}

	const validModeProjects = ["A", "B"];
	if (!validModeProjects.includes(flags.modeProject)) {
		return `--mode-project must be one of ${validModeProjects.join("/")} (got ${flags.modeProject})`;
	}
	const validModeAnalyses = ["ai-assisted", "human-only"];
	if (!validModeAnalyses.includes(flags.modeAnalysis)) {
		return `--mode-analysis must be one of ${validModeAnalyses.join("/")} (got ${flags.modeAnalysis})`;
	}
	const validModeRubrics = ["default", "custom", "default+jd"];
	if (!validModeRubrics.includes(flags.modeRubric)) {
		return `--mode-rubric must be one of ${validModeRubrics.join("/")} (got ${flags.modeRubric})`;
	}

	const config: RoleConfig = {
		roleSlug: flags.role,
		roleTitle: flags.roleTitle ?? flags.role,
		stack: flags.stack,
		domain: flags.domain,
		featureDescription: flags.feature,
		timeBoxMinutes: timeBox,
		projectMode: flags.modeProject as ProjectMode,
		analysisMode: flags.modeAnalysis as AnalysisMode,
		rubricMode: flags.modeRubric as RubricMode,
		outputDir: flags.outputDir,
		...(flags.jdPath ? { jdPath: flags.jdPath } : {}),
		...(flags.customPrompt ? { customPrompt: flags.customPrompt } : {}),
		...(flags.projectPrompt ? { projectPrompt: flags.projectPrompt } : {}),
	};
	return config;
}

async function main() {
	const flags = parseArgs(process.argv.slice(2));
	const built = buildConfig(flags);
	if (typeof built === "string") {
		consola.error(built);
		process.exit(1);
	}
	const maxAttempts = flags.maxAttempts
		? Number.parseInt(flags.maxAttempts, 10)
		: undefined;
	const result = await runBootstrap(built, {
		client: new OpenAIGeneratorClient(undefined, flags.model),
		kitTemplateDir: flags.kitDir,
		...(Number.isFinite(maxAttempts) ? { maxAttempts } : {}),
	});
	if (!result.ok) {
		consola.error("Bootstrap failed:");
		for (const f of result.failures) consola.error(`  - ${f}`);
		process.exit(1);
	}
	consola.success(
		`Bootstrap completed in ${result.attempts} attempt(s). Output: ${built.outputDir}`,
	);
}

main().catch((err) => {
	consola.error(err);
	process.exit(1);
});
