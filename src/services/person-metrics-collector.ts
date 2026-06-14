import type { IdentityResolver } from "../core/types.js";
import type { RawCommit } from "../lib/commit-attribution.js";
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
		prSearchItemsByLogin[login] = items;
	}

	// 2. Commits per repo: enumerate, then detail each for file stats + parents.
	const commits: RawCommit[] = [];
	for (const repository of options.repositories) {
		const [owner, repo] = splitRepo(repository.name, options.org);
		for (let page = 1; page <= maxPages; page++) {
			const res = await octokit.rest.repos.listCommits({
				owner,
				repo,
				since: options.since,
				until: options.until,
				per_page: 100,
				page,
			});
			const list = (res.data ?? []) as Array<{ sha: string }>;
			for (const entry of list) {
				const detail = await octokit.rest.repos.getCommit({
					owner,
					repo,
					ref: entry.sha,
				});
				commits.push(
					toRawCommit(detail.data as GitHubCommit, `${owner}/${repo}`),
				);
			}
			if (list.length < 100) break;
		}
	}

	return buildPersonMetrics(resolver, { prSearchItemsByLogin, commits });
}
