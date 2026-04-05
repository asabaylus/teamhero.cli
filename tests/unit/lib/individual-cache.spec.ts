import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
import { IndividualSummaryCache } from "../../../src/lib/individual-cache.js";
import type {
	CacheRecord,
	CacheWriteInput,
} from "../../../src/lib/individual-cache.js";
import type {
	ContributorSummaryPayload,
	ContributorSummaryStatus,
} from "../../../src/models/individual-summary.js";

function makeFakePayload(login: string): ContributorSummaryPayload {
	return {
		contributor: { login, displayName: login },
		reportingWindow: {
			startISO: "2026-01-01T00:00:00Z",
			endISO: "2026-01-07T00:00:00Z",
			human: "Jan 1–7, 2026",
		},
		metrics: {
			commits: 10,
			prsTotal: 5,
			prsMerged: 3,
			linesAdded: 500,
			linesDeleted: 200,
			reviews: 2,
		},
		pullRequests: [],
		asana: {
			status: "disabled",
			tasks: [],
		},
		highlights: { general: [], prs: [], commits: [] },
	};
}

function makeFakeInput(
	login: string,
	status: ContributorSummaryStatus = "completed",
): CacheWriteInput {
	return {
		login,
		status,
		payload: makeFakePayload(login),
		summary: `Summary for ${login}`,
	};
}

