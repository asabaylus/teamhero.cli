import { describe, expect, it } from "bun:test";
import type { ReportMemberMetrics } from "../../../src/lib/report-renderer.js";
import type { ContributorReportingWindow } from "../../../src/models/individual-summary.js";
import { IndividualActivityService } from "../../../src/services/individual-activity.service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWindow(): ContributorReportingWindow {
	return {
		startISO: "2026-02-24T00:00:00Z",
		endISO: "2026-02-28T23:59:59Z",
		human: "Feb 24 - Feb 28, 2026",
	};
}

function makeMember(
	overrides: Partial<ReportMemberMetrics> = {},
): ReportMemberMetrics {
	return {
		login: "alice",
		displayName: "Alice A",
		commits: 5,
		prsOpened: 3,
		prsClosed: 1,
		prsMerged: 2,
		prsTotal: 3, // pre-existing type quirk used by buildContributorPayload
		linesAdded: 200,
		linesDeleted: 50,
		reviews: 4,
		approvals: 2,
		changesRequested: 1,
		commented: 1,
		reviewComments: 3,
		aiSummary: "",
		highlights: ["Shipped feature X"],
		prHighlights: ["Merged PR #10"],
		commitHighlights: ["Cleaned up logging"],
		taskTracker: {
			status: "matched",
			tasks: [
				{
					gid: "task-1",
					name: "Fix bug",
					status: "completed",
					completedAt: "2026-02-26T10:00:00Z",
				},
			],
		},
		rawPullRequests: [
			{
				repoName: "api",
				number: 10,
				title: "Add endpoint",
				url: "https://github.com/org/api/pull/10",
				mergedAt: "2026-02-25T12:00:00Z",
				state: "MERGED",
			},
		],
		rawCommits: [
			{
				repoName: "api",
				oid: "abc123",
				message: "fix: cleanup",
				url: "https://github.com/org/api/commit/abc123",
				committedAt: "2026-02-25T10:00:00Z",
			},
		],
		...overrides,
	} as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IndividualActivityService", () => {
	describe("buildContributorPayloads", () => {
		it("returns empty array for empty members", () => {
			const service = new IndividualActivityService();
			const result = service.buildContributorPayloads({
				members: [],
				window: makeWindow(),
			});
			expect(result).toEqual([]);
		});

		it("returns one payload per member", () => {
			const service = new IndividualActivityService();
			const members = [
				makeMember({ login: "alice", displayName: "Alice" }),
				makeMember({ login: "bob", displayName: "Bob" }),
				makeMember({ login: "charlie", displayName: "Charlie" }),
			];
			const result = service.buildContributorPayloads({
				members,
				window: makeWindow(),
			});
			expect(result).toHaveLength(3);
		});

		it("maps logins 1:1 from members to payloads", () => {
			const service = new IndividualActivityService();
			const members = [
				makeMember({ login: "alice" }),
				makeMember({ login: "bob" }),
			];
			const result = service.buildContributorPayloads({
				members,
				window: makeWindow(),
			});

			expect(result.map((p) => p.contributor.login)).toEqual(["alice", "bob"]);
		});

		it("produces payload with correct contributor info", () => {
			const service = new IndividualActivityService();
			const result = service.buildContributorPayloads({
				members: [makeMember({ login: "alice", displayName: "Alice A" })],
				window: makeWindow(),
			});
			const payload = result[0];

			expect(payload.contributor).toEqual({
				login: "alice",
				displayName: "Alice A",
			});
		});

		it("includes reporting window in payload", () => {
			const service = new IndividualActivityService();
			const window = makeWindow();
			const result = service.buildContributorPayloads({
				members: [makeMember()],
				window,
			});

			expect(result[0].reportingWindow).toEqual(window);
		});

		it("includes metrics snapshot in payload", () => {
			const service = new IndividualActivityService();
			const result = service.buildContributorPayloads({
				members: [
					makeMember({
						commits: 10,
						prsMerged: 3,
						linesAdded: 500,
						linesDeleted: 100,
						reviews: 7,
					}),
				],
				window: makeWindow(),
			});
			const metrics = result[0].metrics;

			expect(metrics.commits).toBe(10);
			expect(metrics.prsMerged).toBe(3);
			expect(metrics.linesAdded).toBe(500);
			expect(metrics.linesDeleted).toBe(100);
			expect(metrics.reviews).toBe(7);
		});

		it("includes pull request details in payload", () => {
			const service = new IndividualActivityService();
			const result = service.buildContributorPayloads({
				members: [makeMember()],
				window: makeWindow(),
			});
			const prs = result[0].pullRequests;

			expect(prs).toHaveLength(1);
			expect(prs[0]).toEqual(
				expect.objectContaining({
					repo: "api",
					number: 10,
					title: "Add endpoint",
					status: "MERGED",
				}),
			);
		});

		it("includes Asana status in payload", () => {
			const service = new IndividualActivityService();
			const result = service.buildContributorPayloads({
				members: [makeMember()],
				window: makeWindow(),
			});

			expect(result[0].asana.status).toBe("matched");
			expect(result[0].asana.tasks).toHaveLength(1);
		});

		it("includes highlights in payload", () => {
			const service = new IndividualActivityService();
			const result = service.buildContributorPayloads({
				members: [
					makeMember({
						highlights: ["Did great work"],
						prHighlights: ["Merged big PR"],
						commitHighlights: ["Fixed tests"],
					}),
				],
				window: makeWindow(),
			});
			const highlights = result[0].highlights;

			expect(highlights.general).toContain("Did great work");
			expect(highlights.prs).toContain("Merged big PR");
			expect(highlights.commits).toContain("Fixed tests");
		});

		it("handles member with no raw pull requests", () => {
			const service = new IndividualActivityService();
			const result = service.buildContributorPayloads({
				members: [makeMember({ rawPullRequests: undefined })],
				window: makeWindow(),
			});

			expect(result[0].pullRequests).toEqual([]);
		});

		it("handles member with disabled task tracker", () => {
			const service = new IndividualActivityService();
			const result = service.buildContributorPayloads({
				members: [
					makeMember({
						taskTracker: undefined as any,
					}),
				],
				window: makeWindow(),
			});

			expect(result[0].asana.status).toBe("disabled");
		});
	});
});
