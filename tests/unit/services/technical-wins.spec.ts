import { describe, expect, it, spyOn } from "bun:test";
import type { TechnicalFoundationalWinsResult } from "../../../src/core/types.js";
import * as envMod from "../../../src/lib/env.js";

const {
	flattenTechnicalWinsForDedup,
	hashTechnicalWinsInput,
	normalizeTechnicalWinsResult,
	resolveTechnicalWinsSubheadings,
} = await import(
	new URL("../../../src/services/technical-wins.service.ts", import.meta.url)
		.href
);

// ---------------------------------------------------------------------------
// resolveTechnicalWinsSubheadings
// ---------------------------------------------------------------------------

describe("resolveTechnicalWinsSubheadings", () => {
	it("returns 'auto' for empty input", () => {
		expect(resolveTechnicalWinsSubheadings("")).toBe("auto");
	});

	it("returns 'auto' for explicit 'auto'", () => {
		expect(resolveTechnicalWinsSubheadings("auto")).toBe("auto");
	});

	it("is case-insensitive for 'auto'", () => {
		expect(resolveTechnicalWinsSubheadings("AUTO")).toBe("auto");
		expect(resolveTechnicalWinsSubheadings("Auto")).toBe("auto");
	});

	it("parses comma-separated subheadings into an array", () => {
		expect(
			resolveTechnicalWinsSubheadings("AI / Engineering, IT / Centre, DevOps"),
		).toEqual(["AI / Engineering", "IT / Centre", "DevOps"]);
	});

	it("trims whitespace and drops empty entries", () => {
		expect(resolveTechnicalWinsSubheadings(" A ,  ,B , ")).toEqual(["A", "B"]);
	});

	it("falls back to 'auto' when only separators are given", () => {
		expect(resolveTechnicalWinsSubheadings(", , ,")).toBe("auto");
	});

	it("reads from TECHNICAL_WINS_SUBHEADINGS env when no argument is given", () => {
		const getEnvSpy = spyOn(envMod, "getEnv").mockReturnValue("AI, DevOps");
		try {
			expect(resolveTechnicalWinsSubheadings()).toEqual(["AI", "DevOps"]);
		} finally {
			getEnvSpy.mockRestore();
		}
	});
});

// ---------------------------------------------------------------------------
// hashTechnicalWinsInput
// ---------------------------------------------------------------------------

describe("hashTechnicalWinsInput", () => {
	const baseArgs = {
		currentWeekItems: ["a", "b"],
		previousWeekItems: [],
		verbosity: "standard",
		subheadings: "auto" as const,
		audience: "CTO",
		windowStart: "2026-04-03",
		windowEnd: "2026-04-10",
	};

	it("produces a 16-char hex hash", () => {
		expect(hashTechnicalWinsInput(baseArgs)).toMatch(/^[0-9a-f]{16}$/);
	});

	it("is deterministic for identical inputs", () => {
		expect(hashTechnicalWinsInput(baseArgs)).toBe(
			hashTechnicalWinsInput(baseArgs),
		);
	});

	it("changes when currentWeekItems changes", () => {
		expect(hashTechnicalWinsInput(baseArgs)).not.toBe(
			hashTechnicalWinsInput({
				...baseArgs,
				currentWeekItems: ["a", "b", "c"],
			}),
		);
	});

	it("changes when previousWeekItems changes", () => {
		expect(hashTechnicalWinsInput(baseArgs)).not.toBe(
			hashTechnicalWinsInput({
				...baseArgs,
				previousWeekItems: ["old win"],
			}),
		);
	});

	it("changes when verbosity changes", () => {
		expect(hashTechnicalWinsInput(baseArgs)).not.toBe(
			hashTechnicalWinsInput({ ...baseArgs, verbosity: "detailed" }),
		);
	});

	it("changes when subheadings changes", () => {
		expect(hashTechnicalWinsInput(baseArgs)).not.toBe(
			hashTechnicalWinsInput({
				...baseArgs,
				subheadings: ["AI", "DevOps"],
			}),
		);
	});

	it("changes when audience changes", () => {
		expect(hashTechnicalWinsInput(baseArgs)).not.toBe(
			hashTechnicalWinsInput({ ...baseArgs, audience: "Engineers" }),
		);
	});

	it("treats missing audience as empty string", () => {
		const withUndefined = hashTechnicalWinsInput({
			...baseArgs,
			audience: undefined,
		});
		const withEmpty = hashTechnicalWinsInput({ ...baseArgs, audience: "" });
		expect(withUndefined).toBe(withEmpty);
	});

	it("changes when the reporting window shifts", () => {
		expect(hashTechnicalWinsInput(baseArgs)).not.toBe(
			hashTechnicalWinsInput({ ...baseArgs, windowStart: "2026-04-04" }),
		);
	});

	it("changes when visibleWinsSummary changes", () => {
		expect(hashTechnicalWinsInput(baseArgs)).not.toBe(
			hashTechnicalWinsInput({
				...baseArgs,
				visibleWinsSummary: "GCCW\n* Pilot on track",
			}),
		);
	});

	it("treats missing visibleWinsSummary as empty string", () => {
		const withUndefined = hashTechnicalWinsInput(baseArgs);
		const withEmpty = hashTechnicalWinsInput({
			...baseArgs,
			visibleWinsSummary: "",
		});
		expect(withUndefined).toBe(withEmpty);
	});

	it("changes when roadmapContext changes", () => {
		expect(hashTechnicalWinsInput(baseArgs)).not.toBe(
			hashTechnicalWinsInput({
				...baseArgs,
				roadmapContext: "- GCCW v1.x\n- SOC 2 Type 1",
			}),
		);
	});

	it("treats missing roadmapContext as empty string", () => {
		const withUndefined = hashTechnicalWinsInput(baseArgs);
		const withEmpty = hashTechnicalWinsInput({
			...baseArgs,
			roadmapContext: "",
		});
		expect(withUndefined).toBe(withEmpty);
	});
});

