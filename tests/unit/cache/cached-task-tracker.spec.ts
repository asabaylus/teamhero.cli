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
	MemberTaskSummary,
	ReportingWindow,
	TaskTrackerMemberInput,
	TaskTrackerProvider,
} from "../../../src/core/types.js";
import * as envMod from "../../../src/lib/env.js";
import * as pathsMod from "../../../src/lib/paths.js";
import * as unifiedLogMod from "../../../src/lib/unified-log.js";
import { mocked } from "../../helpers/mocked.js";

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

const { CachedTaskTrackerProvider } = await import(
	"../../../src/adapters/cache/cached-task-tracker.js"
);
const { getEnv } = await import("../../../src/lib/env.js");
const { appendUnifiedLog } = await import("../../../src/lib/unified-log.js");

const WINDOW: ReportingWindow = {
	startISO: "2026-02-01T00:00:00Z",
	endISO: "2026-02-08T00:00:00Z",
};

const MEMBERS: TaskTrackerMemberInput[] = [
	{ login: "alice", displayName: "Alice" },
	{ login: "bob", displayName: "Bob" },
];

function makeTaskResult(): Map<string, MemberTaskSummary> {
	const result = new Map<string, MemberTaskSummary>();
	result.set("alice", {
		status: "matched",
		tasks: [
			{
				gid: "1",
				name: "Ship feature",
				status: "completed",
				completedAt: "2026-02-03T10:00:00Z",
			},
		],
	});
	result.set("bob", {
		status: "no-match",
		tasks: [],
		message: "No match found.",
	});
	return result;
}

