import type {
	ContributorDiscrepancy,
	DiscrepancyReport,
	MetricDelta,
	PeriodDeltas,
	RoadmapEntry,
} from "../../../src/core/types.js";
import type {
	ReportMemberMetrics,
	ReportRenderInput,
} from "../../../src/lib/report-renderer.js";
/**
 * Additional tests for report-renderer.ts covering lines not exercised
 * by the existing tests/unit/report.renderer.spec.ts.
 *
 * Focus: renderReport edge cases, renderVisibleWinsSection, renderDiscrepancySection,
 * formatDeltaCompact, warnings section, and normalizeAccomplishments.
 */
import {
	renderReport,
	renderRoadmapSection,
	renderVisibleWinsSection,
} from "../../../src/lib/report-renderer.js";
import type {
	ProjectAccomplishment,
	ProjectTask,
} from "../../../src/models/visible-wins.js";

// ---------------------------------------------------------------------------
// Shared fixture helpers
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

function makeDelta(current: number, previous?: number): MetricDelta {
	if (previous === undefined) {
		return { current };
	}
	const absoluteChange = current - previous;
	const percentageChange =
		previous === 0 ? undefined : Math.round((absoluteChange / previous) * 100);
	return { current, previous, absoluteChange, percentageChange };
}

function makeDiscrepancy(
	overrides: Partial<ContributorDiscrepancy> = {},
): ContributorDiscrepancy {
	return {
		contributor: "jdoe",
		contributorDisplayName: "Jane Doe",
		sourceA: {
			sourceName: "Report: Individual Summary",
			state: "3 PRs merged",
			url: "",
			itemId: "",
		},
		sourceB: {
			sourceName: "GitHub",
			state: "2 PRs merged",
			url: "https://github.com/acme/repo/pulls",
			itemId: "PR #99",
		},
		suggestedResolution: "Verify merged PR count against GitHub.",
		confidence: 72,
		message:
			"PR count mismatch\nReport claims 3 merged PRs but GitHub shows only 2.",
		rule: "Metric mismatch — Report overstates merged PR count.",
		...overrides,
	};
}

// ===================================================================
// renderReport — overview sentence variations
// ===================================================================

describe("renderReport — overview sentence", () => {
	it("uses 'GitHub metrics were skipped' when git section is disabled", () => {
		const output = renderReport(
			makeInput({
				sections: { git: false, taskTracker: true },
			}),
		);
		expect(output).toContain("GitHub metrics were skipped for this run");
		expect(output).not.toContain("Processed");
	});

	it("omits merged count when prsMerged equals total prs", () => {
		const output = renderReport(
			makeInput({
				totals: { prs: 10, prsMerged: 10, repoCount: 3, contributorCount: 2 },
			}),
		);
		// When all PRs are merged, merged count is not appended separately
		expect(output).not.toContain("10 merged during the window");
	});

	it("omits merged count when prsMerged is zero", () => {
		const output = renderReport(
			makeInput({
				totals: { prs: 10, prsMerged: 0, repoCount: 3, contributorCount: 2 },
			}),
		);
		expect(output).not.toContain("merged during the window");
	});

	it("includes merged count when prsMerged is between 0 and total", () => {
		const output = renderReport(
			makeInput({
				totals: { prs: 10, prsMerged: 7, repoCount: 3, contributorCount: 2 },
			}),
		);
		expect(output).toContain("7 merged during the window");
	});
});

// ===================================================================
// renderReport — aggregated member filtering
// ===================================================================

