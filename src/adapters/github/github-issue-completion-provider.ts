import type {
	GithubIssueCompletion,
	GithubIssueCompletionProvider,
	GithubIssueCompletionResult,
	ReportingWindow,
} from "../../core/types.js";
import type { OctokitClient } from "../../lib/octokit.js";

const PAGE_SIZE = 100;
const MAX_SEARCH_RESULTS = 1000;

interface SearchIssue {
	number: number;
	closed_at?: string | null;
	closed_by?: { login?: string | null; type?: string } | null;
	repository_url?: string;
}

export class GithubIssueClosedProvider
	implements GithubIssueCompletionProvider
{
	constructor(private readonly octokit: OctokitClient) {}

	async collect(
		organization: string,
		window: ReportingWindow,
	): Promise<GithubIssueCompletionResult> {
		const start = window.startISO.slice(0, 10);
		const end = new Date(new Date(window.endISO).getTime() - 1)
			.toISOString()
			.slice(0, 10);
		const events: GithubIssueCompletion[] = [];
		const warnings: string[] = [];
		let complete = true;
		for (let page = 1; page <= 10; page++) {
			try {
				const response = await this.octokit.rest.search.issuesAndPullRequests({
					q: `org:${organization} is:issue is:closed closed:${start}..${end}`,
					per_page: PAGE_SIZE,
					page,
				});
				const data = response.data as {
					total_count?: number;
					incomplete_results?: boolean;
					items?: SearchIssue[];
				};
				if (
					data.incomplete_results ||
					(data.total_count ?? 0) > MAX_SEARCH_RESULTS
				) {
					complete = false;
					warnings.push(
						`GitHub issue closure search was capped or incomplete (${data.total_count ?? "unknown"} issues).`,
					);
				}
				const items = data.items ?? [];
				for (const item of items) {
					const fullName = item.repository_url?.split("/repos/")[1] ?? "";
					const [owner, repo] = fullName.split("/");
					let closer = item.closed_by;
					if (!closer) {
						if (!owner || !repo) {
							complete = false;
							warnings.push(
								`GitHub issue closer lookup skipped for issue #${item.number}: repository identity missing.`,
							);
							continue;
						}
						try {
							const detail = await this.octokit.rest.issues.get({
								owner,
								repo,
								issue_number: item.number,
							});
							closer = detail.data.closed_by;
						} catch (error) {
							complete = false;
							warnings.push(
								`GitHub issue closer lookup failed for ${fullName}#${item.number}: ${(error as Error).message}`,
							);
							continue;
						}
					}
					const login = closer?.login;
					if (
						!login ||
						!item.closed_at ||
						closer?.type === "Bot" ||
						login.endsWith("[bot]")
					)
						continue;
					events.push({
						login,
						repository: fullName,
						number: item.number,
						closedAt: item.closed_at,
					});
				}
				if (items.length < PAGE_SIZE) break;
			} catch (error) {
				complete = false;
				warnings.push(
					`GitHub issue closure collection failed: ${(error as Error).message}`,
				);
				break;
			}
		}
		return { events, warnings, complete };
	}
}
