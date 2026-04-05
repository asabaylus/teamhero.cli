import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ReportingWindow,
	VisibleWinsDataResult,
	VisibleWinsProvider,
} from "../../../src/core/types.js";
import { mocked } from "../../helpers/mocked.js";

import * as envMod from "../../../src/lib/env.js";
import * as pathsMod from "../../../src/lib/paths.js";
import * as unifiedLogMod from "../../../src/lib/unified-log.js";

// Mock cacheDir() and unified log before importing the module under test
let testCacheDir: string;

mock.module("../../../src/lib/paths.js", () => ({
	...pathsMod,
	cacheDir: () => testCacheDir,
}));

mock.module("../../../src/lib/unified-log.js", () => ({
	...unifiedLogMod,
	appendUnifiedLog: mock(),
}));

mock.module("../../../src/lib/env.js", () => ({
	...envMod,
	getEnv: mock(() => undefined),
}));

afterAll(() => {
	mock.restore();
});

const { CachedVisibleWinsProvider } = await import(
	"../../../src/adapters/cache/cached-visible-wins.js"
);
const { getEnv } = await import("../../../src/lib/env.js");
const { appendUnifiedLog } = await import("../../../src/lib/unified-log.js");

const WINDOW: ReportingWindow = {
	startISO: "2026-02-01T00:00:00Z",
	endISO: "2026-02-08T00:00:00Z",
};

function makeDataResult(): VisibleWinsDataResult {
	return {
		projects: [
			{
				name: "Dashboard",
				gid: "gid-1",
				customFields: { status: "In Progress" },
				priorityScore: 80,
			},
		],
		notes: [
			{
				title: "Standup Notes",
				date: "2026-02-03",
				attendees: ["alice"],
				discussionItems: ["Discussed dashboard progress"],
				sourceFile: "standup.md",
			},
		],
		associations: [
			{
				noteIndex: 0,
				projectGid: "gid-1",
				matchedKeywords: ["dashboard"],
			},
		],
	};
}

