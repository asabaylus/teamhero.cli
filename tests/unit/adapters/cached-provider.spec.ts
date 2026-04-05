import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type {
	RepoCacheEntry,
	RepoCacheStore,
} from "../../../src/adapters/cache/repo-cache.js";
import { CachedRepoProvider } from "../../../src/adapters/github/cached-provider.js";
import type { FetchOptions, RepoProvider } from "../../../src/core/types.js";

function makeInnerProvider(
	repos: string[] = ["repo-a", "repo-b"],
): RepoProvider {
	return {
		listRepositories: mock().mockResolvedValue(repos),
	};
}

function makeCacheStore(
	overrides: Partial<RepoCacheStore> = {},
): RepoCacheStore {
	return {
		get: mock().mockResolvedValue(undefined),
		set: mock().mockResolvedValue(undefined),
		list: mock().mockResolvedValue([]),
		...overrides,
	} as any;
}

function makeCacheEntry(repos: string[]): RepoCacheEntry {
	return {
		org: "acme",
		options: { includePrivate: true, includeArchived: false, sortBy: "pushed" },
		repos,
		updatedAt: "2026-02-28T00:00:00.000Z",
	};
}

describe("CachedRepoProvider", () => {
	let savedTestMode: string | undefined;

	beforeEach(() => {
		savedTestMode = process.env.TEAMHERO_TEST_MODE;
		delete process.env.TEAMHERO_TEST_MODE;
	});

	afterEach(() => {
		if (savedTestMode !== undefined) {
			process.env.TEAMHERO_TEST_MODE = savedTestMode;
		} else {
			delete process.env.TEAMHERO_TEST_MODE;
		}
	});

	// ---------------------------------------------------------------------------
	// Cache hit
	// ---------------------------------------------------------------------------

	describe("cache hit", () => {
		it("returns cached repos without calling inner provider", async () => {
			const cachedRepos = ["cached-a", "cached-b"];
			const inner = makeInnerProvider(["fresh-a"]);
			const cache = makeCacheStore({
				get: mock().mockResolvedValue(makeCacheEntry(cachedRepos)),
			});
			const provider = new CachedRepoProvider(inner, cache);

			const result = await provider.listRepositories("acme");

			expect(result).toEqual(cachedRepos);
			expect(inner.listRepositories).not.toHaveBeenCalled();
		});

		it("passes correct cache key options derived from fetch options", async () => {
			const inner = makeInnerProvider();
			const cache = makeCacheStore({
				get: mock().mockResolvedValue(makeCacheEntry(["x"])),
			});
			const provider = new CachedRepoProvider(inner, cache);

			await provider.listRepositories("acme", {
				includePrivate: false,
				includeArchived: true,
				sortBy: "name",
			});

			expect(cache.get).toHaveBeenCalledWith("acme", {
				includePrivate: false,
				includeArchived: true,
				sortBy: "name",
			});
		});

		it("uses default cache key values when fetch options are omitted", async () => {
			const inner = makeInnerProvider();
			const cache = makeCacheStore({
				get: mock().mockResolvedValue(makeCacheEntry(["x"])),
			});
			const provider = new CachedRepoProvider(inner, cache);

			await provider.listRepositories("acme");

			expect(cache.get).toHaveBeenCalledWith("acme", {
				includePrivate: true,
				includeArchived: false,
				sortBy: "pushed",
			});
		});
	});

	// ---------------------------------------------------------------------------
	// Cache miss
	// ---------------------------------------------------------------------------

	describe("cache miss", () => {
		it("calls inner provider when cache returns undefined", async () => {
			const inner = makeInnerProvider(["fresh-a", "fresh-b"]);
			const cache = makeCacheStore();
			const provider = new CachedRepoProvider(inner, cache);

			const result = await provider.listRepositories("acme");

			expect(inner.listRepositories).toHaveBeenCalledWith("acme", {});
			expect(result).toEqual(["fresh-a", "fresh-b"]);
		});

		it("caches result from inner provider after fetch", async () => {
			const inner = makeInnerProvider(["repo-x"]);
			const cache = makeCacheStore();
			const provider = new CachedRepoProvider(inner, cache);

			await provider.listRepositories("acme", {
				includePrivate: false,
				includeArchived: true,
				sortBy: "name",
			});

			expect(cache.set).toHaveBeenCalledWith(
				"acme",
				{ includePrivate: false, includeArchived: true, sortBy: "name" },
				["repo-x"],
			);
		});

		it("passes fetch options through to inner provider", async () => {
			const inner = makeInnerProvider();
			const cache = makeCacheStore();
			const provider = new CachedRepoProvider(inner, cache);

			const opts: FetchOptions = {
				includePrivate: false,
				includeArchived: true,
				sortBy: "name",
				maxRepos: 50,
			};
			await provider.listRepositories("acme", opts);

			expect(inner.listRepositories).toHaveBeenCalledWith("acme", opts);
		});
	});

	// ---------------------------------------------------------------------------
	// Refresh mode
	// ---------------------------------------------------------------------------

	describe("refresh mode", () => {
		it("skips cache lookup and calls inner provider", async () => {
			const inner = makeInnerProvider(["refreshed"]);
			const cache = makeCacheStore({
				get: mock().mockResolvedValue(makeCacheEntry(["stale"])),
			});
			const provider = new CachedRepoProvider(inner, cache, { refresh: true });

			const result = await provider.listRepositories("acme");

			expect(cache.get).not.toHaveBeenCalled();
			expect(inner.listRepositories).toHaveBeenCalled();
			expect(result).toEqual(["refreshed"]);
		});

		it("caches the fresh result after fetching", async () => {
			const inner = makeInnerProvider(["refreshed"]);
			const cache = makeCacheStore();
			const provider = new CachedRepoProvider(inner, cache, { refresh: true });

			await provider.listRepositories("acme");

			expect(cache.set).toHaveBeenCalledWith(
				"acme",
				{ includePrivate: true, includeArchived: false, sortBy: "pushed" },
				["refreshed"],
			);
		});
	});

	// ---------------------------------------------------------------------------
	// TEAMHERO_TEST_MODE bypasses all caching
	// ---------------------------------------------------------------------------

	describe("TEAMHERO_TEST_MODE", () => {
		it("bypasses cache and calls inner provider directly", async () => {
			process.env.TEAMHERO_TEST_MODE = "1";
			const inner = makeInnerProvider(["test-repo"]);
			const cache = makeCacheStore({
				get: mock().mockResolvedValue(makeCacheEntry(["cached"])),
			});
			const provider = new CachedRepoProvider(inner, cache);

			const result = await provider.listRepositories("acme");

			expect(result).toEqual(["test-repo"]);
			expect(inner.listRepositories).toHaveBeenCalled();
			expect(cache.get).not.toHaveBeenCalled();
			expect(cache.set).not.toHaveBeenCalled();
		});

		it("does not cache the result", async () => {
			process.env.TEAMHERO_TEST_MODE = "true";
			const inner = makeInnerProvider(["test-repo"]);
			const cache = makeCacheStore();
			const provider = new CachedRepoProvider(inner, cache);

			await provider.listRepositories("acme");

			expect(cache.set).not.toHaveBeenCalled();
		});

		it("bypasses caching even in refresh mode", async () => {
			process.env.TEAMHERO_TEST_MODE = "1";
			const inner = makeInnerProvider(["test-repo"]);
			const cache = makeCacheStore();
			const provider = new CachedRepoProvider(inner, cache, { refresh: true });

			await provider.listRepositories("acme");

			expect(cache.get).not.toHaveBeenCalled();
			expect(cache.set).not.toHaveBeenCalled();
		});
	});
});
