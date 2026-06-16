import { describe, expect, it, mock } from "bun:test";
import type { IdentityMap } from "../../../src/models/person.js";
import { createIdentityResolver } from "../../../src/services/identity-resolver.service.js";
import { MetricsService } from "../../../src/services/metrics.service.js";

const map: IdentityMap = [
	{
		id: "person-x",
		name: "Person X",
		logins: ["login-x"],
		emails: ["x@example.com"],
	},
];

function searchItem(n: number, merged: boolean) {
	return {
		number: n,
		title: `PR ${n}`,
		html_url: `https://github.com/the-org/r1/pull/${n}`,
		state: "closed",
		pull_request: { merged_at: merged ? "2026-01-05T00:00:00Z" : null },
		user: { login: "login-x" },
		repository_url: "https://api.github.com/repos/the-org/r1",
	};
}

/** A fake octokit that satisfies both the legacy collect path (empty) and search. */
function fakeOctokit() {
	const empty = mock(async () => ({ data: [] }));
	return {
		rest: {
			search: {
				issuesAndPullRequests: mock(async ({ q }: { q: string }) => {
					const login = /author:(\S+)/.exec(q)?.[1];
					return login === "login-x"
						? { data: { items: [searchItem(1, true), searchItem(2, true)] } }
						: { data: { items: [] } };
				}),
			},
			repos: {
				listCommits: empty,
				getCommit: mock(async () => ({ data: {} })),
				compareCommitsWithBasehead: mock(async () => ({ data: { files: [] } })),
			},
			pulls: {
				list: empty,
				get: mock(async () => ({ data: {} })),
				listCommits: empty,
			},
		},
	};
}

describe("MetricsService.collect — reconciled persons", () => {
	it("populates result.persons via the injected resolver and search API", async () => {
		const service = new MetricsService(
			fakeOctokit() as never,
			undefined,
			undefined,
			createIdentityResolver(map),
		);

		const result = await service.collect({
			organization: { login: "the-org" } as never,
			members: [{ login: "login-x", displayName: "Person X" } as never],
			repositories: [
				{ name: "r1", isPrivate: false, isArchived: false } as never,
			],
			since: "2026-01-01T00:00:00.000Z",
			until: "2026-02-01T00:00:00.000Z",
		});

		expect(result.persons).toBeDefined();
		const x = result.persons?.find((p) => p.person.id === "person-x");
		expect(x).toBeDefined();
		expect(x?.prsMerged).toBe(2);
		expect(x?.prsClosedUnmerged).toBe(0);
		// Legacy per-login members path is untouched and still present.
		expect(Array.isArray(result.members)).toBe(true);
	});
});
