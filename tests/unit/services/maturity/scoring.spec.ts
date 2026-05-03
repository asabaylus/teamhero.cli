import { describe, expect, it } from "bun:test";
import {
	bandByName,
	categorySubtotals,
	classifyBand,
	computeOverallScore,
	findMissingItems,
} from "../../../../src/services/maturity/scoring.js";
import type { ItemScore } from "../../../../src/services/maturity/types.js";

function fillItems(score: 0 | 0.5 | 1): ItemScore[] {
	return Array.from({ length: 12 }, (_, idx) => ({
		itemId: idx + 1,
		score,
		whyThisScore: "test",
	}));
}

describe("computeOverallScore", () => {
	it("perfect score = 12 raw, 14.5 weighted, 100%", () => {
		const result = computeOverallScore(fillItems(1));
		expect(result.rawScore).toBe(12);
		expect(result.weightedScore).toBeCloseTo(14.5, 5);
		expect(result.scorePercent).toBe(100);
		expect(result.band.name).toBe("Excellent");
	});

	it("zero score = 0 raw, 0 weighted, 0%", () => {
		const result = computeOverallScore(fillItems(0));
		expect(result.rawScore).toBe(0);
		expect(result.weightedScore).toBe(0);
		expect(result.scorePercent).toBe(0);
		expect(result.band.name).toBe("Triage");
	});

	it("all 0.5 = 6 raw, 7.25 weighted, 50%", () => {
		const result = computeOverallScore(fillItems(0.5));
		expect(result.rawScore).toBe(6);
		expect(result.weightedScore).toBeCloseTo(7.25, 5);
		expect(result.scorePercent).toBeCloseTo(50, 5);
		expect(result.band.name).toBe("Significant dysfunction");
	});

	it("n/a items are excluded from numerator AND max", () => {
		const items: ItemScore[] = fillItems(1);
		// Mark item 12 (D, 1.0× weight) as n/a
		items[11] = { itemId: 12, score: "n/a", whyThisScore: "no info" };
		const result = computeOverallScore(items);
		// 11 items × 1.0 raw, max raw 11
		expect(result.rawScore).toBe(11);
		expect(result.rawScoreMax).toBe(11);
		// max weighted should drop by 1.0 (item 12's category D weight)
		expect(result.weightedScoreMax).toBeCloseTo(13.5, 5);
		expect(result.scorePercent).toBeCloseTo(100, 5);
	});

	it("n/a in category B (1.5×) drops max weighted by 1.5", () => {
		const items: ItemScore[] = fillItems(1);
		items[6] = { itemId: 7, score: "n/a", whyThisScore: "out of scope" };
		const result = computeOverallScore(items);
		expect(result.weightedScoreMax).toBeCloseTo(14.5 - 1.5, 5);
	});

	it("category B is weighted at 1.5×", () => {
		const items: ItemScore[] = fillItems(0);
		// Set item 5 (category B) to 1.0 — should produce 1.5 weighted
		items[4] = { itemId: 5, score: 1, whyThisScore: "" };
		const result = computeOverallScore(items);
		expect(result.weightedScore).toBeCloseTo(1.5, 5);
	});

	it("category C is weighted at 1.25×", () => {
		const items: ItemScore[] = fillItems(0);
		items[7] = { itemId: 8, score: 1, whyThisScore: "" };
		const result = computeOverallScore(items);
		expect(result.weightedScore).toBeCloseTo(1.25, 5);
	});
});

describe("classifyBand", () => {
	it("90% → Excellent", () => {
		expect(classifyBand(95).name).toBe("Excellent");
	});
	it("80% → Healthy", () => {
		expect(classifyBand(80).name).toBe("Healthy");
	});
	it("70% → Functional but slow", () => {
		expect(classifyBand(70).name).toBe("Functional but slow");
	});
	it("50% → Significant dysfunction", () => {
		expect(classifyBand(50).name).toBe("Significant dysfunction");
	});
	it("30% → Triage", () => {
		expect(classifyBand(30).name).toBe("Triage");
	});
	it("boundary 75% → Healthy", () => {
		expect(classifyBand(75).name).toBe("Healthy");
	});
	it("boundary 89.99% → Healthy", () => {
		expect(classifyBand(89.99).name).toBe("Healthy");
	});
});

describe("bandByName", () => {
	it("returns Healthy band by name", () => {
		expect(bandByName("Healthy").min).toBe(75);
	});
	it("throws for unknown band", () => {
		// @ts-expect-error
		expect(() => bandByName("Bogus")).toThrow();
	});
});

describe("categorySubtotals", () => {
	it("each category gets its weight applied", () => {
		const items = fillItems(1);
		const subs = categorySubtotals(items);
		const a = subs.find((s) => s.id === "A")!;
		const b = subs.find((s) => s.id === "B")!;
		const c = subs.find((s) => s.id === "C")!;
		const d = subs.find((s) => s.id === "D")!;
		expect(a.weighted).toBeCloseTo(4.0, 5);
		expect(b.weighted).toBeCloseTo(4.5, 5);
		expect(c.weighted).toBeCloseTo(5.0, 5);
		expect(d.weighted).toBeCloseTo(1.0, 5);
	});
});

describe("findMissingItems", () => {
	it("returns empty when all 12 present", () => {
		expect(findMissingItems(fillItems(1))).toEqual([]);
	});

	it("returns missing item ids", () => {
		const items = fillItems(1).filter((i) => i.itemId !== 7 && i.itemId !== 11);
		expect(findMissingItems(items)).toEqual([7, 11]);
	});
});
