#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { join } from "node:path";
/**
 * Headless report service runner for the Go TUI.
 *
 * Protocol:
 *   stdin  ← JSON config (ReportCommandInput)
 *   stdout → JSON-lines progress events
 *   stderr → consola log output (passed through to terminal)
 *   exit 0 = success, exit 1 = error
 */
// Load credentials from the canonical config store (~/.config/teamhero/.env),
// overriding any stale shell environment variables.
import { config as dotenvConfig } from "dotenv";
import { configDir } from "../src/lib/paths.js";
dotenvConfig({ path: join(configDir(), ".env"), override: true });

import { resolve } from "node:path";
import { consola, createConsola } from "consola";
import { AsanaBoardAdapter } from "../src/adapters/asana/board-adapter.js";
import { CachedLocCollector } from "../src/adapters/cache/cached-loc-collector.js";
import { CachedMetricsProvider } from "../src/adapters/cache/cached-metrics-provider.js";
import { CachedTaskTrackerProvider } from "../src/adapters/cache/cached-task-tracker.js";
import { CachedVisibleWinsProvider } from "../src/adapters/cache/cached-visible-wins.js";
import { CompositeMeetingNotesAdapter } from "../src/adapters/meeting-notes/composite-adapter.js";
import { MeetingNotesFilesystemAdapter } from "../src/adapters/meeting-notes/filesystem-adapter.js";
import { GoogleDriveMeetingNotesAdapter } from "../src/adapters/meeting-notes/google-drive-adapter.js";
import { VisibleWinsAdapter } from "../src/adapters/visible-wins/visible-wins-adapter.js";
import type { ReportCommandInput } from "../src/cli/index.js";
import type {
	CacheOptions,
	CacheSourceType,
	MeetingNotesProvider,
	ProjectBoardProvider,
	VisibleWinsProvider,
} from "../src/core/types.js";
import { loadBoardsConfig } from "../src/lib/boards-config-loader.js";
import { getEnv } from "../src/lib/env.js";
import { isGoogleAuthorized } from "../src/lib/google-oauth.js";
import { JsonLinesProgressDisplay } from "../src/lib/json-lines-progress.js";
import { loadOctokitFromEnv } from "../src/lib/octokit.js";
import { RunHistoryStore } from "../src/lib/run-history.js";
import { appendUnifiedLog } from "../src/lib/unified-log.js";
import { parseUserMap } from "../src/lib/user-map.js";
import {
	VISIBLE_WINS_ENV_KEYS,
	validateSharedConfig,
	validateVisibleWinsConfig,
} from "../src/lib/visible-wins-config.js";
import type { ProjectTask } from "../src/models/visible-wins.js";
import { AIService } from "../src/services/ai.service.js";
import { AsanaService } from "../src/services/asana.service.js";
import { MetricsService } from "../src/services/metrics.service.js";
import { ReportService } from "../src/services/report.service.js";
import { ScopeService } from "../src/services/scope.service.js";

/**
 * Wraps a board provider so all its tasks are rolled up into a single ProjectTask.
 * Used for project-level boards where the board itself is the "project" in the report.
 */
class ConsolidatingBoardProvider implements ProjectBoardProvider {
	constructor(
		private readonly inner: ProjectBoardProvider,
		private readonly projectName: string,
	) {}

	async fetchProjects(): Promise<ProjectTask[]> {
		const tasks = await this.inner.fetchProjects();
		if (tasks.length === 0) return [];

		// Use the highest priority score from child tasks
		const maxPriority = Math.max(...tasks.map((t) => t.priorityScore), 0);

		// Collect child task names as context for the AI prompt
		const taskNames = tasks.map((t) => t.name).join("; ");

		return [
			{
				name: this.projectName,
				gid: `consolidated-${this.projectName.toLowerCase().replace(/\s+/g, "-")}`,
				customFields: { "Child Tasks": taskNames },
				priorityScore: maxPriority,
			},
		];
	}
}

