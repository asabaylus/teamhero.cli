import { describe, expect, it } from "bun:test";
import type { ReportRenderInput } from "../../../src/lib/report-renderer.js";
import type {
	ProjectAccomplishment,
	ProjectTask,
} from "../../../src/models/visible-wins.js";

const { renderReport } = await import(
	new URL("../../../src/lib/report-renderer.ts", import.meta.url).href
);

function makeBaseInput(): ReportRenderInput {
	return {
		schemaVersion: 1,
		orgSlug: "acme",
		orgName: "Acme",
		generatedAt: "2026-02-01T00:00:00Z",
		filters: {
			includeBots: false,
			excludePrivate: false,
			includeArchived: false,
		},
		showDetails: false,
		window: { start: "2026-01-25", end: "2026-02-01", human: "Jan 25 - Feb 1" },
		totals: { prs: 10, prsMerged: 8, repoCount: 5, contributorCount: 3 },
		memberMetrics: [],
		globalHighlights: [],
		teamHighlight: "Team did great work this week.",
		metricsDefinition: "Standard metrics.",
		archivedNote: "",
		sections: { git: true, taskTracker: false },
	};
}

function makeAccomplishment(
	overrides: Partial<ProjectAccomplishment> = {},
): ProjectAccomplishment {
	return {
		projectName: "Dashboard",
		projectGid: "gid-1",
		bullets: [
			{
				text: "Completed dashboard redesign",
				subBullets: ["Migrated rendering"],
				sourceDates: ["2026-01-28"],
				sourceFigures: ["40%"],
				sourceNoteFile: "standup.md",
			},
		],
		...overrides,
	};
}

function makeProject(overrides: Partial<ProjectTask> = {}): ProjectTask {
	return {
		name: "Dashboard",
		gid: "gid-1",
		customFields: {},
		priorityScore: 80,
		...overrides,
	};
}

describe("renderReport with Visible Wins", () => {
	it("includes visible wins section when data is present", () => {
		const input = makeBaseInput();
		input.visibleWins = [makeAccomplishment()];
		input.visibleWinsProjects = [makeProject()];

		const output = renderReport(input);

		expect(output).toContain("This Week's Visible Wins & Delivered Outcomes");
		expect(output).toContain("* Completed dashboard redesign");
		// Sub-bullets are promoted to flat top-level bullets
		expect(output).toContain("* Migrated rendering");
	});

	it("omits visible wins section when data is absent", () => {
		const input = makeBaseInput();
		const output = renderReport(input);
		expect(output).not.toContain("Visible Wins");
	});

	it("existing report output is unchanged when visibleWins not provided", () => {
		const inputWithout = makeBaseInput();
		const outputWithout = renderReport(inputWithout);

		const inputWith = makeBaseInput();
		inputWith.visibleWins = undefined;
		const outputWith = renderReport(inputWith);

		expect(outputWithout).toBe(outputWith);
		expect(outputWithout).toContain("Processed 10 PRs across 5 repositories");
	});

	it("omits visible wins when array is empty", () => {
		const input = makeBaseInput();
		input.visibleWins = [];
		const output = renderReport(input);
		expect(output).not.toContain("Visible Wins");
	});
});