describe("CachedTaskTrackerProvider", () => {
	let mockInner: TaskTrackerProvider;
	let fetchSpy: ReturnType<typeof mock>;

	beforeEach(async () => {
		testCacheDir = await mkdtemp(join(tmpdir(), "teamhero-task-cache-"));
		fetchSpy = mock().mockResolvedValue(makeTaskResult());
		mockInner = {
			enabled: true,
			fetchTasksForMembers: fetchSpy,
		};
		mocked(getEnv).mockReturnValue(undefined);
	});

	afterEach(async () => {
		await rm(testCacheDir, { recursive: true, force: true });
	});

	it("delegates to inner on first call (cache miss)", async () => {
		const provider = new CachedTaskTrackerProvider(mockInner);
		const result = await provider.fetchTasksForMembers(MEMBERS, WINDOW);

		expect(fetchSpy).toHaveBeenCalledOnce();
		expect(result).toBeInstanceOf(Map);
		expect(result.get("alice")?.status).toBe("matched");
		expect(result.get("bob")?.status).toBe("no-match");
	});

	it("returns cached result on second call (cache hit)", async () => {
		const provider = new CachedTaskTrackerProvider(mockInner);

		await provider.fetchTasksForMembers(MEMBERS, WINDOW);
		expect(fetchSpy).toHaveBeenCalledOnce();

		const result2 = await provider.fetchTasksForMembers(MEMBERS, WINDOW);
		expect(fetchSpy).toHaveBeenCalledOnce(); // NOT called again
		expect(result2.get("alice")?.status).toBe("matched");
	});

	it("returns a Map (deserialized from Record) on cache hit", async () => {
		const provider = new CachedTaskTrackerProvider(mockInner);

		await provider.fetchTasksForMembers(MEMBERS, WINDOW);
		const result2 = await provider.fetchTasksForMembers(MEMBERS, WINDOW);

		expect(result2).toBeInstanceOf(Map);
		expect(result2.get("alice")?.tasks).toHaveLength(1);
	});

	it("logs cache-hit event on second call", async () => {
		const provider = new CachedTaskTrackerProvider(mockInner);

		await provider.fetchTasksForMembers(MEMBERS, WINDOW);
		await provider.fetchTasksForMembers(MEMBERS, WINDOW);

		expect(appendUnifiedLog).toHaveBeenCalledWith(
			expect.objectContaining({
				category: "cache",
				event: "cache-hit",
				namespace: "tasks",
			}),
		);
	});

	it("logs cache-miss-and-set event on first call", async () => {
		const provider = new CachedTaskTrackerProvider(mockInner);

		await provider.fetchTasksForMembers(MEMBERS, WINDOW);

		expect(appendUnifiedLog).toHaveBeenCalledWith(
			expect.objectContaining({
				category: "cache",
				event: "cache-miss-and-set",
				namespace: "tasks",
			}),
		);
	});

	it("produces different cache keys for different member sets", async () => {
		const provider = new CachedTaskTrackerProvider(mockInner);

		await provider.fetchTasksForMembers(MEMBERS, WINDOW);
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		// Different member set should miss cache
		await provider.fetchTasksForMembers(
			[{ login: "charlie", displayName: "Charlie" }],
			WINDOW,
		);
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("produces different cache keys for different windows", async () => {
		const provider = new CachedTaskTrackerProvider(mockInner);

		await provider.fetchTasksForMembers(MEMBERS, WINDOW);
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		await provider.fetchTasksForMembers(MEMBERS, {
			startISO: "2026-03-01T00:00:00Z",
			endISO: "2026-03-08T00:00:00Z",
		});
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("bypasses cache when flush option is set", async () => {
		const provider = new CachedTaskTrackerProvider(mockInner, { flush: true });

		await provider.fetchTasksForMembers(MEMBERS, WINDOW);
		await provider.fetchTasksForMembers(MEMBERS, WINDOW);

		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("logs cache-flush-and-set event when flushing", async () => {
		const provider = new CachedTaskTrackerProvider(mockInner, { flush: true });

		await provider.fetchTasksForMembers(MEMBERS, WINDOW);

		expect(appendUnifiedLog).toHaveBeenCalledWith(
			expect.objectContaining({
				category: "cache",
				event: "cache-flush-and-set",
				namespace: "tasks",
			}),
		);
	});

	it("bypasses cache for specific source flush (tasks)", async () => {
		const provider = new CachedTaskTrackerProvider(mockInner, {
			flushSources: ["tasks"],
		});

		await provider.fetchTasksForMembers(MEMBERS, WINDOW);
		await provider.fetchTasksForMembers(MEMBERS, WINDOW);

		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("does NOT flush when flushSources targets a different source", async () => {
		const provider = new CachedTaskTrackerProvider(mockInner, {
			flushSources: ["metrics"],
		});

		await provider.fetchTasksForMembers(MEMBERS, WINDOW);
		await provider.fetchTasksForMembers(MEMBERS, WINDOW);

		// Second call should hit cache since "metrics" is not "tasks"
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("respects flushSince — skips flush when window starts before flushSince", async () => {
		const provider = new CachedTaskTrackerProvider(mockInner, {
			flush: true,
			flushSince: "2026-03-01T00:00:00Z", // after our window
		});

		await provider.fetchTasksForMembers(MEMBERS, WINDOW);
		await provider.fetchTasksForMembers(MEMBERS, WINDOW);

		// Window starts 2026-02-01, which is before flushSince 2026-03-01 => no flush => cache hit
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("respects flushSince — flushes when window starts on or after flushSince", async () => {
		const provider = new CachedTaskTrackerProvider(mockInner, {
			flush: true,
			flushSince: "2026-02-01T00:00:00Z", // matches our window start
		});

		await provider.fetchTasksForMembers(MEMBERS, WINDOW);
		await provider.fetchTasksForMembers(MEMBERS, WINDOW);

		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("skips caching in test mode", async () => {
		mocked(getEnv).mockReturnValue("1");

		const provider = new CachedTaskTrackerProvider(mockInner);

		await provider.fetchTasksForMembers(MEMBERS, WINDOW);
		await provider.fetchTasksForMembers(MEMBERS, WINDOW);

		// Always delegates in test mode
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("proxies enabled property from inner provider", () => {
		const disabledInner: TaskTrackerProvider = {
			enabled: false,
			fetchTasksForMembers: mock(),
		};
		const provider = new CachedTaskTrackerProvider(disabledInner);

		expect(provider.enabled).toBe(false);
	});

	it("uses default cacheOptions when none provided", async () => {
		const provider = new CachedTaskTrackerProvider(mockInner);
		const result = await provider.fetchTasksForMembers(MEMBERS, WINDOW);

		expect(result).toBeInstanceOf(Map);
		expect(fetchSpy).toHaveBeenCalledOnce();
	});
});
