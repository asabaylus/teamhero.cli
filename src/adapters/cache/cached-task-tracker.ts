/**
 * Caching decorator for TaskTrackerProvider.
 *
 * Wraps any TaskTrackerProvider with filesystem-based caching.
 * Always uses TTL (1 hour) — tasks can change retroactively.
 *
 * Map<string, MemberTaskSummary> is serialized as Record<string, MemberTaskSummary>
 * for JSON compatibility (same approach as report-serializer.ts).
 */

import type {
	CacheOptions,
	MemberTaskSummary,
	ReportingWindow,
	TaskTrackerMemberInput,
	TaskTrackerProvider,
} from "../../core/types.js";
import { getEnv } from "../../lib/env.js";
import { appendUnifiedLog } from "../../lib/unified-log.js";
import { FileSystemCacheStore, computeCacheHash } from "./fs-cache-store.js";

const DEFAULT_TTL_SECONDS = 3600; // 1 hour

type SerializedTaskResult = Record<string, MemberTaskSummary>;

export class CachedTaskTrackerProvider implements TaskTrackerProvider {
	private readonly cache: FileSystemCacheStore<SerializedTaskResult>;

	constructor(
		private readonly inner: TaskTrackerProvider,
		private readonly cacheOptions: CacheOptions = {},
	) {
		this.cache = new FileSystemCacheStore({
			namespace: "tasks",
			defaultTtlSeconds: DEFAULT_TTL_SECONDS,
		});
	}

	get enabled(): boolean {
		return this.inner.enabled;
	}

	async fetchTasksForMembers(
		members: TaskTrackerMemberInput[],
		window: ReportingWindow,
	): Promise<Map<string, MemberTaskSummary>> {
		if (getEnv("TEAMHERO_TEST_MODE")) {
			return this.inner.fetchTasksForMembers(members, window);
		}

		const inputHash = computeCacheHash({
			startISO: window.startISO,
			endISO: window.endISO,
			members: members
				.map((m) => m.login)
				.sort()
				.join(","),
		});

		const sourceMatch =
			this.cacheOptions.flush ||
			this.cacheOptions.flushSources?.includes("tasks");
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
					namespace: "tasks",
					inputHash,
				});
				return new Map(Object.entries(hit));
			}
		}

		const result = await this.inner.fetchTasksForMembers(members, window);

		// Serialize Map to Record for JSON storage
		const serialized: SerializedTaskResult = {};
		for (const [key, value] of result) {
			serialized[key] = value;
		}

		await this.cache.set(inputHash, serialized);
		await appendUnifiedLog({
			timestamp: new Date().toISOString(),
			runId: "",
			category: "cache",
			event: shouldFlush ? "cache-flush-and-set" : "cache-miss-and-set",
			namespace: "tasks",
			inputHash,
		});

		return result;
	}
}
