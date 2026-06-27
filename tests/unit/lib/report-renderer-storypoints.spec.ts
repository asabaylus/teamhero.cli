import { describe, expect, it } from "bun:test";
import {
	type ReportMemberMetrics,
	type ReportRenderInput,
	renderReport,
} from "../../../src/lib/report-renderer.js";

const disabledAsana = {
	status: "disabled" as const,
	tasks: [] as never[],
	message: "Integration disabled.",
};

function makeMember(
	over: Partial<ReportMemberMetrics> = {},
): ReportMemberMetrics {
	return {
		login: "dev1",
		displayName: "Dev One",
		commits: 5,
		prsOpened: 2,
		prsClosed: 0,
		prsMerged: 2,
		linesAdded: 300,
		linesDeleted: 50,
		linesAddedInProgress: 0,
		linesDeletedInProgress: 0,
		reviews: 3,
		approvals: 1,
		changesRequested: 0,
		commented: 2,
		reviewComments: 4,
		aiSummary: "Dev One shipped important work.",
		highlights: [],
		prHighlights: [],
		commitHighlights: [],
		taskTracker: disabledAsana,
		...over,
	};
}

function makeInput(members: ReportMemberMetrics[]): ReportRenderInput {
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
		totals: { prs: 10, prsMerged: 8, repoCount: 3, contributorCount: 1 },
		memberMetrics: members,
		globalHighlights: [],
		metricsDefinition: "x",
		archivedNote: "No repos archived.",
		sections: { git: true, taskTracker: true },
	} as ReportRenderInput;
}

describe("renderReport — Story Points column", () => {
	it("omits the column entirely when no member has story points", () => {
		const out = renderReport(makeInput([makeMember()]));
		expect(out).not.toContain("Story Points");
	});

	it("renders the column in the simple (no in-progress) table variant", () => {
		const out = renderReport(
			makeInput([makeMember({ storyPointsCompleted: 13 })]),
		);
		expect(out).toContain("Story Points |");
		// header has no In-Progress columns
		expect(out).not.toContain("In-Progress +");
		// the value lands on the developer row
		const row = out.split("\n").find((l) => l.startsWith("| Dev One |"));
		expect(row?.endsWith("13 |")).toBe(true);
	});

	it("renders the column in the in-progress table variant", () => {
		const out = renderReport(
			makeInput([
				makeMember({
					storyPointsCompleted: 8,
					linesAddedInProgress: 40,
				}),
			]),
		);
		expect(out).toContain("In-Progress +");
		expect(out).toContain("Story Points |");
		const row = out.split("\n").find((l) => l.startsWith("| Dev One |"));
		expect(row?.endsWith("8 |")).toBe(true);
	});
});
