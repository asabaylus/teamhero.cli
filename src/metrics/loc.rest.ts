import { URL } from "node:url";
import { consola } from "consola";
import { createOctokitClient, type OctokitClient } from "../lib/octokit.js";
import { collectRepoCommitsGraphQL } from "./loc.graphql.js";

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
const MAX_FETCH_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;
export const REPO_CONCURRENCY = 3;

const pool = new FetchPool(8);

// One Octokit client per token, shared across repos so the throttling/retry
// plugins track a single rate-limit budget. Commit collection goes through this
// client's GraphQL endpoint; org discovery below still uses raw REST fetch.
const clientByToken = new Map<string, Promise<OctokitClient>>();
function octokitForToken(token: string): Promise<OctokitClient> {
	let client = clientByToken.get(token);
	if (!client) {
		client = createOctokitClient({ authToken: token });
		clientByToken.set(token, client);
	}
	return client;
}

async function delay(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Whether a response should be retried. GitHub signals rate limits two ways: a
 * 429, or a 403 with the quota exhausted (`x-ratelimit-remaining: 0`) or a
 * `Retry-After` (the secondary-limit shape). A 403 WITHOUT those markers is a
 * real auth/permission failure — fail fast, never retry. 5xx are transient.
 */
function isRetryable(response: Response): boolean {
	if (response.status === 429 || response.status >= 500) return true;
	if (response.status === 403) {
		return (
			response.headers.get("x-ratelimit-remaining") === "0" ||
			response.headers.has("retry-after")
		);
	}
	return false;
}

/** Wait before the next attempt: honor Retry-After / reset, else exponential backoff. */
function backoffMs(response: Response, attempt: number): number {
	const retryAfter = Number(response.headers.get("retry-after"));
	if (Number.isFinite(retryAfter) && retryAfter > 0) {
		return Math.min(retryAfter * 1000, MAX_BACKOFF_MS);
	}
	if (response.headers.get("x-ratelimit-remaining") === "0") {
		const resetMs = Number(response.headers.get("x-ratelimit-reset")) * 1000;
		const waitMs = resetMs - Date.now();
		if (Number.isFinite(waitMs) && waitMs > 0) {
			return Math.min(waitMs, MAX_BACKOFF_MS);
		}
	}
	return Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

async function fetchWithRetry(url: string, token: string): Promise<Response> {
	// One pool slot held for the whole retry sequence so a backoff never frees a
	// slot for work that would just contend with the request it's backing off for.
	return await pool.run(async () => {
		let response = await fetch(url, {
			headers: {
				Authorization: `token ${token}`,
				Accept: "application/vnd.github+json",
			},
		});
		for (let attempt = 1; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
			if (!isRetryable(response)) return response;
			const wait = backoffMs(response, attempt);
			consola.warn(
				`GitHub ${response.status} for ${url}; retry ${attempt}/${MAX_FETCH_ATTEMPTS - 1} in ${wait}ms.`,
			);
			await delay(wait);
			response = await fetch(url, {
				headers: {
					Authorization: `token ${token}`,
					Accept: "application/vnd.github+json",
				},
			});
		}
		if (isRetryable(response)) {
			consola.error(
				`GitHub ${response.status} for ${url}; exhausted ${MAX_FETCH_ATTEMPTS} attempts — results may be incomplete.`,
			);
		}
		return response;
	});
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
	const response = await fetchWithRetry(url, token);
	if (!response.ok) {
		// 409 means the repository exists but has no commits (empty repo / no default branch).
		// Throw a message that metrics.service.ts recognises as an empty-repo signal.
		if (response.status === 409) {
			throw new Error(`Git Repository is empty for ${url}`);
		}
		throw new Error(`GitHub request failed (${response.status}) for ${url}`);
	}
	return (await response.json()) as T;
}

function isRepoValid(repo: GitHubRepoSummary): boolean {
	const archived = repo.archived ?? false;
	const template = repo.template ?? repo.is_template ?? false;
	return !archived && !template;
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

/**
 * Collect commit-based LoC for a single repo's default branch. All commits are
 * classified "completed" (in-progress lines come from open PRs in
 * report.service.ts). Delegates to the GraphQL collector — one query per 100
 * commits with inline additions/deletions — sharing a per-token Octokit client.
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
	const client = await octokitForToken(token);
	return collectRepoCommitsGraphQL(
		client,
		owner,
		repo,
		sinceIso,
		untilIso,
		maxPages,
		defaultBranch,
	);
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
		let repoMetrics: Map<string, ContributorLocMetrics>;
		try {
			repoMetrics = await collectRepoCommits(
				owner,
				name,
				token,
				sinceIso,
				untilIso,
				input.maxCommitPages,
				defaultBranches[repo],
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			consola.warn(`Skipped ${repo}: ${msg}`);
			completed += 1;
			input.onRepoProgress?.({
				repoFullName: repo,
				index: completed,
				total,
				phase: "done",
			});
			return;
		}

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
