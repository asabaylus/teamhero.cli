import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as envMod from "../../../src/lib/env.js";

// Mock env.ts for TEAMHERO_HISTORY_MAX_RUNS
mock.module("../../../src/lib/env.js", () => ({
	...envMod,
	getEnv: mock(() => undefined),
}));

let testCacheDir: string;

afterAll(() => {
	mock.restore();
});

const { RunHistoryStore } = await import("../../../src/lib/run-history.js");

describe("RunHistoryStore", () => {
	let storeDir: string;

	beforeEach(async () => {
		testCacheDir = await mkdtemp(join(tmpdir(), "teamhero-history-test-"));
		process.env.XDG_CACHE_HOME = testCacheDir;
		storeDir = join(testCacheDir, "snapshots");
	});

	afterEach(async () => {
		await rm(testCacheDir, { recursive: true, force: true });
		delete process.env.XDG_CACHE_HOME;
	});

	it("saves and retrieves a snapshot", async () => {
		const store = new RunHistoryStore(storeDir);
		const reportData = { memberMetrics: [{ login: "alice", prsMerged: 5 }] };

		await store.save({
			runId: "run-001-full-id",
			timestamp: "2026-02-25T12:00:00Z",
			orgSlug: "acme",
			startDate: "2026-02-18",
			endDate: "2026-02-25",
			memberCount: 1,
			repoCount: 3,
			blobSchemaVersion: 1,
			checksum: "abc123",
			reportData,
		});

		const snapshot = await store.loadSnapshot(
			"acme",
			"2026-02-25_run-001-.json",
		);
		expect(snapshot).toEqual(reportData);
	});

	it("lists snapshots for an org", async () => {
		const store = new RunHistoryStore(storeDir);

		await store.save({
			runId: "run-001",
			timestamp: "2026-02-18T12:00:00Z",
			orgSlug: "acme",
			startDate: "2026-02-11",
			endDate: "2026-02-18",
			memberCount: 2,
			repoCount: 5,
			blobSchemaVersion: 1,
			checksum: "abc123",
			reportData: {},
		});

		await store.save({
			runId: "run-002",
			timestamp: "2026-02-25T12:00:00Z",
			orgSlug: "acme",
			startDate: "2026-02-18",
			endDate: "2026-02-25",
			memberCount: 2,
			repoCount: 5,
			blobSchemaVersion: 1,
			checksum: "def456",
			reportData: {},
		});

		const entries = await store.list("acme");
		expect(entries).toHaveLength(2);
		// Sorted newest first
		expect(entries[0].runId).toBe("run-002");
	});

	it("findForPreviousPeriod matches exact dates", async () => {
		const store = new RunHistoryStore(storeDir);
		const reportData = { memberMetrics: [{ login: "bob", prsMerged: 3 }] };

		await store.save({
			runId: "run-prev",
			timestamp: "2026-02-18T12:00:00Z",
			orgSlug: "acme",
			startDate: "2026-02-11",
			endDate: "2026-02-18",
			memberCount: 1,
			repoCount: 2,
			blobSchemaVersion: 1,
			checksum: "abc123",
			reportData,
		});

		const found = await store.findForPreviousPeriod(
			"acme",
			"2026-02-11",
			"2026-02-18",
		);
		expect(found).toEqual(reportData);

		// Non-matching dates return null
		const notFound = await store.findForPreviousPeriod(
			"acme",
			"2026-01-01",
			"2026-01-08",
		);
		expect(notFound).toBeNull();
	});

	it("returns null for empty org", async () => {
		const store = new RunHistoryStore(storeDir);
		const result = await store.findForPreviousPeriod(
			"nonexistent",
			"2026-01-01",
			"2026-01-08",
		);
		expect(result).toBeNull();
	});

	it("writes index.json with proper structure", async () => {
		const store = new RunHistoryStore(storeDir);

		await store.save({
			runId: "run-idx",
			timestamp: "2026-02-25T12:00:00Z",
			orgSlug: "acme",
			startDate: "2026-02-18",
			endDate: "2026-02-25",
			memberCount: 1,
			repoCount: 1,
			blobSchemaVersion: 1,
			checksum: "abc123",
			reportData: {},
		});

		const indexRaw = await readFile(
			join(storeDir, "acme", "index.json"),
			"utf8",
		);
		const index = JSON.parse(indexRaw);
		expect(index.version).toBe(1);
		expect(index.entries).toHaveLength(1);
		expect(index.entries[0].orgSlug).toBe("acme");
	});
});
