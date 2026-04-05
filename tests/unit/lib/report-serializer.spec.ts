import { describe, expect, it } from "bun:test";
import type { DiscrepancyReport } from "../../../src/core/types.js";
import type { ReportRenderInput } from "../../../src/lib/report-renderer.js";
import { serializeReportRenderInput } from "../../../src/lib/report-serializer.js";

function makeMinimalInput(
	overrides?: Partial<ReportRenderInput>,
): ReportRenderInput {
	return {
		schemaVersion: 1,
		orgSlug: "acme",
		generatedAt: "2026-02-25T00:00:00Z",
		filters: {
			includeBots: false,
			excludePrivate: false,
			includeArchived: false,
		},
		showDetails: false,
		window: {
			start: "2026-02-18",
			end: "2026-02-25",
			human: "Feb 18 – Feb 25",
		},
		totals: { prs: 10, prsMerged: 5, repoCount: 3, contributorCount: 2 },
		memberMetrics: [],
		globalHighlights: [],
		metricsDefinition: "Commits reflect default-branch contributions.",
		archivedNote: "",
		sections: { git: true, taskTracker: true },
		...overrides,
	};
}

describe("serializeReportRenderInput", () => {
	it("should produce a JSON-serializable object for basic input", () => {
		const input = makeMinimalInput();
		const result = serializeReportRenderInput(input);

		// Should be a plain object
		expect(typeof result).toBe("object");
		expect(result).not.toBeNull();

		// Should roundtrip through JSON without loss
		const json = JSON.stringify(result);
		const parsed = JSON.parse(json);
		expect(parsed.orgSlug).toBe("acme");
		expect(parsed.totals.prs).toBe(10);
		expect(parsed.window.start).toBe("2026-02-18");
	});

	it("should convert DiscrepancyReport Map to Record", () => {
		const byContributor = new Map<
			string,
			Array<{
				contributor: string;
				contributorDisplayName: string;
				sourceA: { sourceName: string; state: string };
				sourceB: { sourceName: string; state: string };
				suggestedResolution: string;
				confidence: number;
			}>
		>();
		byContributor.set("alice", [
			{
				contributor: "alice",
				contributorDisplayName: "Alice",
				sourceA: { sourceName: "GitHub", state: "MERGED" },
				sourceB: { sourceName: "Asana", state: "not-started" },
				suggestedResolution: "Update Asana task status",
				confidence: 10,
			},
		]);

		const discrepancyReport: DiscrepancyReport = {
			byContributor: byContributor as DiscrepancyReport["byContributor"],
			unattributed: [],
			totalRawCount: 1,
			totalFilteredCount: 1,
		};

		const input = makeMinimalInput({ discrepancyReport });
		const result = serializeReportRenderInput(input);

		// Should be a plain object, not a Map
		expect(result.discrepancyReport).toBeDefined();
		const dr = result.discrepancyReport as Record<string, unknown>;
		expect(dr.byContributor).toBeDefined();
		expect(dr.byContributor).not.toBeInstanceOf(Map);

		// Should roundtrip through JSON
		const json = JSON.stringify(result);
		const parsed = JSON.parse(json);
		expect(parsed.discrepancyReport.byContributor.alice).toHaveLength(1);
		expect(parsed.discrepancyReport.byContributor.alice[0].confidence).toBe(10);
		expect(parsed.discrepancyReport.totalFilteredCount).toBe(1);
	});

	it("should omit discrepancyReport when not present", () => {
		const input = makeMinimalInput();
		const result = serializeReportRenderInput(input);

		// discrepancyReport should be undefined (omitted from JSON)
		expect(result.discrepancyReport).toBeUndefined();

		const json = JSON.stringify(result);
		const parsed = JSON.parse(json);
		expect(parsed.discrepancyReport).toBeUndefined();
	});

	it("should preserve member metrics data", () => {
		const input = makeMinimalInput({
			memberMetrics: [
				{
					login: "alice",
					displayName: "Alice",
					commits: 15,
					prsOpened: 3,
					prsClosed: 1,
					prsMerged: 2,
					linesAdded: 500,
					linesDeleted: 100,
					linesAddedInProgress: 0,
					linesDeletedInProgress: 0,
					reviews: 5,
					approvals: 3,
					changesRequested: 1,
					commented: 1,
					reviewComments: 2,
					aiSummary: "Alice shipped feature X",
					highlights: ["Merged PR #42"],
					prHighlights: [],
					commitHighlights: [],
					taskTracker: { status: "matched", tasks: [], message: "" },
				},
			],
		});

		const result = serializeReportRenderInput(input);
		const json = JSON.stringify(result);
		const parsed = JSON.parse(json);

		expect(parsed.memberMetrics).toHaveLength(1);
		expect(parsed.memberMetrics[0].login).toBe("alice");
		expect(parsed.memberMetrics[0].commits).toBe(15);
		expect(parsed.memberMetrics[0].aiSummary).toBe("Alice shipped feature X");
	});
});
