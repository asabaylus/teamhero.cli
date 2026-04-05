import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import * as timersPromisesMod from "node:timers/promises";
import { collectLocMetricsStats } from "../../src/metrics/loc.stats.js";

// Mock the timers/promises delay to speed up retry tests
mock.module("node:timers/promises", () => ({
	...timersPromisesMod,
	setTimeout: mock().mockResolvedValue(undefined),
}));

afterAll(() => {
	mock.restore();
});

const mockStatsResponse = [
	{
		author: { login: "alice" },
		total: 100,
		weeks: [
			{ w: 1756339200, a: 30, d: 10, c: 2 }, // Sep 1, 2025 Sunday 00:00 UTC - within range
			{ w: 1756944000, a: 20, d: 5, c: 1 }, // Sep 8, 2025 - within range
			{ w: 1757548800, a: 15, d: 3, c: 1 }, // Sep 15, 2025 - within range
			{ w: 1758153600, a: 25, d: 10, c: 2 }, // Sep 22, 2025 - within range
			{ w: 1758758400, a: 10, d: 0, c: 1 }, // Sep 29, 2025 - within range
			{ w: 1759363200, a: 50, d: 20, c: 3 }, // Oct 6, 2025 - outside range (after Oct 1)
		],
	},
	{
		author: { login: "bob" },
		total: 50,
		weeks: [
			{ w: 1756339200, a: 15, d: 5, c: 1 }, // Sep 1, 2025 - within range
			{ w: 1756944000, a: 10, d: 2, c: 1 }, // Sep 8, 2025 - within range
			{ w: 1759363200, a: 25, d: 10, c: 2 }, // Oct 6, 2025 - outside range
		],
	},
	{
		author: null, // Bot or deleted user
		total: 10,
		weeks: [{ w: 1756339200, a: 5, d: 1, c: 1 }],
	},
];

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), { status });
}

