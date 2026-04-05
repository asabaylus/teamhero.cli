import { URL } from "node:url";

export interface CollectLocInput {
	org?: string;
	repos?: string[];
	sinceIso: string;
	untilIso: string;
	token: string;
	maxCommitPages?: number;
	repoDefaultBranches?: Record<string, string>;
	onRepoProgress?: (info: {
		repoFullName: string;
		index: number;
		total: number;
		phase: "commits" | "done";
	}) => void;
}

export interface LocBreakdown {
	additions: number;
	deletions: number;
	commit_count: number;
}

export interface ContributorLocMetrics {
	login: string;
	additions: number;
	deletions: number;
	net: number;
	commit_count: number;
	completed: LocBreakdown;
	inProgress: LocBreakdown;
}

interface GitHubRepoSummary {
	full_name: string;
	archived?: boolean;
	owner: { login: string };
	name: string;
	template?: boolean;
	is_template?: boolean;
	default_branch?: string;
}

interface GitHubBranch {
	name: string;
	commit: { sha: string };
}

interface GitHubCommitStats {
	additions: number;
	deletions: number;
}

interface GitHubCommit {
	sha: string;
	stats?: GitHubCommitStats;
	commit: {
		author: { date: string };
	};
	author: { login: string | null } | null;
}

class FetchPool {
	private active = 0;
	private readonly queue: (() => void)[] = [];

	constructor(private readonly limit: number) {}

	async run<T>(task: () => Promise<T>): Promise<T> {
		if (this.active >= this.limit) {
			await new Promise<void>((resolve) => {
				this.queue.push(resolve);
			});
		}
		this.active += 1;
		try {
			return await task();
		} finally {
			this.active -= 1;
			const next = this.queue.shift();
			if (next) {
				next();
			}
		}
	}
}

const API_ROOT = "https://api.github.com";
const MAX_PER_PAGE = 100;
const RETRYABLE_CODES = new Set([403, 429]);
export const REPO_CONCURRENCY = 3;

const pool = new FetchPool(8);

async function delay(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
	url: string,
	token: string,
	attempt = 1,
): Promise<Response> {
	return await pool.run(async () => {
		const response = await fetch(url, {
			headers: {
				Authorization: `token ${token}`,
				Accept: "application/vnd.github+json",
			},
		});
		if (RETRYABLE_CODES.has(response.status) && attempt < 3) {
			await delay(500 * attempt);
			return await fetchWithRetry(url, token, attempt + 1);
		}
		return response;
	});
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
	const response = await fetchWithRetry(url, token);
	if (!response.ok) {
		throw new Error(`GitHub request failed (${response.status}) for ${url}`);
	}
	return (await response.json()) as T;
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
		commit_count: 0,
		completed: { additions: 0, deletions: 0, commit_count: 0 },
		inProgress: { additions: 0, deletions: 0, commit_count: 0 },
	};
	map.set(login, created);
	return created;
}

function isRepoValid(repo: GitHubRepoSummary): boolean {
	const archived = repo.archived ?? false;
	const template = repo.template ?? repo.is_template ?? false;
	return !archived && !template;
}

function buildPaginatedUrl(base: string, page: number): string {
	const url = new URL(base, API_ROOT);
	url.searchParams.set("per_page", String(MAX_PER_PAGE));
	url.searchParams.set("page", String(page));
	return url.toString();
}

export interface OrgRepoDiscovery {
	repos: string[];
	defaultBranches: Record<string, string>;
}

export async function listOrgRepos(
	org: string,
	token: string,
): Promise<string[]> {
	const { repos } = await discoverOrgRepos(org, token);
	return repos;
}

export async function discoverOrgRepos(
	org: string,
	token: string,
): Promise<OrgRepoDiscovery> {
	const repos: string[] = [];
	const defaultBranches: Record<string, string> = {};
	let page = 1;
	while (true) {
		const url = new URL(`/orgs/${org}/repos`, API_ROOT);
		url.searchParams.set("per_page", String(MAX_PER_PAGE));
		url.searchParams.set("type", "all");
		url.searchParams.set("page", String(page));
		const batch = await fetchJson<GitHubRepoSummary[]>(url.toString(), token);
		if (batch.length === 0) {
			break;
		}
		for (const repo of batch) {
			if (isRepoValid(repo)) {
				const fullName = repo.full_name ?? `${repo.owner.login}/${repo.name}`;
				repos.push(fullName);
				if (repo.default_branch) {
					defaultBranches[fullName] = repo.default_branch;
				}
			}
		}
		if (batch.length < MAX_PER_PAGE) {
			break;
		}
		page += 1;
	}
	return { repos, defaultBranches };
}

export function parseRepoFullName(repo: string): {
	owner: string;
	name: string;
} {
	const [owner, name] = repo.split("/");
	if (!owner || !name) {
		throw new Error(`Invalid repository name: ${repo}`);
	}
	return { owner, name };
}

