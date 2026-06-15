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

function history(
	nodes: ReturnType<typeof node>[],
	hasNextPage: boolean,
	endCursor: string | null,
) {
	return {
		target: { history: { pageInfo: { hasNextPage, endCursor }, nodes } },
	};
}

/**
 * A page returned when NO branch is supplied: the server resolves
 * `defaultBranchRef` (and the `ref` field is skipped, so it's absent).
 */
function defaultBranchPage(
	nodes: ReturnType<typeof node>[],
	hasNextPage = false,
	endCursor: string | null = null,
) {
	return {
		repository: { defaultBranchRef: history(nodes, hasNextPage, endCursor) },
	};
}

/** A page returned when an explicit branch IS supplied (server returns `ref`). */
function providedBranchPage(
	nodes: ReturnType<typeof node>[],
	hasNextPage = false,
	endCursor: string | null = null,
) {
	return { repository: { ref: history(nodes, hasNextPage, endCursor) } };
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

const SINCE = "2026-05-01T00:00:00.000Z";
const UNTIL = "2026-05-08T00:00:00.000Z";

describe("collectRepoCommitsGraphQL", () => {
	it("aggregates additions/deletions per author login in a single query", async () => {
		const { client, graphql } = fakeClient([
			defaultBranchPage([
				node("alice", 10, 2),
				node("bob", 5, 1),
				node("alice", 3, 0),
			]),
		]);

		const result = await collectRepoCommitsGraphQL(
			client,
			"the-org",
			"r1",
			SINCE,
			UNTIL,
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

	it("resolves the default branch server-side when none is supplied", async () => {
		const { client, graphql } = fakeClient([
			defaultBranchPage([node("alice", 7, 0)]),
		]);

		const result = await collectRepoCommitsGraphQL(
			client,
			"the-org",
			"r1",
			SINCE,
			UNTIL,
		);

		// Counts come from defaultBranchRef, not a guessed "main" ref.
		expect(result.get("alice")?.additions).toBe(7);
		const vars = graphql.mock.calls[0]?.[1] as { useProvidedBranch?: boolean };
		expect(vars.useProvidedBranch).toBe(false);
	});

	it("queries the supplied branch as a fully-qualified ref", async () => {
		const { client, graphql } = fakeClient([
			providedBranchPage([node("alice", 4, 0)]),
		]);

		const result = await collectRepoCommitsGraphQL(
			client,
			"the-org",
			"r1",
			SINCE,
			UNTIL,
			undefined,
			"develop",
		);

		expect(result.get("alice")?.additions).toBe(4);
		const vars = graphql.mock.calls[0]?.[1] as {
			branch?: string;
			useProvidedBranch?: boolean;
		};
		expect(vars.branch).toBe("refs/heads/develop");
		expect(vars.useProvidedBranch).toBe(true);
	});

	it("paginates with the cursor until hasNextPage is false", async () => {
		const { client, graphql } = fakeClient([
			defaultBranchPage([node("alice", 10, 0)], true, "CURSOR_1"),
			defaultBranchPage([node("alice", 5, 0)], false, null),
		]);

		const result = await collectRepoCommitsGraphQL(
			client,
			"the-org",
			"r1",
			SINCE,
			UNTIL,
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
			defaultBranchPage([node("alice", 10, 0)], true, "CURSOR_1"),
			defaultBranchPage([node("alice", 5, 0)], true, "CURSOR_2"),
		]);

		const result = await collectRepoCommitsGraphQL(
			client,
			"the-org",
			"r1",
			SINCE,
			UNTIL,
			1, // maxPages
		);

		expect(graphql).toHaveBeenCalledTimes(1);
		expect(result.get("alice")?.additions).toBe(10);
	});

	it("skips commits whose author has no linked GitHub login", async () => {
		const { client } = fakeClient([
			defaultBranchPage([node(null, 999, 999), node("alice", 4, 1)]),
		]);

		const result = await collectRepoCommitsGraphQL(
			client,
			"the-org",
			"r1",
			SINCE,
			UNTIL,
		);

		expect(result.has("alice")).toBe(true);
		expect(result.size).toBe(1); // the unlinked commit contributed nothing
	});

	it("returns an empty map for an empty repo (no resolvable default branch)", async () => {
		const { client, graphql } = fakeClient([
			{ repository: { defaultBranchRef: null } },
		]);

		const result = await collectRepoCommitsGraphQL(
			client,
			"the-org",
			"empty",
			SINCE,
			UNTIL,
		);

		expect(result.size).toBe(0);
		expect(graphql).toHaveBeenCalledTimes(1);
	});
});
