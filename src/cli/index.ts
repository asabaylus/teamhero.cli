#!/usr/bin/env node
import { config as loadDotenv } from "dotenv";

loadDotenv({ override: true });

import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { type ConsolaInstance, consola, createConsola } from "consola";
import type { DiscrepancyEventItem } from "../lib/json-lines-progress.js";
import { resolveTuiBinary } from "../lib/tui-resolver.js";
import { AuthService } from "../services/auth.service.js";

export interface ReportSectionsSelection {
	dataSources: { git: boolean; asana: boolean };
	reportSections: {
		visibleWins: boolean;
		individualContributions: boolean;
		discrepancyLog?: boolean;
		loc?: boolean;
	};
}

export interface ReportCommandInput {
	org: string;
	team?: string;
	members?: string[];
	repos?: string[];
	since?: string;
	until?: string;
	includeBots: boolean;
	excludePrivate: boolean;
	includeArchived: boolean;
	detailed: boolean;
	maxCommitPages?: number;
	maxPrPages?: number;
	sections: ReportSectionsSelection;
	/** How the report was invoked: "interactive" or "headless" (CLI flags / cron). */
	mode?: "interactive" | "headless";
	/** Custom output file path (overrides default timestamped path). */
	outputPath?: string;
	/** Output format: "markdown" (default), "json", or "both". */
	outputFormat?: "markdown" | "json" | "both";
	/** When true, run AI requests sequentially instead of in parallel. */
	sequential?: boolean;
	/** Confidence threshold for discrepancies shown in the report (0-100). Defaults to 30. */
	discrepancyThreshold?: number;
	/** Flush cached data before run: "all" or comma-separated source types. */
	flushCache?: string;
	/** Report template: "detailed" (default), "executive", "individual". */
	template?: string;
}

export interface ReportResult {
	outputPath: string;
	/** Path to the JSON data file (when outputFormat is "json" or "both"). */
	jsonOutputPath?: string;
	/** AI-generated team highlight summary. */
	summary?: string;
	/** Serialized report data for TUI JSON Data tab (always populated). */
	reportData?: Record<string, unknown>;
	/** Serialized discrepancy data for TUI and headless output. */
	serializedDiscrepancy?: {
		totalCount: number;
		byContributor: Record<string, DiscrepancyEventItem[]>;
		unattributed: DiscrepancyEventItem[];
		items: DiscrepancyEventItem[];
		allItems?: DiscrepancyEventItem[];
		discrepancyThreshold?: number;
	};
}

export interface LoginResult {
	authenticated: boolean;
	provider: "token";
	message: string;
}

export interface AuthCoordinator {
	ensureAuthenticated(): Promise<LoginResult>;
	login(): Promise<LoginResult>;
}

export interface CliDependencies {
	auth: AuthCoordinator;
	logger: ConsolaInstance;
}

export interface CliOptions {
	exitOverride?: boolean;
}

// Version is set at build time
const VERSION = "0.1.0";

/** Spawn the Go TUI binary with the given args and wait for exit. */
async function spawnTui(deps: CliDependencies, args: string[]): Promise<void> {
	const tuiBinary = await resolveTuiBinary();

	if (!tuiBinary) {
		deps.logger.error(
			"Go TUI binary not found. Build it with: cd tui && go build -o teamhero-tui .",
		);
		process.exit(1);
	}

	const child = spawn(tuiBinary, args, {
		stdio: "inherit",
		env: process.env,
	});

	await new Promise<void>((resolve, reject) => {
		child.on("error", (err) => {
			deps.logger.error("Failed to launch TUI:", err);
			reject(err);
		});
		child.on("close", (code) => {
			if (code === 0) {
				resolve();
			} else {
				process.exit(code || 1);
			}
		});
	});
}

export function createCli(
	deps: CliDependencies,
	options: CliOptions = {},
): Command {
	const program = new Command();

	if (options.exitOverride) {
		program.exitOverride();
	}

	program
		.name("teamhero")
		.description("TeamHero developer contribution reports CLI")
		.version(VERSION);

	program
		.command("report")
		.description("Generate a developer contribution report")
		.helpOption(false) // Let the Go TUI binary handle --help
		.allowUnknownOption() // Pass through any flags to the TUI binary
		.action(async function (this: Command) {
			const reportArgIndex = process.argv.indexOf("report");
			const argsToPass =
				reportArgIndex >= 0 ? process.argv.slice(reportArgIndex + 1) : [];

			// Reject subcommands that are top-level — don't allow `teamhero report doctor`.
			const subcommands = ["doctor", "setup"];
			if (argsToPass.length > 0 && subcommands.includes(argsToPass[0])) {
				deps.logger.error(
					`Unknown argument: ${argsToPass[0]}. Did you mean \`teamhero ${argsToPass[0]}\`?`,
				);
				process.exit(1);
			}

			await spawnTui(deps, argsToPass);
		});

	program
		.command("setup")
		.description("Configure credentials and preferences")
		.helpOption(false)
		.allowUnknownOption()
		.action(async function (this: Command) {
			const setupArgIndex = process.argv.indexOf("setup");
			const argsToPass =
				setupArgIndex >= 0 ? process.argv.slice(setupArgIndex) : ["setup"];
			await spawnTui(deps, argsToPass);
		});

	program
		.command("doctor")
		.description("Validate installation health")
		.helpOption(false)
		.allowUnknownOption()
		.action(async function (this: Command) {
			const doctorArgIndex = process.argv.indexOf("doctor");
			const argsToPass =
				doctorArgIndex >= 0 ? process.argv.slice(doctorArgIndex) : ["doctor"];
			await spawnTui(deps, argsToPass);
		});

	return program;
}

export async function createDefaultDependencies(): Promise<CliDependencies> {
	const logger = createConsola({
		level: process.env.TEAMHERO_LOG_LEVEL
			? Number(process.env.TEAMHERO_LOG_LEVEL)
			: consola.level,
		defaults: {
			tag: "teamhero",
		},
	});

	const auth = new AuthService();

	return {
		auth,
		logger,
	} satisfies CliDependencies;
}

export async function run(
	argv: string[] = process.argv,
	deps?: CliDependencies,
): Promise<void> {
	const resolvedDeps = deps ?? (await createDefaultDependencies());
	const program = createCli(resolvedDeps);

	// If a subcommand is followed by --help, pass through to the Go binary
	// instead of letting Commander handle it (which prints the top-level help).
	const args = argv.slice(2);
	const subcommands = ["report", "doctor", "setup"];
	if (
		args.length >= 1 &&
		subcommands.includes(args[0]) &&
		args.includes("--help")
	) {
		await spawnTui(resolvedDeps, args);
		return;
	}

	await program.parseAsync(argv);
}

const thisScript = fileURLToPath(import.meta.url);
const invokedScript = await realpath(process.argv[1]).catch(
	() => process.argv[1],
);
if (invokedScript === thisScript) {
	run().catch((error) => {
		consola.error(error);
		process.exit(1);
	});
}
