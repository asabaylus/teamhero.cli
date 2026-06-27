/**
 * Tests for src/metrics/loc.rest.ts — input validation, the raw-fetch retry
 * policy (used by org discovery), and orchestration over the GraphQL collector.
 */
import {
	afterAll,
	afterEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import { consola } from "consola";
import * as octokitMod from "../../../src/lib/octokit.js";

/**
 * Fake GraphQL client whose commit history depends on the repo name, so the
 * orchestration test can assert cross-repo merging with no network call. The
 * Octokit factory is mocked to hand this back from `collectRepoCommits`.
 */
const fakeGraphql = mock(async (_query: string, vars: { name: string }) => {
	const additionsByRepo: Record<string, number> = { r1: 100, r2: 40 };
	const additions = additionsByRepo[vars.name] ?? 0;
	return {
		repository: {
			ref: {
				target: {
					history: {
						pageInfo: { hasNextPage: false, endCursor: null },
						nodes: [
							{
								oid: `${vars.name}-1`,
								additions,
								deletions: 0,
								author: { user: { login: "alice" } },
							},
						],
					},
				},
			},
		},
	};
});

mock.module("../../../src/lib/octokit.js", () => ({
	...octokitMod,
	createOctokitClient: mock(async () => ({ graphql: fakeGraphql })),
}));

const { collectLocMetricsRest, discoverOrgRepos } = await import(
	"../../../src/metrics/loc.rest.js"
);

afterAll(() => {
	mock.restore();
});

describe("collectLocMetricsRest — input validation", () => {
	it("throws when neither org nor repos are provided", async () => {
		await expect(
			collectLocMetricsRest({
				sinceIso: "2026-03-01T00:00:00Z",
				untilIso: "2026-03-08T00:00:00Z",
				token: "ghp_test",
			}),
		).rejects.toThrow("Provide an organization or a list of repositories");
	});

	it("throws when repos is an empty array and no org", async () => {
		await expect(
			collectLocMetricsRest({
				repos: [],
				sinceIso: "2026-03-01T00:00:00Z",
				untilIso: "2026-03-08T00:00:00Z",
				token: "ghp_test",
			}),
		).rejects.toThrow("Provide an organization or a list of repositories");
	});

	it("throws when sinceIso is invalid", async () => {
		await expect(
			collectLocMetricsRest({
				repos: ["org/repo"],
				sinceIso: "not-a-date",
				untilIso: "2026-03-08T00:00:00Z",
				token: "ghp_test",
			}),
		).rejects.toThrow("Invalid ISO date range provided");
	});

	it("throws when untilIso is invalid", async () => {
		await expect(
			collectLocMetricsRest({
				repos: ["org/repo"],
				sinceIso: "2026-03-01T00:00:00Z",
				untilIso: "invalid",
				token: "ghp_test",
			}),
		).rejects.toThrow("Invalid ISO date range provided");
	});
});

describe("collectLocMetricsRest — orchestration over the GraphQL collector", () => {
	it("merges per-repo results and sorts contributors by net descending", async () => {
		const result = await collectLocMetricsRest({
			repos: ["the-org/r1", "the-org/r2"],
			sinceIso: "2026-05-01T00:00:00.000Z",
			untilIso: "2026-05-08T00:00:00.000Z",
			token: "ghp_orchestration",
		});

		// alice contributed in both repos: 100 + 40 additions, one commit each.
		expect(result).toHaveLength(1);
		expect(result[0].login).toBe("alice");
		expect(result[0].additions).toBe(140);
		expect(result[0].commit_count).toBe(2);
	});
});

describe("fetchWithRetry policy (via discoverOrgRepos)", () => {
	const okEmptyRepos = () => new Response(JSON.stringify([]), { status: 200 });

	function mockFetchSequence(responses: Response[]): { calls: () => number } {
		let i = 0;
		const spy = spyOn(global, "fetch").mockImplementation(() =>
			Promise.resolve(responses[Math.min(i++, responses.length - 1)]),
		);
		return { calls: () => spy.mock.calls.length };
	}

	afterEach(() => {
		(global.fetch as unknown as { mockRestore?: () => void }).mockRestore?.();
		(consola.warn as unknown as { mockRestore?: () => void }).mockRestore?.();
		(consola.error as unknown as { mockRestore?: () => void }).mockRestore?.();
	});

	const run = () => discoverOrgRepos("the-org", "ghp_test");

	it("retries a 429 and then succeeds", async () => {
		spyOn(consola, "warn").mockImplementation(() => {});
		const { calls } = mockFetchSequence([
			new Response("{}", { status: 429 }),
			okEmptyRepos(),
		]);
		const result = await run();
		expect(result.repos).toEqual([]); // retry recovered, empty org
		expect(calls()).toBe(2);
		expect(consola.warn).toHaveBeenCalled();
	});

	it("retries a transient 5xx and then succeeds", async () => {
		spyOn(consola, "warn").mockImplementation(() => {});
		const { calls } = mockFetchSequence([
			new Response("boom", { status: 503 }),
			okEmptyRepos(),
		]);
		await run();
		expect(calls()).toBe(2);
	});

	it("retries a rate-limited 403 (quota exhausted)", async () => {
		spyOn(consola, "warn").mockImplementation(() => {});
		const { calls } = mockFetchSequence([
			new Response("{}", {
				status: 403,
				headers: { "x-ratelimit-remaining": "0" },
			}),
			okEmptyRepos(),
		]);
		await run();
		expect(calls()).toBe(2);
	});

	it("does NOT retry a 403 auth/permission failure (no rate-limit markers)", async () => {
		const { calls } = mockFetchSequence([
			new Response("Forbidden", { status: 403 }),
		]);
		// A plain 403 is a hard failure — surfaced to the caller, never retried.
		await expect(run()).rejects.toThrow(/403/);
		expect(calls()).toBe(1);
	});
});
