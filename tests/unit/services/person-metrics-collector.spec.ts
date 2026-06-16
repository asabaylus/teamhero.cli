import { describe, expect, it, mock, spyOn } from "bun:test";
import { consola } from "consola";
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

// What listCommits returns: author/parents/date but NO files (files come from
// the getCommit enrichment step, mirroring the real GitHub payloads).
const listS1 = {
	sha: "s1",
	parents: [{}],
	commit: {
		author: {
			name: "Person X",
			email: "x@example.com",
			date: "2026-01-10T00:00:00Z",
		},
	},
};
const listM1 = {
	sha: "m1",
	parents: [{}, {}],
	commit: { author: { email: "x@example.com", date: "2026-01-11T00:00:00Z" } },
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
			page === 1 ? { data: [listS1, listM1] } : { data: [] },
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
		// getCommit (the rate-limit-prone step) is called ONLY for the attributable
		// non-merge commit — not the merge commit.
		expect(getCommit).toHaveBeenCalledTimes(1);
	});

	it("skips an empty/inaccessible repo instead of failing the whole run", async () => {
		const issuesAndPullRequests = mock(async () => ({ data: { items: [] } }));
		// First repo throws "Git Repository is empty" (409); second yields a commit.
		const listCommits = mock(
			async ({ repo, page }: { repo: string; page: number }) => {
				if (repo === "empty-repo") {
					throw new Error("Git Repository is empty. (409)");
				}
				return page === 1 ? { data: [listS1] } : { data: [] };
			},
		);
		const getCommit = mock(async () => ({ data: commitsBySha.s1 }));

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
				repositories: [
					{ name: "the-org/empty-repo" },
					{ name: "the-org/good-repo" },
				],
				since: "2026-01-01T00:00:00.000Z",
				until: "2026-02-01T00:00:00.000Z",
			},
		);

		// The empty repo is skipped; the good repo's commit still counts.
		expect(result.persons[0].commitsTotal).toBe(1);
	});

	it("buffers commit bounds (Commits API) but keeps PR search on the raw inclusive window", async () => {
		let prQuery = "";
		const issuesAndPullRequests = mock(async ({ q }: { q: string }) => {
			prQuery = q;
			return { data: { items: [] } };
		});
		const listCommitsArgs: { since?: string; until?: string }[] = [];
		const listCommits = mock(
			async (args: { since?: string; until?: string; page: number }) => {
				listCommitsArgs.push({ since: args.since, until: args.until });
				return { data: [] };
			},
		);
		const getCommit = mock(async () => ({ data: {} }));
		const octokit = {
			rest: {
				search: { issuesAndPullRequests },
				repos: { listCommits, getCommit },
			},
		};

		await collectPersonMetrics(octokit as never, createIdentityResolver(map), {
			org: "the-org",
			repositories: [{ name: "the-org/r1" }],
			since: "2026-01-01", // bare YYYY-MM-DD (the CLI weekly path)
			until: "2026-01-31",
		});

		// Commits: resolveStartISO keeps the start day; resolveEndISO adds the
		// +2-day exclusive buffer so the last calendar day isn't missed.
		expect(listCommitsArgs[0]?.since).toBe("2026-01-01T00:00:00.000Z");
		expect(listCommitsArgs[0]?.until).toBe("2026-02-02T00:00:00.000Z");
		// PR search: inclusive on both ends → the literal window, no buffer.
		expect(prQuery).toContain("created:2026-01-01..2026-01-31");
	});

	it("surfaces unmapped authors even with an empty identity map (no short-circuit)", async () => {
		const issuesAndPullRequests = mock(async () => ({ data: { items: [] } }));
		const listCommits = mock(async ({ page }: { page: number }) =>
			page === 1 ? { data: [listS1] } : { data: [] },
		);
		const getCommit = mock(async () => ({ data: commitsBySha.s1 }));
		const octokit = {
			rest: {
				search: { issuesAndPullRequests },
				repos: { listCommits, getCommit },
			},
		};

		const result = await collectPersonMetrics(
			octokit as never,
			createIdentityResolver([]), // no mapped Persons
			{
				org: "the-org",
				repositories: [{ name: "the-org/r1" }],
				since: "2026-01-01T00:00:00.000Z",
				until: "2026-02-01T00:00:00.000Z",
			},
		);

		// No Persons, but the author is queued for reconciliation rather than hidden.
		expect(result.persons).toHaveLength(0);
		expect(result.unmappedCommits).toEqual([
			{ email: "x@example.com", name: "Person X", count: 1 },
		]);
		// No logins to search; LoC enrichment only runs for resolved commits.
		expect(issuesAndPullRequests).not.toHaveBeenCalled();
		expect(getCommit).not.toHaveBeenCalled();
	});

	it("logs a failed PR search instead of silently undercounting", async () => {
		const warn = spyOn(consola, "warn").mockImplementation(() => {});
		try {
			// login-x's search throws (a rate limit that survived Octokit's retries);
			// login-x2's succeeds. The Person must still get login-x2's PR, and the
			// failure must be logged so the undercount isn't invisible.
			const issuesAndPullRequests = mock(async ({ q }: { q: string }) => {
				if (/author:login-x\b/.test(q)) {
					throw new Error("Secondary rate limit exceeded");
				}
				return { data: { items: [searchItem(4, true)] } };
			});
			const listCommits = mock(async () => ({ data: [] }));
			const getCommit = mock(async () => ({ data: {} }));
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

			// The surviving login's merged PR is still counted (partial > nothing).
			expect(result.persons[0].prsMerged).toBe(1);
			// The failure is surfaced, naming the throttled login.
			expect(warn).toHaveBeenCalledTimes(1);
			expect(String(warn.mock.calls[0]?.[0])).toContain("login-x");
			expect(String(warn.mock.calls[0]?.[0])).toMatch(/undercount/i);
		} finally {
			warn.mockRestore();
		}
	});
});