// ---------------------------------------------------------------------------
// normalizeTechnicalWinsResult
// ---------------------------------------------------------------------------

describe("normalizeTechnicalWinsResult", () => {
	it("deduplicates wins within a category", () => {
		const raw: TechnicalFoundationalWinsResult = {
			categories: [
				{
					category: "AI",
					wins: ["Deployed model A", "Deployed model A", "Deployed model B"],
				},
			],
		};
		expect(normalizeTechnicalWinsResult(raw).categories[0].wins).toEqual([
			"Deployed model A",
			"Deployed model B",
		]);
	});

	it("deduplicates wins across categories case-insensitively", () => {
		const raw: TechnicalFoundationalWinsResult = {
			categories: [
				{ category: "AI", wins: ["Deployed model A"] },
				{ category: "DevOps", wins: ["deployed model a", "New pipeline"] },
			],
		};
		const result = normalizeTechnicalWinsResult(raw);
		expect(result.categories[0].wins).toEqual(["Deployed model A"]);
		expect(result.categories[1].wins).toEqual(["New pipeline"]);
	});

	it("filters empty and whitespace-only wins", () => {
		const raw: TechnicalFoundationalWinsResult = {
			categories: [{ category: "IT", wins: ["", "  ", "Real win"] }],
		};
		expect(normalizeTechnicalWinsResult(raw).categories[0].wins).toEqual([
			"Real win",
		]);
	});

	it("trims whitespace on category names and wins", () => {
		const raw: TechnicalFoundationalWinsResult = {
			categories: [{ category: "  AI / Engineering  ", wins: ["  Win one  "] }],
		};
		const result = normalizeTechnicalWinsResult(raw);
		expect(result.categories[0].category).toBe("AI / Engineering");
		expect(result.categories[0].wins[0]).toBe("Win one");
	});

	it("preserves categories whose wins are all empty as long as the name is non-empty", () => {
		const raw: TechnicalFoundationalWinsResult = {
			categories: [{ category: "DevOps", wins: [] }],
		};
		const result = normalizeTechnicalWinsResult(raw);
		expect(result.categories).toHaveLength(1);
		expect(result.categories[0].category).toBe("DevOps");
	});

	it("drops categories with both empty name and no wins", () => {
		const raw: TechnicalFoundationalWinsResult = {
			categories: [
				{ category: "", wins: [] },
				{ category: "IT", wins: ["Real win"] },
			],
		};
		const result = normalizeTechnicalWinsResult(raw);
		expect(result.categories).toHaveLength(1);
		expect(result.categories[0].category).toBe("IT");
	});

	it("tolerates missing categories array", () => {
		const raw = {} as TechnicalFoundationalWinsResult;
		expect(normalizeTechnicalWinsResult(raw).categories).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// flattenTechnicalWinsForDedup
// ---------------------------------------------------------------------------

describe("flattenTechnicalWinsForDedup", () => {
	it("returns an empty list for undefined input", () => {
		expect(flattenTechnicalWinsForDedup(undefined)).toEqual([]);
	});

	it("prefixes wins with their category name when flattening a typed result", () => {
		const result: TechnicalFoundationalWinsResult = {
			categories: [
				{ category: "AI", wins: ["Win A", "Win B"] },
				{ category: "DevOps", wins: ["Win C"] },
			],
		};
		expect(flattenTechnicalWinsForDedup(result)).toEqual([
			"AI: Win A",
			"AI: Win B",
			"DevOps: Win C",
		]);
	});

	it("parses the legacy markdown-string snapshot format", () => {
		const legacy =
			"## This Week's Technical / Foundational Wins\n\n### AI\n* Deployed model A\n* Deployed model B";
		expect(flattenTechnicalWinsForDedup(legacy)).toEqual([
			"This Week's Technical / Foundational Wins",
			"AI",
			"Deployed model A",
			"Deployed model B",
		]);
	});

	it("skips empty wins when flattening", () => {
		const result: TechnicalFoundationalWinsResult = {
			categories: [{ category: "AI", wins: ["", "Real win", "  "] }],
		};
		expect(flattenTechnicalWinsForDedup(result)).toEqual(["AI: Real win"]);
	});
});
