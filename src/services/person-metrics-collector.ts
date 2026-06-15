import { consola } from "consola";
import type { IdentityResolver } from "../core/types.js";
import { isMergeCommit, type RawCommit } from "../lib/commit-attribution.js";
import { resolveEndISO, resolveStartISO } from "../lib/date-utils.js";
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

function errMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
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
	// Normalize the window once, here at the single collection seam, per the
	// date-utils contract: `since`/`until` may arrive as bare YYYY-MM-DD (the CLI
	// weekly path) or as already-resolved ISO (the report path). resolveStartISO/
	// resolveEndISO are idempotent for resolved input, so this is safe either way.
	// The commit bounds get resolveEndISO's +2-day buffer (the Commits API `until`
	// is exclusive and filters by author date, which can fall on the next UTC day
	// for negative-UTC timezones); PR search keeps the raw intended window below.
	const commitSinceISO = resolveStartISO(options.since);
	const commitUntilISO = resolveEndISO(options.until);

	const logins = [
		...new Set(resolver.persons().flatMap((person) => person.logins)),
	];

	// 1. PRs org-wide per login via the search API (authoritative count).
	const prSearchItemsByLogin: Record<string, PrSearchItem[]> = {};
	const maxPages = options.maxSearchPages ?? 10;
	for (const login of logins) {
		// GitHub search `created:` is inclusive on BOTH endpoints, so the PR query
		// must use the user's intended window — never the +2-day commit buffer,
		// which would count PRs created up to two days past the window.
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
		} catch (err) {
			// A search that fails after Octokit's bounded rate-limit retries leaves
			// this login's PRs partially counted. Don't fail the whole run, but log
			// it loudly — a silent skip is exactly how a real 7-PR week reads as 1.
			consola.warn(
				`PR search failed for ${login} (org ${options.org}); its PR count may be undercounted: ${errMessage(err)}`,
			);
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
					since: commitSinceISO,
					until: commitUntilISO,
					per_page: 100,
					page,
				});
				const list = (res.data ?? []) as GitHubCommit[];
				for (const entry of list) {
					commits.push(toRawCommit(entry, `${owner}/${repo}`));
				}
				if (list.length < 100) break;
			}
		} catch (err) {
			// Empty/inaccessible repos (e.g. 409 "Git Repository is empty") are
			// expected and skipped — but log so a wrongly-private or renamed repo,
			// which silently drops every commit, doesn't pass unnoticed.
			consola.warn(`Skipped commits for ${owner}/${repo}: ${errMessage(err)}`);
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
		} catch (err) {
			// Best-effort: a throttled/failed file fetch lowers this commit's LoC but
			// never its (already complete) monthly count. Log at debug so it's
			// recoverable without drowning a large run in per-commit warnings.
			consola.debug(
				`LoC enrichment failed for ${commit.repo}@${commit.oid.slice(0, 7)}: ${errMessage(err)}`,
			);
		}
	}

	return buildPersonMetrics(resolver, { prSearchItemsByLogin, commits });
}
