import { describe, expect, it } from "bun:test";
import type { FactualValidationContext } from "../../../src/core/types.js";
import type {
	NormalizedNote,
	ProjectAccomplishment,
	ProjectTask,
} from "../../../src/models/visible-wins.js";

const { validateFactualClaims } = await import(
	new URL("../../../src/services/factual-validator.ts", import.meta.url).href
);

function makeNote(overrides: Partial<NormalizedNote> = {}): NormalizedNote {
	return {
		title: "Weekly Standup",
		date: "2026-01-28",
		attendees: ["Alice", "Bob"],
		discussionItems: [
			"Discussed dashboard redesign improving load time by 40%",
		],
		sourceFile: "standup.md",
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

function makeAccomplishment(
	overrides: Partial<ProjectAccomplishment> = {},
): ProjectAccomplishment {
	return {
		projectName: "Dashboard",
		projectGid: "gid-1",
		bullets: [
			{
				text: "Completed dashboard redesign improving load time by 40%",
				subBullets: [],
				sourceDates: ["2026-01-28"],
				sourceFigures: ["40%"],
				sourceNoteFile: "standup.md",
			},
		],
		...overrides,
	};
}

function makeContext(
	overrides: Partial<FactualValidationContext> = {},
): FactualValidationContext {
	return {
		accomplishments: [makeAccomplishment()],
		notes: [makeNote()],
		projects: [makeProject()],
		...overrides,
	};
}

describe("validateFactualClaims", () => {
	it("returns empty array when all dates and figures are found in source data", () => {
		const result = validateFactualClaims(makeContext());
		expect(result).toEqual([]);
	});

	it("detects date not found in any source note", () => {
		const context = makeContext({
			accomplishments: [
				makeAccomplishment({
					bullets: [
						{
							text: "Launched on 2026-02-15",
							subBullets: [],
							sourceDates: ["2026-02-15"],
							sourceFigures: [],
							sourceNoteFile: "standup.md",
						},
					],
				}),
			],
		});

		const result = validateFactualClaims(context);

		expect(result).toHaveLength(1);
		expect(result[0].type).toBe("date");
		expect(result[0].aiValue).toBe("2026-02-15");
		expect(result[0].sourceValue).toBe("not found in source data");
		expect(result[0].bulletText).toBe("Launched on 2026-02-15");
		expect(result[0].rationale).toContain("2026-02-15");
		expect(result[0].rationale).toContain("does not appear anywhere");
	});

	it("detects figure not found in any source note or Asana field", () => {
		const context = makeContext({
			accomplishments: [
				makeAccomplishment({
					bullets: [
						{
							text: "Reduced costs by $1.2M",
							subBullets: [],
							sourceDates: [],
							sourceFigures: ["$1.2M"],
							sourceNoteFile: "standup.md",
						},
					],
				}),
			],
		});

		const result = validateFactualClaims(context);

		expect(result).toHaveLength(1);
		expect(result[0].type).toBe("figure");
		expect(result[0].aiValue).toBe("$1.2M");
		expect(result[0].bulletText).toBe("Reduced costs by $1.2M");
		expect(result[0].rationale).toContain("$1.2M");
		expect(result[0].rationale).toContain("calculated, rounded, or fabricated");
	});

	it("produces correct discrepancy record with all fields", () => {
		const context = makeContext({
			accomplishments: [
				makeAccomplishment({
					projectName: "API Gateway",
					bullets: [
						{
							text: "Improved throughput by 60%",
							subBullets: [],
							sourceDates: ["2026-03-01"],
							sourceFigures: ["60%"],
							sourceNoteFile: "retro.md",
						},
					],
				}),
			],
		});

		const result = validateFactualClaims(context);

		expect(result).toHaveLength(2);
		const dateDisc = result.find((d) => d.type === "date");
		const figDisc = result.find((d) => d.type === "figure");

		expect(dateDisc).toEqual(
			expect.objectContaining({
				projectName: "API Gateway",
				type: "date",
				aiValue: "2026-03-01",
				sourceValue: "not found in source data",
				sourceFile: "retro.md",
				bulletText: "Improved throughput by 60%",
			}),
		);
		expect(dateDisc?.rationale).toContain("2026-03-01");

		expect(figDisc).toEqual(
			expect.objectContaining({
				projectName: "API Gateway",
				type: "figure",
				aiValue: "60%",
				sourceValue: "not found in source data",
				sourceFile: "retro.md",
				bulletText: "Improved throughput by 60%",
			}),
		);
		expect(figDisc?.rationale).toContain("60%");
	});

	it("handles multiple discrepancies across multiple projects", () => {
		const context = makeContext({
			accomplishments: [
				makeAccomplishment({
					projectName: "Dashboard",
					bullets: [
						{
							text: "Fake date",
							subBullets: [],
							sourceDates: ["2099-01-01"],
							sourceFigures: [],
							sourceNoteFile: "standup.md",
						},
					],
				}),
				makeAccomplishment({
					projectName: "API",
					projectGid: "gid-2",
					bullets: [
						{
							text: "Fake figure",
							subBullets: [],
							sourceDates: [],
							sourceFigures: ["999%"],
							sourceNoteFile: "standup.md",
						},
					],
				}),
			],
		});

		const result = validateFactualClaims(context);

		expect(result).toHaveLength(2);
		expect(result[0].projectName).toBe("Dashboard");
		expect(result[1].projectName).toBe("API");
	});

	it("handles empty accomplishments array", () => {
		const context = makeContext({ accomplishments: [] });
		const result = validateFactualClaims(context);
		expect(result).toEqual([]);
	});

	it("handles bullets with no sourceDates or sourceFigures", () => {
		const context = makeContext({
			accomplishments: [
				makeAccomplishment({
					bullets: [
						{
							text: "General improvement",
							subBullets: [],
							sourceDates: [],
							sourceFigures: [],
							sourceNoteFile: "standup.md",
						},
					],
				}),
			],
		});

		const result = validateFactualClaims(context);
		expect(result).toEqual([]);
	});

	it("validates figures found in Asana custom fields", () => {
		const context = makeContext({
			accomplishments: [
				makeAccomplishment({
					bullets: [
						{
							text: "Budget of $50K allocated",
							subBullets: [],
							sourceDates: [],
							sourceFigures: ["$50K"],
							sourceNoteFile: "standup.md",
						},
					],
				}),
			],
			projects: [makeProject({ customFields: { budget: "$50K" } })],
		});

		const result = validateFactualClaims(context);
		expect(result).toEqual([]);
	});
});