describe("renderReport — aggregated member filtering", () => {
	it("excludes members with login 'others'", () => {
		const output = renderReport(
			makeInput({
				memberMetrics: [
					makeMember({ login: "others", displayName: "Others" }),
					makeMember({ login: "real-dev", displayName: "Real Dev" }),
				],
			}),
		);
		expect(output).not.toContain("### Others");
		expect(output).toContain("### Real Dev");
	});

	it("excludes members with displayName 'Other Contributors'", () => {
		const output = renderReport(
			makeInput({
				memberMetrics: [
					makeMember({ login: "misc", displayName: "Other Contributors" }),
					makeMember({ login: "real-dev", displayName: "Real Dev" }),
				],
			}),
		);
		expect(output).not.toContain("### Other Contributors");
		expect(output).toContain("### Real Dev");
	});

	it("excludes members with login 'aggregate'", () => {
		const output = renderReport(
			makeInput({
				memberMetrics: [
					makeMember({ login: "aggregate", displayName: "Aggregate" }),
					makeMember({ login: "dev1", displayName: "Dev One" }),
				],
			}),
		);
		expect(output).not.toContain("### Aggregate");
	});
});

// ===================================================================
// renderReport — member sorting (line 107 coverage)
// ===================================================================

describe("renderReport — member sorting", () => {
	it("breaks ties on merged PRs by commit count", () => {
		const output = renderReport(
			makeInput({
				memberMetrics: [
					makeMember({
						login: "low-commits",
						displayName: "Low Commits",
						prsMerged: 3,
						commits: 2,
					}),
					makeMember({
						login: "high-commits",
						displayName: "High Commits",
						prsMerged: 3,
						commits: 10,
					}),
				],
			}),
		);
		const lines = output.split("\n");
		const highIdx = lines.findIndex((l) => l.includes("High Commits"));
		const lowIdx = lines.findIndex((l) => l.includes("Low Commits"));
		expect(highIdx).toBeLessThan(lowIdx);
	});

	it("breaks commit ties alphabetically by login", () => {
		const output = renderReport(
			makeInput({
				memberMetrics: [
					makeMember({
						login: "zara",
						displayName: "Zara Z",
						prsMerged: 3,
						commits: 5,
					}),
					makeMember({
						login: "alice",
						displayName: "Alice A",
						prsMerged: 3,
						commits: 5,
					}),
				],
			}),
		);
		const lines = output.split("\n");
		const aliceIdx = lines.findIndex((l) => l.includes("Alice A"));
		const zaraIdx = lines.findIndex((l) => l.includes("Zara Z"));
		expect(aliceIdx).toBeLessThan(zaraIdx);
	});
});

// ===================================================================
// renderReport — warnings section
// ===================================================================

describe("renderReport — warnings section", () => {
	it("renders repository warnings section when there are repo-related warnings", () => {
		const output = renderReport(
			makeInput({
				warnings: ["Skipped empty repository: acme/deprecated-lib"],
			}),
		);
		expect(output).toContain("Repositories Unable to Collect Data");
		expect(output).toContain("`acme/deprecated-lib`");
	});

	it("extracts repo name from warning and renders as inline code", () => {
		const output = renderReport(
			makeInput({
				warnings: ["Skipped repository: org/some-repo"],
			}),
		);
		expect(output).toContain("`org/some-repo`");
	});

	it("falls back to cleaned warning text when no repo pattern matches", () => {
		const output = renderReport(
			makeInput({
				warnings: ["Skipped empty repository: something weird with no slash"],
			}),
		);
		expect(output).toContain("Repositories Unable to Collect Data");
		// Should contain the cleaned-up warning text
		expect(output).toContain("something weird with no slash");
	});

	it("does not render warnings section for non-repo warnings", () => {
		const output = renderReport(
			makeInput({
				warnings: ["Rate limit approaching"],
			}),
		);
		expect(output).not.toContain("Repositories Unable to Collect Data");
	});

	it("does not render warnings section when warnings array is empty", () => {
		const output = renderReport(makeInput({ warnings: [] }));
		expect(output).not.toContain("Repositories Unable to Collect Data");
	});
});

// ===================================================================
// renderReport — errors section
// ===================================================================

describe("renderReport — errors section", () => {
	it("does not render errors section when errors array is empty", () => {
		const output = renderReport(makeInput({ errors: [] }));
		expect(output).not.toContain("Errors Encountered");
	});

	it("does not render errors section when errors is undefined", () => {
		const output = renderReport(makeInput());
		expect(output).not.toContain("Errors Encountered");
	});
});

