import { describe, expect, it, mock } from "bun:test";
import type { IdentityMap } from "../../../src/models/person.js";
import { createIdentityResolver } from "../../../src/services/identity-resolver.service.js";
import { collectPersonMetrics } from "../../../src/services/person-metrics-collector.js";

const map: IdentityMap = [
	{
		id: "person-x",
		name: "Person X",
		logins: ["login-x", "login-x2"],
		emails: ["x@example.com"],
	},
];

/** A search result item in octokit shape. */
function searchItem(n: number, merged: boolean, open = false) {
	return {
		number: n,
		title: `PR ${n}`,
		html_url: `https://github.com/the-org/r1/pull/${n}`,
		state: open ? "open" : "closed",
		pull_request: { merged_at: merged ? "2026-01-05T00:00:00Z" : null },
		user: { login: "login-x" },
		repository_url: "https://api.github.com/repos/the-org/r1",
	};
}

const commitsBySha: Record<string, unknown> = {
	s1: {
		sha: "s1",
		parents: [{}],
		commit: {
			author: {
				name: "Person X",
				email: "x@example.com",
				date: "2026-01-10T00:00:00Z",
			},
		},
		files: [
			{ filename: "src/app.ts", additions: 10, deletions: 2 },
			{ filename: "data/dump.json", additions: 500, deletions: 0 },
		],
	},
	m1: {
		sha: "m1",
		parents: [{}, {}], // merge — excluded
		commit: {
			author: { email: "x@example.com", date: "2026-01-11T00:00:00Z" },
		},
		files: [{ filename: "src/merged.ts", additions: 9999, deletions: 0 }],
	},
};

describe("collectPersonMetrics", () => {
	it("fetches PRs per login + commits per repo and aggregates per Person", async () => {
		const issuesAndPullRequests = mock(async ({ q }: { q: string }) => {
			const login = /author:(\S+)/.exec(q)?.[1];
			if (login === "login-x")
				return {
					data: {
						items: [
							searchItem(1, true),
							searchItem(2, true),
							searchItem(3, false),
							searchItem(5, false, true),
						],
					},
				};
			if (login === "login-x2")
				return { data: { items: [searchItem(4, true)] } };
			return { data: { items: [] } };
		});
		const listCommits = mock(async ({ page }: { page: number }) =>
			page === 1 ? { data: [{ sha: "s1" }, { sha: "m1" }] } : { data: [] },
		);
		const getCommit = mock(async ({ ref }: { ref: string }) => ({
			data: commitsBySha[ref],
		}));

		const octokit = {
			rest: {
				search: { issuesAndPullRequests },
				repos: { listCommits, getCommit },
			},
		};

		const result = await collectPersonMetrics(
			octokit as never,
			createIdentityResolver(map),
			{
				org: "the-org",
				repositories: [{ name: "the-org/r1" }],
				since: "2026-01-01T00:00:00.000Z",
				until: "2026-02-01T00:00:00.000Z",
			},
		);

		expect(result.persons).toHaveLength(1);
		const x = result.persons[0];
		// PRs summed across both logins: 3 merged + 1 closed-unmerged + 1 open.
		expect(x.prsMerged).toBe(3);
		expect(x.prsClosedUnmerged).toBe(1);
		expect(x.prsOpen).toBe(1);
		// One authored commit (merge excluded), Jan.
		expect(x.commitsTotal).toBe(1);
		expect(x.commitsByMonth).toEqual({ "2026-01": 1 });
		// rawLoc = (10+2)+(500) = 512; codeLoc excludes the json = 10+2 = 12.
		expect(x.rawLoc).toBe(512);
		expect(x.codeLoc).toBe(12);
		// Queried both logins.
		expect(issuesAndPullRequests).toHaveBeenCalledTimes(2);
	});
});
