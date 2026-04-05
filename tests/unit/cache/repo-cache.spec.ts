import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as pathsMod from "../../../src/lib/paths.js";

// Mock configDir() to use a temp directory
let testConfigDir: string;

mock.module("../../../src/lib/paths.js", () => ({
	...pathsMod,
	configDir: () => testConfigDir,
}));

afterAll(() => {
	mock.restore();
});

// Import after mocking
const { RepoCacheStore } = await import(
	"../../../src/adapters/cache/repo-cache.js"
);

import type { RepoCacheKeyOptions } from "../../../src/adapters/cache/repo-cache.js";

const defaultOptions: RepoCacheKeyOptions = {
	includePrivate: false,
	includeArchived: false,
	sortBy: "pushed",
};

const alternateOptions: RepoCacheKeyOptions = {
	includePrivate: true,
	includeArchived: false,
	sortBy: "name",
};

describe("RepoCacheStore", () => {
	let store: InstanceType<typeof RepoCacheStore>;

	beforeEach(async () => {
		testConfigDir = await mkdtemp(join(tmpdir(), "teamhero-repo-cache-test-"));
		store = new RepoCacheStore();
	});

	afterEach(async () => {
		await rm(testConfigDir, { recursive: true, force: true });
	});

	describe("get", () => {
		it("returns undefined on cache miss", async () => {
			const result = await store.get("acme", defaultOptions);
			expect(result).toBeUndefined();
		});

		it("returns cached entry when org and options match", async () => {
			const repos = ["repo-a", "repo-b"];
			await store.set("acme", defaultOptions, repos);

			const result = await store.get("acme", defaultOptions);
			expect(result).toBeDefined();
			expect(result!.org).toBe("acme");
			expect(result!.repos).toEqual(repos);
			expect(result!.options).toEqual(defaultOptions);
			expect(result!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		});

		it("returns undefined when options do not match", async () => {
			await store.set("acme", defaultOptions, ["repo-a"]);

			const result = await store.get("acme", alternateOptions);
			expect(result).toBeUndefined();
		});

		it("returns undefined when org does not match", async () => {
			await store.set("acme", defaultOptions, ["repo-a"]);

			const result = await store.get("other-org", defaultOptions);
			expect(result).toBeUndefined();
		});
	});

	describe("set", () => {
		it("inserts a new entry", async () => {
			const repos = ["repo-x", "repo-y"];
			const result = await store.set("neworg", defaultOptions, repos);

			expect(result.org).toBe("neworg");
			expect(result.repos).toEqual(repos);
			expect(result.options).toEqual(defaultOptions);
			expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		});

		it("updates an existing entry with same org and options", async () => {
			await store.set("acme", defaultOptions, ["old-repo"]);
			const updated = await store.set("acme", defaultOptions, ["new-repo"]);

			expect(updated.repos).toEqual(["new-repo"]);

			// Verify only one entry exists (not duplicated)
			const entries = await store.list("acme");
			const matching = entries.filter(
				(e) =>
					e.options.includePrivate === defaultOptions.includePrivate &&
					e.options.includeArchived === defaultOptions.includeArchived &&
					e.options.sortBy === defaultOptions.sortBy,
			);
			expect(matching).toHaveLength(1);
		});

		it("stores multiple entries for the same org with different options", async () => {
			await store.set("acme", defaultOptions, ["repo-a"]);
			await store.set("acme", alternateOptions, ["repo-b"]);

			const entries = await store.list("acme");
			expect(entries).toHaveLength(2);
		});

		it("persists data to disk", async () => {
			await store.set("acme", defaultOptions, ["repo-a"]);

			const cachePath = join(testConfigDir, "repos-cache.json");
			const raw = await readFile(cachePath, "utf8");
			const parsed = JSON.parse(raw);

			expect(parsed.version).toBe(1);
			expect(parsed.entries).toHaveLength(1);
			expect(parsed.entries[0].org).toBe("acme");
		});
	});

	describe("list", () => {
		it("returns entries filtered by org", async () => {
			await store.set("acme", defaultOptions, ["repo-a"]);
			await store.set("other", defaultOptions, ["repo-b"]);

			const acmeEntries = await store.list("acme");
			expect(acmeEntries).toHaveLength(1);
			expect(acmeEntries[0].org).toBe("acme");
		});

		it("returns empty array when no entries match org", async () => {
			await store.set("acme", defaultOptions, ["repo-a"]);

			const entries = await store.list("nonexistent");
			expect(entries).toEqual([]);
		});

		it("returns all entries for the given org", async () => {
			await store.set("acme", defaultOptions, ["repo-a"]);
			await store.set("acme", alternateOptions, ["repo-b"]);
			await store.set("other", defaultOptions, ["repo-c"]);

			const entries = await store.list("acme");
			expect(entries).toHaveLength(2);
		});
	});

	describe("optionsEqual comparison", () => {
		it("matches when all option fields are identical", async () => {
			const opts: RepoCacheKeyOptions = {
				includePrivate: true,
				includeArchived: true,
				sortBy: "name",
			};
			await store.set("acme", opts, ["repo-1"]);

			const result = await store.get("acme", { ...opts });
			expect(result).toBeDefined();
			expect(result!.repos).toEqual(["repo-1"]);
		});

		it("does not match when includePrivate differs", async () => {
			await store.set(
				"acme",
				{ includePrivate: true, includeArchived: false, sortBy: "pushed" },
				["repo-1"],
			);

			const result = await store.get("acme", {
				includePrivate: false,
				includeArchived: false,
				sortBy: "pushed",
			});
			expect(result).toBeUndefined();
		});

		it("does not match when includeArchived differs", async () => {
			await store.set(
				"acme",
				{ includePrivate: false, includeArchived: true, sortBy: "pushed" },
				["repo-1"],
			);

			const result = await store.get("acme", {
				includePrivate: false,
				includeArchived: false,
				sortBy: "pushed",
			});
			expect(result).toBeUndefined();
		});

		it("does not match when sortBy differs", async () => {
			await store.set(
				"acme",
				{ includePrivate: false, includeArchived: false, sortBy: "pushed" },
				["repo-1"],
			);

			const result = await store.get("acme", {
				includePrivate: false,
				includeArchived: false,
				sortBy: "name",
			});
			expect(result).toBeUndefined();
		});
	});

	describe("version validation", () => {
		it("returns empty entries when version is not 1", async () => {
			const cachePath = join(testConfigDir, "repos-cache.json");
			await mkdir(testConfigDir, { recursive: true });
			await writeFile(
				cachePath,
				JSON.stringify({ version: 2, entries: [{ org: "acme" }] }),
				"utf8",
			);

			const result = await store.get("acme", defaultOptions);
			expect(result).toBeUndefined();
		});

		it("returns empty entries when entries field is not an array", async () => {
			const cachePath = join(testConfigDir, "repos-cache.json");
			await mkdir(testConfigDir, { recursive: true });
			await writeFile(
				cachePath,
				JSON.stringify({ version: 1, entries: "not-an-array" }),
				"utf8",
			);

			const result = await store.get("acme", defaultOptions);
			expect(result).toBeUndefined();
		});

		it("returns empty entries when parsed value is null", async () => {
			const cachePath = join(testConfigDir, "repos-cache.json");
			await mkdir(testConfigDir, { recursive: true });
			await writeFile(cachePath, "null", "utf8");

			const result = await store.get("acme", defaultOptions);
			expect(result).toBeUndefined();
		});
	});

	describe("error handling in readCacheFile", () => {
		it("returns empty entries when cache file does not exist", async () => {
			// No file written at all — readCacheFile should catch the ENOENT
			const result = await store.get("acme", defaultOptions);
			expect(result).toBeUndefined();
		});

		it("returns empty entries when cache file contains invalid JSON", async () => {
			const cachePath = join(testConfigDir, "repos-cache.json");
			await mkdir(testConfigDir, { recursive: true });
			await writeFile(cachePath, "THIS IS NOT JSON!!!", "utf8");

			const result = await store.get("acme", defaultOptions);
			expect(result).toBeUndefined();
		});

		it("recovers after corrupted file by writing a fresh cache", async () => {
			const cachePath = join(testConfigDir, "repos-cache.json");
			await mkdir(testConfigDir, { recursive: true });
			await writeFile(cachePath, "CORRUPTED", "utf8");

			// set should overwrite the corrupted file
			await store.set("acme", defaultOptions, ["repo-a"]);

			const result = await store.get("acme", defaultOptions);
			expect(result).toBeDefined();
			expect(result!.repos).toEqual(["repo-a"]);
		});
	});
});
