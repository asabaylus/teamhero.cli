import type {
	ReportingWindow,
	ReviewActivity,
	ReviewActivityProvider,
	ReviewActivityResult,
} from "../../core/types.js";
import type { OctokitClient } from "../../lib/octokit.js";

const PAGE_SIZE = 100;
const MAX_SEARCH_RESULTS = 1000;

interface SearchPullRequest {
	number: number;
	user?: { login?: string | null } | null;
	repository_url?: string;
}

function repoParts(item: SearchPullRequest): [string, string] | undefined {
	const full = item.repository_url?.split("/repos/")[1];
	const [owner, repo] = full?.split("/") ?? [];
	return owner && repo ? [owner, repo] : undefined;
}

function isBot(login: string, type?: string): boolean {
	return type === "Bot" || login.endsWith("[bot]");
}

/**
 * Submitted review events. Dismissed reviews remain historical submissions and
 * are counted in the commented bucket because GitHub mutates their current
 * state to DISMISSED while retaining submitted_at.
 */
export class GithubReviewActivityProvider implements ReviewActivityProvider {
	constructor(private readonly octokit: OctokitClient) {}

	async collect(
		organization: string,
		window: ReportingWindow,
	): Promise<ReviewActivityResult> {
		const start = window.startISO.slice(0, 10);
		const end = new Date(new Date(window.endISO).getTime() - 1)
			.toISOString()
			.slice(0, 10);
		const warnings: string[] = [];
		const events: ReviewActivity[] = [];
		let complete = true;
		let searchPage = 1;

		for (;;) {
			let items: SearchPullRequest[];
			try {
				const response = await this.octokit.rest.search.issuesAndPullRequests({
					q: `org:${organization} is:pr updated:${start}..${end}`,
					per_page: PAGE_SIZE,
					page: searchPage,
				});
				const data = response.data as {
					total_count?: number;
					incomplete_results?: boolean;
					items?: SearchPullRequest[];
				};
				items = data.items ?? [];
				if (
					data.incomplete_results ||
					(data.total_count ?? 0) > MAX_SEARCH_RESULTS
				) {
					complete = false;
					warnings.push(
						`GitHub review candidate search was capped or incomplete (${data.total_count ?? "unknown"} PRs).`,
					);
				}
			} catch (error) {
				complete = false;
				warnings.push(
					`GitHub review collection failed: ${(error as Error).message}`,
				);
				break;
			}

			for (const item of items) {
				const parts = repoParts(item);
				if (!parts) continue;
				let reviewPage = 1;
				for (;;) {
					try {
						const response = await this.octokit.rest.pulls.listReviews({
							owner: parts[0],
							repo: parts[1],
							pull_number: item.number,
							per_page: PAGE_SIZE,
							page: reviewPage,
						});
						const reviews = response.data as Array<{
							id?: number;
							user?: { login?: string | null; type?: string } | null;
							submitted_at?: string | null;
							state?: string;
						}>;
						for (const review of reviews) {
							const login = review.user?.login;
							const submittedAt = review.submitted_at;
							if (
								!login ||
								!submittedAt ||
								isBot(login, review.user?.type) ||
								login.toLowerCase() === item.user?.login?.toLowerCase() ||
								submittedAt < window.startISO ||
								submittedAt >= window.endISO
							)
								continue;
							const state = review.state?.toUpperCase();
							events.push({
								login,
								pullRequestAuthor: item.user?.login ?? undefined,
								repository: `${parts[0]}/${parts[1]}`,
								pullNumber: item.number,
								submittedAt,
								state:
									state === "APPROVED"
										? "approved"
										: state === "CHANGES_REQUESTED"
											? "changes-requested"
											: "commented",
							});
						}
						if (reviews.length < PAGE_SIZE) break;
						reviewPage += 1;
					} catch (error) {
						complete = false;
						warnings.push(
							`GitHub reviews failed for ${parts[0]}/${parts[1]}#${item.number}: ${(error as Error).message}`,
						);
						break;
					}
				}
			}
			if (
				items.length < PAGE_SIZE ||
				searchPage * PAGE_SIZE >= MAX_SEARCH_RESULTS
			)
				break;
			searchPage += 1;
		}

		return { events, warnings, complete };
	}
}
