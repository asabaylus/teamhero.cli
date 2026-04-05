import { describe, expect, it } from "bun:test";
import type { ReportRenderInput } from "../../../src/lib/report-renderer.js";
import { renderReport } from "../../../src/lib/report-renderer.js";
import type { ProjectAccomplishment } from "../../../src/models/visible-wins.js";

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
		window: {
			start: "2026-01-25",
			end: "2026-02-01",
			human: "Jan 25 - Feb 1",
		},
		totals: { prs: 10, prsMerged: 8, repoCount: 5, contributorCount: 3 },
		memberMetrics: [],
		globalHighlights: [],
		teamHighlight: "Team did great work this week.",
		metricsDefinition: "Standard metrics.",
		archivedNote: "",
		sections: { git: true, taskTracker: false },
	};
}

describe("Visible Wins graceful degradation", () => {
	it("renders error in report appendix when visible wins errors are present", () => {
		const input = makeBaseInput();
		input.errors = ["Visible Wins: API timeout after 30s"];

		const output = renderReport(input);

		expect(output).toContain("Errors Encountered");
		expect(output).toContain("Visible Wins: API timeout after 30s");
		expect(output).not.toContain("Visible Wins & Delivered Outcomes");
	});

	it("report generates normally when errors array has visible wins error", () => {
		const input = makeBaseInput();
		input.errors = ["Visible Wins: fetch failed"];

		const output = renderReport(input);

		expect(output).toContain("Weekly Engineering Summary");
		expect(output).toContain("At-a-Glance Summary");
		expect(output).toContain("Processed 10 PRs across 5 repositories");
		expect(output).toContain("Visible Wins: fetch failed");
	});

	it("suppresses projects with empty bullets when no meeting notes exist", () => {
		const noNoteAccomplishments: ProjectAccomplishment[] = [
			{ projectName: "Dashboard", projectGid: "gid-1", bullets: [] },
			{ projectName: "API", projectGid: "gid-2", bullets: [] },
		];
		const input = makeBaseInput();
		input.visibleWins = noNoteAccomplishments;
		input.visibleWinsProjects = [
			{ name: "Dashboard", gid: "gid-1", customFields: {}, priorityScore: 80 },
			{ name: "API", gid: "gid-2", customFields: {}, priorityScore: 60 },
		];

		const output = renderReport(input);

		expect(output).toContain("Visible Wins & Delivered Outcomes");
		// Projects with no bullets are suppressed from output
		expect(output).not.toContain("Dashboard");
		expect(output).not.toContain("API");
		expect(output).not.toContain("No Change");
	});

	it("config validation skip still produces complete report (AC #2)", () => {
		const input = makeBaseInput();
		const output = renderReport(input);

		expect(output).toContain("Weekly Engineering Summary");
		expect(output).toContain("At-a-Glance Summary");
		expect(output).not.toContain("Visible Wins");
	});
});
