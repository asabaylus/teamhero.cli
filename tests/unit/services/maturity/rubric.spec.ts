import { describe, expect, it } from "bun:test";
import {
	getCategory,
	getRubricItem,
	MATURITY_BANDS,
	MAX_RAW_SCORE,
	MAX_WEIGHTED_SCORE,
	RUBRIC_CATEGORIES,
	RUBRIC_ITEMS,
} from "../../../../src/services/maturity/rubric.js";
import { RUBRIC_VERSION } from "../../../../src/services/maturity/types.js";

describe("rubric", () => {
	it("has exactly 12 items", () => {
		expect(RUBRIC_ITEMS).toHaveLength(12);
	});

	it("item ids are 1..12 with no gaps", () => {
		const ids = RUBRIC_ITEMS.map((i) => i.id).sort((a, b) => a - b);
		expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
	});

	it("category weights sum to the documented max weighted score", () => {
		const total = RUBRIC_CATEGORIES.reduce((sum, c) => sum + c.maxWeighted, 0);
		expect(total).toBeCloseTo(MAX_WEIGHTED_SCORE, 5);
	});

	it("category item lists partition the 12 items", () => {
		const all = RUBRIC_CATEGORIES.flatMap((c) => c.itemIds).sort(
			(a, b) => a - b,
		);
		expect(all).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		expect(all).toHaveLength(MAX_RAW_SCORE);
	});

	it("each item references a valid category", () => {
		for (const item of RUBRIC_ITEMS) {
			expect(["A", "B", "C", "D"]).toContain(item.categoryId);
			const cat = getCategory(item.categoryId);
			expect(cat.itemIds).toContain(item.id);
		}
	});

	it("category weights match the spec (A=1.0, B=1.5, C=1.25, D=1.0)", () => {
		expect(getCategory("A").weight).toBe(1.0);
		expect(getCategory("B").weight).toBe(1.5);
		expect(getCategory("C").weight).toBe(1.25);
		expect(getCategory("D").weight).toBe(1.0);
	});

	it("each item has non-empty score levels and whyItMatters", () => {
		for (const item of RUBRIC_ITEMS) {
			expect(item.scoreLevels.one.length).toBeGreaterThan(10);
			expect(item.scoreLevels.half.length).toBeGreaterThan(10);
			expect(item.scoreLevels.zero.length).toBeGreaterThan(5);
			expect(item.whyItMatters.length).toBeGreaterThan(20);
			expect(item.title.length).toBeGreaterThan(3);
		}
	});

	it("tier3Cap items are exactly 2, 3, 9, 11 (per preflight.md)", () => {
		const capped = RUBRIC_ITEMS.filter((i) => i.tier3Cap).map((i) => i.id);
		expect(capped.sort((a, b) => a - b)).toEqual([2, 3, 9, 11]);
	});

	it("getRubricItem throws for unknown id", () => {
		expect(() => getRubricItem(99)).toThrow();
	});

	it("maturity bands cover the full 0..100 range", () => {
		for (let pct = 0; pct <= 100; pct += 5) {
			const matched = MATURITY_BANDS.filter(
				(b) => pct >= b.min && pct <= b.max,
			);
			expect(matched).toHaveLength(1);
		}
	});

	it("rubric version is a non-empty string", () => {
		expect(RUBRIC_VERSION).toBeTruthy();
		expect(typeof RUBRIC_VERSION).toBe("string");
	});
});
