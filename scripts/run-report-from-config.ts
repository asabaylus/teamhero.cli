#!/usr/bin/env bun
import { join } from "node:path";
// Load credentials from the canonical config store (~/.config/teamhero/.env),
// overriding any stale shell environment variables.
import { config as dotenvConfig } from "dotenv";
import { configDir } from "../src/lib/paths.js";

dotenvConfig({ path: join(configDir(), ".env"), override: true });

import { readFile } from "node:fs/promises";
import { consola, createConsola } from "consola";
import { getEnv } from "../src/lib/env.js";
import { loadOctokitFromEnv } from "../src/lib/octokit.js";
import { parseUserMap } from "../src/lib/user-map.js";
import { AIService } from "../src/services/ai.service.js";
import { AsanaService } from "../src/services/asana.service.js";
import { ReportService } from "../src/services/report.service.js";

function parseEnvList(value: string | undefined): string[] {
	if (!value) {
		return [];
	}
	return value
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

interface ReportConfig {
	org: string;
	team?: string;
	members?: string[];
	repos?: string[];
	useAllRepos?: boolean;
	since?: string;
	until?: string;
	includeBots?: boolean;
	excludePrivate?: boolean;
	includeArchived?: boolean;
	detailed?: boolean;
	maxCommitPages?: number;
	maxPrPages?: number;
	sections?: {
		git?: boolean;
		asana?: boolean;
		loc?: boolean;
		visibleWins?: boolean;
	};
}

const CONFIG_FILE = join(configDir(), "config.json");

async function loadSavedConfig(): Promise<ReportConfig | null> {
	try {
		const raw = await readFile(CONFIG_FILE, "utf8");
		const parsed = JSON.parse(raw) as Partial<ReportConfig>;
		if (!parsed.org) {
			return null;
		}
		return {
			org: parsed.org,
			team: parsed.team,
			members: parsed.members ?? [],
			repos: parsed.repos ?? [],
			useAllRepos: parsed.useAllRepos ?? true,
			since: parsed.since,
			until: parsed.until,
			includeBots: parsed.includeBots ?? false,
			excludePrivate: parsed.excludePrivate ?? false,
			includeArchived: parsed.includeArchived ?? false,
			detailed: parsed.detailed ?? false,
			maxCommitPages: parsed.maxCommitPages,
			maxPrPages: parsed.maxPrPages,
			sections: parsed.sections ?? {
				git: true,
				asana: true,
				loc: false,
				visibleWins: false,
			},
		} satisfies ReportConfig;
	} catch (error) {
		console.error(`Failed to load config: ${error}`);
		return null;
	}
}

function buildReportInput(config: ReportConfig) {
	const selectedRepos =
		!config.useAllRepos && config.repos && config.repos.length > 0
			? config.repos
			: undefined;
	const selectedMembers =
		config.members && config.members.length > 0 ? config.members : undefined;
	return {
		org: config.org,
		team: config.team,
		members: selectedMembers,
		repos: selectedRepos,
		since: config.since,
		until: config.until,
		includeBots: config.includeBots ?? false,
		excludePrivate: config.excludePrivate ?? false,
		includeArchived: config.includeArchived ?? false,
		detailed: config.detailed ?? false,
		maxCommitPages: config.maxCommitPages,
		maxPrPages: config.maxPrPages,
		sections: config.sections ?? {
			git: true,
			asana: true,
			loc: false,
			visibleWins: false,
		},
	};
}

async function main() {
	const config = await loadSavedConfig();
	if (!config) {
		console.error(
			"No saved configuration found. Please run 'bun run report' first to create a configuration.",
		);
		process.exit(1);
	}

	console.log("Using saved configuration:");
	console.log(JSON.stringify(config, null, 2));
	console.log("\nGenerating report...\n");

	const logger = createConsola({
		level: process.env.TEAMHERO_LOG_LEVEL
			? Number(process.env.TEAMHERO_LOG_LEVEL)
			: consola.level,
		defaults: {
			tag: "teamhero",
		},
	});

	const ai = new AIService({ logger: logger.withTag("ai") });
	const userMap = parseUserMap(getEnv("USER_MAP"));
	const asana = new AsanaService({
		token: getEnv("ASANA_API_TOKEN"),
		baseUrl: getEnv("ASANA_API_BASE_URL"),
		workspaceGids: parseEnvList(getEnv("ASANA_WORKSPACE_GID")),
		emailDomain: getEnv("ASANA_DEFAULT_EMAIL_DOMAIN"),
		userMap,
		userAgent: getEnv("ASANA_USER_AGENT"),
		logger: logger.withTag("asana"),
	});

	const reportService = new ReportService({
		octokitFactory: loadOctokitFromEnv,
		ai,
		logger,
		asana,
		userMap,
	});

	const reportInput = buildReportInput(config);
	const result = await reportService.generateReport(reportInput);

	console.log(`\n✅ Report generated: ${result.outputPath}`);
}

main().catch((error) => {
	console.error("Error generating report:", error);
	process.exit(1);
});
