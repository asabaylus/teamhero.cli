import type {
	CacheOptions,
	CompletedWorkFetchResult,
	JiraCompletedWorkProvider,
	ReportingWindow,
	StoryPointOptions,
} from "../../core/types.js";
import { getEnv } from "../../lib/env.js";
import { computeCacheHash, FileSystemCacheStore } from "./fs-cache-store.js";

const OPEN_TTL_SECONDS = 3600;
const CLOSED_TTL_SECONDS = 24 * 3600;
const RULE_VERSION = "first-done-transition-v1";

export class CachedCompletedWorkProvider implements JiraCompletedWorkProvider {
	private readonly cache = new FileSystemCacheStore<CompletedWorkFetchResult>({
		namespace: "jira-completed-work",
		defaultTtlSeconds: OPEN_TTL_SECONDS,
	});

	constructor(
		private readonly inner: JiraCompletedWorkProvider,
		private readonly cacheOptions: CacheOptions = {},
		private readonly identityCacheKey = "",
	) {}

	get enabled(): boolean {
		return this.inner.enabled;
	}

	async fetchCompletedWork(
		window: ReportingWindow,
		options: StoryPointOptions,
	): Promise<CompletedWorkFetchResult> {
		if (getEnv("TEAMHERO_TEST_MODE")) {
			return this.inner.fetchCompletedWork(window, options);
		}
		const inputHash = computeCacheHash({
			rule: RULE_VERSION,
			startISO: window.startISO,
			endISO: window.endISO,
			projects: JSON.stringify(
				options.projects.map((project) => ({
					key: project.key,
					fieldId: project.fieldId,
					issueTypes: project.issueTypes ?? [],
					completedWork: project.completedWork,
				})),
			),
			issueTypes: JSON.stringify(options.issueTypes ?? []),
			storyPointField: options.storyPointField ?? "",
			creditBy: options.creditBy ?? "assignee",
			identityCacheKey: this.identityCacheKey,
		});
		const sourceMatch =
			this.cacheOptions.flush ||
			this.cacheOptions.flushSources?.includes("jira-completed-work") ||
			this.cacheOptions.flushSources?.includes("storypoints");
		const shouldFlush =
			sourceMatch &&
			(!this.cacheOptions.flushSince ||
				window.startISO >= this.cacheOptions.flushSince);
		if (!shouldFlush) {
			const hit = await this.cache.get(inputHash);
			if (hit) return hit;
		}
		const result = await this.inner.fetchCompletedWork(window, options);
		await this.cache.set(
			inputHash,
			result,
			new Date(window.endISO) < new Date() ? CLOSED_TTL_SECONDS : undefined,
		);
		return result;
	}
}
