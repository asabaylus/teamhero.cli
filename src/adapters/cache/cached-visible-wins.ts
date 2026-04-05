/**
 * Caching decorator for VisibleWinsProvider.
 *
 * Wraps any VisibleWinsProvider with filesystem-based caching.
 * Permanent cache — flush with --flush-cache=visible-wins when data changes.
 */

import type {
	CacheOptions,
	ReportingWindow,
	VisibleWinsDataResult,
	VisibleWinsProvider,
} from "../../core/types.js";
import { getEnv } from "../../lib/env.js";
import { appendUnifiedLog } from "../../lib/unified-log.js";
import { FileSystemCacheStore, computeCacheHash } from "./fs-cache-store.js";

const DEFAULT_TTL_SECONDS = 0; // permanent — flush with --flush-cache=visible-wins

export class CachedVisibleWinsProvider implements VisibleWinsProvider {
	private readonly cache: FileSystemCacheStore<VisibleWinsDataResult>;
	private readonly configHash: string;

	constructor(
		private readonly inner: VisibleWinsProvider,
		private readonly cacheOptions: CacheOptions = {},
		configHash?: string,
	) {
		this.cache = new FileSystemCacheStore({
			namespace: "visible-wins",
			defaultTtlSeconds: DEFAULT_TTL_SECONDS,
		});
		this.configHash = configHash ?? "";
	}

	async fetchData(window: ReportingWindow): Promise<VisibleWinsDataResult> {
		if (getEnv("TEAMHERO_TEST_MODE")) {
			return this.inner.fetchData(window);
		}

		const inputHash = computeCacheHash({
			startISO: window.startISO,
			endISO: window.endISO,
			configHash: this.configHash,
		});

		const sourceMatch =
			this.cacheOptions.flush ||
			this.cacheOptions.flushSources?.includes("visible-wins");
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
					namespace: "visible-wins",
					inputHash,
				});
				return hit;
			}
		}

		const result = await this.inner.fetchData(window);

		await this.cache.set(inputHash, result);
		await appendUnifiedLog({
			timestamp: new Date().toISOString(),
			runId: "",
			category: "cache",
			event: shouldFlush ? "cache-flush-and-set" : "cache-miss-and-set",
			namespace: "visible-wins",
			inputHash,
		});

		return result;
	}
}
