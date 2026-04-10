import { describe, expect, it } from "bun:test";
import type { WeeklyWinsResult } from "../../../src/core/types.js";
import type {
	ReportMemberMetrics,
	ReportRenderInput,
} from "../../../src/lib/report-renderer.js";
import {
	renderReport,
	renderWeeklyWinsSection,
} from "../../../src/lib/report-renderer.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const disabledAsana = {
	status: "disabled" as const,
	tasks: [] as never[],
	message: "Integration disabled.",
};

function makeMember(
	overrides: Partial<ReportMemberMetrics> = {},
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
// renderWeeklyWinsSection (standalone)
// ---------------------------------------------------------------------------

describe("renderWeeklyWinsSection", () => {
	it("renders categories with wins", () => {
		const result: WeeklyWinsResult = {
			categories: [
				{
					category: "AI / Engineering",
					wins: ["Win A", "Win B"],
				},
				{
					category: "DevOps",
					wins: ["Win C"],
				},
			],
		};

		const output = renderWeeklyWinsSection(result);
		expect(output).toContain(
			"## **This Week's Technical / Foundational Wins**",
		);
		expect(output).toContain("* AI / Engineering");
		expect(output).toContain("** Win A");
		expect(output).toContain("** Win B");
		expect(output).toContain("* DevOps");
		expect(output).toContain("** Win C");
	});
});

// ---------------------------------------------------------------------------
// renderReport integration
// ---------------------------------------------------------------------------

describe("renderReport with weeklyWins", () => {
	it("includes weekly wins section when enabled with data", () => {
		const weeklyWins: WeeklyWinsResult = {
			categories: [
				{ category: "Infrastructure", wins: ["Migrated to new CDN"] },
			],
		};
		const input = makeInput({
			sections: { git: true, taskTracker: true, weeklyWins: true },
			weeklyWins,
		});

		const output = renderReport(input);
		expect(output).toContain(
			"## **This Week's Technical / Foundational Wins**",
		);
		expect(output).toContain("* Infrastructure");
		expect(output).toContain("** Migrated to new CDN");
	});

	it("omits weekly wins when section is disabled", () => {
		const weeklyWins: WeeklyWinsResult = {
			categories: [
				{ category: "Infrastructure", wins: ["Migrated to new CDN"] },
			],
		};
		const input = makeInput({
			sections: { git: true, taskTracker: true, weeklyWins: false },
			weeklyWins,
		});

		const output = renderReport(input);
		expect(output).not.toContain("This Week's Technical / Foundational Wins");
	});

	it("omits weekly wins when no categories are present", () => {
		const weeklyWins: WeeklyWinsResult = { categories: [] };
		const input = makeInput({
			sections: { git: true, taskTracker: true, weeklyWins: true },
			weeklyWins,
		});

		const output = renderReport(input);
		expect(output).not.toContain("This Week's Technical / Foundational Wins");
	});

	it("omits weekly wins when weeklyWins data is undefined", () => {
		const input = makeInput({
			sections: { git: true, taskTracker: true, weeklyWins: true },
		});

		const output = renderReport(input);
		expect(output).not.toContain("This Week's Technical / Foundational Wins");
	});

	it("places weekly wins after visible wins and before metrics", () => {
		const weeklyWins: WeeklyWinsResult = {
			categories: [{ category: "Engineering", wins: ["Shipped feature X"] }],
		};
		const input = makeInput({
			sections: { git: true, taskTracker: true, weeklyWins: true },
			weeklyWins,
		});

		const output = renderReport(input);
		const weeklyWinsIdx = output.indexOf(
			"This Week's Technical / Foundational Wins",
		);
		const metricsIdx = output.indexOf("Weekly Engineering Summary");
		expect(weeklyWinsIdx).toBeGreaterThan(-1);
		expect(metricsIdx).toBeGreaterThan(-1);
		expect(weeklyWinsIdx).toBeLessThan(metricsIdx);
	});
});
