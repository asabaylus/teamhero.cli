/**
 * GraphQL commit-history collection for code LoC.
 *
 * The REST path needed a per-commit detail call to read additions/deletions
 * (the commits LIST never includes line stats) — an N+1 that exhausts the
 * 5,000-req/hour limit partway through a large org. GraphQL returns
 * `additions`/`deletions` inline on each history node, so one query covers 100
 * commits: ~1 call per 100 commits instead of 1 + N. Same date window, same
 * per-author attribution, same `ContributorLocMetrics` shape as the REST path.
 */

import type { ContributorLocMetrics } from "./loc.rest.js";

/**
 * Minimal structural shape of the dependency we need — the Octokit client's
 * `.graphql()` satisfies it, and tests can inject a fake without a real client.
 */
export interface GraphqlExecutor {
	graphql: <T>(query: string, variables: Record<string, unknown>) => Promise<T>;
}

interface HistoryNode {
	oid: string;
	additions: number;
	deletions: number;
	/** `author.user` is null for commits whose email isn't linked to a GitHub account. */
	author: { user: { login: string | null } | null } | null;
}

interface RefWithHistory {
	target: {
		history: {
			pageInfo: { hasNextPage: boolean; endCursor: string | null };
			nodes: HistoryNode[];
		};
	} | null;
}

interface CommitHistoryResponse {
	repository: {
		/** Present only when an explicit branch was supplied (`@include`). */
		ref?: RefWithHistory | null;
		/** Present only when no branch was supplied (`@skip`); the repo's real default. */
		defaultBranchRef?: RefWithHistory | null;
	} | null;
}

const PER_PAGE = 100;

/** Per-call retry budget for the history query. GitHub's GraphQL endpoint can
 * transiently fail the inline additions/deletions computation for a page that
 * contains a very large commit (a server-side timeout surfaces as a thrown
 * GraphqlResponseError). Without a retry the whole repo is dropped silently and
 * its LoC vanishes from the report. Bounded exponential backoff turns those
 * transient timeouts into a brief wait instead of lost data. */
const HISTORY_QUERY_ATTEMPTS = 3;
const HISTORY_BACKOFF_MS = 500;

async function graphqlHistoryWithRetry<T>(
	client: GraphqlExecutor,
	variables: Record<string, unknown>,
): Promise<T> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= HISTORY_QUERY_ATTEMPTS; attempt++) {
		try {
			return await client.graphql<T>(COMMIT_HISTORY_QUERY, variables);
		} catch (error) {
			lastError = error;
			if (attempt < HISTORY_QUERY_ATTEMPTS) {
				await new Promise((resolve) =>
					setTimeout(resolve, HISTORY_BACKOFF_MS * 2 ** (attempt - 1)),
				);
			}
		}
	}
	throw lastError;
}

// When the caller supplies the branch (the discovery path always does), query it
// directly. When it doesn't, resolve `defaultBranchRef` server-side rather than
// guessing "main" — guessing silently drops every commit for master/develop/etc.
// repos. The @include/@skip directives keep this to ONE history per query (the
// whole point of GraphQL here), and the shared fragment avoids duplicating it.
export const COMMIT_HISTORY_QUERY = `
query CommitHistory($owner: String!, $name: String!, $branch: String!, $useProvidedBranch: Boolean!, $since: GitTimestamp!, $until: GitTimestamp!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    ref(qualifiedName: $branch) @include(if: $useProvidedBranch) {
      target { ...HistoryFields }
    }
    defaultBranchRef @skip(if: $useProvidedBranch) {
      target { ...HistoryFields }
    }
  }
}

fragment HistoryFields on Commit {
  history(since: $since, until: $until, first: ${PER_PAGE}, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      oid
      additions
      deletions
      author { user { login } }
    }
  }
}`;

function ensureContributor(
	map: Map<string, ContributorLocMetrics>,
	login: string,
): ContributorLocMetrics {
	const existing = map.get(login);
	if (existing) return existing;
	const created: ContributorLocMetrics = {
		login,
		additions: 0,
		deletions: 0,
		net: 0,
		commit_count: 0,
		completed: { additions: 0, deletions: 0, commit_count: 0 },
		inProgress: { additions: 0, deletions: 0, commit_count: 0 },
	};
	map.set(login, created);
	return created;
}

/**
 * Collect commit-based LoC for one repo's default branch via GraphQL, bounded by
 * `[sinceIso, untilIso]`. All commits are classified "completed" (in-progress
 * lines come from open PRs elsewhere). When `defaultBranch` is omitted the repo's
 * real `defaultBranchRef` is resolved server-side (never assumed to be "main").
 * An empty repo or unresolvable branch yields an empty map rather than throwing.
 *
 * `maxPages` caps pages (each = {@link PER_PAGE} commits), mirroring the old
 * REST `maxCommitPages`. GraphQL errors (404/403/NOT_FOUND) propagate so the
 * caller can skip-and-log the repo, matching the REST path.
 */
export async function collectRepoCommitsGraphQL(
	client: GraphqlExecutor,
	owner: string,
	repo: string,
	sinceIso: string,
	untilIso: string,
	maxPages?: number,
	defaultBranch?: string,
): Promise<Map<string, ContributorLocMetrics>> {
	const metrics = new Map<string, ContributorLocMetrics>();
	const useProvidedBranch = Boolean(defaultBranch);
	// Placeholder when no branch is supplied: the `ref` field is `@skip`-ed, so
	// `qualifiedName` is never evaluated, but the `String!` variable must be set.
	const branch = defaultBranch ? `refs/heads/${defaultBranch}` : "HEAD";
	let cursor: string | null = null;
	let pages = 0;

	while (true) {
		const data = await graphqlHistoryWithRetry<CommitHistoryResponse>(client, {
			owner,
			name: repo,
			branch,
			useProvidedBranch,
			since: sinceIso,
			until: untilIso,
			cursor,
		});

		const ref = data.repository?.ref ?? data.repository?.defaultBranchRef;
		const history = ref?.target?.history;
		if (!history) break; // empty repo / no resolvable default branch

		for (const node of history.nodes) {
			const login = node.author?.user?.login;
			if (!login) continue; // unlinked author — no GitHub login to attribute to
			const contributor = ensureContributor(metrics, login);
			contributor.additions += node.additions;
			contributor.deletions += node.deletions;
			contributor.net = contributor.additions - contributor.deletions;
			contributor.commit_count += 1;
			contributor.completed.additions += node.additions;
			contributor.completed.deletions += node.deletions;
			contributor.completed.commit_count += 1;
		}

		pages += 1;
		if (!history.pageInfo.hasNextPage) break;
		if (typeof maxPages === "number" && pages >= maxPages) break;
		cursor = history.pageInfo.endCursor;
	}

	return metrics;
}
