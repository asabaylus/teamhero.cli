/**
 * Caching decorator for MetricsProvider.
 *
 * Wraps any MetricsProvider with filesystem-based caching.
 * Cache key includes org, date window, members, and repos to prevent
 * scope mismatch (e.g. cached "all repos" data served for "5 repos" request).
 *
 * Closed-window optimization: if the reporting window's end date is in the past,
 * Git metrics cache entries become permanent (commits/PRs are immutable once merged).
 */

import type {
	CacheOptions,
	MetricsCollectionOptions,
	MetricsCollectionResult,
	MetricsProvider,
} from "../../core/types.js";
import { getEnv } from "../../lib/env.js";
import { appendUnifiedLog } from "../../lib/unified-log.js";
import { FileSystemCacheStore, computeCacheHash } from "./fs-cache-store.js";

const DEFAULT_TTL_SECONDS = 4 * 3600; // 4 hours

export class CachedMetricsProvider implements MetricsProvider {
	private readonly cache: FileSystemCacheStore<MetricsCollectionResult>;

	constructor(
		private readonly inner: MetricsProvider,
		private readonly cacheOptions: CacheOptions = {},
	) {
		this.cache = new FileSystemCacheStore({
			namespace: "metrics",
			defaultTtlSeconds: DEFAULT_TTL_SECONDS,
		});
	}

	async collect(
		options: MetricsCollectionOptions,
	): Promise<MetricsCollectionResult> {
		// Skip caching in test mode
		if (getEnv("TEAMHERO_TEST_MODE")) {
			return this.inner.collect(options);
		}

		// Cache key includes members and repos to prevent scope mismatch
		const inputHash = computeCacheHash({
			org: options.organization.login,
			since: options.since,
			until: options.until,
			members: options.members
				.map((m) => m.login)
				.sort()
				.join(","),
			repos: options.repositories
				.map((r) => r.name)
				.sort()
				.join(","),
		});

		const sourceMatch =
			this.cacheOptions.flush ||
			this.cacheOptions.flushSources?.includes("metrics");
		const shouldFlush =
			sourceMatch &&
			(!this.cacheOptions.flushSince ||
				options.since >= this.cacheOptions.flushSince);

		if (!shouldFlush) {
			// Closed-window optimization: if end date is in the past, cache is permanent
			const windowClosed = new Date(options.until) < new Date();
			const hit = await this.cache.get(inputHash, { permanent: windowClosed });

			if (hit) {
				await appendUnifiedLog({
					timestamp: new Date().toISOString(),
					runId: "",
					category: "cache",
					event: "cache-hit",
					namespace: "metrics",
					inputHash,
					org: options.organization.login,
				});
				return hit;
			}
		}

		const result = await this.inner.collect(options);

		await this.cache.set(inputHash, result);
		await appendUnifiedLog({
			timestamp: new Date().toISOString(),
			runId: "",
			category: "cache",
			event: shouldFlush ? "cache-flush-and-set" : "cache-miss-and-set",
			namespace: "metrics",
			inputHash,
			org: options.organization.login,
		});

		return result;
	}
}
