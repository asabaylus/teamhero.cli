import type { MemberTaskSummary, TaskSummary } from "../core/types.js";
import type { ReportMemberMetrics } from "../lib/report-renderer.js";

const MAX_PULL_REQUEST_DETAILS = 25;
const MAX_HIGHLIGHTS_PER_SECTION = 25;
const MAX_TASKS = 20;

function limitWithNotice(
	items: string[],
	limit: number,
	label: string,
): string[] {
	if (items.length <= limit) {
		return [...items];
	}
	const remaining = items.length - limit;
	return [
		...items.slice(0, limit),
		`${remaining} additional ${label} not shown to keep the report concise.`,
	];
}

function limitTasks(tasks: TaskSummary[]): TaskSummary[] {
	if (tasks.length <= MAX_TASKS) {
		return tasks.map((task) => ({ ...task }));
	}
	return tasks.slice(0, MAX_TASKS).map((task) => ({ ...task }));
}

export interface ContributorReportingWindow {
	startISO: string;
	endISO: string;
	human: string;
}

export interface ContributorPullRequest {
	repo: string;
	number: number;
	title: string;
	url: string;
	status: "MERGED" | "OPEN" | "CLOSED";
	mergedAt?: string | null;
	description?: string;
}

export interface ContributorMetricsSnapshot {
	commits: number;
	prsTotal: number;
	prsMerged: number;
	linesAdded: number;
	linesDeleted: number;
	reviews: number;
}

export interface ContributorAsanaStatus {
	status: MemberTaskSummary["status"];
	matchType?: MemberTaskSummary["matchType"];
	message?: string;
	tasks: TaskSummary[];
}

export interface ContributorSummaryUsage {
	promptTokens?: number;
	completionTokens?: number;
	costUsd?: number;
}

export type ContributorSummaryStatus = "pending" | "completed" | "failed";

export interface ContributorSummaryRecord {
	login: string;
	displayName: string;
	status: ContributorSummaryStatus;
	summary?: string;
	error?: string;
	fromCache: boolean;
	usage?: ContributorSummaryUsage;
	payload: ContributorSummaryPayload;
}

export interface ContributorSummaryPayload {
	contributor: {
		login: string;
		displayName: string;
	};
	reportingWindow: ContributorReportingWindow;
	metrics: ContributorMetricsSnapshot;
	pullRequests: ContributorPullRequest[];
	asana: ContributorAsanaStatus;
	highlights: {
		general: string[];
		prs: string[];
		commits: string[];
	};
}

export interface BuildContributorPayloadInput {
	metrics: ReportMemberMetrics;
	window: ContributorReportingWindow;
}

export function buildContributorPayload(
	input: BuildContributorPayloadInput,
): ContributorSummaryPayload {
	const { metrics, window } = input;

	const allPullRequests = metrics.rawPullRequests ?? [];
	const sortedPullRequests = [...allPullRequests].sort((a, b) => {
		const left = a.mergedAt ?? "";
		const right = b.mergedAt ?? "";
		if (left === right) {
			return b.number - a.number;
		}
		return right.localeCompare(left);
	});
	const limitedPullRequests = sortedPullRequests
		.slice(0, MAX_PULL_REQUEST_DETAILS)
		.map(
			(pr) =>
				({
					repo: pr.repoName,
					number: pr.number,
					title: pr.title,
					url: pr.url,
					status: pr.state,
					mergedAt: pr.mergedAt ?? null,
					description: pr.bodyText ?? undefined,
				}) satisfies ContributorPullRequest,
		);

	const asanaSummary =
		metrics.taskTracker ??
		({
			status: "disabled",
			tasks: [],
			message: "Asana integration disabled.",
		} as MemberTaskSummary);

	const asanaTasks = Array.isArray(asanaSummary.tasks)
		? limitTasks(asanaSummary.tasks)
		: [];

	const asanaStatus: ContributorAsanaStatus = {
		status: asanaSummary.status,
		matchType: asanaSummary.matchType,
		message: asanaSummary.message,
		tasks: asanaTasks,
	};

	const generalHighlightsBase = [...metrics.highlights];
	if (allPullRequests.length > MAX_PULL_REQUEST_DETAILS) {
		const remaining = allPullRequests.length - MAX_PULL_REQUEST_DETAILS;
		generalHighlightsBase.unshift(
			`Pull request details truncated: showing ${MAX_PULL_REQUEST_DETAILS} of ${allPullRequests.length}, with ${remaining} additional entries omitted for brevity.`,
		);
	}
	if (
		Array.isArray(asanaSummary.tasks) &&
		asanaSummary.tasks.length > asanaTasks.length
	) {
		const remainingTasks = asanaSummary.tasks.length - asanaTasks.length;
		generalHighlightsBase.unshift(
			`Asana task list truncated: showing ${asanaTasks.length} tasks with ${remainingTasks} additional entries available.`,
		);
	}
	const generalHighlights = limitWithNotice(
		generalHighlightsBase,
		MAX_HIGHLIGHTS_PER_SECTION,
		"highlights",
	);

	const prHighlights = limitWithNotice(
		[...metrics.prHighlights],
		MAX_HIGHLIGHTS_PER_SECTION,
		"PR highlights",
	);
	const commitHighlights = limitWithNotice(
		[...metrics.commitHighlights],
		MAX_HIGHLIGHTS_PER_SECTION,
		"commit highlights",
	);

	const metricsSnapshot: ContributorMetricsSnapshot = {
		commits: metrics.commits,
		prsTotal: metrics.prsOpened,
		prsMerged: metrics.prsMerged,
		linesAdded: metrics.linesAdded,
		linesDeleted: metrics.linesDeleted,
		reviews: metrics.reviews,
	};

	return {
		contributor: {
			login: metrics.login,
			displayName: metrics.displayName,
		},
		reportingWindow: window,
		metrics: metricsSnapshot,
		pullRequests: limitedPullRequests,
		asana: asanaStatus,
		highlights: {
			general: generalHighlights,
			prs: prHighlights,
			commits: commitHighlights,
		},
	};
}
