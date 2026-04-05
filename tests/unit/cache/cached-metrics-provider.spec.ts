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
	MetricsCollectionOptions,
	MetricsCollectionResult,
	MetricsProvider,
} from "../../../src/core/types.js";
import { mocked } from "../../helpers/mocked.js";

import * as envMod from "../../../src/lib/env.js";
import * as pathsMod from "../../../src/lib/paths.js";
import * as unifiedLogMod from "../../../src/lib/unified-log.js";

// Mock cacheDir() and unified log
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

const { CachedMetricsProvider } = await import(
	"../../../src/adapters/cache/cached-metrics-provider.js"
);
const { getEnv } = await import("../../../src/lib/env.js");

function makeOptions(
	overrides?: Partial<MetricsCollectionOptions>,
): MetricsCollectionOptions {
	return {
		organization: { login: "acme", name: "Acme Inc", url: "" },
		members: [
			{ login: "alice", name: "Alice", avatarUrl: "" },
			{ login: "bob", name: "Bob", avatarUrl: "" },
		],
		repositories: [
			{ name: "repo-a", url: "", isArchived: false, isPrivate: false },
			{ name: "repo-b", url: "", isArchived: false, isPrivate: false },
		],
		since: "2026-02-01",
		until: "2026-02-08",
		...overrides,
	};
}

function makeResult(prsMerged = 5): MetricsCollectionResult {
	return {
		members: [],
		warnings: [],
		errors: [],
		mergedTotal: prsMerged,
	};
}

describe("CachedMetricsProvider", () => {
	let mockInner: MetricsProvider;
	let collectSpy: ReturnType<typeof mock>;

	beforeEach(async () => {
		testCacheDir = await mkdtemp(join(tmpdir(), "teamhero-metrics-cache-"));
		collectSpy = mock().mockResolvedValue(makeResult());
		mockInner = { collect: collectSpy };
		mocked(getEnv).mockReturnValue(undefined);
	});

	afterEach(async () => {
		await rm(testCacheDir, { recursive: true, force: true });
	});

	it("delegates to inner on first call (cache miss)", async () => {
		const provider = new CachedMetricsProvider(mockInner);
		const result = await provider.collect(makeOptions());

		expect(collectSpy).toHaveBeenCalledOnce();
		expect(result.mergedTotal).toBe(5);
	});

	it("returns cached result on second call (cache hit)", async () => {
		const provider = new CachedMetricsProvider(mockInner);
		const options = makeOptions();

		await provider.collect(options);
		expect(collectSpy).toHaveBeenCalledOnce();

		const result2 = await provider.collect(options);
		expect(collectSpy).toHaveBeenCalledOnce(); // NOT called again
		expect(result2.mergedTotal).toBe(5);
	});

	it("produces different cache keys for different member sets", async () => {
		const provider = new CachedMetricsProvider(mockInner);

		// First call with alice+bob
		await provider.collect(makeOptions());
		expect(collectSpy).toHaveBeenCalledTimes(1);

		// Second call with only alice — different scope, should miss cache
		await provider.collect(
			makeOptions({
				members: [{ login: "alice", name: "Alice", avatarUrl: "" }],
			}),
		);
		expect(collectSpy).toHaveBeenCalledTimes(2);
	});

	it("produces different cache keys for different repo sets", async () => {
		const provider = new CachedMetricsProvider(mockInner);

		await provider.collect(makeOptions());
		expect(collectSpy).toHaveBeenCalledTimes(1);

		// Different repos — should miss cache
		await provider.collect(
			makeOptions({
				repositories: [
					{ name: "repo-c", url: "", isArchived: false, isPrivate: false },
				],
			}),
		);
		expect(collectSpy).toHaveBeenCalledTimes(2);
	});

	it("bypasses cache when flush option is set", async () => {
		const provider = new CachedMetricsProvider(mockInner, { flush: true });
		const options = makeOptions();

		await provider.collect(options);
		await provider.collect(options);

		// Inner called both times because flush is set
		expect(collectSpy).toHaveBeenCalledTimes(2);
	});

	it("bypasses cache for specific source flush", async () => {
		const provider = new CachedMetricsProvider(mockInner, {
			flushSources: ["metrics"],
		});
		const options = makeOptions();

		await provider.collect(options);
		await provider.collect(options);

		expect(collectSpy).toHaveBeenCalledTimes(2);
	});

	it("skips caching in test mode", async () => {
		mocked(getEnv).mockReturnValue("1");

		const provider = new CachedMetricsProvider(mockInner);
		const options = makeOptions();

		await provider.collect(options);
		await provider.collect(options);

		// Always delegates in test mode
		expect(collectSpy).toHaveBeenCalledTimes(2);
	});
});
