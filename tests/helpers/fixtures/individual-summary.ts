import type { ReportMemberMetrics } from "../../../src/lib/report-renderer.js";
import type {
	AsanaTaskSummary,
	MemberAsanaSummary,
} from "../../../src/models/asana.js";

export interface ReportingWindowFixture {
	startISO: string;
	endISO: string;
	human: string;
}

export function buildReportingWindowFixture(
	overrides: Partial<ReportingWindowFixture> = {},
): ReportingWindowFixture {
	return {
		startISO: "2025-09-15T00:00:00Z",
		endISO: "2025-09-21T23:59:59Z",
		human: "15 Sep 2025 – 21 Sep 2025",
		...overrides,
	};
}

export function buildAsanaTaskSummaryFixture(
	overrides: Partial<AsanaTaskSummary> = {},
): AsanaTaskSummary {
	return {
		gid: "task-123",
		name: "Ship reporting improvements",
		status: "completed",
		completedAt: "2025-09-18T12:34:00Z",
		dueOn: "2025-09-19",
		dueAt: null,
		permalinkUrl: "https://app.asana.com/0/123/task/123",
		description: "Publish contributor updates",
		comments: ["Coordinated with design"],
		...overrides,
	};
}

export function buildMemberAsanaSummaryFixture(
	overrides: Partial<MemberAsanaSummary> = {},
): MemberAsanaSummary {
	return {
		status: "matched",
		matchType: "email",
		tasks: [buildAsanaTaskSummaryFixture()],
		message: undefined,
		...overrides,
	};
}

export function buildMemberMetricsFixture(
	overrides: Partial<ReportMemberMetrics> = {},
): ReportMemberMetrics {
	return {
		login: "jane.doe",
		displayName: "Jane Doe",
		commits: 4,
		prsOpened: 2,
		prsMerged: 1,
		linesAdded: 420,
		linesDeleted: 137,
		linesAddedInProgress: 0,
		linesDeletedInProgress: 0,
		reviews: 3,
		approvals: 2,
		changesRequested: 0,
		commented: 1,
		reviewComments: 5,
		aiSummary: "",
		highlights: ["Merged API improvements"],
		prHighlights: [],
		commitHighlights: [],
		taskTracker: buildMemberAsanaSummaryFixture(),
		rawPullRequests: [
			{
				repoName: "teamhero/cli",
				number: 42,
				title: "Improve report cache",
				url: "https://github.com/teamhero/cli/pull/42",
				mergedAt: "2025-09-18T16:45:00Z",
				state: "MERGED",
				bodyText: "Adds weekly summary caching",
			},
			{
				repoName: "teamhero/cli",
				number: 43,
				title: "Draft contributor workflow",
				url: "https://github.com/teamhero/cli/pull/43",
				mergedAt: "",
				state: "OPEN",
				bodyText: "Introduces summarizer playground",
			},
		],
		rawCommits: [
			{
				repoName: "teamhero/cli",
				oid: "abc123",
				message: "Refine contributor payload",
				url: "https://github.com/teamhero/cli/commit/abc123",
				committedAt: "2025-09-17T10:00:00Z",
			},
		],
		...overrides,
	};
}
