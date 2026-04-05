import { describe, expect, it } from "bun:test";
import type {
	MetricDelta,
	PeriodDeltas,
	RoadmapEntry,
} from "../../../../src/core/types.js";
import { executiveRenderer } from "../../../../src/lib/renderers/executive.js";
import type { ReportRenderInput } from "../../../../src/lib/report-renderer.js";
import type { ProjectAccomplishment } from "../../../../src/models/visible-wins.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const disabledAsana = {
	status: "disabled" as const,
	tasks: [] as never[],
	message: "Integration disabled.",
};

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
		totals: { prs: 10, prsMerged: 8, repoCount: 3, contributorCount: 4 },
		memberMetrics: [],
		globalHighlights: [],
		metricsDefinition: "Commits include default branch merges",
		archivedNote: "No repos archived.",
		sections: { git: true, taskTracker: true },
		...overrides,
	};
}

function makeDelta(current: number, previous?: number): MetricDelta {
	if (previous === undefined) {
		return { current };
	}
	const absoluteChange = current - previous;
	const percentageChange =
		previous === 0 ? undefined : Math.round((absoluteChange / previous) * 100);
	return { current, previous, absoluteChange, percentageChange };
}

function makePeriodDeltas(overrides: Partial<PeriodDeltas> = {}): PeriodDeltas {
	return {
		hasPreviousPeriod: true,
		prsMerged: makeDelta(8, 6),
		prsOpened: makeDelta(10, 8),
		tasksCompleted: makeDelta(15, 12),
		linesChanged: makeDelta(500, 400),
		commits: makeDelta(30, 25),
		...overrides,
	};
}

function makeAccomplishment(
	projectName: string,
	bulletText: string,
): ProjectAccomplishment {
	return {
		projectName,
		projectGid: `gid-${projectName}`,
		bullets: [
			{
				text: bulletText,
				subBullets: [],
				sourceDates: [],
				sourceFigures: [],
				sourceNoteFile: "",
			},
		],
	};
}

