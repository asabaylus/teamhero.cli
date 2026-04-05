import { join } from "node:path";
import { consola } from "consola";
import { config as dotenvConfig } from "dotenv";
import { CachedLocCollector } from "../adapters/cache/cached-loc-collector.js";
import { CachedMetricsProvider } from "../adapters/cache/cached-metrics-provider.js";
import { CachedTaskTrackerProvider } from "../adapters/cache/cached-task-tracker.js";
import type { CacheOptions, ProgressReporterFactory } from "../core/types.js";
import { AIService } from "../services/ai.service.js";
import { AsanaService } from "../services/asana.service.js";
import { MetricsService } from "../services/metrics.service.js";
import { ReportService } from "../services/report.service.js";
import { ScopeService } from "../services/scope.service.js";
import { getEnv } from "./env.js";
import { loadOctokitFromEnv } from "./octokit.js";
import { configDir } from "./paths.js";

export interface ServiceFactoryOptions {
	cacheOptions?: CacheOptions;
	progressFactory?: ProgressReporterFactory;
	logger?: typeof consola;
}

export async function createReportService(
	options: ServiceFactoryOptions = {},
): Promise<ReportService> {
	// Load env from config dir
	dotenvConfig({ path: join(configDir(), ".env"), override: true });

	const logger = options.logger ?? consola.withTag("teamhero");

	const octokit = await loadOctokitFromEnv();
	const scope = new ScopeService(octokit);
	const metrics = new MetricsService(octokit, logger.withTag("metrics"));
	const ai = new AIService({ logger: logger.withTag("ai") });

	const cachedMetrics = new CachedMetricsProvider(
		metrics,
		options.cacheOptions ?? {},
	);
	const cachedLoc = new CachedLocCollector(options.cacheOptions ?? {});

	// Asana is optional — only wire if token is configured
	let taskTracker: CachedTaskTrackerProvider | undefined;
	let asanaService: AsanaService | undefined;
	let asanaToken = getEnv("ASANA_API_TOKEN");
	if (!asanaToken) {
		try {
			const { getValidAsanaToken } = await import("./asana-oauth.js");
			asanaToken = await getValidAsanaToken();
		} catch {
			// No OAuth tokens either
		}
	}
	if (asanaToken) {
		asanaService = new AsanaService({
			token: asanaToken,
			logger: logger.withTag("asana"),
		});
		taskTracker = new CachedTaskTrackerProvider(
			asanaService,
			options.cacheOptions ?? {},
		);
	}

	return new ReportService({
		scope,
		metrics: cachedMetrics,
		ai,
		logger,
		taskTracker,
		locCollector: cachedLoc,
		cacheOptions: options.cacheOptions,
		progressFactory: options.progressFactory,
		asanaService,
	});
}
