import { describe, expect, it, mock } from "bun:test";
import { GithubIssueClosedProvider } from "../../../../src/adapters/github/github-issue-completion-provider.js";
import type { OctokitClient } from "../../../../src/lib/octokit.js";

describe("GithubIssueClosedProvider", () => {
	it("credits the closer and excludes bots", async () => {
		const search = mock(async () => ({
			data: {
				total_count: 2,
				items: [
					{
						number: 1,
						closed_at: "2026-03-02T00:00:00Z",
						closed_by: { login: "alice" },
						repository_url: "https://api.github.com/repos/acme/app",
					},
					{
						number: 2,
						closed_at: "2026-03-02T00:00:00Z",
						closed_by: { login: "bot[bot]", type: "Bot" },
					},
				],
			},
		}));
		const octokit = {
			rest: { search: { issuesAndPullRequests: search } },
		} as unknown as OctokitClient;
		const result = await new GithubIssueClosedProvider(octokit).collect(
			"acme",
			{
				startISO: "2026-03-01T00:00:00Z",
				endISO: "2026-03-08T00:00:00Z",
			},
		);
		expect(result.complete).toBe(true);
		expect(result.events).toEqual([
			{
				login: "alice",
				repository: "acme/app",
				number: 1,
				closedAt: "2026-03-02T00:00:00Z",
			},
		]);
	});
});
