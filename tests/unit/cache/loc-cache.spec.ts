import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as pathsMod from "../../../src/lib/paths.js";

// Mock cacheDir() to use a temp directory
let testCacheDir: string;

mock.module("../../../src/lib/paths.js", () => ({
	...pathsMod,
	cacheDir: () => testCacheDir,
}));

afterAll(() => {
	mock.restore();
});

// Import after mocking
const { LocCacheStore } = await import(
	"../../../src/adapters/cache/loc-cache.js"
);

function makeFakeStats(author: string, total = 100) {
	return [
		{
			author: { login: author },
			total,
			weeks: [{ w: 1700000000, a: 50, d: 30, c: 5 }],
		},
	];
}

describe("LocCacheStore", () => {
	let store: InstanceType<typeof LocCacheStore>;

	beforeEach(async () => {
		testCacheDir = await mkdtemp(join(tmpdir(), "teamhero-loc-cache-test-"));
		store = new LocCacheStore();
	});

	afterEach(async () => {
		await rm(testCacheDir, { recursive: true, force: true });
	});

	describe("get", () => {
		it("returns cached entry on success", async () => {
			const stats = makeFakeStats("alice");
			await store.set("acme", "webapp", stats);

			const result = await store.get("acme", "webapp");
			expect(result).not.toBeNull();
			expect(result!.org).toBe("acme");
			expect(result!.repo).toBe("webapp");
			expect(result!.stats).toEqual(stats);
			expect(result!.fetchedAt).toBeDefined();
		});

		it("returns null when file does not exist", async () => {
			const result = await store.get("nonexistent", "norepo");
			expect(result).toBeNull();
		});

		it("returns null on parse error (malformed JSON)", async () => {
			// Write a malformed JSON file directly
			const locDir = join(testCacheDir, "loc");
			await mkdir(locDir, { recursive: true });
			const filePath = join(locDir, "acme__broken.json");
			await writeFile(filePath, "not valid json {{{", "utf8");

			const result = await store.get("acme", "broken");
			expect(result).toBeNull();
		});
	});

	describe("set", () => {
		it("creates the cache directory and writes JSON with timestamp", async () => {
			const stats = makeFakeStats("bob");
			await store.set("orgA", "repoB", stats);

			const locDir = join(testCacheDir, "loc");
			const files = await readdir(locDir);
			expect(files).toHaveLength(1);
			expect(files[0]).toBe("orgA__repoB.json");

			const raw = await readFile(join(locDir, files[0]), "utf8");
			const parsed = JSON.parse(raw);
			expect(parsed.org).toBe("orgA");
			expect(parsed.repo).toBe("repoB");
			expect(parsed.stats).toEqual(stats);
			expect(parsed.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		});

		it("sanitizes special characters in org/repo names", async () => {
			const stats = makeFakeStats("charlie");
			await store.set("my/org", "repo@v2", stats);

			const locDir = join(testCacheDir, "loc");
			const files = await readdir(locDir);
			expect(files).toHaveLength(1);
			// Special chars replaced with underscores
			expect(files[0]).toMatch(/^my_org__repo_v2\.json$/);
		});

		it("overwrites existing cache entry", async () => {
			const stats1 = makeFakeStats("alice", 100);
			const stats2 = makeFakeStats("alice", 200);

			await store.set("acme", "app", stats1);
			await store.set("acme", "app", stats2);

			const result = await store.get("acme", "app");
			expect(result!.stats[0].total).toBe(200);
		});
	});

	describe("list", () => {
		it("returns entries sorted by org then repo", async () => {
			await store.set("zeta", "alpha", makeFakeStats("a"));
			await store.set("alpha", "zeta", makeFakeStats("b"));
			await store.set("alpha", "alpha", makeFakeStats("c"));

			const entries = await store.list();
			expect(entries).toHaveLength(3);
			expect(entries[0]).toEqual(
				expect.objectContaining({ org: "alpha", repo: "alpha" }),
			);
			expect(entries[1]).toEqual(
				expect.objectContaining({ org: "alpha", repo: "zeta" }),
			);
			expect(entries[2]).toEqual(
				expect.objectContaining({ org: "zeta", repo: "alpha" }),
			);
		});

		it("skips malformed JSON files", async () => {
			await store.set("acme", "good", makeFakeStats("ok"));

			const locDir = join(testCacheDir, "loc");
			await writeFile(join(locDir, "bad__entry.json"), "NOT JSON", "utf8");

			const entries = await store.list();
			expect(entries).toHaveLength(1);
			expect(entries[0].org).toBe("acme");
		});

		it("skips non-.json files", async () => {
			await store.set("acme", "repo", makeFakeStats("ok"));

			const locDir = join(testCacheDir, "loc");
			await writeFile(join(locDir, "readme.txt"), "ignore me", "utf8");
			await writeFile(join(locDir, "notes.md"), "skip", "utf8");

			const entries = await store.list();
			expect(entries).toHaveLength(1);
		});

		it("returns empty array when cache directory is empty", async () => {
			const entries = await store.list();
			expect(entries).toEqual([]);
		});

		it("includes fetchedAt in each entry", async () => {
			await store.set("org1", "repo1", makeFakeStats("x"));

			const entries = await store.list();
			expect(entries).toHaveLength(1);
			expect(entries[0].fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		});
	});

	describe("clear", () => {
		it("clears all entries when no args provided", async () => {
			await store.set("orgA", "repo1", makeFakeStats("a"));
			await store.set("orgA", "repo2", makeFakeStats("b"));
			await store.set("orgB", "repo3", makeFakeStats("c"));

			const count = await store.clear();
			expect(count).toBe(3);

			const entries = await store.list();
			expect(entries).toEqual([]);
		});

		it("clears only matching org when org is specified", async () => {
			await store.set("orgA", "repo1", makeFakeStats("a"));
			await store.set("orgA", "repo2", makeFakeStats("b"));
			await store.set("orgB", "repo3", makeFakeStats("c"));

			const count = await store.clear("orgA");
			expect(count).toBe(2);

			const entries = await store.list();
			expect(entries).toHaveLength(1);
			expect(entries[0].org).toBe("orgB");
		});

		it("clears only specific org+repo when both are specified", async () => {
			await store.set("orgA", "repo1", makeFakeStats("a"));
			await store.set("orgA", "repo2", makeFakeStats("b"));

			const count = await store.clear("orgA", "repo1");
			expect(count).toBe(1);

			const entries = await store.list();
			expect(entries).toHaveLength(1);
			expect(entries[0].repo).toBe("repo2");
		});

		it("returns 0 when nothing matches", async () => {
			await store.set("orgA", "repo1", makeFakeStats("a"));

			const count = await store.clear("nonexistent");
			expect(count).toBe(0);
		});

		it("returns count of cleared entries", async () => {
			await store.set("acme", "app1", makeFakeStats("a"));
			await store.set("acme", "app2", makeFakeStats("b"));
			await store.set("acme", "app3", makeFakeStats("c"));

			const count = await store.clear("acme");
			expect(count).toBe(3);
		});

		it("skips non-.json files during clear", async () => {
			await store.set("acme", "repo", makeFakeStats("a"));

			const locDir = join(testCacheDir, "loc");
			await writeFile(join(locDir, "keepme.txt"), "persist", "utf8");

			const count = await store.clear();
			expect(count).toBe(1);

			// The .txt file should still be there
			const files = await readdir(locDir);
			expect(files).toContain("keepme.txt");
		});

		it("skips malformed JSON when clearing by org", async () => {
			await store.set("acme", "good", makeFakeStats("a"));

			const locDir = join(testCacheDir, "loc");
			await writeFile(join(locDir, "malformed.json"), "NOT JSON", "utf8");

			// Clearing by org tries to parse each file — malformed ones are skipped via continue
			const count = await store.clear("acme");
			expect(count).toBe(1);
		});
	});
});
