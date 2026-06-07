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
	outputDir?: string;
	kitDir?: string;
	model?: string;
	maxAttempts?: string;
	debug?: boolean;
	stackByCandidate?: boolean;
	jdInfluencesProject?: boolean;
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
	{ flag: "--output-dir", target: "outputDir" },
	{ flag: "--kit-dir", target: "kitDir" },
	{ flag: "--model", target: "model" },
	{ flag: "--max-attempts", target: "maxAttempts" },
];

function parseArgs(argv: readonly string[]): ParsedFlags {
	const out: ParsedFlags = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--debug" || arg === "-d") {
			out.debug = true;
			continue;
		}
		if (arg === "--stack-by-candidate") {
			out.stackByCandidate = true;
			continue;
		}
		if (arg === "--jd-influences-project") {
			out.jdInfluencesProject = true;
			continue;
		}
		const spec = FLAGS.find((f) => f.flag === arg);
		if (spec && i + 1 < argv.length) {
			(out as Record<string, string | boolean | undefined>)[spec.target] =
				argv[i + 1];
			i++;
		}
	}
	return out;
}

function buildConfig(flags: ParsedFlags): RoleConfig | string {
	if (!flags.role) return "Missing required flag --role";
	if (!flags.stack) return "Missing required flag --stack";
	// --domain is required UNLESS --jd-path is supplied. The JD
	// describes the business domain; the OpenAI prompt and role-config
	// validator both accept an empty domain when a JD is attached.
	if (!flags.domain && !flags.jdPath) {
		return "Missing required flag --domain (or attach a --jd-path so the JD can describe the domain)";
	}
	if (!flags.feature) return "Missing required flag --feature";
	if (!flags.modeProject) return "Missing required flag --mode-project";
	if (!flags.modeAnalysis) return "Missing required flag --mode-analysis";
	if (!flags.modeRubric) return "Missing required flag --mode-rubric";
	if (!flags.outputDir) return "Missing required flag --output-dir";

	const timeBox = Number.parseInt(flags.timeBox ?? "60", 10);
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
	const validModeRubrics = ["default", "custom"];
	if (!validModeRubrics.includes(flags.modeRubric)) {
		return `--mode-rubric must be one of ${validModeRubrics.join("/")} (got ${flags.modeRubric})`;
	}

	if (flags.stackByCandidate && flags.modeProject !== "B") {
		return "--stack-by-candidate is only valid with --mode-project B";
	}

	if (flags.jdInfluencesProject && !flags.jdPath) {
		return "--jd-influences-project requires --jd-path";
	}

	const config: RoleConfig = {
		roleSlug: flags.role,
		roleTitle: flags.roleTitle ?? flags.role,
		stack: flags.stack,
		// Empty domain is allowed when --jd-path is supplied; the
		// OpenAI prompt and the validator both fall back to the JD.
		domain: flags.domain ?? "",
		featureDescription: flags.feature,
		timeBoxMinutes: timeBox,
		projectMode: flags.modeProject as ProjectMode,
		analysisMode: flags.modeAnalysis as AnalysisMode,
		rubricMode: flags.modeRubric as RubricMode,
		outputDir: flags.outputDir,
		...(flags.jdPath ? { jdPath: flags.jdPath } : {}),
		...(flags.customPrompt ? { customPrompt: flags.customPrompt } : {}),
		...(flags.stackByCandidate ? { stackByCandidate: true } : {}),
		...(flags.jdInfluencesProject ? { jdInfluencesProject: true } : {}),
	};
	return config;
}

// truncateForLog clips long strings so a stray multi-KB feature description
// (or rubric custom-prompt) can't blow up the debug log. 300 chars is
// enough to recognize the input while staying readable in a terminal.
function truncateForLog(s: string | undefined, max = 300): string {
	if (!s) return "";
	const t = s.replace(/\s+/g, " ").trim();
	if (t.length <= max) return t;
	return `${t.slice(0, max - 1)}…`;
}

async function main() {
	const flags = parseArgs(process.argv.slice(2));
	// consola's default log level (3) hides .debug() output. When the
	// proctor passes --debug we want the per-field truncated body logs
	// to actually print, so raise the threshold. Lifted once here so
	// every consola.debug below benefits without re-checking the flag.
	if (flags.debug) {
		consola.level = 4;
	}
	const built = buildConfig(flags);
	if (typeof built === "string") {
		consola.error(built);
		process.exit(1);
	}
	const maxAttempts = flags.maxAttempts
		? Number.parseInt(flags.maxAttempts, 10)
		: undefined;

	// Always log: enough run context to triage a failure ticket without
	// repro. Skip feature/prompt text bodies — those go in --debug.
	consola.info(
		`bootstrap.start role=${built.roleSlug} mode=${built.projectMode} stack=${built.stack} stack-by-candidate=${built.stackByCandidate ?? false} domain=${built.domain} time-box=${built.timeBoxMinutes}m rubric=${built.rubricMode} jd=${built.jdPath ?? "(none)"} jd-influences-project=${built.jdInfluencesProject ?? false} max-attempts=${maxAttempts ?? "(default)"} model=${flags.model ?? "(default)"}`,
	);
	if (flags.debug) {
		consola.debug(
			`bootstrap.debug.feature ${truncateForLog(built.featureDescription)}`,
		);
		if (built.customPrompt) {
			consola.debug(
				`bootstrap.debug.custom-prompt ${truncateForLog(built.customPrompt)}`,
			);
		}
		consola.debug(`bootstrap.debug.output-dir ${built.outputDir}`);
		consola.debug(`bootstrap.debug.kit-dir ${flags.kitDir ?? "(none)"}`);
	}

	const startedAt = Date.now();
	const result = await runBootstrap(built, {
		client: new OpenAIGeneratorClient(undefined, flags.model),
		kitTemplateDir: flags.kitDir,
		...(Number.isFinite(maxAttempts) ? { maxAttempts } : {}),
	});
	const elapsedMs = Date.now() - startedAt;
	if (!result.ok) {
		consola.error(
			`bootstrap.fail attempts=${result.attempts} elapsed=${elapsedMs}ms`,
		);
		for (const f of result.failures) consola.error(`  - ${f}`);
		process.exit(1);
	}
	consola.success(
		`bootstrap.ok attempts=${result.attempts} elapsed=${elapsedMs}ms output=${built.outputDir}`,
	);
}

main().catch((err) => {
	consola.error(err);
	process.exit(1);
});
