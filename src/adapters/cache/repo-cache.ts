import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { configDir } from "../../lib/paths.js";

export interface RepoCacheKeyOptions {
	includePrivate: boolean;
	includeArchived: boolean;
	sortBy: "pushed" | "name";
}

export interface RepoCacheEntry {
	org: string;
	options: RepoCacheKeyOptions;
	repos: string[];
	updatedAt: string; // ISO timestamp
}

interface RepoCacheFile {
	version: 1;
	entries: RepoCacheEntry[];
}

function getCachePath(): string {
	return join(configDir(), "repos-cache.json");
}

async function ensureDir(path: string): Promise<void> {
	const dir = path.split("/").slice(0, -1).join("/");
	if (!dir) return;
	await mkdir(dir, { recursive: true });
}

async function readCacheFile(): Promise<RepoCacheFile> {
	const file = getCachePath();
	try {
		const raw = await readFile(file, "utf8");
		const parsed = JSON.parse(raw) as RepoCacheFile;
		if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
			return { version: 1, entries: [] } satisfies RepoCacheFile;
		}
		return parsed;
	} catch {
		return { version: 1, entries: [] } satisfies RepoCacheFile;
	}
}

async function writeCacheFile(cache: RepoCacheFile): Promise<void> {
	const file = getCachePath();
	await ensureDir(file);
	await writeFile(file, JSON.stringify(cache, null, 2), "utf8");
}

function optionsEqual(a: RepoCacheKeyOptions, b: RepoCacheKeyOptions): boolean {
	return (
		a.includePrivate === b.includePrivate &&
		a.includeArchived === b.includeArchived &&
		a.sortBy === b.sortBy
	);
}

export class RepoCacheStore {
	async get(
		org: string,
		options: RepoCacheKeyOptions,
	): Promise<RepoCacheEntry | undefined> {
		const cache = await readCacheFile();
		return cache.entries.find(
			(e) => e.org === org && optionsEqual(e.options, options),
		);
	}

	async set(
		org: string,
		options: RepoCacheKeyOptions,
		repos: string[],
	): Promise<RepoCacheEntry> {
		const cache = await readCacheFile();
		const updated: RepoCacheEntry = {
			org,
			options,
			repos,
			updatedAt: new Date().toISOString(),
		};
		const existingIndex = cache.entries.findIndex(
			(e) => e.org === org && optionsEqual(e.options, options),
		);
		if (existingIndex >= 0) {
			cache.entries[existingIndex] = updated;
		} else {
			cache.entries.push(updated);
		}
		await writeCacheFile(cache);
		return updated;
	}

	async list(org: string): Promise<RepoCacheEntry[]> {
		const cache = await readCacheFile();
		return cache.entries.filter((e) => e.org === org);
	}
}
