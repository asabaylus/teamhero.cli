import { describe, expect, it, mock } from "bun:test";
import {
	collectRepoCommitsGraphQL,
	type GraphqlExecutor,
} from "../../../src/metrics/loc.graphql.js";

/** A single history node in the GraphQL response shape. */
function node(login: string | null, additions: number, deletions: number) {
	return {
		oid: `sha-${login}-${additions}-${deletions}`,
		additions,
		deletions,
		author: { user: login ? { login } : null },
	};
}

/** A `history` page wrapped in the repository → ref → target nesting. */
function page(
	nodes: ReturnType<typeof node>[],
	hasNextPage = false,
	endCursor: string | null = null,
) {
	return {
		repository: {
			ref: {
				target: { history: { pageInfo: { hasNextPage, endCursor }, nodes } },
			},
		},
	};
}

/** A fake client returning the queued pages in order, recording the call args. */
function fakeClient(pages: unknown[]): {
	client: GraphqlExecutor;
	graphql: ReturnType<typeof mock>;
} {
	let i = 0;
	const graphql = mock(async () => pages[Math.min(i++, pages.length - 1)]);
	return { client: { graphql } as unknown as GraphqlExecutor, graphql };
}

describe("collectRepoCommitsGraphQL", () => {
	it("aggregates additions/deletions per author login in a single query", async () => {
		const { client, graphql } = fakeClient([
			page([node("alice", 10, 2), node("bob", 5, 1), node("alice", 3, 0)]),
		]);

		const result = await collectRepoCommitsGraphQL(
			client,
			"the-org",
			"r1",
			"2026-05-01T00:00:00.000Z",
			"2026-05-08T00:00:00.000Z",
		);

		const alice = result.get("alice");
		expect(alice?.additions).toBe(13);
		expect(alice?.deletions).toBe(2);
		expect(alice?.net).toBe(11);
		expect(alice?.commit_count).toBe(2);
		// All default-branch commits classify as completed; in-progress stays zero.
		expect(alice?.completed).toEqual({
			additions: 13,
			deletions: 2,
			commit_count: 2,
		});
		expect(alice?.inProgress).toEqual({
			additions: 0,
			deletions: 0,
			commit_count: 0,
		});
		expect(result.get("bob")?.net).toBe(4);
		// One query for three commits — no per-commit N+1.
		expect(graphql).toHaveBeenCalledTimes(1);
	});

	it("paginates with the cursor until hasNextPage is false", async () => {
		const { client, graphql } = fakeClient([
			page([node("alice", 10, 0)], true, "CURSOR_1"),
			page([node("alice", 5, 0)], false, null),
		]);

		const result = await collectRepoCommitsGraphQL(
			client,
			"the-org",
			"r1",
			"2026-05-01T00:00:00.000Z",
			"2026-05-08T00:00:00.000Z",
		);

		expect(result.get("alice")?.additions).toBe(15);
		expect(result.get("alice")?.commit_count).toBe(2);
		expect(graphql).toHaveBeenCalledTimes(2);
		// The second query carries the first page's endCursor.
		const secondVars = graphql.mock.calls[1]?.[1] as { cursor?: string };
		expect(secondVars.cursor).toBe("CURSOR_1");
		// The first query starts with a null cursor.
		const firstVars = graphql.mock.calls[0]?.[1] as { cursor?: string | null };
		expect(firstVars.cursor).toBeNull();
	});

	it("stops at maxPages even when more pages remain", async () => {
		const { client, graphql } = fakeClient([
			page([node("alice", 10, 0)], true, "CURSOR_1"),
			page([node("alice", 5, 0)], true, "CURSOR_2"),
		]);

		const result = await collectRepoCommitsGraphQL(
			client,
			"the-org",
			"r1",
			"2026-05-01T00:00:00.000Z",
			"2026-05-08T00:00:00.000Z",
			1, // maxPages
		);

		expect(graphql).toHaveBeenCalledTimes(1);
		expect(result.get("alice")?.additions).toBe(10);
	});

	it("skips commits whose author has no linked GitHub login", async () => {
		const { client } = fakeClient([
			page([node(null, 999, 999), node("alice", 4, 1)]),
		]);

		const result = await collectRepoCommitsGraphQL(
			client,
			"the-org",
			"r1",
			"2026-05-01T00:00:00.000Z",
			"2026-05-08T00:00:00.000Z",
		);

		expect(result.has("alice")).toBe(true);
		expect(result.size).toBe(1); // the unlinked commit contributed nothing
	});

	it("returns an empty map for an empty repo (ref resolves to null)", async () => {
		const { client, graphql } = fakeClient([{ repository: { ref: null } }]);

		const result = await collectRepoCommitsGraphQL(
			client,
			"the-org",
			"empty",
			"2026-05-01T00:00:00.000Z",
			"2026-05-08T00:00:00.000Z",
		);

		expect(result.size).toBe(0);
		expect(graphql).toHaveBeenCalledTimes(1);
	});

	it("queries the default branch as a fully-qualified ref", async () => {
		const { client, graphql } = fakeClient([page([])]);

		await collectRepoCommitsGraphQL(
			client,
			"the-org",
			"r1",
			"2026-05-01T00:00:00.000Z",
			"2026-05-08T00:00:00.000Z",
			undefined,
			"develop",
		);

		const vars = graphql.mock.calls[0]?.[1] as { branch?: string };
		expect(vars.branch).toBe("refs/heads/develop");
	});
});