describe("CachedVisibleWinsProvider", () => {
	let mockInner: VisibleWinsProvider;
	let fetchSpy: ReturnType<typeof mock>;

	beforeEach(async () => {
		testCacheDir = await mkdtemp(join(tmpdir(), "teamhero-vw-cache-"));
		fetchSpy = mock().mockResolvedValue(makeDataResult());
		mockInner = { fetchData: fetchSpy };
		mocked(getEnv).mockReturnValue(undefined);
	});

	afterEach(async () => {
		await rm(testCacheDir, { recursive: true, force: true });
	});

	it("delegates to inner on first call (cache miss)", async () => {
		const provider = new CachedVisibleWinsProvider(mockInner);
		const result = await provider.fetchData(WINDOW);

		expect(fetchSpy).toHaveBeenCalledOnce();
		expect(result.projects).toHaveLength(1);
		expect(result.projects[0].name).toBe("Dashboard");
	});

	it("returns cached result on second call (cache hit)", async () => {
		const provider = new CachedVisibleWinsProvider(mockInner);

		await provider.fetchData(WINDOW);
		expect(fetchSpy).toHaveBeenCalledOnce();

		const result2 = await provider.fetchData(WINDOW);
		expect(fetchSpy).toHaveBeenCalledOnce(); // NOT called again
		expect(result2.projects).toHaveLength(1);
		expect(result2.notes).toHaveLength(1);
	});

	it("logs cache-hit event on second call", async () => {
		const provider = new CachedVisibleWinsProvider(mockInner);

		await provider.fetchData(WINDOW);
		await provider.fetchData(WINDOW);

		expect(appendUnifiedLog).toHaveBeenCalledWith(
			expect.objectContaining({
				category: "cache",
				event: "cache-hit",
				namespace: "visible-wins",
			}),
		);
	});

	it("logs cache-miss-and-set event on first call", async () => {
		const provider = new CachedVisibleWinsProvider(mockInner);

		await provider.fetchData(WINDOW);

		expect(appendUnifiedLog).toHaveBeenCalledWith(
			expect.objectContaining({
				category: "cache",
				event: "cache-miss-and-set",
				namespace: "visible-wins",
			}),
		);
	});

	it("produces different cache keys for different windows", async () => {
		const provider = new CachedVisibleWinsProvider(mockInner);

		await provider.fetchData(WINDOW);
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		await provider.fetchData({
			startISO: "2026-03-01T00:00:00Z",
			endISO: "2026-03-08T00:00:00Z",
		});
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("bypasses cache when flush option is set", async () => {
		const provider = new CachedVisibleWinsProvider(mockInner, {
			flush: true,
		});

		await provider.fetchData(WINDOW);
		await provider.fetchData(WINDOW);

		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("logs cache-flush-and-set event when flushing", async () => {
		const provider = new CachedVisibleWinsProvider(mockInner, {
			flush: true,
		});

		await provider.fetchData(WINDOW);

		expect(appendUnifiedLog).toHaveBeenCalledWith(
			expect.objectContaining({
				category: "cache",
				event: "cache-flush-and-set",
				namespace: "visible-wins",
			}),
		);
	});

	it("bypasses cache for specific source flush (visible-wins)", async () => {
		const provider = new CachedVisibleWinsProvider(mockInner, {
			flushSources: ["visible-wins"],
		});

		await provider.fetchData(WINDOW);
		await provider.fetchData(WINDOW);

		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("does NOT flush when flushSources targets a different source", async () => {
		const provider = new CachedVisibleWinsProvider(mockInner, {
			flushSources: ["metrics"],
		});

		await provider.fetchData(WINDOW);
		await provider.fetchData(WINDOW);

		// Second call should hit cache since "metrics" is not "visible-wins"
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("respects flushSince — skips flush when window starts before flushSince", async () => {
		const provider = new CachedVisibleWinsProvider(mockInner, {
			flush: true,
			flushSince: "2026-03-01T00:00:00Z",
		});

		await provider.fetchData(WINDOW);
		await provider.fetchData(WINDOW);

		// Window starts 2026-02-01, which is before flushSince => no flush => cache hit
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("respects flushSince — flushes when window starts on or after flushSince", async () => {
		const provider = new CachedVisibleWinsProvider(mockInner, {
			flush: true,
			flushSince: "2026-02-01T00:00:00Z",
		});

		await provider.fetchData(WINDOW);
		await provider.fetchData(WINDOW);

		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("skips caching in test mode", async () => {
		mocked(getEnv).mockReturnValue("1");

		const provider = new CachedVisibleWinsProvider(mockInner);

		await provider.fetchData(WINDOW);
		await provider.fetchData(WINDOW);

		// Always delegates in test mode
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("uses default cacheOptions when none provided", async () => {
		const provider = new CachedVisibleWinsProvider(mockInner);
		const result = await provider.fetchData(WINDOW);

		expect(result.projects).toHaveLength(1);
		expect(fetchSpy).toHaveBeenCalledOnce();
	});

	it("produces different cache keys for different configHash values", async () => {
		const providerA = new CachedVisibleWinsProvider(
			mockInner,
			{},
			"config-aaa",
		);
		const providerB = new CachedVisibleWinsProvider(
			mockInner,
			{},
			"config-bbb",
		);

		await providerA.fetchData(WINDOW);
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		// Same window but different configHash → cache miss
		await providerB.fetchData(WINDOW);
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("preserves supplementaryNotes through cache", async () => {
		fetchSpy.mockResolvedValue({
			...makeDataResult(),
			supplementaryNotes: "Extra context from external sources.",
		});

		const provider = new CachedVisibleWinsProvider(mockInner);

		await provider.fetchData(WINDOW);
		const result2 = await provider.fetchData(WINDOW);

		expect(result2.supplementaryNotes).toBe(
			"Extra context from external sources.",
		);
	});
});
