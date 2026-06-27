import { join } from "node:path";
import { consola } from "consola";
import { config as dotenvConfig } from "dotenv";
import { CachedLocCollector } from "../adapters/cache/cached-loc-collector.js";
import { CachedMetricsProvider } from "../adapters/cache/cached-metrics-provider.js";
import { CachedStoryPointProvider } from "../adapters/cache/cached-story-point-provider.js";
import { CachedTaskTrackerProvider } from "../adapters/cache/cached-task-tracker.js";
import { JiraStoryPointProvider } from "../adapters/jira/jira-story-point-provider.js";
import type {
	CacheOptions,
	ProgressReporterFactory,
	StoryPointOptions,
} from "../core/types.js";
import { AIService } from "../services/ai.service.js";
import { AsanaService } from "../services/asana.service.js";
import { createIdentityResolver } from "../services/identity-resolver.service.js";
import { MetricsService } from "../services/metrics.service.js";
import { ReportService } from "../services/report.service.js";
import { ScopeService } from "../services/scope.service.js";
import { getEnv } from "./env.js";
import { loadIdentityMapFile } from "./identity-map.js";
import { loadJiraConfig } from "./jira-config-loader.js";
import { loadOctokitFromEnv } from "./octokit.js";
import { configDir } from "./paths.js";
import {
	buildJiraLoginLookup,
	mergeUserMaps,
	parseUserMap,
	personsToUserMap,
	userMapDeprecationNotice,
} from "./user-map.js";

export interface ServiceFactoryOptions {
	cacheOptions?: CacheOptions;
	progressFactory?: ProgressReporterFactory;
	logger?: typeof consola;
	systemPrompts?: Record<string, string>;
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
	const ai = new AIService({
		logger: logger.withTag("ai"),
		systemPrompts: options.systemPrompts,
	});

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

	// Unified identity: identity-map.yaml is the canonical source; the legacy
	// USER_MAP env folds in as supplemental, back-compat entries (canonical wins).
	const identityMap = await loadIdentityMapFile(
		".teamhero/local/identity-map.yaml",
	);
	const identityResolver = createIdentityResolver(identityMap);
	const persons = identityResolver.persons();
	const userMapEnv = getEnv("USER_MAP");
	const deprecationNotice = userMapDeprecationNotice(userMapEnv);
	if (deprecationNotice) logger.warn(deprecationNotice);
	const userMap = mergeUserMaps(
		personsToUserMap(persons),
		parseUserMap(userMapEnv),
	);

	// Jira story points are optional — only wire when both auth env and a saved
	// jira-config.json are present. Otherwise the report-time guard warns and skips.
	let storyPointProvider: CachedStoryPointProvider | undefined;
	let storyPointOptions: StoryPointOptions | undefined;
	const jiraBaseUrl = getEnv("JIRA_BASE_URL");
	const jiraEmail = getEnv("JIRA_EMAIL");
	const jiraToken = getEnv("JIRA_API_TOKEN");
	if (jiraBaseUrl && jiraEmail && jiraToken) {
		const jiraConfig = await loadJiraConfig();
		if (jiraConfig) {
			const jira = new JiraStoryPointProvider({
				baseUrl: jiraBaseUrl,
				email: jiraEmail,
				apiToken: jiraToken,
				jiraLookup: buildJiraLoginLookup(userMap),
				logger: logger.withTag("jira"),
			});
			storyPointProvider = new CachedStoryPointProvider(
				jira,
				options.cacheOptions ?? {},
			);
			storyPointOptions = {
				projects: jiraConfig.projects,
				issueTypes: jiraConfig.issueTypes,
				creditBy: jiraConfig.creditBy,
			};
		}
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
		userMap,
		identityResolver,
		storyPointProvider,
		storyPointOptions,
	});
}
