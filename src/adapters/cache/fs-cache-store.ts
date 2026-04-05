/**
 * Generic filesystem-based cache store.
 *
 * Each cached value is stored as a JSON envelope in a per-namespace directory:
 *   ~/.cache/teamhero/data-cache/{namespace}/{key-hash}.json
 *
 * Envelope format: { version, meta: { cachedAt, inputHash, ttlSeconds }, data: T }
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cacheDir } from "../../lib/paths.js";

export interface CacheEnvelopeMeta {
	cachedAt: string; // ISO timestamp
	inputHash: string; // hash of the cache key components
	ttlSeconds: number; // 0 = permanent
}

export interface CacheEnvelope<T> {
	version: 1;
	meta: CacheEnvelopeMeta;
	data: T;
}

export interface CacheStoreOptions {
	/** Sub-namespace for this cache store (e.g. "metrics", "tasks"). */
	namespace: string;
	/** Default TTL in seconds. 0 = permanent. */
	defaultTtlSeconds: number;
}

/**
 * Compute a stable hash from cache key components.
 * Accepts an object whose values are strings/numbers/booleans.
 */
export function computeCacheHash(
	components: Record<string, string | number | boolean | undefined>,
): string {
	const sorted = Object.keys(components)
		.sort()
		.map((k) => `${k}=${String(components[k] ?? "")}`)
		.join("|");
	return createHash("sha256").update(sorted).digest("hex").slice(0, 16);
}

export class FileSystemCacheStore<T> {
	private readonly dir: string;
	private readonly defaultTtlSeconds: number;

	constructor(options: CacheStoreOptions) {
		this.dir = join(cacheDir(), "data-cache", options.namespace);
		this.defaultTtlSeconds = options.defaultTtlSeconds;
	}

	/**
	 * Read a cached value. Returns null on miss, stale, or read error.
	 *
	 * @param inputHash - hash of the cache key
	 * @param options.permanent - if true, skip TTL check (e.g. closed git windows)
	 */
	async get(
		inputHash: string,
		options?: { permanent?: boolean },
	): Promise<T | null> {
		try {
			const filePath = this.filePath(inputHash);
			const raw = await readFile(filePath, "utf8");
			const envelope = JSON.parse(raw) as CacheEnvelope<T>;

			if (envelope.version !== 1) return null;
			if (envelope.meta.inputHash !== inputHash) return null;

			// Skip TTL check for permanent entries
			if (!options?.permanent && envelope.meta.ttlSeconds > 0) {
				const cachedAt = new Date(envelope.meta.cachedAt).getTime();
				const expiresAt = cachedAt + envelope.meta.ttlSeconds * 1000;
				if (Date.now() > expiresAt) return null;
			}

			return envelope.data;
		} catch {
			return null;
		}
	}

	/**
	 * Write a value to cache.
	 *
	 * @param inputHash - hash of the cache key
	 * @param data - the value to cache
	 * @param ttlSeconds - override TTL (0 = permanent)
	 */
	async set(inputHash: string, data: T, ttlSeconds?: number): Promise<void> {
		await mkdir(this.dir, { recursive: true });
		const envelope: CacheEnvelope<T> = {
			version: 1,
			meta: {
				cachedAt: new Date().toISOString(),
				inputHash,
				ttlSeconds: ttlSeconds ?? this.defaultTtlSeconds,
			},
			data,
		};
		await writeFile(
			this.filePath(inputHash),
			JSON.stringify(envelope, null, 2),
			"utf8",
		);
	}

	/** Check if a non-stale cached entry exists without reading data. */
	async has(
		inputHash: string,
		options?: { permanent?: boolean },
	): Promise<boolean> {
		const result = await this.get(inputHash, options);
		return result !== null;
	}

	/** Remove a specific cached entry. */
	async remove(inputHash: string): Promise<void> {
		try {
			await unlink(this.filePath(inputHash));
		} catch {
			// Ignore — file may not exist
		}
	}

	/** Clear all entries in this namespace. Returns number of files removed. */
	async clear(): Promise<number> {
		try {
			await mkdir(this.dir, { recursive: true });
			const files = await readdir(this.dir);
			let cleared = 0;
			for (const file of files) {
				if (!file.endsWith(".json")) continue;
				await unlink(join(this.dir, file));
				cleared += 1;
			}
			return cleared;
		} catch {
			return 0;
		}
	}

	/** List all non-stale cache entry metadata. */
	async list(): Promise<CacheEnvelopeMeta[]> {
		try {
			await mkdir(this.dir, { recursive: true });
			const files = await readdir(this.dir);
			const entries: CacheEnvelopeMeta[] = [];
			for (const file of files) {
				if (!file.endsWith(".json")) continue;
				try {
					const raw = await readFile(join(this.dir, file), "utf8");
					const envelope = JSON.parse(raw) as CacheEnvelope<T>;
					if (envelope.version === 1) {
						entries.push(envelope.meta);
					}
				} catch {
					// Skip invalid files
				}
			}
			return entries;
		} catch {
			return [];
		}
	}

	private filePath(inputHash: string): string {
		return join(this.dir, `${inputHash}.json`);
	}
}
