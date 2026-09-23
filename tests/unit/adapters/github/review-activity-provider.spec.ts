import { describe, expect, it, mock } from "bun:test";
import { GithubReviewActivityProvider } from "../../../../src/adapters/github/review-activity-provider.js";
import type { OctokitClient } from "../../../../src/lib/octokit.js";

describe("GithubReviewActivityProvider", () => {
	it("counts submitted states, dismissed history, and excludes self/bot reviews", async () => {
		const search = mock(async () => ({
			data: {
				total_count: 1,
				items: [
					{
						number: 9,
						user: { login: "author" },
						repository_url: "https://api.github.com/repos/acme/app",
					},
				],
			},
		}));
		const listReviews = mock(async () => ({
			data: [
				{
					user: { login: "reviewer" },
					submitted_at: "2026-03-02T10:00:00Z",
					state: "APPROVED",
				},
				{
					user: { login: "dismissed-reviewer" },
					submitted_at: "2026-03-03T10:00:00Z",
					state: "DISMISSED",
				},
				{
					user: { login: "author" },
					submitted_at: "2026-03-03T10:00:00Z",
					state: "COMMENTED",
				},
				{
					user: { login: "ci[bot]", type: "Bot" },
					submitted_at: "2026-03-03T10:00:00Z",
					state: "COMMENTED",
				},
			],
		}));
		const octokit = {
			rest: {
				search: { issuesAndPullRequests: search },
				pulls: { listReviews },
			},
		} as unknown as OctokitClient;
		const result = await new GithubReviewActivityProvider(octokit).collect(
			"acme",
			{
				startISO: "2026-03-01T00:00:00Z",
				endISO: "2026-03-08T00:00:00Z",
			},
		);
		expect(result.events).toHaveLength(2);
		expect(result.events.map((event) => event.state)).toEqual([
			"approved",
			"commented",
		]);
	});
});
