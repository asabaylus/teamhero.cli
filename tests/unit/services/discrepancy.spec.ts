/**
 * Tests for AI-powered report audit: discrepancy detection.
 *
 * Tests buildSectionAuditContexts(), verifyMetricCounts(),
 * mapAuditResultToDiscrepancyReport(), and normalizeRule().
 */

import { describe, expect, it } from "bun:test";
import type {
	ContributorDiscrepancy,
	SectionDiscrepancy,
} from "../../../src/core/types.js";
import type {
	ReportMemberMetrics,
	ReportRenderInput,
} from "../../../src/lib/report-renderer.js";

const {
	buildSectionAuditContexts,
	mapAuditResultToDiscrepancyReport,
	normalizeRule,
	verifyMetricCounts,
} = await import(
	new URL(
		"../../../src/services/contributor-discrepancy.service.ts",
		import.meta.url,
	).href
);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeMember(
	overrides: Partial<ReportMemberMetrics> = {},
): ReportMemberMetrics {
	return {
		login: "jdoe",
		displayName: "Jane Doe",
		commits: 5,
		prsOpened: 2,
		prsClosed: 0,
		prsMerged: 1,
		linesAdded: 100,
		linesDeleted: 50,
		linesAddedInProgress: 0,
		linesDeletedInProgress: 0,
		reviews: 3,
		approvals: 1,
		changesRequested: 0,
		commented: 2,
		reviewComments: 1,
		highlights: [],
		prHighlights: [],
		commitHighlights: [],
		aiSummary: "Jane shipped enrollment routing and fixed data quality bugs.",
		taskTracker: {
			status: "matched",
			tasks: [
				{
					gid: "task-001",
					name: "Implement routing",
					status: "completed",
					completedAt: "2026-02-20T12:00:00Z",
				},
			],
		},
		rawPullRequests: [
			{
				repoName: "app",
				number: 441,
				title: "Enrollment routing",
				url: "https://github.com/org/app/pull/441",
				mergedAt: "2026-02-20T10:00:00Z",
				state: "MERGED",
			},
		],
		rawCommits: [
			{
				repoName: "app",
				oid: "abc1234def5678",
				message: "feat: routing logic",
				url: "https://github.com/org/app/commit/abc1234",
				committedAt: "2026-02-19T10:00:00Z",
			},
			{
				repoName: "app",
				oid: "bcd2345efg6789",
				message: "fix: null check",
				url: "https://github.com/org/app/commit/bcd2345",
				committedAt: "2026-02-19T11:00:00Z",
			},
			{
				repoName: "app",
				oid: "cde3456fgh7890",
				message: "test: add routing tests",
				url: "https://github.com/org/app/commit/cde3456",
				committedAt: "2026-02-19T12:00:00Z",
			},
			{
				repoName: "app",
				oid: "def4567ghi8901",
				message: "chore: cleanup",
				url: "https://github.com/org/app/commit/def4567",
				committedAt: "2026-02-19T13:00:00Z",
			},
			{
				repoName: "app",
				oid: "efg5678hij9012",
				message: "fix: data quality",
				url: "https://github.com/org/app/commit/efg5678",
				committedAt: "2026-02-19T14:00:00Z",
			},
		],
		...overrides,
	};
}

