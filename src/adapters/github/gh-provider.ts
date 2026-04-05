import type { Octokit } from "@octokit/rest";
import type { FetchOptions, RepoProvider } from "../../core/types.js";

function parseMaxRepos(value: unknown, fallback: number): number {
	if (typeof value !== "string" || value.trim().length === 0) {
		return fallback;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return fallback;
	}
	return Math.floor(parsed);
}

export interface GitHubRepoProviderOptions {
	defaultMaxRepos?: number;
}

export class GitHubRepoProvider implements RepoProvider {
	private readonly defaultMaxRepos: number;

	constructor(
		private readonly octokit: Octokit,
		options: GitHubRepoProviderOptions = {},
	) {
		const envDefault = parseMaxRepos(process.env.GITHUB_MAX_REPOSITORIES, 100);
		this.defaultMaxRepos = options.defaultMaxRepos ?? envDefault;
	}

	async listRepositories(
		org: string,
		options: FetchOptions = {},
	): Promise<string[]> {
		const includePrivate = options.includePrivate ?? true;
		const includeArchived = options.includeArchived ?? false;
		const maxRepos = options.maxRepos ?? this.defaultMaxRepos;
		const sortBy = options.sortBy ?? "pushed";

		const type = includePrivate ? "all" : "public";

		const repos = await this.octokit.paginate(
			this.octokit.rest.repos.listForOrg,
			{
				org,
				type,
				per_page: 100,
				sort: sortBy === "name" ? "full_name" : "pushed",
				direction: sortBy === "name" ? "asc" : "desc",
			},
		);

		const filtered = repos.filter((repo) => includeArchived || !repo.archived);

		const sorted = filtered.sort((a, b) => {
			if (sortBy === "name") {
				return a.name.localeCompare(b.name);
			}
			const aTime = a.pushed_at ? new Date(a.pushed_at).getTime() : 0;
			const bTime = b.pushed_at ? new Date(b.pushed_at).getTime() : 0;
			return bTime - aTime;
		});

		return sorted.slice(0, maxRepos).map((repo) => repo.name);
	}
}
