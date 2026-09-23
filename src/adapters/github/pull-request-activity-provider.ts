import type {
	PullRequestActivity,
	PullRequestActivityProvider,
	PullRequestActivityResult,
	ReportingWindow,
} from "../../core/types.js";
import type { OctokitClient } from "../../lib/octokit.js";

const PAGE_SIZE = 100;
const MAX_SEARCH_RESULTS = 1000;

interface SearchItem {
	number: number;
	html_url?: string;
	user?: { login?: string | null; type?: string } | null;
	created_at?: string | null;
	closed_at?: string | null;
	pull_request?: { merged_at?: string | null } | null;
	repository_url?: string;
}

function day(value: string): string {
	return value.slice(0, 10);
}

function inclusiveEndDay(exclusiveEnd: string): string {
	return new Date(new Date(exclusiveEnd).getTime() - 1)
		.toISOString()
		.slice(0, 10);
}

function repository(item: SearchItem): string {
	return item.repository_url?.split("/repos/")[1] ?? "";
}

function isBot(item: SearchItem): boolean {
	const login = item.user?.login ?? "";
	return item.user?.type === "Bot" || login.endsWith("[bot]");
}

/** Org-wide, event-timed PR activity. Each column is queried by its own date. */
export class GithubPullRequestActivityProvider
	implements PullRequestActivityProvider
{
	constructor(private readonly octokit: OctokitClient) {}

	async collect(
		organization: string,
		window: ReportingWindow,
	): Promise<PullRequestActivityResult> {
		const start = day(window.startISO);
		const end = inclusiveEndDay(window.endISO);
		const definitions = [
			{
				event: "opened" as const,
				query: `org:${organization} is:pr created:${start}..${end}`,
				timestamp: (item: SearchItem) => item.created_at,
			},
			{
				event: "merged" as const,
				query: `org:${organization} is:pr is:merged merged:${start}..${end}`,
				timestamp: (item: SearchItem) => item.pull_request?.merged_at,
			},
			{
				event: "closed-unmerged" as const,
				query: `org:${organization} is:pr is:closed is:unmerged closed:${start}..${end}`,
				timestamp: (item: SearchItem) => item.closed_at,
			},
		];
		const events: PullRequestActivity[] = [];
		const warnings: string[] = [];
		let complete = true;

		for (const definition of definitions) {
			let page = 1;
			for (;;) {
				try {
					const response = await this.octokit.rest.search.issuesAndPullRequests(
						{
							q: definition.query,
							per_page: PAGE_SIZE,
							page,
						},
					);
					const data = response.data as {
						total_count?: number;
						incomplete_results?: boolean;
						items?: SearchItem[];
					};
					if (
						data.incomplete_results ||
						(data.total_count ?? 0) > MAX_SEARCH_RESULTS
					) {
						complete = false;
						warnings.push(
							`GitHub PR ${definition.event} search was capped or incomplete (${data.total_count ?? "unknown"} matches).`,
						);
					}
					const items = data.items ?? [];
					for (const item of items) {
						const login = item.user?.login;
						const occurredAt = definition.timestamp(item);
						if (!login || !occurredAt || isBot(item)) continue;
						events.push({
							login,
							repository: repository(item),
							number: item.number,
							event: definition.event,
							occurredAt,
						});
					}
					if (
						items.length < PAGE_SIZE ||
						page * PAGE_SIZE >= MAX_SEARCH_RESULTS
					)
						break;
					page += 1;
				} catch (error) {
					complete = false;
					warnings.push(
						`GitHub PR ${definition.event} collection failed: ${(error as Error).message}`,
					);
					break;
				}
			}
		}
		return { events, warnings, complete };
	}
}