function parseEnvList(value?: string | null): string[] {
	if (!value) return [];
	return value
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/**
 * Build the meeting notes provider based on config and available credentials.
 * When Google OAuth tokens exist and no explicit provider is set, uses a
 * composite adapter that pulls from both filesystem and Google Drive.
 */
async function createNotesProvider(
	config: {
		meetingNotesDir?: string;
		meetingNotesProvider: string;
		googleDriveFolderIds?: string[];
		googleDriveIncludeTranscripts?: boolean;
	},
	logger: import("consola").ConsolaInstance,
): Promise<MeetingNotesProvider> {
	const provider = config.meetingNotesProvider;
	const googleAuthorized = await isGoogleAuthorized();

	if (provider === "google-drive") {
		return new GoogleDriveMeetingNotesAdapter({
			folderIds: config.googleDriveFolderIds,
			includeTranscripts: config.googleDriveIncludeTranscripts,
			logger: logger.withTag("gdrive-notes"),
		});
	}

	const filesystemAdapter = config.meetingNotesDir
		? new MeetingNotesFilesystemAdapter({
				notesDir: config.meetingNotesDir,
				logger,
			})
		: null;

	// Auto-detect: if Google is authorized and provider wasn't explicitly set to
	// something other than the default, use composite (filesystem + Google Drive)
	if (googleAuthorized && provider === "google-meet" && filesystemAdapter) {
		const driveAdapter = new GoogleDriveMeetingNotesAdapter({
			folderIds: config.googleDriveFolderIds,
			includeTranscripts: config.googleDriveIncludeTranscripts,
			logger: logger.withTag("gdrive-notes"),
		});
		return new CompositeMeetingNotesAdapter(
			[filesystemAdapter, driveAdapter],
			logger,
		);
	}

	if (filesystemAdapter) {
		return filesystemAdapter;
	}

	// Fallback: return a no-op adapter
	return { fetchNotes: async () => [] };
}

async function readStdin(): Promise<string> {
	const chunks: string[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
	}
	return chunks.join("");
}

async function main(): Promise<void> {
	const progressReporter = new JsonLinesProgressDisplay(process.stdout);

	try {
		const raw = await readStdin();
		if (!raw.trim()) {
			progressReporter.emitError("No config provided on stdin.");
			process.exit(1);
		}

		let input: ReportCommandInput;
		try {
			input = JSON.parse(raw) as ReportCommandInput;
		} catch {
			progressReporter.emitError("Invalid JSON config on stdin.");
			process.exit(1);
		}

		// Direct consola output to stderr so stdout stays clean for JSON-lines
		const logger = createConsola({
			level: process.env.TEAMHERO_LOG_LEVEL
				? Number(process.env.TEAMHERO_LOG_LEVEL)
				: consola.level,
			defaults: { tag: "teamhero" },
			stderr: process.stderr,
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

		const octokit = await loadOctokitFromEnv();
		const scope = new ScopeService(octokit);
		const metrics = new MetricsService(octokit, logger.withTag("metrics"));

		// Build visible wins provider from config if available
		let visibleWins: VisibleWinsProvider | undefined;
		const boardsResult = await loadBoardsConfig();
		const boards = boardsResult?.boards;
		if (boards) {
			const sharedConfig = validateSharedConfig();
			if (sharedConfig) {
				const notesProvider = await createNotesProvider(
					sharedConfig,
					logger.withTag("meeting-notes"),
				);
				visibleWins = new VisibleWinsAdapter({
					boardProviders: boards.flatMap((board) => {
						const sections = board.sections ?? [];
						const makeAdapter = (
							sectionName?: string,
						): ProjectBoardProvider => {
							const adapter = new AsanaBoardAdapter({
								asanaService: asana,
								projectGid: board.projectGid,
								...(sectionName ? { sectionName } : {}),
								priorityFieldName: board.priorityField,
								projectAliases: board.projectAliases,
								aliasesOnly: board.aliasesOnly,
							});
							if (board.singleProject && board.label) {
								return new ConsolidatingBoardProvider(adapter, board.label);
							}
							return adapter;
						};

						if (sections.length === 0) {
							return [makeAdapter()];
						}
						return sections.map((s) => makeAdapter(s));
					}),
					notesProvider,
					supplementsPath:
						getEnv(
							VISIBLE_WINS_ENV_KEYS.VISIBLE_WINS_SUPPLEMENTS_FILE,
						)?.trim() || undefined,
					includeInVisibleWins: boardsResult?.includeInVisibleWins,
					logger: logger.withTag("visible-wins"),
				});
			}
		} else {
			const vwResult = validateVisibleWinsConfig();
			if (vwResult?.valid) {
				const cfg = vwResult.config;
				const notesProvider = await createNotesProvider(
					cfg,
					logger.withTag("meeting-notes"),
				);
				visibleWins = new VisibleWinsAdapter({
					boardProviders: [
						new AsanaBoardAdapter({
							asanaService: asana,
							projectGid: cfg.asanaProjectGid,
							sectionGid: cfg.asanaSectionGid,
							sectionName: cfg.asanaSectionName,
							priorityFieldName: cfg.asanaPriorityField,
						}),
					],
					notesProvider,
					supplementsPath:
						getEnv(
							VISIBLE_WINS_ENV_KEYS.VISIBLE_WINS_SUPPLEMENTS_FILE,
						)?.trim() || undefined,
					logger: logger.withTag("visible-wins"),
				});
			}
		}

		// Parse cache flush options from input
		// Supports: "all", "loc,metrics", "all:since=2026-02-20", "loc:since=2026-02-20"
		const cacheOptions: CacheOptions = {};
		if (input.flushCache) {
			const [sourceSpec, ...modifiers] = input.flushCache.split(":");
			// Parse source spec
			const trimmedSpec = sourceSpec.trim();
			if (trimmedSpec === "all" || trimmedSpec === "true") {
				cacheOptions.flush = true;
			} else {
				cacheOptions.flushSources = trimmedSpec
					.split(",")
					.map((s) => s.trim()) as CacheSourceType[];
			}
			// Parse modifiers (e.g. "since=2026-02-20")
			for (const mod of modifiers) {
				const [key, value] = mod.split("=").map((s) => s.trim());
				if (key === "since" && value) {
					cacheOptions.flushSince = value;
				}
			}
		}

		// Wrap providers with caching decorators
		const cachedMetrics = new CachedMetricsProvider(metrics, cacheOptions);
		const cachedTaskTracker = new CachedTaskTrackerProvider(
			asana,
			cacheOptions,
		);
		const boardsConfigHash = boardsResult
			? createHash("sha256")
					.update(JSON.stringify(boardsResult))
					.digest("hex")
					.slice(0, 16)
			: "";
		const cachedVisibleWins = visibleWins
			? new CachedVisibleWinsProvider(
					visibleWins,
					cacheOptions,
					boardsConfigHash,
				)
			: undefined;
		const cachedLoc = new CachedLocCollector(cacheOptions);

		const reportService = new ReportService({
			scope,
			metrics: cachedMetrics,
			ai,
			logger,
			taskTracker: cachedTaskTracker,
			visibleWins: cachedVisibleWins,
			locCollector: cachedLoc,
			cacheOptions,
			progressFactory: { create: (_opts) => progressReporter },
			boardConfigs: boards ?? undefined,
			asanaService: asana,
			roadmapTitle: boardsResult?.roadmapTitle,
			userMap,
		});

		const result = await reportService.generateReport(input);

		// Save run snapshot for history-based deltas
		if (result.reportData) {
			try {
				const runHistory = new RunHistoryStore();
				const reportData = result.reportData as Record<string, unknown>;
				const window = reportData.window as
					| { start?: string; end?: string }
					| undefined;
				const serializedJson = JSON.stringify(reportData);
				const checksum = createHash("sha256")
					.update(serializedJson)
					.digest("hex");
				await runHistory.save({
					runId: (reportData.generatedAt as string) ?? new Date().toISOString(),
					timestamp: new Date().toISOString(),
					orgSlug: input.org,
					startDate: window?.start ?? input.since ?? "",
					endDate: window?.end ?? input.until ?? "",
					memberCount: (reportData.memberMetrics as unknown[])?.length ?? 0,
					repoCount:
						(reportData.totals as { repoCount?: number })?.repoCount ?? 0,
					blobSchemaVersion: 1,
					checksum,
					reportData,
				});
				await appendUnifiedLog({
					timestamp: new Date().toISOString(),
					runId: (reportData.generatedAt as string) ?? "",
					category: "cache",
					event: "snapshot-saved",
					org: input.org,
				});
			} catch (snapshotErr) {
				// Snapshot saving is best-effort — don't fail the report
				logger.warn(
					`Failed to save run snapshot: ${snapshotErr instanceof Error ? snapshotErr.message : String(snapshotErr)}`,
				);
			}
		}

		// Emit discrepancy data for the TUI Discrepancy Log tab.
		if (result.serializedDiscrepancy) {
			progressReporter.emitDiscrepancy(result.serializedDiscrepancy);
		}

		// Emit serialized report data for the TUI JSON Data tab.
		if (result.reportData) {
			progressReporter.emitReportData(result.reportData);
		}

		progressReporter.emitResult(
			resolve(result.outputPath),
			result.jsonOutputPath ? resolve(result.jsonOutputPath) : undefined,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		progressReporter.emitError(message);
		process.exit(1);
	}
}

await main();
