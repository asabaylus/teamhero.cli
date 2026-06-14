import type { IdentityResolver } from "../core/types.js";
import { isMergeCommit, type RawCommit } from "../lib/commit-attribution.js";
import {
	type GitHubCommit,
	type GitHubSearchItem,
	toPrSearchItem,
	toRawCommit,
} from "../lib/github-mappers.js";
import type { OctokitClient } from "../lib/octokit.js";
import {
	buildPersonMetrics,
	type PersonMetricsResult,
} from "../lib/person-metrics.js";
import { buildPrSearchQuery, type PrSearchItem } from "../lib/pr-search.js";

/**
 * Fetch the reconciled-metrics inputs from GitHub and delegate to the pure
 * {@link buildPersonMetrics} aggregator. PRs come org-wide from the search API
 * per login; commits are enumerated per repo and detailed for file stats. This
 * is the thin I/O seam — all logic lives in the pure cores. See ADR-0001.
 */
export interface CollectPersonMetricsOptions {
	org: string;
	repositories: { name: string }[];
	since: string;
	until: string;
	/** Safety cap on search pages per login (default 10 × 100 = 1000 PRs). */
	maxSearchPages?: number;
}

function splitRepo(fullName: string, org: string): [string, string] {
	const idx = fullName.indexOf("/");
	if (idx > 0) return [fullName.slice(0, idx), fullName.slice(idx + 1)];
	return [org, fullName];
}

export async function collectPersonMetrics(
	octokit: OctokitClient,
	resolver: IdentityResolver,
	options: CollectPersonMetricsOptions,
): Promise<PersonMetricsResult> {
	// With no identity map there are no Persons to attribute to, so skip all
	// fetching — reconciliation is a no-op rather than an expensive walk that
	// resolves nothing. (Also keeps reconciliation from adding GitHub calls in
	// environments without the gitignored local map.)
	if (resolver.persons().length === 0) {
		return { persons: [], unmappedCommits: [] };
	}

	const logins = [
		...new Set(resolver.persons().flatMap((person) => person.logins)),
	];

	// 1. PRs org-wide per login via the search API (authoritative count).
	const prSearchItemsByLogin: Record<string, PrSearchItem[]> = {};
	const maxPages = options.maxSearchPages ?? 10;
	for (const login of logins) {
		const q = buildPrSearchQuery({
			login,
			org: options.org,
			startISO: options.since,
			endISO: options.until,
		});
		const items: PrSearchItem[] = [];
		try {
			for (let page = 1; page <= maxPages; page++) {
				const res = await octokit.rest.search.issuesAndPullRequests({
					q,
					per_page: 100,
					page,
				});
				const pageItems = (res.data?.items ?? []) as GitHubSearchItem[];
				for (const item of pageItems) items.push(toPrSearchItem(item));
				if (pageItems.length < 100) break;
			}
		} catch {
			// Skip a login whose search failed (rate limit / transient) — partial
			// counts beat failing the whole reconciliation.
		}
		prSearchItemsByLogin[login] = items;
	}

	// 2. Commits per repo via listCommits ONLY. The list payload already carries
	//    author email/name, date, and parents — enough for attribution, monthly
	//    counts, and merge exclusion — at one cheap call per page. (Empty or
	//    inaccessible repos, e.g. 409 "Git Repository is empty", are skipped.)
	const commits: RawCommit[] = [];
	for (const repository of options.repositories) {
		const [owner, repo] = splitRepo(repository.name, options.org);
		try {
			for (let page = 1; page <= maxPages; page++) {
				const res = await octokit.rest.repos.listCommits({
					owner,
					repo,
					since: options.since,
					until: options.until,
					per_page: 100,
					page,
				});
				const list = (res.data ?? []) as GitHubCommit[];
				for (const entry of list) {
					commits.push(toRawCommit(entry, `${owner}/${repo}`));
				}
				if (list.length < 100) break;
			}
		} catch {
			// Skip an empty or inaccessible repo.
		}
	}

	// 3. LoC enrichment: per-file stats need getCommit (N+1), the only step that
	//    can hit GitHub secondary rate limits. Restrict it to non-merge commits
	//    that actually attribute to a Person, and treat failures as best-effort —
	//    so a throttled/incomplete file fetch lowers LoC but never the (already
	//    complete) monthly commit counts.
	for (const commit of commits) {
		if (isMergeCommit(commit)) continue;
		const resolution = resolver.resolve({
			email: commit.authorEmail,
			name: commit.authorName,
		});
		if (resolution.type !== "resolved") continue;
		const [owner, repo] = splitRepo(commit.repo, options.org);
		try {
			const detail = await octokit.rest.repos.getCommit({
				owner,
				repo,
				ref: commit.oid,
			});
			commit.files = toRawCommit(
				detail.data as GitHubCommit,
				commit.repo,
			).files;
		} catch {
			// Leave this commit's LoC unfetched (best-effort).
		}
	}

	return buildPersonMetrics(resolver, { prSearchItemsByLogin, commits });
}