function makeRoadmapEntry(
	displayName: string,
	overallStatus: RoadmapEntry["overallStatus"] = "on-track",
	keyNotes = "On schedule",
): RoadmapEntry {
	return {
		gid: `gid-${displayName}`,
		displayName,
		overallStatus,
		nextMilestone: "Q2 delivery",
		keyNotes,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executiveRenderer", () => {
	describe("metadata", () => {
		it("has name 'executive'", () => {
			expect(executiveRenderer.name).toBe("executive");
		});

		it("has a non-empty description", () => {
			expect(executiveRenderer.description.length).toBeGreaterThan(0);
		});
	});

	describe("title", () => {
		it("renders title with correct date window", () => {
			const input = makeInput();
			const output = executiveRenderer.render(input);
			expect(output).toContain("# Executive Summary (2026-02-24 – 2026-02-28)");
		});
	});

	describe("team highlight", () => {
		it("includes team highlight text when present", () => {
			const input = makeInput({
				teamHighlight: "This was an outstanding week for the team.",
			});
			const output = executiveRenderer.render(input);
			expect(output).toContain("This was an outstanding week for the team.");
		});

		it("falls back to metrics-only sentence when teamHighlight is absent", () => {
			const input = makeInput({ teamHighlight: undefined });
			const output = executiveRenderer.render(input);
			expect(output).toContain(
				"8 PRs merged across 3 repositories by 4 engineers.",
			);
		});
	});

	describe("key metrics", () => {
		it("renders a key metrics summary line", () => {
			const input = makeInput();
			const output = executiveRenderer.render(input);
			expect(output).toContain(
				"**Key Metrics:** 8 PRs merged across 3 repos by 4 engineers",
			);
		});
	});

	describe("velocity trends", () => {
		it("shows velocity trends table when periodDeltas has previous period", () => {
			const input = makeInput({ periodDeltas: makePeriodDeltas() });
			const output = executiveRenderer.render(input);
			expect(output).toContain("## Velocity Trends");
			expect(output).toContain("| Metric | This Period | Change |");
			expect(output).toContain("|--------|----------:|-------:|");
			expect(output).toContain("| PRs Merged |");
			expect(output).toContain("| PRs Opened |");
			expect(output).toContain("| Tasks Completed |");
			expect(output).toContain("| Lines Changed |");
			expect(output).toContain("| Commits |");
		});

		it("shows current values in the velocity table", () => {
			const input = makeInput({ periodDeltas: makePeriodDeltas() });
			const output = executiveRenderer.render(input);
			// PRs Merged: current=8, prev=6 → change=+2
			expect(output).toContain("| PRs Merged | 8 | +2 |");
		});

		it("shows em dash for zero change", () => {
			const deltas = makePeriodDeltas({
				prsMerged: {
					current: 8,
					previous: 8,
					absoluteChange: 0,
					percentageChange: 0,
				},
			});
			const input = makeInput({ periodDeltas: deltas });
			const output = executiveRenderer.render(input);
			expect(output).toContain("| PRs Merged | 8 | — |");
		});

		it("shows em dash when no previous period data", () => {
			const deltas = makePeriodDeltas({
				commits: { current: 10 },
			});
			const input = makeInput({ periodDeltas: deltas });
			const output = executiveRenderer.render(input);
			expect(output).toContain("| Commits | 10 | — |");
		});

		it("omits velocity section when hasPreviousPeriod is false", () => {
			const input = makeInput({
				periodDeltas: makePeriodDeltas({ hasPreviousPeriod: false }),
			});
			const output = executiveRenderer.render(input);
			expect(output).not.toContain("## Velocity Trends");
		});

		it("omits velocity section when periodDeltas is absent", () => {
			const input = makeInput({ periodDeltas: undefined });
			const output = executiveRenderer.render(input);
			expect(output).not.toContain("## Velocity Trends");
		});
	});

	describe("top accomplishments", () => {
		it("shows up to 5 visible wins", () => {
			const wins = [
				makeAccomplishment("Project A", "Shipped feature X"),
				makeAccomplishment("Project B", "Completed migration"),
				makeAccomplishment("Project C", "Fixed critical bug"),
				makeAccomplishment("Project D", "Improved performance"),
				makeAccomplishment("Project E", "Released v2.0"),
				makeAccomplishment("Project F", "This should be omitted"),
			];
			const input = makeInput({ visibleWins: wins });
			const output = executiveRenderer.render(input);
			expect(output).toContain("## Top Accomplishments");
			expect(output).toContain("**Project A**: Shipped feature X");
			expect(output).toContain("**Project E**: Released v2.0");
			expect(output).not.toContain("Project F");
		});

		it("shows all wins when 5 or fewer", () => {
			const wins = [
				makeAccomplishment("Project A", "Shipped feature X"),
				makeAccomplishment("Project B", "Completed migration"),
			];
			const input = makeInput({ visibleWins: wins });
			const output = executiveRenderer.render(input);
			expect(output).toContain("**Project A**: Shipped feature X");
			expect(output).toContain("**Project B**: Completed migration");
		});

		it("omits accomplishments section when visibleWins is empty", () => {
			const input = makeInput({ visibleWins: [] });
			const output = executiveRenderer.render(input);
			expect(output).not.toContain("## Top Accomplishments");
		});

		it("omits accomplishments section when visibleWins is absent", () => {
			const input = makeInput({ visibleWins: undefined });
			const output = executiveRenderer.render(input);
			expect(output).not.toContain("## Top Accomplishments");
		});
	});

	describe("roadmap status", () => {
		it("shows roadmap status table when roadmapEntries are present", () => {
			const entries = [
				makeRoadmapEntry("Initiative Alpha", "on-track", "On schedule"),
				makeRoadmapEntry("Initiative Beta", "at-risk", "Delayed by 1 week"),
			];
			const input = makeInput({ roadmapEntries: entries });
			const output = executiveRenderer.render(input);
			expect(output).toContain("## Roadmap Status");
			expect(output).toContain("| Item | Status | Progress |");
			expect(output).toContain("|------|--------|----------|");
			expect(output).toContain("Initiative Alpha");
			expect(output).toContain("on-track");
			expect(output).toContain("On schedule");
			expect(output).toContain("Initiative Beta");
			expect(output).toContain("at-risk");
			expect(output).toContain("Delayed by 1 week");
		});

		it("omits roadmap section when roadmapEntries is empty", () => {
			const input = makeInput({ roadmapEntries: [] });
			const output = executiveRenderer.render(input);
			expect(output).not.toContain("## Roadmap Status");
		});

		it("omits roadmap section when roadmapEntries is absent", () => {
			const input = makeInput({ roadmapEntries: undefined });
			const output = executiveRenderer.render(input);
			expect(output).not.toContain("## Roadmap Status");
		});
	});

	describe("risks & discrepancies", () => {
		it("shows discrepancy count when present", () => {
			const input = makeInput({
				discrepancyReport: {
					byContributor: new Map(),
					unattributed: [],
					totalRawCount: 5,
					totalFilteredCount: 3,
					allItems: [],
					discrepancyThreshold: 70,
				},
			});
			const output = executiveRenderer.render(input);
			expect(output).toContain("## Risks & Discrepancies");
			expect(output).toContain(
				"3 cross-source discrepancies detected (threshold: 70%).",
			);
		});

		it("omits risks section when totalFilteredCount is zero", () => {
			const input = makeInput({
				discrepancyReport: {
					byContributor: new Map(),
					unattributed: [],
					totalRawCount: 0,
					totalFilteredCount: 0,
					allItems: [],
					discrepancyThreshold: 70,
				},
			});
			const output = executiveRenderer.render(input);
			expect(output).not.toContain("## Risks & Discrepancies");
		});

		it("omits risks section when discrepancyReport is absent", () => {
			const input = makeInput({ discrepancyReport: undefined });
			const output = executiveRenderer.render(input);
			expect(output).not.toContain("## Risks & Discrepancies");
		});
	});

	describe("omits sections when data is missing", () => {
		it("renders minimal output with only required fields populated", () => {
			const input = makeInput();
			const output = executiveRenderer.render(input);
			expect(output).toContain("# Executive Summary");
			expect(output).not.toContain("## Velocity Trends");
			expect(output).not.toContain("## Top Accomplishments");
			expect(output).not.toContain("## Roadmap Status");
			expect(output).not.toContain("## Risks & Discrepancies");
		});
	});
});
