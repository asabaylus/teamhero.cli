/**
 * Caching decorator for StoryPointProvider.
 *
 * Mirrors cached-task-tracker.ts. Namespace "storypoints".
 *
 * A past week is NOT settled data. Jira story points are edited after the fact:
 * an estimate is added to an issue that shipped weeks ago, an issue is reopened
 * and finished again, an assignee changes. A closed window was once cached
 * permanently on the analogy of a closed git window, and the result was a
 * report that replayed a months-old snapshot of Jira for every historical week
 * and answered a re-run with byte-identical totals — the shape of a wrong
 * number that looks reproducible. Closed windows now expire too, just slowly.
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

const DEFAULT_TTL_SECONDS = 3600; // 1 hour — the window is still open
/** A closed window changes rarely, but it does change. Re-read once a day. */
const CLOSED_WINDOW_TTL_SECONDS = 24 * 3600;
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
		/**
		 * Stable version of the Jira identity mapping. Included in the cache key so
		 * a change to the identity map / USER_MAP invalidates cached (possibly
		 * misattributed) results instead of serving them from a permanent entry.
		 */
		private readonly identityCacheKey = "",
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
			storyPointField: options.storyPointField ?? "",
			creditBy: options.creditBy ?? "assignee",
			identityCacheKey: this.identityCacheKey,
			// Bump when the completion rule changes, so entries written under the
			// old rule miss instead of replaying a stale total.
			rule: "first-completion-from-changelog",
		});

		const sourceMatch =
			this.cacheOptions.flush ||
			this.cacheOptions.flushSources?.includes(NAMESPACE);
		const shouldFlush =
			sourceMatch &&
			(!this.cacheOptions.flushSince ||
				window.startISO >= this.cacheOptions.flushSince);

		if (!shouldFlush) {
			const hit = await this.cache.get(inputHash);
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
		await this.cache.set(
			inputHash,
			serialized,
			isClosedWindow ? CLOSED_WINDOW_TTL_SECONDS : undefined,
		);
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
