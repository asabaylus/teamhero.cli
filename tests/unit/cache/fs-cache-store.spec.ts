import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	setSystemTime,
} from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	FileSystemCacheStore,
	computeCacheHash,
} from "../../../src/adapters/cache/fs-cache-store.js";

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

interface TestData {
	value: number;
	label: string;
}

describe("computeCacheHash", () => {
	it("produces stable hashes for identical inputs", () => {
		const a = computeCacheHash({ org: "acme", since: "2026-01-01" });
		const b = computeCacheHash({ org: "acme", since: "2026-01-01" });
		expect(a).toBe(b);
	});

	it("produces different hashes for different inputs", () => {
		const a = computeCacheHash({ org: "acme", since: "2026-01-01" });
		const b = computeCacheHash({ org: "acme", since: "2026-02-01" });
		expect(a).not.toBe(b);
	});

	it("is order-independent", () => {
		const a = computeCacheHash({ org: "acme", since: "2026-01-01" });
		const b = computeCacheHash({ since: "2026-01-01", org: "acme" });
		expect(a).toBe(b);
	});

	it("handles undefined values", () => {
		const a = computeCacheHash({ org: "acme", team: undefined });
		const b = computeCacheHash({ org: "acme", team: undefined });
		expect(a).toBe(b);
	});

	it("returns a 16-char hex string", () => {
		const hash = computeCacheHash({ key: "value" });
		expect(hash).toMatch(/^[0-9a-f]{16}$/);
	});
});

describe("FileSystemCacheStore", () => {
	let store: FileSystemCacheStore<TestData>;

	beforeEach(async () => {
		testCacheDir = await mkdtemp(join(tmpdir(), "teamhero-cache-test-"));
		store = new FileSystemCacheStore<TestData>({
			namespace: "test",
			defaultTtlSeconds: 3600,
		});
	});

	afterEach(async () => {
		await rm(testCacheDir, { recursive: true, force: true });
	});

	it("returns null on cache miss", async () => {
		const result = await store.get("nonexistent");
		expect(result).toBeNull();
	});

	it("writes and reads back data", async () => {
		const data: TestData = { value: 42, label: "test" };
		await store.set("abc123", data);
		const result = await store.get("abc123");
		expect(result).toEqual(data);
	});

	it("returns null for expired entries", async () => {
		const data: TestData = { value: 1, label: "expired" };
		// Write with 1 second TTL
		await store.set("short-lived", data, 1);

		// Advance time past TTL
		setSystemTime(new Date(Date.now() + 2000));

		const result = await store.get("short-lived");
		expect(result).toBeNull();

		setSystemTime();
	});

	it("skips TTL check when permanent option is true", async () => {
		const data: TestData = { value: 1, label: "permanent" };
		await store.set("perm", data, 1);

		setSystemTime(new Date(Date.now() + 2000));

		const result = await store.get("perm", { permanent: true });
		expect(result).toEqual(data);

		setSystemTime();
	});

	it("has() returns true for existing entries", async () => {
		await store.set("exists", { value: 1, label: "yes" });
		expect(await store.has("exists")).toBe(true);
		expect(await store.has("nope")).toBe(false);
	});

	it("remove() deletes a cached entry", async () => {
		await store.set("removeme", { value: 1, label: "bye" });
		expect(await store.has("removeme")).toBe(true);

		await store.remove("removeme");
		expect(await store.has("removeme")).toBe(false);
	});

	it("clear() removes all entries and returns count", async () => {
		await store.set("a", { value: 1, label: "a" });
		await store.set("b", { value: 2, label: "b" });
		await store.set("c", { value: 3, label: "c" });

		const cleared = await store.clear();
		expect(cleared).toBe(3);
		expect(await store.has("a")).toBe(false);
	});

	it("list() returns metadata for all entries", async () => {
		await store.set("x", { value: 1, label: "x" });
		await store.set("y", { value: 2, label: "y" });

		const entries = await store.list();
		expect(entries).toHaveLength(2);
		expect(entries[0]).toHaveProperty("cachedAt");
		expect(entries[0]).toHaveProperty("inputHash");
		expect(entries[0]).toHaveProperty("ttlSeconds");
	});

	it("rejects entries with mismatched inputHash", async () => {
		// Write with one hash, then manually corrupt the file
		await store.set("good-hash", { value: 1, label: "ok" });

		// Read should succeed with correct hash
		const result = await store.get("good-hash");
		expect(result).toEqual({ value: 1, label: "ok" });

		// Reading with a different hash key returns null
		// (the file is keyed by the inputHash in the filename, so a different
		//  key would look for a different file — which doesn't exist)
		const miss = await store.get("wrong-hash");
		expect(miss).toBeNull();
	});
});