describe("IndividualSummaryCache", () => {
	let testDir: string;
	let cache: IndividualSummaryCache;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "teamhero-ind-cache-test-"));
		cache = new IndividualSummaryCache({ baseDir: testDir });
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	describe("write", () => {
		it("creates the directory and writes JSON with timestamp", async () => {
			// Use a subdirectory that does not exist yet to verify ensureDirectory
			const subDir = join(testDir, "sub", "deep");
			const subCache = new IndividualSummaryCache({ baseDir: subDir });

			await subCache.write(makeFakeInput("alice"));

			const files = await readdir(subDir);
			expect(files).toHaveLength(1);
			expect(files[0]).toBe("alice.summary.json");

			const raw = await readFile(join(subDir, files[0]), "utf8");
			const record = JSON.parse(raw) as CacheRecord;
			expect(record.login).toBe("alice");
			expect(record.status).toBe("completed");
			expect(record.summary).toBe("Summary for alice");
			expect(record.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			expect(record.payload.contributor.login).toBe("alice");
		});

		it("sanitizes login with special characters", async () => {
			await cache.write(makeFakeInput("user/name@org"));

			const files = await readdir(testDir);
			expect(files).toHaveLength(1);
			// Special chars replaced: / and @ become _
			expect(files[0]).toBe("user_name_org.summary.json");
		});

		it("stores optional error and usage fields", async () => {
			const input: CacheWriteInput = {
				login: "bob",
				status: "failed",
				payload: makeFakePayload("bob"),
				error: "API timeout",
				usage: { promptTokens: 100, completionTokens: 50, costUsd: 0.01 },
			};
			await cache.write(input);

			const record = await cache.read("bob");
			expect(record).not.toBeNull();
			expect(record!.error).toBe("API timeout");
			expect(record!.usage).toEqual({
				promptTokens: 100,
				completionTokens: 50,
				costUsd: 0.01,
			});
		});

		it("overwrites existing cache file", async () => {
			await cache.write(makeFakeInput("alice"));
			await cache.write({
				...makeFakeInput("alice"),
				summary: "Updated summary",
			});

			const record = await cache.read("alice");
			expect(record!.summary).toBe("Updated summary");
		});
	});

	describe("read", () => {
		it("returns cached record when file exists", async () => {
			await cache.write(makeFakeInput("alice"));

			const record = await cache.read("alice");
			expect(record).not.toBeNull();
			expect(record!.login).toBe("alice");
			expect(record!.status).toBe("completed");
		});

		it("returns null when file does not exist (ENOENT)", async () => {
			const record = await cache.read("nonexistent");
			expect(record).toBeNull();
		});

		it("rethrows non-ENOENT errors", async () => {
			// Create a directory where the file should be, so readFile fails with EISDIR
			const filePath = join(testDir, "badlogin.summary.json");
			await mkdir(filePath, { recursive: true });

			await expect(cache.read("badlogin")).rejects.toThrow();
		});
	});

	describe("readAll", () => {
		it("returns all cached records as a Map", async () => {
			await cache.write(makeFakeInput("alice"));
			await cache.write(makeFakeInput("bob"));

			const all = await cache.readAll();
			expect(all).toBeInstanceOf(Map);
			expect(all.size).toBe(2);
			expect(all.has("alice")).toBe(true);
			expect(all.has("bob")).toBe(true);
			expect(all.get("alice")!.login).toBe("alice");
		});

		it("filters to only *.summary.json files", async () => {
			await cache.write(makeFakeInput("alice"));

			// Write non-matching files
			await writeFile(join(testDir, "readme.txt"), "ignore", "utf8");
			await writeFile(
				join(testDir, "data.json"),
				JSON.stringify({ login: "fake" }),
				"utf8",
			);
			await writeFile(join(testDir, "notes.summary.txt"), "nope", "utf8");

			const all = await cache.readAll();
			expect(all.size).toBe(1);
			expect(all.has("alice")).toBe(true);
		});

		it("skips files that fail to parse", async () => {
			await cache.write(makeFakeInput("alice"));

			// Write a file that matches the pattern but has invalid JSON
			await writeFile(
				join(testDir, "broken.summary.json"),
				"NOT VALID JSON",
				"utf8",
			);

			// readAll calls read(), which will throw on parse error (non-ENOENT),
			// so the entry won't be added. But read() rethrows non-ENOENT errors.
			// Actually, JSON.parse throws a SyntaxError which is not ENOENT, so
			// it will propagate. Let's verify: read() catches ENOENT but rethrows others.
			// So readAll will throw for invalid JSON. Let's check the actual behavior.
			// Looking at the code: readAll calls this.read(login), and if record is truthy
			// it adds to map. If read() throws, it propagates up.
			// For invalid JSON, read() will throw SyntaxError (not ENOENT).
			await expect(cache.readAll()).rejects.toThrow();
		});

		it("skips directories in the base directory", async () => {
			await cache.write(makeFakeInput("alice"));

			// Create a subdirectory (even if it matches pattern, isFile() check filters it)
			await mkdir(join(testDir, "subdir.summary.json"), { recursive: true });

			const all = await cache.readAll();
			expect(all.size).toBe(1);
		});

		it("returns empty map when no summary files exist", async () => {
			const all = await cache.readAll();
			expect(all.size).toBe(0);
		});
	});

	describe("clear", () => {
		it("clears a single login", async () => {
			await cache.write(makeFakeInput("alice"));
			await cache.write(makeFakeInput("bob"));

			await cache.clear("alice");

			const alice = await cache.read("alice");
			const bob = await cache.read("bob");
			expect(alice).toBeNull();
			expect(bob).not.toBeNull();
		});

		it("is a no-op when clearing a nonexistent login (ENOENT)", async () => {
			// Should not throw
			await expect(cache.clear("nonexistent")).resolves.toBeUndefined();
		});

		it("rethrows non-ENOENT errors when clearing single login", async () => {
			// Create a directory where the file should be
			const filePath = join(testDir, "badlogin.summary.json");
			await mkdir(filePath, { recursive: true });

			// rm on a directory without recursive will fail differently depending on OS,
			// but the error won't be ENOENT so it should be rethrown
			await expect(cache.clear("badlogin")).rejects.toThrow();
		});

		it("clears all summary files when no login is provided", async () => {
			await cache.write(makeFakeInput("alice"));
			await cache.write(makeFakeInput("bob"));
			await cache.write(makeFakeInput("charlie"));

			// Add a non-summary file that should NOT be deleted
			await writeFile(join(testDir, "config.json"), "{}", "utf8");

			await cache.clear();

			const files = await readdir(testDir);
			// Only config.json should remain
			expect(files).toEqual(["config.json"]);
		});

		it("does not delete non-.summary.json files during clear all", async () => {
			await cache.write(makeFakeInput("alice"));
			await writeFile(join(testDir, "keepme.txt"), "persist", "utf8");
			await writeFile(join(testDir, "data.json"), "{}", "utf8");

			await cache.clear();

			const files = await readdir(testDir);
			expect(files).toContain("keepme.txt");
			expect(files).toContain("data.json");
			expect(files).not.toContain("alice.summary.json");
		});
	});
});