function makeReportData(
	overrides: Partial<ReportRenderInput> = {},
	memberOverrides: Partial<ReportMemberMetrics>[] = [{}],
): ReportRenderInput {
	const members = memberOverrides.map((o) => makeMember(o));
	return {
		schemaVersion: 1,
		orgSlug: "test-org",
		generatedAt: "2026-02-28T00:00:00Z",
		filters: {
			includeBots: false,
			excludePrivate: false,
			includeArchived: false,
		},
		showDetails: false,
		window: {
			start: "2026-02-21",
			end: "2026-02-28",
			human: "Feb 21, 2026 – Feb 28, 2026",
		},
		totals: {
			prs: 10,
			prsMerged: 5,
			repoCount: 3,
			contributorCount: members.length,
		},
		memberMetrics: members,
		globalHighlights: [],
		teamHighlight:
			"The team shipped enrollment routing and improved data quality across 3 repos.",
		metricsDefinition: "Test definition",
		archivedNote: "",
		sections: { git: true, taskTracker: true },
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// buildSectionAuditContexts
// ---------------------------------------------------------------------------

describe("buildSectionAuditContexts", () => {
	it("creates a team highlight context from teamHighlight", () => {
		const data = makeReportData();
		const contexts = buildSectionAuditContexts(data);

		const teamCtx = contexts.find((c) => c.sectionName === "teamHighlight");
		expect(teamCtx).toBeDefined();
		expect(teamCtx!.claims).toContain("enrollment routing");
		expect(teamCtx!.evidence).toContain("Jane Doe");
		expect(teamCtx!.contributor).toBeUndefined();
	});

	it("skips team highlight when teamHighlight is empty", () => {
		const data = makeReportData({ teamHighlight: "" });
		const contexts = buildSectionAuditContexts(data);
		expect(
			contexts.find((c) => c.sectionName === "teamHighlight"),
		).toBeUndefined();
	});

	it("creates per-member individual contribution contexts", () => {
		const data = makeReportData({}, [
			{
				login: "alice",
				displayName: "Alice",
				aiSummary: "Alice delivered feature X.",
			},
			{
				login: "bob",
				displayName: "Bob",
				aiSummary: "Bob fixed critical bugs.",
			},
		]);
		const contexts = buildSectionAuditContexts(data);

		const individualCtxs = contexts.filter(
			(c) => c.sectionName === "individualContribution",
		);
		expect(individualCtxs.length).toBe(2);
		expect(individualCtxs[0].contributor).toBe("alice");
		expect(individualCtxs[1].contributor).toBe("bob");
		expect(individualCtxs[0].claims).toContain("Alice delivered feature X");
	});

	it("skips members with no aiSummary", () => {
		const data = makeReportData({}, [{ aiSummary: "" }]);
		const contexts = buildSectionAuditContexts(data);
		const individualCtxs = contexts.filter(
			(c) => c.sectionName === "individualContribution",
		);
		expect(individualCtxs.length).toBe(0);
	});

	it("includes raw PR, commit, and task evidence in individual context", () => {
		const data = makeReportData();
		const contexts = buildSectionAuditContexts(data);
		const ctx = contexts.find(
			(c) => c.sectionName === "individualContribution",
		);

		expect(ctx).toBeDefined();
		expect(ctx!.evidence).toContain("Pull Requests (1 total):");
		expect(ctx!.evidence).toContain("PR #441");
		expect(ctx!.evidence).toContain("Commits (5 total):");
		expect(ctx!.evidence).toContain("abc1234");
		expect(ctx!.evidence).toContain("Implement routing");
	});

	it("includes count headers in evidence sections", () => {
		const data = makeReportData({}, [
			{
				rawPullRequests: [
					{
						repoName: "app",
						number: 1,
						title: "PR 1",
						url: "",
						mergedAt: "",
						state: "MERGED",
					},
					{
						repoName: "app",
						number: 2,
						title: "PR 2",
						url: "",
						mergedAt: "",
						state: "OPEN",
					},
					{
						repoName: "app",
						number: 3,
						title: "PR 3",
						url: "",
						mergedAt: "",
						state: "CLOSED",
					},
				],
				rawCommits: [
					{ repoName: "app", oid: "a", message: "1", url: "", committedAt: "" },
					{ repoName: "app", oid: "b", message: "2", url: "", committedAt: "" },
				],
			},
		]);
		const contexts = buildSectionAuditContexts(data);
		const ctx = contexts.find(
			(c) => c.sectionName === "individualContribution",
		);
		expect(ctx!.evidence).toContain("Pull Requests (3 total):");
		expect(ctx!.evidence).toContain("Commits (2 total):");
	});

	it("adds zero-activity confirmation when member has no GitHub activity", () => {
		const data = makeReportData({}, [
			{
				rawPullRequests: [],
				rawCommits: [],
			},
		]);
		const contexts = buildSectionAuditContexts(data);
		const ctx = contexts.find(
			(c) => c.sectionName === "individualContribution",
		);
		expect(ctx!.evidence).toContain(
			"GitHub: No commits or pull requests found for this contributor in the reporting period.",
		);
	});

	it("adds review count note when git section is enabled", () => {
		const data = makeReportData();
		const contexts = buildSectionAuditContexts(data);
		const ctx = contexts.find(
			(c) => c.sectionName === "individualContribution",
		);
		expect(ctx!.evidence).toContain(
			"Note: Review counts are not tracked via the REST API (reviews=0 is expected and should not be flagged).",
		);
	});

	it("omits GitHub context notes when git section is disabled", () => {
		const data = makeReportData(
			{ sections: { git: false, taskTracker: true } },
			[
				{
					rawPullRequests: [],
					rawCommits: [],
				},
			],
		);
		const contexts = buildSectionAuditContexts(data);
		const ctx = contexts.find(
			(c) => c.sectionName === "individualContribution",
		);
		expect(ctx!.evidence).not.toContain(
			"GitHub: No commits or pull requests found",
		);
		expect(ctx!.evidence).not.toContain("Review counts are not tracked");
	});

	it("creates visible wins context when accomplishments exist", () => {
		const data = makeReportData({
			visibleWins: [
				{
					projectName: "Test Project",
					projectGid: "gid-1",
					bullets: [
						{
							text: "Shipped phase 1",
							subBullets: [],
							sourceDates: [],
							sourceFigures: [],
							sourceNoteFile: "",
						},
					],
				},
			],
		});
		const contexts = buildSectionAuditContexts(data);
		const vwCtx = contexts.find((c) => c.sectionName === "visibleWins");
		expect(vwCtx).toBeDefined();
		expect(vwCtx!.claims).toContain("Shipped phase 1");
	});

	it("includes meeting notes in visible wins evidence", () => {
		const data = makeReportData({
			visibleWins: [
				{
					projectName: "Test Project",
					projectGid: "gid-1",
					bullets: [
						{
							text: "Shipped phase 1",
							subBullets: [],
							sourceDates: [],
							sourceFigures: [],
							sourceNoteFile: "",
						},
					],
				},
			],
		});
		const notes = [
			{
				title: "Weekly Standup",
				date: "2026-02-25",
				attendees: ["Alice"],
				discussionItems: ["Discussed phase 1 deployment"],
				sourceFile: "standup-2026-02-25.md",
			},
		];
		const contexts = buildSectionAuditContexts(data, notes);
		const vwCtx = contexts.find((c) => c.sectionName === "visibleWins");
		expect(vwCtx!.evidence).toContain("Weekly Standup");
		expect(vwCtx!.evidence).toContain("phase 1 deployment");
	});

	it("truncates long evidence fields", () => {
		const longBody = "x".repeat(10000);
		const data = makeReportData({}, [
			{
				rawPullRequests: [
					{
						repoName: "app",
						number: 1,
						title: "Test",
						url: "https://github.com/org/app/pull/1",
						mergedAt: "",
						state: "OPEN",
						bodyText: longBody,
					},
				],
			},
		]);
		const contexts = buildSectionAuditContexts(data);
		const ctx = contexts.find(
			(c) => c.sectionName === "individualContribution",
		);
		// Evidence should be truncated to MAX_EVIDENCE_CHARS (8000)
		expect(ctx!.evidence.length).toBeLessThanOrEqual(8001);
	});
});

// ---------------------------------------------------------------------------
// verifyMetricCounts
// ---------------------------------------------------------------------------

describe("verifyMetricCounts", () => {
	it("returns no discrepancies when counts match", () => {
		const data = makeReportData({}, [
			{
				prsMerged: 1,
				commits: 5,
				rawPullRequests: [
					{
						repoName: "app",
						number: 1,
						title: "PR 1",
						url: "",
						mergedAt: "",
						state: "MERGED",
					},
				],
				rawCommits: [
					{ repoName: "app", oid: "a", message: "1", url: "", committedAt: "" },
					{ repoName: "app", oid: "b", message: "2", url: "", committedAt: "" },
					{ repoName: "app", oid: "c", message: "3", url: "", committedAt: "" },
					{ repoName: "app", oid: "d", message: "4", url: "", committedAt: "" },
					{ repoName: "app", oid: "e", message: "5", url: "", committedAt: "" },
				],
			},
		]);
		const discrepancies = verifyMetricCounts(data);
		expect(discrepancies.length).toBe(0);
	});

	it("detects merged PR count mismatch", () => {
		const data = makeReportData({}, [
			{
				prsMerged: 3, // report says 3 but only 1 MERGED PR in raw data
				rawPullRequests: [
					{
						repoName: "app",
						number: 1,
						title: "PR 1",
						url: "",
						mergedAt: "",
						state: "MERGED",
					},
					{
						repoName: "app",
						number: 2,
						title: "PR 2",
						url: "",
						mergedAt: "",
						state: "OPEN",
					},
				],
			},
		]);
		const discrepancies = verifyMetricCounts(data);
		expect(discrepancies.length).toBe(1);
		expect(discrepancies[0].sectionName).toBe("metrics");
		expect(discrepancies[0].message).toContain("3 merged PRs");
		expect(discrepancies[0].message).toContain("1");
	});

	it("detects commit count mismatch", () => {
		const data = makeReportData({}, [
			{
				commits: 10, // report says 10 but only 2 commits in raw data
				rawCommits: [
					{ repoName: "app", oid: "a", message: "1", url: "", committedAt: "" },
					{ repoName: "app", oid: "b", message: "2", url: "", committedAt: "" },
				],
			},
		]);
		const discrepancies = verifyMetricCounts(data);
		expect(discrepancies.length).toBe(1);
		expect(discrepancies[0].sectionName).toBe("metrics");
		expect(discrepancies[0].message).toContain("10 commits");
	});

	it("skips verification when raw data is absent", () => {
		const data = makeReportData({}, [
			{
				prsMerged: 5,
				commits: 10,
				rawPullRequests: undefined,
				rawCommits: undefined,
			},
		]);
		const discrepancies = verifyMetricCounts(data);
		expect(discrepancies.length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// normalizeRule
// ---------------------------------------------------------------------------

describe("normalizeRule", () => {
	it("passes through rules with existing separator", () => {
		const rule = "Metric mismatch — Report overstates merged PR count.";
		expect(normalizeRule(rule)).toBe(rule);
	});

	it("prepends Audit when separator is missing", () => {
		const rule = "Report overstates merged PR count.";
		expect(normalizeRule(rule)).toBe(
			"Audit — Report overstates merged PR count.",
		);
	});

	it("trims whitespace", () => {
		expect(normalizeRule("  Audit — Foo.  ")).toBe("Audit — Foo.");
	});
});

// ---------------------------------------------------------------------------
// mapAuditResultToDiscrepancyReport
// ---------------------------------------------------------------------------

describe("mapAuditResultToDiscrepancyReport", () => {
	it("converts SectionDiscrepancy to ContributorDiscrepancy and groups by contributor", () => {
		const aiDiscrepancies: SectionDiscrepancy[] = [
			{
				sectionName: "individualContribution",
				contributor: "alice",
				contributorDisplayName: "Alice",
				summary: "Report claims 3 PRs merged",
				explanation: "Raw data shows only 1 merged PR",
				sourceA: { sourceName: "Report", state: "3 PRs merged" },
				sourceB: { sourceName: "GitHub", state: "1 PR merged" },
				suggestedResolution: "Verify metric aggregation",
				confidence: 10,
				rule: "Metric mismatch — Report overstates merged PR count.",
			},
		];

		const report = mapAuditResultToDiscrepancyReport(aiDiscrepancies, [], 0);

		expect(report.totalFilteredCount).toBe(1);
		expect(report.byContributor.has("alice")).toBe(true);
		const items = report.byContributor.get("alice")!;
		expect(items.length).toBe(1);
		expect(items[0].message).toContain("Report claims 3 PRs merged");
		expect(items[0].message).toContain("Raw data shows only 1 merged PR");
		expect(items[0].sectionName).toBe("individualContribution");
	});

	it("places unattributed discrepancies in unattributed bucket", () => {
		const aiDiscrepancies: SectionDiscrepancy[] = [
			{
				sectionName: "teamHighlight",
				summary: "Team highlight claims 10 PRs",
				explanation: "Only 7 PRs in data",
				sourceA: { sourceName: "Report", state: "10 PRs" },
				sourceB: { sourceName: "GitHub", state: "7 PRs" },
				suggestedResolution: "Update team highlight",
				confidence: 40,
				rule: "Metric mismatch — Team highlight overstates PR count.",
			},
		];

		const report = mapAuditResultToDiscrepancyReport(aiDiscrepancies, []);

		expect(report.unattributed.length).toBe(1);
		expect(report.byContributor.size).toBe(0);
	});

	it("combines AI and metric discrepancies", () => {
		const aiDiscrepancies: SectionDiscrepancy[] = [
			{
				sectionName: "individualContribution",
				contributor: "bob",
				contributorDisplayName: "Bob",
				summary: "Sum",
				explanation: "Exp",
				sourceA: { sourceName: "Report", state: "X" },
				sourceB: { sourceName: "GitHub", state: "Y" },
				suggestedResolution: "Fix",
				confidence: 20,
				rule: "Category — Description.",
			},
		];
		const metricDiscrepancies: ContributorDiscrepancy[] = [
			{
				contributor: "bob",
				contributorDisplayName: "Bob",
				sourceA: { sourceName: "Report metrics", state: "prsMerged = 5" },
				sourceB: { sourceName: "GitHub raw data", state: "3 MERGED PRs" },
				suggestedResolution: "Investigate",
				confidence: 5,
				message: "Metric mismatch",
				rule: "Metric mismatch — Report merged PR count differs from raw PR data.",
				sectionName: "metrics",
			},
		];

		const report = mapAuditResultToDiscrepancyReport(
			aiDiscrepancies,
			metricDiscrepancies,
			0,
		);

		expect(report.totalFilteredCount).toBe(2);
		const bobItems = report.byContributor.get("bob")!;
		expect(bobItems.length).toBe(2);
	});

	it("normalizes rules without separator", () => {
		const aiDiscrepancies: SectionDiscrepancy[] = [
			{
				sectionName: "visibleWins",
				summary: "S",
				explanation: "E",
				sourceA: { sourceName: "Report", state: "X" },
				sourceB: { sourceName: "Asana", state: "Y" },
				suggestedResolution: "Fix",
				confidence: 40,
				rule: "Date is wrong in bullet.",
			},
		];

		const report = mapAuditResultToDiscrepancyReport(aiDiscrepancies, []);
		expect(report.unattributed[0].rule).toBe(
			"Audit — Date is wrong in bullet.",
		);
	});

	it("filters items below the confidence threshold", () => {
		const aiDiscrepancies: SectionDiscrepancy[] = [
			{
				sectionName: "individualContribution",
				contributor: "alice",
				contributorDisplayName: "Alice",
				summary: "High confidence",
				explanation: "Clear mismatch",
				sourceA: { sourceName: "Report", state: "X" },
				sourceB: { sourceName: "GitHub", state: "Y" },
				suggestedResolution: "Fix",
				confidence: 85,
				rule: "Metric — High.",
			},
			{
				sectionName: "individualContribution",
				contributor: "bob",
				contributorDisplayName: "Bob",
				summary: "Low confidence",
				explanation: "Marginal",
				sourceA: { sourceName: "Report", state: "A" },
				sourceB: { sourceName: "GitHub", state: "B" },
				suggestedResolution: "Investigate",
				confidence: 40,
				rule: "Metric — Low.",
			},
			{
				sectionName: "teamHighlight",
				summary: "Below threshold unattributed",
				explanation: "Minor",
				sourceA: { sourceName: "Report", state: "M" },
				sourceB: { sourceName: "GitHub", state: "N" },
				suggestedResolution: "Check",
				confidence: 20,
				rule: "Audit — Minor.",
			},
		];

		const report = mapAuditResultToDiscrepancyReport(aiDiscrepancies, [], 70);

		// Only Alice's item (confidence 85) passes the 70% threshold
		expect(report.totalFilteredCount).toBe(1);
		expect(report.totalRawCount).toBe(3);
		expect(report.byContributor.has("alice")).toBe(true);
		expect(report.byContributor.has("bob")).toBe(false);
		expect(report.unattributed.length).toBe(0);
		expect(report.discrepancyThreshold).toBe(70);

		// allItems still contains everything (for TUI display)
		expect(report.allItems.length).toBe(3);
	});

	it("uses default threshold of 30 when not specified", () => {
		const aiDiscrepancies: SectionDiscrepancy[] = [
			{
				sectionName: "individualContribution",
				contributor: "alice",
				contributorDisplayName: "Alice",
				summary: "Above default",
				explanation: "OK",
				sourceA: { sourceName: "Report", state: "X" },
				sourceB: { sourceName: "GitHub", state: "Y" },
				suggestedResolution: "Fix",
				confidence: 35,
				rule: "Metric — Above.",
			},
			{
				sectionName: "individualContribution",
				contributor: "bob",
				contributorDisplayName: "Bob",
				summary: "Below default",
				explanation: "Low",
				sourceA: { sourceName: "Report", state: "A" },
				sourceB: { sourceName: "GitHub", state: "B" },
				suggestedResolution: "Skip",
				confidence: 25,
				rule: "Metric — Below.",
			},
		];

		// No threshold arg → default of 30
		const report = mapAuditResultToDiscrepancyReport(aiDiscrepancies, []);

		expect(report.totalFilteredCount).toBe(1);
		expect(report.byContributor.has("alice")).toBe(true);
		expect(report.byContributor.has("bob")).toBe(false);
		expect(report.discrepancyThreshold).toBe(30);
	});

	it("synthesizes message from summary and explanation", () => {
		const aiDiscrepancies: SectionDiscrepancy[] = [
			{
				sectionName: "individualContribution",
				contributor: "charlie",
				contributorDisplayName: "Charlie",
				summary: "PR count inflated",
				explanation: "Report says 5 but only 2 exist",
				sourceA: { sourceName: "Report", state: "5 PRs" },
				sourceB: { sourceName: "GitHub", state: "2 PRs" },
				suggestedResolution: "Fix count",
				confidence: 10,
				rule: "Metric — Inflated count.",
			},
		];

		const report = mapAuditResultToDiscrepancyReport(aiDiscrepancies, [], 0);
		const item = report.byContributor.get("charlie")![0];
		expect(item.message).toBe(
			"PR count inflated\nReport says 5 but only 2 exist",
		);
	});
});
