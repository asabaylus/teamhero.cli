import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";
import { LocCacheStore } from "../adapters/cache/loc-cache.js";
import type { CollectLocInput, ContributorLocMetrics } from "./loc.rest.js";

const API_ROOT = "https://api.github.com";

interface ContributorWeeklyStats {
	w: number; // week start (unix seconds)
	a: number; // additions
	d: number; // deletions
	c: number; // commits
}

interface RepoContributorStats {
	author: { login: string | null } | null;
	total: number;
	weeks: ContributorWeeklyStats[];
}

async function fetchStats(
	owner: string,
	repo: string,
	token: string,
): Promise<Response> {
	const url = new URL(
		`/repos/${owner}/${repo}/stats/contributors`,
		API_ROOT,
	).toString();
	return await fetch(url, {
		headers: {
			Authorization: `token ${token}`,
			Accept: "application/vnd.github+json",
		},
	});
}

async function fetchStatsWithRetry(
	owner: string,
	repo: string,
	token: string,
): Promise<RepoContributorStats[] | null> {
	// GitHub may return 202 while computing stats; retry with backoff.
	const delays = [2000, 4000, 8000];
	for (let attempt = 0; attempt <= delays.length; attempt++) {
		const response = await fetchStats(owner, repo, token);
		if (response.status === 202) {
			if (attempt < delays.length) {
				await delay(delays[attempt]);
				continue;
			}
			return null; // Give up; stats not ready
		}
		if (!response.ok) {
			throw new Error(
				`GitHub stats request failed (${response.status}) for ${owner}/${repo}`,
			);
		}
		const data = (await response.json()) as RepoContributorStats[];
		return data;
	}
	return null;
}

function weekOverlapsRange(
	weekStartUnixSeconds: number,
	since: Date,
	until: Date,
): boolean {
	const start = new Date(weekStartUnixSeconds * 1000);
	const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
	return start <= until && end >= since;
}

function ensureContributor(
	map: Map<string, ContributorLocMetrics>,
	login: string,
): ContributorLocMetrics {
	const existing = map.get(login);
	if (existing) {
		return existing;
	}
	const created: ContributorLocMetrics = {
		login,
		additions: 0,
		deletions: 0,
		net: 0,
		pr_open_count: 0,
		pr_closed_count: 0,
		pr_merged_count: 0,
		direct_commit_count: 0,
	};
	map.set(login, created);
	return created;
}

function addTotals(
	target: ContributorLocMetrics,
	additions: number,
	deletions: number,
): void {
	target.additions += additions;
	target.deletions += deletions;
	target.net = target.additions - target.deletions;
}

function parseRepoFullName(repo: string): { owner: string; name: string } {
	const [owner, name] = repo.split("/");
	if (!owner || !name) {
		throw new Error(`Invalid repository name: ${repo}`);
	}
	return { owner, name };
}

export async function collectLocMetricsStats(
	input: CollectLocInput,
	options?: { useCache?: boolean; cacheStore?: LocCacheStore },
): Promise<ContributorLocMetrics[]> {
	const { repos, org, sinceIso, untilIso, token } = input;
	const since = new Date(sinceIso);
	const until = new Date(untilIso);
	if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
		throw new Error("Invalid ISO date range provided");
	}

	const targetRepos = repos && repos.length > 0 ? repos : [];
	if (targetRepos.length === 0 && !org) {
		// Allow empty repos if it's intentional (return empty result)
		return [];
	}
	const total = targetRepos.length;
	let index = 0;

	const useCache = options?.useCache ?? true;
	const cacheStore = options?.cacheStore ?? new LocCacheStore();
	const metrics = new Map<string, ContributorLocMetrics>();

	for (const repoFull of targetRepos) {
		index += 1;
		const { owner, name } = parseRepoFullName(repoFull);

		let stats: RepoContributorStats[] | null = null;

		// Try cache first
		if (useCache) {
			const cached = await cacheStore.get(owner, name);
			if (cached) {
				stats = cached.stats;
			}
		}

		// Fetch from API if not cached or cache disabled
		if (!stats) {
			input.onRepoProgress?.({
				repoFullName: repoFull,
				index,
				total,
				phase: "pr",
			});
			try {
				stats = await fetchStatsWithRetry(owner, name, token);
			} catch (_error) {
				// Skip repos that fail (e.g., 404, 403, etc.) and continue with others
				input.onRepoProgress?.({
					repoFullName: repoFull,
					index,
					total,
					phase: "done",
				});
				continue;
			}
			if (!stats) {
				// Stats not ready after retries; skip gracefully
				input.onRepoProgress?.({
					repoFullName: repoFull,
					index,
					total,
					phase: "done",
				});
				continue;
			}
			// Cache the fetched stats
			await cacheStore.set(owner, name, stats);
		}

		for (const contributor of stats) {
			const login = contributor.author?.login;
			if (!login) {
				continue;
			}
			const target = ensureContributor(metrics, login);
			for (const week of contributor.weeks) {
				if (!weekOverlapsRange(week.w, since, until)) {
					continue;
				}
				addTotals(target, week.a, week.d);
				target.direct_commit_count += week.c;
			}
		}
		input.onRepoProgress?.({
			repoFullName: repoFull,
			index,
			total,
			phase: "done",
		});
	}

	return Array.from(metrics.values()).sort(
		(a, b) => b.net - a.net || a.login.localeCompare(b.login),
	);
}
