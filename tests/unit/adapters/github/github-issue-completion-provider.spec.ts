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

	it("fetches issue details when search omits closed_by", async () => {
		const search = mock(async () => ({
			data: {
				total_count: 1,
				items: [
					{
						number: 3,
						closed_at: "2026-03-02T00:00:00Z",
						repository_url: "https://api.github.com/repos/acme/app",
					},
				],
			},
		}));
		const get = mock(async () => ({
			data: { closed_by: { login: "closer" } },
		}));
		const octokit = {
			rest: { search: { issuesAndPullRequests: search }, issues: { get } },
		} as unknown as OctokitClient;
		const result = await new GithubIssueClosedProvider(octokit).collect(
			"acme",
			{
				startISO: "2026-03-01T00:00:00Z",
				endISO: "2026-03-08T00:00:00Z",
			},
		);
		expect(get).toHaveBeenCalledWith({
			owner: "acme",
			repo: "app",
			issue_number: 3,
		});
		expect(result.complete).toBe(true);
		expect(result.events[0]?.login).toBe("closer");
	});

	it("marks coverage partial when a closer lookup fails", async () => {
		const search = mock(async () => ({
			data: {
				total_count: 1,
				items: [
					{
						number: 4,
						closed_at: "2026-03-02T00:00:00Z",
						repository_url: "https://api.github.com/repos/acme/app",
					},
				],
			},
		}));
		const octokit = {
			rest: {
				search: { issuesAndPullRequests: search },
				issues: { get: mock(async () => Promise.reject(new Error("boom"))) },
			},
		} as unknown as OctokitClient;
		const result = await new GithubIssueClosedProvider(octokit).collect(
			"acme",
			{
				startISO: "2026-03-01T00:00:00Z",
				endISO: "2026-03-08T00:00:00Z",
			},
		);
		expect(result.complete).toBe(false);
		expect(result.events).toEqual([]);
		expect(result.warnings[0]).toContain("closer lookup failed");
	});
});