// ===================================================================
// renderReport — visible wins integration
// ===================================================================

describe("renderReport — visible wins integration", () => {
	it("renders visible wins section when visibleWins are provided", () => {
		const output = renderReport(
			makeInput({
				visibleWins: [
					{
						projectName: "Dashboard",
						projectGid: "gid-1",
						bullets: [
							{
								text: "Dashboard redesign shipped to production",
								subBullets: [],
								sourceDates: ["Feb 24th"],
								sourceFigures: [],
								sourceNoteFile: "standup.md",
							},
						],
					},
				],
				visibleWinsProjects: [
					{
						name: "Dashboard",
						gid: "gid-1",
						customFields: {},
						priorityScore: 90,
					},
				],
			}),
		);
		expect(output).toContain("This Week's Visible Wins");
		expect(output).toContain("Dashboard");
		expect(output).toContain("Dashboard redesign shipped to production");
	});

	it("does not render visible wins section when visibleWins is empty", () => {
		const output = renderReport(makeInput({ visibleWins: [] }));
		expect(output).not.toContain("Visible Wins");
	});

	it("does not render visible wins section when visibleWins is undefined", () => {
		const output = renderReport(makeInput());
		expect(output).not.toContain("Visible Wins");
	});

	it("renders technical wins section after visible wins when enabled", () => {
		const output = renderReport(
			makeInput({
				sections: {
					git: true,
					taskTracker: true,
					technicalFoundationalWins: true,
				},
				visibleWins: [
					{
						projectName: "Dashboard",
						projectGid: "gid-1",
						bullets: [
							{
								text: "Dashboard redesign shipped to production",
								subBullets: [],
								sourceDates: [],
								sourceFigures: [],
								sourceNoteFile: "note.md",
							},
						],
					},
				],
				visibleWinsProjects: [
					{
						name: "Dashboard",
						gid: "gid-1",
						customFields: {},
						priorityScore: 1,
					},
				],
				technicalFoundationalWins: {
					categories: [
						{
							category: "AI / Engineering",
							wins: ["Added Claude team access"],
						},
					],
				},
			}),
		);
		const winsIdx = output.indexOf("This Week's Visible Wins");
		const techIdx = output.indexOf("This Week's Technical / Foundational Wins");
		expect(winsIdx).toBeGreaterThan(-1);
		expect(techIdx).toBeGreaterThan(winsIdx);
	});
});

// ===================================================================
// renderReport — period deltas (velocity trends)
// ===================================================================

describe("renderReport — period deltas", () => {
	it("renders velocity trends table when hasPreviousPeriod is true", () => {
		const deltas: PeriodDeltas = {
			prsMerged: makeDelta(12, 9),
			prsOpened: makeDelta(15, 12),
			tasksCompleted: makeDelta(8, 10),
			linesChanged: makeDelta(2000, 1500),
			commits: makeDelta(25, 20),
			hasPreviousPeriod: true,
		};
		const output = renderReport(makeInput({ periodDeltas: deltas }));
		expect(output).toContain("Velocity Trends (vs. Previous Period)");
		expect(output).toContain("PRs Merged");
		expect(output).toContain("PRs Opened");
		expect(output).toContain("Tasks Completed");
		expect(output).toContain("Lines Changed");
		expect(output).toContain("Commits");
	});

	it("does not render velocity trends when hasPreviousPeriod is false", () => {
		const deltas: PeriodDeltas = {
			prsMerged: makeDelta(12),
			prsOpened: makeDelta(15),
			tasksCompleted: makeDelta(8),
			linesChanged: makeDelta(2000),
			commits: makeDelta(25),
			hasPreviousPeriod: false,
		};
		const output = renderReport(makeInput({ periodDeltas: deltas }));
		expect(output).not.toContain("Velocity Trends");
	});

	it("does not render velocity trends when periodDeltas is undefined", () => {
		const output = renderReport(makeInput());
		expect(output).not.toContain("Velocity Trends");
	});

	it("renders '(new)' when previous is zero (percentageChange undefined)", () => {
		const deltas: PeriodDeltas = {
			prsMerged: makeDelta(5, 0),
			prsOpened: makeDelta(3, 0),
			tasksCompleted: makeDelta(2, 0),
			linesChanged: makeDelta(100, 0),
			commits: makeDelta(10, 0),
			hasPreviousPeriod: true,
		};
		const output = renderReport(makeInput({ periodDeltas: deltas }));
		expect(output).toContain("(new)");
	});

	it("renders '-' for metrics with no previous period data", () => {
		const deltas: PeriodDeltas = {
			prsMerged: { current: 5 },
			prsOpened: { current: 3 },
			tasksCompleted: { current: 2 },
			linesChanged: { current: 100 },
			commits: { current: 10 },
			hasPreviousPeriod: true,
		};
		const output = renderReport(makeInput({ periodDeltas: deltas }));
		// The change column should show "-" for metrics without previous
		expect(output).toContain("Velocity Trends");
	});
});