describe("collectLocMetricsStats", () => {
	beforeEach(() => {
		spyOn(global, "fetch").mockImplementation((input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();

			if (url.includes("/repos/") && url.includes("/stats/contributors")) {
				return Promise.resolve(jsonResponse(mockStatsResponse));
			}

			return Promise.resolve(new Response("{}", { status: 404 }));
		});
	});

	afterEach(() => {
		// Restore the fetch spy without undoing mock.module() registrations
		(global.fetch as any).mockRestore?.();
	});

	it("aggregates LOC metrics correctly from statistics API", async () => {
		const result = await collectLocMetricsStats({
			repos: ["test-org/repo-one"],
			sinceIso: "2025-09-01T00:00:00Z",
			untilIso: "2025-10-01T00:00:00Z",
			token: "dummy",
		});

		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({
			login: "alice",
			additions: 100, // 30 + 20 + 15 + 25 + 10 (excludes Oct 6)
			deletions: 28, // 10 + 5 + 3 + 10 + 0 (excludes Oct 6)
			net: 72,
			pr_open_count: 0,
			pr_closed_count: 0,
			pr_merged_count: 0,
			direct_commit_count: 7, // 2 + 1 + 1 + 2 + 1
		});
		expect(result[1]).toEqual({
			login: "bob",
			additions: 25, // 15 + 10 (excludes Oct 6)
			deletions: 7, // 5 + 2 (excludes Oct 6)
			net: 18,
			pr_open_count: 0,
			pr_closed_count: 0,
			pr_merged_count: 0,
			direct_commit_count: 2, // 1 + 1
		});
	});

	it("filters weeks by date range correctly", async () => {
		const result = await collectLocMetricsStats({
			repos: ["test-org/repo-one"],
			sinceIso: "2025-09-08T00:00:00Z",
			untilIso: "2025-09-22T00:00:00Z",
			token: "dummy",
		});

		const alice = result.find((m) => m.login === "alice");
		expect(alice?.additions).toBe(60); // 20 + 15 + 25 (Sep 8, 15, 22 only)
		expect(alice?.deletions).toBe(18); // 5 + 3 + 10
	});

	it("handles 202 response with retry", async () => {
		let callCount = 0;
		spyOn(global, "fetch").mockImplementation(() => {
			callCount += 1;
			if (callCount < 2) {
				return Promise.resolve(new Response("", { status: 202 }));
			}
			return Promise.resolve(jsonResponse(mockStatsResponse));
		});

		const result = await collectLocMetricsStats(
			{
				repos: ["test-org/repo-one"],
				sinceIso: "2025-09-01T00:00:00Z",
				untilIso: "2025-10-01T00:00:00Z",
				token: "dummy",
			},
			{ useCache: false },
		);

		expect(callCount).toBe(2);
		expect(result).toHaveLength(2);
	});

	it("skips repo after max retries on 202", async () => {
		spyOn(global, "fetch").mockImplementation(() => {
			return Promise.resolve(new Response("", { status: 202 }));
		});

		const result = await collectLocMetricsStats(
			{
				repos: ["test-org/repo-one"],
				sinceIso: "2025-09-01T00:00:00Z",
				untilIso: "2025-10-01T00:00:00Z",
				token: "dummy",
			},
			{ useCache: false },
		);

		expect(result).toHaveLength(0); // No data collected
	}, 20000); // Increase timeout for retry delays

	it("ignores contributors with null author", async () => {
		const result = await collectLocMetricsStats({
			repos: ["test-org/repo-one"],
			sinceIso: "2025-09-01T00:00:00Z",
			untilIso: "2025-10-01T00:00:00Z",
			token: "dummy",
		});

		const nullAuthor = result.find(
			(m) => m.login === null || m.login === undefined,
		);
		expect(nullAuthor).toBeUndefined();
	});

	it("aggregates across multiple repos", async () => {
		const result = await collectLocMetricsStats({
			repos: ["test-org/repo-one", "test-org/repo-two"],
			sinceIso: "2025-09-01T00:00:00Z",
			untilIso: "2025-10-01T00:00:00Z",
			token: "dummy",
		});

		const alice = result.find((m) => m.login === "alice");
		// Should have double the stats since we fetched from 2 repos with same data
		expect(alice?.additions).toBe(200); // 100 * 2
		expect(alice?.deletions).toBe(56); // 28 * 2
	});

	it("calls progress callback for each repo", async () => {
		const progressCalls: any[] = [];

		await collectLocMetricsStats(
			{
				repos: ["test-org/repo-one", "test-org/repo-two"],
				sinceIso: "2025-09-01T00:00:00Z",
				untilIso: "2025-10-01T00:00:00Z",
				token: "dummy",
				onRepoProgress: (info) => {
					progressCalls.push(info);
				},
			},
			{ useCache: false },
		);

		expect(progressCalls).toHaveLength(4); // 2 repos * 2 phases (pr + done)
		expect(progressCalls[0]).toMatchObject({
			repoFullName: "test-org/repo-one",
			index: 1,
			total: 2,
			phase: "pr",
		});
		expect(progressCalls[1]).toMatchObject({
			repoFullName: "test-org/repo-one",
			index: 1,
			total: 2,
			phase: "done",
		});
	});

	it("sorts results by net LOC descending", async () => {
		const result = await collectLocMetricsStats({
			repos: ["test-org/repo-one"],
			sinceIso: "2025-09-01T00:00:00Z",
			untilIso: "2025-10-01T00:00:00Z",
			token: "dummy",
		});

		expect(result[0].login).toBe("alice"); // Higher net (72)
		expect(result[1].login).toBe("bob"); // Lower net (18)
	});

	it("handles empty repo list", async () => {
		const result = await collectLocMetricsStats({
			repos: [],
			sinceIso: "2025-09-01T00:00:00Z",
			untilIso: "2025-10-01T00:00:00Z",
			token: "dummy",
		});

		expect(result).toHaveLength(0);
	});

	it("throws on invalid date range", async () => {
		await expect(
			collectLocMetricsStats({
				repos: ["test-org/repo-one"],
				sinceIso: "invalid-date",
				untilIso: "2025-10-01T00:00:00Z",
				token: "dummy",
			}),
		).rejects.toThrow("Invalid ISO date range");
	});
});