async function ensureCommitStats(
	owner: string,
	repo: string,
	commit: GitHubCommit,
	token: string,
): Promise<GitHubCommitStats> {
	if (commit.stats) {
		return commit.stats;
	}
	const detailUrl = `${API_ROOT}/repos/${owner}/${repo}/commits/${commit.sha}`;
	const detail = await fetchJson<GitHubCommit>(detailUrl, token);
	if (!detail.stats) {
		return { additions: 0, deletions: 0 };
	}
	return detail.stats;
}

/**
 * Collect commit-based LOC metrics for a single repo from its default branch.
 * All commits on the default branch are classified as "completed".
 * In-progress lines are computed separately from open PRs in report.service.ts.
 */
export async function collectRepoCommits(
	owner: string,
	repo: string,
	token: string,
	sinceIso: string,
	untilIso: string,
	maxPages?: number,
	defaultBranch?: string,
): Promise<Map<string, ContributorLocMetrics>> {
	const metrics = new Map<string, ContributorLocMetrics>();
	const processedShas = new Set<string>();
	const resolvedDefault = defaultBranch ?? "main";

	// Fetch commits only from the default branch — all classified as completed
	const branch: GitHubBranch = { name: resolvedDefault, commit: { sha: "" } };
	await processBranchCommits(
		owner,
		repo,
		token,
		sinceIso,
		untilIso,
		branch,
		maxPages,
		processedShas,
		metrics,
		"completed",
	);

	return metrics;
}

async function processBranchCommits(
	owner: string,
	repo: string,
	token: string,
	sinceIso: string,
	untilIso: string,
	branch: GitHubBranch,
	maxPages: number | undefined,
	processedShas: Set<string>,
	metrics: Map<string, ContributorLocMetrics>,
	classification: "completed" | "inProgress",
): Promise<void> {
	let page = 1;
	let pages = 0;
	while (true) {
		const listUrl = buildPaginatedUrl(
			`/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch.name)}&since=${encodeURIComponent(sinceIso)}&until=${encodeURIComponent(untilIso)}`,
			page,
		);
		const commits = await fetchJson<GitHubCommit[]>(listUrl, token);
		if (commits.length === 0) {
			break;
		}
		pages += 1;

		const statsPromises = commits
			.filter((c) => !processedShas.has(c.sha) && c.author?.login)
			.map(async (commit) => {
				const stats = await ensureCommitStats(owner, repo, commit, token);
				return { commit, stats };
			});
		const results = await Promise.all(statsPromises);

		for (const { commit, stats } of results) {
			if (processedShas.has(commit.sha)) {
				continue;
			}
			processedShas.add(commit.sha);
			const login = commit.author?.login;
			if (!login) {
				continue;
			}
			const contributor = ensureContributor(metrics, login);
			contributor.additions += stats.additions;
			contributor.deletions += stats.deletions;
			contributor.net = contributor.additions - contributor.deletions;
			contributor.commit_count += 1;

			const breakdown = contributor[classification];
			breakdown.additions += stats.additions;
			breakdown.deletions += stats.deletions;
			breakdown.commit_count += 1;
		}

		if (commits.length < MAX_PER_PAGE) {
			break;
		}
		if (typeof maxPages === "number" && pages >= maxPages) {
			break;
		}
		page += 1;
	}
}

function mergeContributor(
	target: ContributorLocMetrics,
	source: ContributorLocMetrics,
): void {
	target.additions += source.additions;
	target.deletions += source.deletions;
	target.net = target.additions - target.deletions;
	target.commit_count += source.commit_count;
	target.completed.additions += source.completed.additions;
	target.completed.deletions += source.completed.deletions;
	target.completed.commit_count += source.completed.commit_count;
	target.inProgress.additions += source.inProgress.additions;
	target.inProgress.deletions += source.inProgress.deletions;
	target.inProgress.commit_count += source.inProgress.commit_count;
}

export async function collectLocMetricsRest(
	input: CollectLocInput,
): Promise<ContributorLocMetrics[]> {
	const { org, repos, sinceIso, untilIso, token } = input;
	if (!org && (!repos || repos.length === 0)) {
		throw new Error("Provide an organization or a list of repositories");
	}
	if (
		Number.isNaN(new Date(sinceIso).getTime()) ||
		Number.isNaN(new Date(untilIso).getTime())
	) {
		throw new Error("Invalid ISO date range provided");
	}

	let targetRepos: string[];
	let defaultBranches = input.repoDefaultBranches ?? {};

	if (repos && repos.length > 0) {
		targetRepos = repos;
	} else {
		const discovery = await discoverOrgRepos(org as string, token);
		targetRepos = discovery.repos;
		defaultBranches = { ...discovery.defaultBranches, ...defaultBranches };
	}

	const merged = new Map<string, ContributorLocMetrics>();
	const total = targetRepos.length;
	let completed = 0;

	// Process repos in parallel batches
	const repoTasks = targetRepos.map((repo) => async () => {
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

		// Merge into global map
		for (const [login, data] of repoMetrics) {
			const existing = merged.get(login);
			if (existing) {
				mergeContributor(existing, data);
			} else {
				merged.set(login, {
					...data,
					completed: { ...data.completed },
					inProgress: { ...data.inProgress },
				});
			}
		}
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

	return Array.from(merged.values()).sort(
		(a, b) => b.net - a.net || a.login.localeCompare(b.login),
	);
}
