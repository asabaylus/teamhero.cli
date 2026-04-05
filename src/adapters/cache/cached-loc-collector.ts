/**
 * Caching wrapper for LOC metrics collection — per-repo granularity.
 *
 * Each repo is cached independently under namespace "loc-repo" so adding
 * a new repo only fetches that repo while all previously-cached repos
 * are served from disk.
 *
 * Closed-window optimization: if the reporting window's end date is in the past,
 * LOC cache entries become permanent (commits are immutable once merged).
 */

import type { CacheOptions } from "../../core/types.js";
import { getEnv } from "../../lib/env.js";
import { appendUnifiedLog } from "../../lib/unified-log.js";
import type {
	CollectLocInput,
	ContributorLocMetrics,
} from "../../metrics/loc.rest.js";
import {
	REPO_CONCURRENCY,
	collectLocMetricsRest,
	collectRepoCommits,
	discoverOrgRepos,
	listOrgRepos,
	parseRepoFullName,
} from "../../metrics/loc.rest.js";
import { FileSystemCacheStore, computeCacheHash } from "./fs-cache-store.js";

const DEFAULT_TTL_SECONDS = 4 * 3600; // 4 hours

export class CachedLocCollector {
	private readonly cache: FileSystemCacheStore<ContributorLocMetrics[]>;

	constructor(private readonly cacheOptions: CacheOptions = {}) {
		this.cache = new FileSystemCacheStore({
			namespace: "loc-repo",
			defaultTtlSeconds: DEFAULT_TTL_SECONDS,
		});
	}

	async collect(input: CollectLocInput): Promise<ContributorLocMetrics[]> {
		// Skip caching in test mode — delegate directly
		if (getEnv("TEAMHERO_TEST_MODE")) {
			return collectLocMetricsRest(input);
		}

		const { org, repos, sinceIso, untilIso, token } = input;

		// Resolve target repos and default branches
		let targetRepos: string[];
		let defaultBranches = input.repoDefaultBranches ?? {};

		if (repos && repos.length > 0) {
			targetRepos = repos;
		} else {
			const discovery = await discoverOrgRepos(org as string, token);
			targetRepos = discovery.repos;
			defaultBranches = { ...discovery.defaultBranches, ...defaultBranches };
		}

		const total = targetRepos.length;
		const windowClosed = new Date(untilIso) < new Date();
		const sourceMatch =
			this.cacheOptions.flush ||
			this.cacheOptions.flushSources?.includes("loc");
		const shouldFlush =
			sourceMatch &&
			(!this.cacheOptions.flushSince ||
				sinceIso >= this.cacheOptions.flushSince);

		// Per-repo collection with bounded concurrency
		const perRepoResults: Map<string, ContributorLocMetrics>[] = new Array(
			total,
		);
		let completed = 0;

		const repoTasks = targetRepos.map((repo, idx) => async () => {
			const repoHash = computeCacheHash({
				org: org ?? "",
				repo,
				since: sinceIso,
				until: untilIso,
			});

			// Try cache unless flushing
			if (!shouldFlush) {
				const hit = await this.cache.get(repoHash, {
					permanent: windowClosed,
				});

				if (hit) {
					await appendUnifiedLog({
						timestamp: new Date().toISOString(),
						runId: "",
						category: "cache",
						event: "cache-hit",
						namespace: "loc-repo",
						inputHash: repoHash,
						repo,
					});

					// Convert array back to map for merging
					const map = new Map<string, ContributorLocMetrics>();
					for (const entry of hit) {
						map.set(entry.login, entry);
					}
					perRepoResults[idx] = map;

					completed += 1;
					input.onRepoProgress?.({
						repoFullName: repo,
						index: completed,
						total,
						phase: "done",
					});
					return;
				}
			}

			// Cache miss — fetch from API
			const { owner, name } = parseRepoFullName(repo);
			input.onRepoProgress?.({
				repoFullName: repo,
				index: completed + 1,
				total,
				phase: "commits",
			});

			const repoMetrics = await collectRepoCommits(
				owner,
				name,
				token,
				sinceIso,
				untilIso,
				input.maxCommitPages,
				defaultBranches[repo],
			);

			// Cache the per-repo result as an array
			const asArray = Array.from(repoMetrics.values());
			await this.cache.set(repoHash, asArray);

			await appendUnifiedLog({
				timestamp: new Date().toISOString(),
				runId: "",
				category: "cache",
				event: shouldFlush ? "cache-flush-and-set" : "cache-miss-and-set",
				namespace: "loc-repo",
				inputHash: repoHash,
				repo,
			});

			perRepoResults[idx] = repoMetrics;
			completed += 1;
			input.onRepoProgress?.({
				repoFullName: repo,
				index: completed,
				total,
				phase: "done",
			});
		});

		// Run repos with bounded concurrency
		const running: Promise<void>[] = [];
		for (const task of repoTasks) {
			const p = task().then(() => {
				running.splice(running.indexOf(p), 1);
			});
			running.push(p);
			if (running.length >= REPO_CONCURRENCY) {
				await Promise.race(running);
			}
		}
		await Promise.all(running);

		// Merge all per-repo maps
		const merged = new Map<string, ContributorLocMetrics>();
		for (const repoMap of perRepoResults) {
			if (!repoMap) continue;
			for (const [login, data] of repoMap) {
				const existing = merged.get(login);
				if (existing) {
					existing.additions += data.additions;
					existing.deletions += data.deletions;
					existing.net = existing.additions - existing.deletions;
					existing.commit_count += data.commit_count;
					if (data.completed && existing.completed) {
						existing.completed.additions += data.completed.additions;
						existing.completed.deletions += data.completed.deletions;
						existing.completed.commit_count += data.completed.commit_count;
					}
					if (data.inProgress && existing.inProgress) {
						existing.inProgress.additions += data.inProgress.additions;
						existing.inProgress.deletions += data.inProgress.deletions;
						existing.inProgress.commit_count += data.inProgress.commit_count;
					}
				} else {
					merged.set(login, {
						...data,
						completed: data.completed
							? { ...data.completed }
							: { additions: 0, deletions: 0, commit_count: 0 },
						inProgress: data.inProgress
							? { ...data.inProgress }
							: { additions: 0, deletions: 0, commit_count: 0 },
					});
				}
			}
		}

		return Array.from(merged.values()).sort(
			(a, b) => b.net - a.net || a.login.localeCompare(b.login),
		);
	}
}
