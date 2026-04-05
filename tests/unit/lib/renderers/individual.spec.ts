import { describe, expect, it } from "bun:test";
import type { MemberTaskSummary } from "../../../../src/core/types.js";
import { individualRenderer } from "../../../../src/lib/renderers/individual.js";
import type {
	ReportMemberMetrics,
	ReportRenderInput,
} from "../../../../src/lib/report-renderer.js";

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------

const disabledTaskTracker: MemberTaskSummary = {
	status: "disabled",
	tasks: [],
	message: "Integration disabled.",
};

function makeMember(
	overrides: Partial<ReportMemberMetrics> = {},
): ReportMemberMetrics {
	return {
		login: "alice",
		displayName: "Alice Smith",
		commits: 10,
		prsOpened: 3,
		prsClosed: 1,
		prsMerged: 2,
		linesAdded: 500,
		linesDeleted: 100,
		linesAddedInProgress: 0,
		linesDeletedInProgress: 0,
		reviews: 4,
		approvals: 2,
		changesRequested: 1,
		commented: 1,
		reviewComments: 5,
		aiSummary: "Alice delivered key features this week.",
		highlights: [],
		prHighlights: [],
		commitHighlights: [],
		taskTracker: disabledTaskTracker,
		...overrides,
	};
}

function makeInput(
	overrides: Partial<ReportRenderInput> = {},
): ReportRenderInput {
	return {
		schemaVersion: 1,
		orgSlug: "acme",
		generatedAt: "2026-02-28T10:00:00Z",
		filters: {
			includeBots: false,
			excludePrivate: false,
			includeArchived: false,
		},
		showDetails: false,
		window: {
			start: "2026-02-24",
			end: "2026-02-28",
			human: "Feb 24 – Feb 28, 2026",
		},
		totals: { prs: 10, prsMerged: 8, repoCount: 3, contributorCount: 2 },
		memberMetrics: [makeMember()],
		globalHighlights: [],
		metricsDefinition: "Commits include default branch merges",
		archivedNote: "No repos archived.",
		sections: { git: true, taskTracker: true },
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("individualRenderer", () => {
	it("has the correct name and description", () => {
		expect(individualRenderer.name).toBe("individual");
		expect(individualRenderer.description).toBeTruthy();
	});

	describe("single-member mode (options.member provided)", () => {
		it("renders a single member when options.member matches a login", () => {
			const input = makeInput();
			const result = individualRenderer.render(input, { member: "alice" });
			expect(result).toContain("# Individual Report: Alice Smith (@alice)");
			expect(result).toContain("2026-02-24 – 2026-02-28");
		});

		it("matches login case-insensitively", () => {
			const input = makeInput();
			const result = individualRenderer.render(input, { member: "ALICE" });
			expect(result).toContain("# Individual Report: Alice Smith (@alice)");
		});

		it("throws an error with available logins when member is not found", () => {
			const input = makeInput({
				memberMetrics: [
					makeMember({ login: "alice" }),
					makeMember({ login: "bob", displayName: "Bob Jones" }),
				],
			});
			expect(() =>
				individualRenderer.render(input, { member: "charlie" }),
			).toThrow(/charlie.*not found/i);
			expect(() =>
				individualRenderer.render(input, { member: "charlie" }),
			).toThrow(/alice/);
			expect(() =>
				individualRenderer.render(input, { member: "charlie" }),
			).toThrow(/bob/);
		});

		it("renders the metrics table with correct values", () => {
			const input = makeInput({
				memberMetrics: [
					makeMember({
						commits: 7,
						prsOpened: 4,
						prsMerged: 3,
						linesAdded: 800,
						linesDeleted: 200,
						reviews: 5,
					}),
				],
			});
			const result = individualRenderer.render(input, { member: "alice" });
			expect(result).toContain("| Commits | 7 |");
			expect(result).toContain("| PRs Opened | 4 |");
			expect(result).toContain("| PRs Merged | 3 |");
			expect(result).toContain("| Lines Added | 800 |");
			expect(result).toContain("| Lines Deleted | 200 |");
			expect(result).toContain("| Reviews | 5 |");
		});

		it("renders the AI summary", () => {
			const input = makeInput({
				memberMetrics: [
					makeMember({ aiSummary: "Alice shipped the authentication module." }),
				],
			});
			const result = individualRenderer.render(input, { member: "alice" });
			expect(result).toContain("### Summary");
			expect(result).toContain("Alice shipped the authentication module.");
		});

		it("shows task data when completed tasks are available", () => {
			const taskTracker: MemberTaskSummary = {
				status: "matched",
				tasks: [
					{
						gid: "1",
						name: "Implement login flow",
						status: "completed",
						completedAt: "2026-02-26T15:00:00Z",
					},
					{
						gid: "2",
						name: "Write unit tests",
						status: "completed",
						completedAt: "2026-02-27T10:00:00Z",
					},
				],
			};
			const input = makeInput({
				memberMetrics: [makeMember({ taskTracker })],
			});
			const result = individualRenderer.render(input, { member: "alice" });
			expect(result).toContain("### Tasks");
			expect(result).toContain("2 tasks completed");
			expect(result).toContain("- Implement login flow");
			expect(result).toContain("- Write unit tests");
		});

		it("shows in-progress task count when available", () => {
			const taskTracker: MemberTaskSummary = {
				status: "matched",
				tasks: [
					{
						gid: "3",
						name: "Refactor auth service",
						status: "incomplete",
					},
				],
			};
			const input = makeInput({
				memberMetrics: [makeMember({ taskTracker })],
			});
			const result = individualRenderer.render(input, { member: "alice" });
			expect(result).toContain("### Tasks");
			expect(result).toContain("1 task in progress");
		});

		it("shows 'No task tracker data' when tasks are empty", () => {
			const input = makeInput({
				memberMetrics: [makeMember({ taskTracker: disabledTaskTracker })],
			});
			const result = individualRenderer.render(input, { member: "alice" });
			expect(result).toContain("### Tasks");
			expect(result).toContain("No task tracker data for this period.");
		});
	});

	describe("all-members mode (no options.member)", () => {
		it("renders all members as separate sections when no member option is provided", () => {
			const input = makeInput({
				memberMetrics: [
					makeMember({ login: "alice", displayName: "Alice Smith" }),
					makeMember({
						login: "bob",
						displayName: "Bob Jones",
						aiSummary: "Bob reviewed PRs.",
					}),
				],
			});
			const result = individualRenderer.render(input);
			expect(result).toContain("# Individual Report: Alice Smith (@alice)");
			expect(result).toContain("# Individual Report: Bob Jones (@bob)");
		});

		it("separates member sections with a horizontal rule", () => {
			const input = makeInput({
				memberMetrics: [
					makeMember({ login: "alice", displayName: "Alice Smith" }),
					makeMember({
						login: "bob",
						displayName: "Bob Jones",
						aiSummary: "Bob worked on APIs.",
					}),
				],
			});
			const result = individualRenderer.render(input);
			expect(result).toContain("---");
		});

		it("renders a single member correctly with no options", () => {
			const input = makeInput();
			const result = individualRenderer.render(input);
			expect(result).toContain("# Individual Report: Alice Smith (@alice)");
			expect(result).not.toContain("---\n\n");
		});
	});
});