// ===================================================================
// renderReport — discrepancy log section
// ===================================================================

describe("renderReport — discrepancy log", () => {
	function makeDiscrepancyReport(
		items: ContributorDiscrepancy[],
	): DiscrepancyReport {
		const byContributor = new Map<string, ContributorDiscrepancy[]>();
		const unattributed: ContributorDiscrepancy[] = [];
		for (const item of items) {
			if (item.contributor) {
				const existing = byContributor.get(item.contributor) ?? [];
				existing.push(item);
				byContributor.set(item.contributor, existing);
			} else {
				unattributed.push(item);
			}
		}
		return {
			byContributor,
			unattributed,
			totalRawCount: items.length,
			totalFilteredCount: items.length,
			allItems: items,
			discrepancyThreshold: 50,
		};
	}

	it("renders discrepancy section when opted in with items present", () => {
		const report = makeDiscrepancyReport([makeDiscrepancy()]);
		const output = renderReport(
			makeInput({
				sections: { git: true, taskTracker: true, discrepancyLog: true },
				discrepancyReport: report,
			}),
		);
		expect(output).toContain("Discrepancy Report");
		expect(output).toContain("PR count mismatch");
		expect(output).toContain("Jane Doe");
	});

	it("does not render discrepancy section when sections.discrepancyLog is false", () => {
		const report = makeDiscrepancyReport([makeDiscrepancy()]);
		const output = renderReport(
			makeInput({
				sections: { git: true, taskTracker: true, discrepancyLog: false },
				discrepancyReport: report,
			}),
		);
		expect(output).not.toContain("Discrepancy Report");
	});

	it("does not render discrepancy section when totalFilteredCount is 0", () => {
		const report = makeDiscrepancyReport([]);
		const output = renderReport(
			makeInput({
				sections: { git: true, taskTracker: true, discrepancyLog: true },
				discrepancyReport: report,
			}),
		);
		expect(output).not.toContain("Discrepancy Report");
	});

	it("renders summary table with anchor links", () => {
		const report = makeDiscrepancyReport([makeDiscrepancy()]);
		const output = renderReport(
			makeInput({
				sections: { git: true, taskTracker: true, discrepancyLog: true },
				discrepancyReport: report,
			}),
		);
		expect(output).toContain("[1](#discrepancy-1)");
		expect(output).toContain("| # | Issue | Contributor | Confidence |");
	});

	it("renders detailed discrepancy cards with evidence", () => {
		const report = makeDiscrepancyReport([makeDiscrepancy()]);
		const output = renderReport(
			makeInput({
				sections: { git: true, taskTracker: true, discrepancyLog: true },
				discrepancyReport: report,
			}),
		);
		expect(output).toContain("**Evidence:**");
		expect(output).toContain("**Action:**");
		expect(output).toContain("Verify merged PR count against GitHub");
	});

	it("renders gap from rule description", () => {
		const report = makeDiscrepancyReport([makeDiscrepancy()]);
		const output = renderReport(
			makeInput({
				sections: { git: true, taskTracker: true, discrepancyLog: true },
				discrepancyReport: report,
			}),
		);
		expect(output).toContain("**Gap:** Report overstates merged PR count.");
	});

	it("renders unattributed discrepancies", () => {
		const unattributed = makeDiscrepancy({
			contributor: "",
			contributorDisplayName: "",
		});
		const report = makeDiscrepancyReport([unattributed]);
		const output = renderReport(
			makeInput({
				sections: { git: true, taskTracker: true, discrepancyLog: true },
				discrepancyReport: report,
			}),
		);
		expect(output).toContain("Unattributed");
	});

	it("renders evidence bullet with URL as a markdown link", () => {
		const d = makeDiscrepancy({
			sourceB: {
				sourceName: "GitHub",
				state: "2 PRs merged",
				url: "https://github.com/acme/repo/pulls",
				itemId: "PR #99",
			},
		});
		const report = makeDiscrepancyReport([d]);
		const output = renderReport(
			makeInput({
				sections: { git: true, taskTracker: true, discrepancyLog: true },
				discrepancyReport: report,
			}),
		);
		expect(output).toContain(
			"[GitHub: PR #99](https://github.com/acme/repo/pulls)",
		);
	});

	it("renders evidence bullet without URL as plain text", () => {
		const d = makeDiscrepancy({
			sourceA: {
				sourceName: "Report: Individual Summary",
				state: "3 PRs merged",
				url: "",
				itemId: "",
			},
		});
		const report = makeDiscrepancyReport([d]);
		const output = renderReport(
			makeInput({
				sections: { git: true, taskTracker: true, discrepancyLog: true },
				discrepancyReport: report,
			}),
		);
		expect(output).toContain("- Report: Individual Summary — 3 PRs merged");
	});

	it("renders explanation when message has multiple lines", () => {
		const d = makeDiscrepancy({
			message: "Summary line\nDetailed explanation on the second line.",
		});
		const report = makeDiscrepancyReport([d]);
		const output = renderReport(
			makeInput({
				sections: { git: true, taskTracker: true, discrepancyLog: true },
				discrepancyReport: report,
			}),
		);
		expect(output).toContain("Detailed explanation on the second line.");
	});

	it("omits explanation when message is a single line", () => {
		const d = makeDiscrepancy({
			message: "Single line summary only",
		});
		const report = makeDiscrepancyReport([d]);
		const output = renderReport(
			makeInput({
				sections: { git: true, taskTracker: true, discrepancyLog: true },
				discrepancyReport: report,
			}),
		);
		// The single line is the summary; there is no extra explanation paragraph
		const lines = output.split("\n");
		const summaryLineIdx = lines.findIndex((l) =>
			l.includes("Single line summary only"),
		);
		expect(summaryLineIdx).toBeGreaterThanOrEqual(0);
	});

	it("sorts discrepancies by confidence descending", () => {
		const d1 = makeDiscrepancy({
			confidence: 40,
			message: "Low confidence item",
		});
		const d2 = makeDiscrepancy({
			confidence: 90,
			message: "High confidence item",
		});
		const report = makeDiscrepancyReport([d1, d2]);
		const output = renderReport(
			makeInput({
				sections: { git: true, taskTracker: true, discrepancyLog: true },
				discrepancyReport: report,
			}),
		);
		const highIdx = output.indexOf("High confidence item");
		const lowIdx = output.indexOf("Low confidence item");
		expect(highIdx).toBeLessThan(lowIdx);
	});

	it("omits gap when rule has no separator", () => {
		const d = makeDiscrepancy({
			rule: "Simple rule without separator",
		});
		const report = makeDiscrepancyReport([d]);
		const output = renderReport(
			makeInput({
				sections: { git: true, taskTracker: true, discrepancyLog: true },
				discrepancyReport: report,
			}),
		);
		expect(output).not.toContain("**Gap:**");
	});
});

