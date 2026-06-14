import type { RawCommit } from "./commit-attribution.js";
import type { PrSearchItem } from "./pr-search.js";

/**
 * Pure mappers from GitHub REST response shapes to the reconciliation cores'
 * input types. Kept separate from the octokit I/O so the parsing is unit-tested
 * without mocking the client. See ADR-0001.
 */

/** Subset of a `search.issuesAndPullRequests` result item we depend on. */
export interface GitHubSearchItem {
	number: number;
	title?: string;
	html_url?: string;
	state?: string;
	pull_request?: { merged_at?: string | null } | null;
	user?: { login?: string } | null;
	repository_url?: string;
}

/** `https://api.github.com/repos/OWNER/REPO` → `OWNER/REPO`. */
function repoFromApiUrl(url?: string): string | undefined {
	if (!url) return undefined;
	const match = /\/repos\/([^/]+\/[^/]+)$/.exec(url);
	return match ? match[1] : undefined;
}

/** Map a search result item to a {@link PrSearchItem} for tallying. */
export function toPrSearchItem(
	item: GitHubSearchItem,
	repo?: string,
): PrSearchItem {
	return {
		authorLogin: item.user?.login ?? "",
		state: item.state === "closed" ? "closed" : "open",
		mergedAt: item.pull_request?.merged_at ?? null,
		number: item.number,
		title: item.title ?? "",
		url: item.html_url ?? "",
		repo: repo ?? repoFromApiUrl(item.repository_url),
	};
}

/** Subset of a `repos.getCommit` / `repos.listCommits` item we depend on. */
export interface GitHubCommit {
	sha: string;
	parents?: unknown[];
	commit?: {
		author?: { name?: string; email?: string; date?: string } | null;
		committer?: { name?: string; email?: string; date?: string } | null;
	} | null;
	files?: Array<{ filename?: string; additions?: number; deletions?: number }>;
}

/** Map a commit (with optional file stats) to a {@link RawCommit}. */
export function toRawCommit(commit: GitHubCommit, repo: string): RawCommit {
	return {
		repo,
		oid: commit.sha,
		authorEmail: commit.commit?.author?.email,
		authorName: commit.commit?.author?.name,
		authoredAtISO: commit.commit?.author?.date ?? "",
		parentCount: commit.parents?.length ?? 0,
		committerEmail: commit.commit?.committer?.email ?? undefined,
		files: commit.files?.map((f) => ({
			path: f.filename ?? "",
			additions: f.additions ?? 0,
			deletions: f.deletions ?? 0,
		})),
	};
}
