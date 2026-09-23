import { describe, expect, it, mock } from "bun:test";
import { GithubPullRequestActivityProvider } from "../../../../src/adapters/github/pull-request-activity-provider.js";
import type { OctokitClient } from "../../../../src/lib/octokit.js";

function client(search: ReturnType<typeof mock>): OctokitClient {
	return {
		rest: { search: { issuesAndPullRequests: search } },
	} as unknown as OctokitClient;
}

describe("GithubPullRequestActivityProvider", () => {
	it("buckets each PR lifecycle event by its own timestamp", async () => {
		const search = mock(async ({ q }: { q: string }) => {
			if (q.includes("created:")) {
				return {
					data: {
						total_count: 1,
						items: [
							{
								number: 7,
								user: { login: "alice" },
								created_at: "2026-03-01T12:00:00Z",
								repository_url: "https://api.github.com/repos/acme/app",
							},
						],
					},
				};
			}
			if (q.includes("is:merged")) {
				return {
					data: {
						total_count: 1,
						items: [
							{
								number: 2,
								user: { login: "bob" },
								pull_request: { merged_at: "2026-03-03T12:00:00Z" },
							},
						],
					},
				};
			}
			return {
				data: {
					total_count: 1,
					items: [
						{
							number: 3,
							user: { login: "carol" },
							closed_at: "2026-03-04T12:00:00Z",
						},
					],
				},
			};
		});
		const result = await new GithubPullRequestActivityProvider(
			client(search),
		).collect("acme", {
			startISO: "2026-03-01T00:00:00Z",
			endISO: "2026-03-08T00:00:00Z",
		});
		expect(result.complete).toBe(true);
		expect(result.events.map((event) => event.event)).toEqual([
			"opened",
			"merged",
			"closed-unmerged",
		]);
		expect(search.mock.calls.map((call) => call[0].q)).toEqual([
			"org:acme is:pr created:2026-03-01..2026-03-07",
			"org:acme is:pr is:merged merged:2026-03-01..2026-03-07",
			"org:acme is:pr is:closed is:unmerged closed:2026-03-01..2026-03-07",
		]);
	});

	it("marks capped searches partial instead of reporting a plausible zero", async () => {
		const search = mock(async () => ({
			data: { total_count: 1001, incomplete_results: true, items: [] },
		}));
		const result = await new GithubPullRequestActivityProvider(
			client(search),
		).collect("acme", {
			startISO: "2026-03-01T00:00:00Z",
			endISO: "2026-03-08T00:00:00Z",
		});
		expect(result.complete).toBe(false);
		expect(result.warnings).toHaveLength(3);
	});
});