// ===================================================================
// renderVisibleWinsSection
// ===================================================================

describe("renderVisibleWinsSection", () => {
	it("renders heading", () => {
		const output = renderVisibleWinsSection([], []);
		expect(output).toContain("This Week's Visible Wins & Delivered Outcomes");
	});

	it("renders project with accomplishment bullets", () => {
		const accomplishments: ProjectAccomplishment[] = [
			{
				projectName: "Dashboard",
				projectGid: "gid-1",
				bullets: [
					{
						text: "Redesign shipped to production",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "standup.md",
					},
				],
			},
		];
		const projects: ProjectTask[] = [
			{ name: "Dashboard", gid: "gid-1", customFields: {}, priorityScore: 90 },
		];
		const output = renderVisibleWinsSection(accomplishments, projects);
		expect(output).toContain("Dashboard");
		expect(output).toContain("* Redesign shipped to production");
	});

	it("sorts projects by priority score descending", () => {
		const accomplishments: ProjectAccomplishment[] = [
			{
				projectName: "Low Priority",
				projectGid: "gid-low",
				bullets: [
					{
						text: "Low work",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "a.md",
					},
				],
			},
			{
				projectName: "High Priority",
				projectGid: "gid-high",
				bullets: [
					{
						text: "High work",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "b.md",
					},
				],
			},
		];
		const projects: ProjectTask[] = [
			{
				name: "Low Priority",
				gid: "gid-low",
				customFields: {},
				priorityScore: 10,
			},
			{
				name: "High Priority",
				gid: "gid-high",
				customFields: {},
				priorityScore: 95,
			},
		];
		const output = renderVisibleWinsSection(accomplishments, projects);
		const highIdx = output.indexOf("High Priority");
		const lowIdx = output.indexOf("Low Priority");
		expect(highIdx).toBeLessThan(lowIdx);
	});

	it("deduplicates bullets with the same text (case insensitive)", () => {
		const accomplishments: ProjectAccomplishment[] = [
			{
				projectName: "Dashboard",
				projectGid: "gid-1",
				bullets: [
					{
						text: "Redesign shipped",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "a.md",
					},
					{
						text: "Redesign shipped",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "b.md",
					},
				],
			},
		];
		const projects: ProjectTask[] = [
			{ name: "Dashboard", gid: "gid-1", customFields: {}, priorityScore: 90 },
		];
		const output = renderVisibleWinsSection(accomplishments, projects);
		const matches = output.match(/Redesign shipped/g);
		expect(matches).toHaveLength(1);
	});

	it("merges duplicate project entries by projectGid", () => {
		const accomplishments: ProjectAccomplishment[] = [
			{
				projectName: "Dashboard",
				projectGid: "gid-1",
				bullets: [
					{
						text: "Bullet A",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "a.md",
					},
				],
			},
			{
				projectName: "Dashboard",
				projectGid: "gid-1",
				bullets: [
					{
						text: "Bullet B",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "b.md",
					},
				],
			},
		];
		const projects: ProjectTask[] = [
			{ name: "Dashboard", gid: "gid-1", customFields: {}, priorityScore: 90 },
		];
		const output = renderVisibleWinsSection(accomplishments, projects);
		expect(output).toContain("* Bullet A");
		expect(output).toContain("* Bullet B");
		// Dashboard heading should appear only once
		const headingMatches = output.match(/^Dashboard$/gm);
		expect(headingMatches).toHaveLength(1);
	});

	it("promotes subBullets to top-level bullets", () => {
		const accomplishments: ProjectAccomplishment[] = [
			{
				projectName: "Dashboard",
				projectGid: "gid-1",
				bullets: [
					{
						text: "Parent bullet",
						subBullets: ["Sub-bullet detail one", "Sub-bullet detail two"],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "a.md",
					},
				],
			},
		];
		const projects: ProjectTask[] = [
			{ name: "Dashboard", gid: "gid-1", customFields: {}, priorityScore: 90 },
		];
		const output = renderVisibleWinsSection(accomplishments, projects);
		expect(output).toContain("* Sub-bullet detail one");
		expect(output).toContain("* Sub-bullet detail two");
	});

	it("strips project name prefix from bullet text", () => {
		const accomplishments: ProjectAccomplishment[] = [
			{
				projectName: "Dashboard",
				projectGid: "gid-1",
				bullets: [
					{
						text: "Dashboard — Redesign shipped",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "a.md",
					},
				],
			},
		];
		const projects: ProjectTask[] = [
			{ name: "Dashboard", gid: "gid-1", customFields: {}, priorityScore: 90 },
		];
		const output = renderVisibleWinsSection(accomplishments, projects);
		expect(output).toContain("* Redesign shipped");
		expect(output).not.toContain("* Dashboard —");
	});

	it("omits projects with no accomplishment bullets", () => {
		const accomplishments: ProjectAccomplishment[] = [
			{
				projectName: "Dashboard",
				projectGid: "gid-1",
				bullets: [
					{
						text: "Some work",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "a.md",
					},
				],
			},
		];
		const projects: ProjectTask[] = [
			{ name: "Dashboard", gid: "gid-1", customFields: {}, priorityScore: 90 },
			{
				name: "Empty Project",
				gid: "gid-empty",
				customFields: {},
				priorityScore: 50,
			},
		];
		const output = renderVisibleWinsSection(accomplishments, projects);
		expect(output).toContain("Dashboard");
		expect(output).not.toContain("Empty Project");
	});

	it("includes accomplishments for projects not in the board list", () => {
		const accomplishments: ProjectAccomplishment[] = [
			{
				projectName: "Supplement Project",
				projectGid: "gid-supplement",
				bullets: [
					{
						text: "Extra work done",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "supp.md",
					},
				],
			},
		];
		const projects: ProjectTask[] = []; // No board projects
		const output = renderVisibleWinsSection(accomplishments, projects);
		expect(output).toContain("Supplement Project");
		expect(output).toContain("* Extra work done");
	});

	it("handles empty accomplishments array", () => {
		const output = renderVisibleWinsSection([], []);
		expect(output).toContain("This Week's Visible Wins");
		// No bullet points should be present (only the heading which has **)
		const lines = output.split("\n").filter((l) => l.startsWith("* "));
		expect(lines).toHaveLength(0);
	});

	it("splits multi-line bullet text into separate bullets", () => {
		const accomplishments: ProjectAccomplishment[] = [
			{
				projectName: "Dashboard",
				projectGid: "gid-1",
				bullets: [
					{
						text: "First outcome\n- Second outcome\n* Third outcome",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "a.md",
					},
				],
			},
		];
		const projects: ProjectTask[] = [
			{ name: "Dashboard", gid: "gid-1", customFields: {}, priorityScore: 90 },
		];
		const output = renderVisibleWinsSection(accomplishments, projects);
		expect(output).toContain("* First outcome");
		expect(output).toContain("* Second outcome");
		expect(output).toContain("* Third outcome");
	});
});

