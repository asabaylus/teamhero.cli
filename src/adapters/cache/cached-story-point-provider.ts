/**
 * Caching decorator for StoryPointProvider.
 *
 * Mirrors cached-task-tracker.ts. Namespace "storypoints". Closed windows
 * (end date in the past) are cached permanently; open windows use the default
 * TTL since recent issues can still transition to Done.
 */

import type {
	CacheOptions,
	ReportingWindow,
	StoryPointFetchResult,
	StoryPointOptions,
	StoryPointProvider,
	StoryPointResult,
	TaskTrackerMemberInput,
} from "../../core/types.js";
import { getEnv } from "../../lib/env.js";
import { appendUnifiedLog } from "../../lib/unified-log.js";
import { computeCacheHash, FileSystemCacheStore } from "./fs-cache-store.js";

const DEFAULT_TTL_SECONDS = 3600; // 1 hour
const NAMESPACE = "storypoints";

interface SerializedResult {
	byPerson: Record<string, StoryPointResult>;
	unmatchedAssignees: string[];
}

export class CachedStoryPointProvider implements StoryPointProvider {
	private readonly cache: FileSystemCacheStore<SerializedResult>;

	constructor(
		private readonly inner: StoryPointProvider,
		private readonly cacheOptions: CacheOptions = {},
	) {
		this.cache = new FileSystemCacheStore({
			namespace: NAMESPACE,
			defaultTtlSeconds: DEFAULT_TTL_SECONDS,
		});
	}

	get enabled(): boolean {
		return this.inner.enabled;
	}

	async fetchCompletedStoryPoints(
		members: TaskTrackerMemberInput[],
		window: ReportingWindow,
		options: StoryPointOptions,
	): Promise<StoryPointFetchResult> {
		if (getEnv("TEAMHERO_TEST_MODE")) {
			return this.inner.fetchCompletedStoryPoints(members, window, options);
		}

		const isClosedWindow = new Date(window.endISO) < new Date();
		const inputHash = computeCacheHash({
			startISO: window.startISO,
			endISO: window.endISO,
			members: members
				.map((m) => m.login)
				.sort()
				.join(","),
			// project keys + field ids double as the field-map version
			projects: options.projects
				.map((p) => `${p.key}:${p.fieldId}`)
				.sort()
				.join(","),
			issueTypes: (options.issueTypes ?? []).join(","),
			creditBy: options.creditBy ?? "assignee",
		});

		const sourceMatch =
			this.cacheOptions.flush ||
			this.cacheOptions.flushSources?.includes(NAMESPACE);
		const shouldFlush =
			sourceMatch &&
			(!this.cacheOptions.flushSince ||
				window.startISO >= this.cacheOptions.flushSince);

		if (!shouldFlush) {
			const hit = await this.cache.get(inputHash, {
				permanent: isClosedWindow,
			});
			if (hit) {
				await appendUnifiedLog({
					timestamp: new Date().toISOString(),
					runId: "",
					category: "cache",
					event: "cache-hit",
					namespace: NAMESPACE,
					inputHash,
				});
				return {
					byPerson: new Map(Object.entries(hit.byPerson)),
					unmatchedAssignees: hit.unmatchedAssignees,
				};
			}
		}

		const result = await this.inner.fetchCompletedStoryPoints(
			members,
			window,
			options,
		);

		const serialized: SerializedResult = {
			byPerson: Object.fromEntries(result.byPerson),
			unmatchedAssignees: result.unmatchedAssignees,
		};
		await this.cache.set(inputHash, serialized, isClosedWindow ? 0 : undefined);
		await appendUnifiedLog({
			timestamp: new Date().toISOString(),
			runId: "",
			category: "cache",
			event: shouldFlush ? "cache-flush-and-set" : "cache-miss-and-set",
			namespace: NAMESPACE,
			inputHash,
		});

		return result;
	}
}
