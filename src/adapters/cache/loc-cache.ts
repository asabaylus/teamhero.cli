import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cacheDir } from "../../lib/paths.js";

interface LocCacheEntry {
	org: string;
	repo: string;
	stats: Array<{
		author: { login: string | null } | null;
		total: number;
		weeks: Array<{
			w: number;
			a: number;
			d: number;
			c: number;
		}>;
	}>;
	fetchedAt: string; // ISO timestamp
}

export class LocCacheStore {
	private readonly cacheDir: string;

	constructor() {
		this.cacheDir = join(cacheDir(), "loc");
	}

	private getCacheKey(org: string, repo: string): string {
		return `${org}__${repo}.json`.replace(/[^a-zA-Z0-9_.-]/g, "_");
	}

	private getCachePath(org: string, repo: string): string {
		return join(this.cacheDir, this.getCacheKey(org, repo));
	}

	async get(org: string, repo: string): Promise<LocCacheEntry | null> {
		try {
			const cachePath = this.getCachePath(org, repo);
			const raw = await readFile(cachePath, "utf8");
			const entry = JSON.parse(raw) as LocCacheEntry;
			return entry;
		} catch {
			return null;
		}
	}

	async set(
		org: string,
		repo: string,
		stats: LocCacheEntry["stats"],
	): Promise<void> {
		await mkdir(this.cacheDir, { recursive: true });
		const cachePath = this.getCachePath(org, repo);
		const entry: LocCacheEntry = {
			org,
			repo,
			stats,
			fetchedAt: new Date().toISOString(),
		};
		await writeFile(cachePath, JSON.stringify(entry, null, 2), "utf8");
	}

	async list(): Promise<
		Array<{ org: string; repo: string; fetchedAt: string }>
	> {
		try {
			await mkdir(this.cacheDir, { recursive: true });
			const files = await readdir(this.cacheDir);
			const entries: Array<{ org: string; repo: string; fetchedAt: string }> =
				[];

			for (const file of files) {
				if (!file.endsWith(".json")) {
					continue;
				}
				try {
					const raw = await readFile(join(this.cacheDir, file), "utf8");
					const entry = JSON.parse(raw) as LocCacheEntry;
					entries.push({
						org: entry.org,
						repo: entry.repo,
						fetchedAt: entry.fetchedAt,
					});
				} catch {
					// Skip invalid cache files
				}
			}

			return entries.sort((a, b) => {
				const orgCompare = a.org.localeCompare(b.org);
				if (orgCompare !== 0) return orgCompare;
				return a.repo.localeCompare(b.repo);
			});
		} catch {
			return [];
		}
	}

	async clear(org?: string, repo?: string): Promise<number> {
		try {
			await mkdir(this.cacheDir, { recursive: true });
			const files = await readdir(this.cacheDir);
			let cleared = 0;

			for (const file of files) {
				if (!file.endsWith(".json")) {
					continue;
				}

				// If specific org/repo requested, only clear that one
				if (org && repo) {
					const targetKey = this.getCacheKey(org, repo);
					if (file !== targetKey) {
						continue;
					}
				} else if (org) {
					// If only org specified, clear all repos for that org
					try {
						const raw = await readFile(join(this.cacheDir, file), "utf8");
						const entry = JSON.parse(raw) as LocCacheEntry;
						if (entry.org !== org) {
							continue;
						}
					} catch {
						continue;
					}
				}

				await unlink(join(this.cacheDir, file));
				cleared += 1;
			}

			return cleared;
		} catch {
			return 0;
		}
	}
}