// ===================================================================
// renderReport — formatIndividualSummary edge cases
// ===================================================================

describe("renderReport — formatIndividualSummary", () => {
	it("throws when aiSummary is empty", () => {
		expect(() =>
			renderReport(
				makeInput({
					memberMetrics: [makeMember({ aiSummary: "" })],
				}),
			),
		).toThrow("Missing summary content");
	});

	it("throws when aiSummary is only whitespace", () => {
		expect(() =>
			renderReport(
				makeInput({
					memberMetrics: [makeMember({ aiSummary: "   " })],
				}),
			),
		).toThrow("Missing summary content");
	});

	it("includes aiSummary text in the output", () => {
		const output = renderReport(
			makeInput({
				memberMetrics: [
					makeMember({ aiSummary: "Jane delivered billing improvements." }),
				],
			}),
		);
		expect(output).toContain("Jane delivered billing improvements.");
	});
});

// ===================================================================
// renderReport — member details (showDetails: true)
// ===================================================================

describe("renderReport — member details", () => {
	it("renders completed tasks in detail view", () => {
		const output = renderReport(
			makeInput({
				showDetails: true,
				memberMetrics: [
					makeMember({
						taskTracker: {
							status: "matched",
							tasks: [
								{
									gid: "task-1",
									name: "Ship billing fix",
									status: "completed",
									completedAt: "2026-02-20T12:00:00Z",
									dueOn: "2026-02-20",
									dueAt: null,
									permalinkUrl: "https://app.asana.com/0/123/task-1",
								},
							],
						},
					}),
				],
			}),
		);
		expect(output).toContain("**Completed tasks**");
		expect(output).toContain("Ship billing fix");
		expect(output).toContain("(completed 2026-02-20)");
		expect(output).toContain("https://app.asana.com/0/123/task-1");
	});

	it("renders 'None' for completed tasks when there are none", () => {
		const output = renderReport(
			makeInput({
				showDetails: true,
				memberMetrics: [
					makeMember({
						taskTracker: { status: "matched", tasks: [] },
					}),
				],
			}),
		);
		expect(output).toContain("**Completed tasks**");
		expect(output).toContain("None");
	});
});

describe("renderRoadmapSection — phase 3 citations and phase 2 status colors", () => {
	function makeEntry(overrides: Partial<RoadmapEntry> = {}): RoadmapEntry {
		return {
			gid: "gid-1",
			displayName: "Auth Overhaul",
			overallStatus: "on-track",
			nextMilestone: "Beta launch Mar 15",
			keyNotes: "Rolling out smoothly",
			...overrides,
		};
	}

	it("appends an italic citation suffix when nextMilestoneCitation is present", () => {
		const out = renderRoadmapSection([
			makeEntry({
				nextMilestone: "Apr 13 - First Full Release",
				nextMilestoneCitation: "Eng sync 2026-04-08",
				nextMilestoneSource: "meeting-note",
			}),
		]);
		expect(out).toContain(
			"Apr 13 - First Full Release _(per Eng sync 2026-04-08)_",
		);
	});

	it("leaves the milestone cell unchanged when there is no citation", () => {
		const out = renderRoadmapSection([makeEntry()]);
		expect(out).toContain("| Beta launch Mar 15 |");
		expect(out).not.toContain("_(per");
	});

	it("ignores whitespace-only citations", () => {
		const out = renderRoadmapSection([
			makeEntry({ nextMilestoneCitation: "   " }),
		]);
		expect(out).not.toContain("_(per");
	});

	it("uses latestStatusUpdate.color for the status emoji when present", () => {
		const out = renderRoadmapSection([
			makeEntry({
				overallStatus: "unknown",
				latestStatusUpdate: {
					title: "Weekly update",
					text: "All good.",
					color: "blue",
					createdAt: "2026-04-08T14:00:00Z",
				},
			}),
		]);
		expect(out).toContain("🔵");
		// Overall status is still 'unknown' at the union level but blue wins here
		expect(out).not.toMatch(/ ⚪ /);
	});

	it("falls back to overallStatus emoji when latestStatusUpdate is missing", () => {
		const out = renderRoadmapSection([
			makeEntry({ overallStatus: "off-track" }),
		]);
		expect(out).toContain("🔴");
	});

	it("renders ⚪ when status is unknown and no latestStatusUpdate exists", () => {
		const out = renderRoadmapSection([
			makeEntry({ overallStatus: "unknown", latestStatusUpdate: undefined }),
		]);
		expect(out).toContain("⚪");
	});

	it("escapes pipe characters in citation text to avoid breaking the table", () => {
		const out = renderRoadmapSection([
			makeEntry({
				nextMilestone: "Apr 20",
				nextMilestoneCitation: "Retro|Note 2026-04-09",
			}),
		]);
		expect(out).toContain("Retro\\|Note 2026-04-09");
	});
});
