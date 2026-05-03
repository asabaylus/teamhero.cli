import {
	getRubricItem,
	MATURITY_BANDS,
	MAX_RAW_SCORE,
	MAX_WEIGHTED_SCORE,
	RUBRIC_CATEGORIES,
} from "./rubric.js";
import type {
	CategoryId,
	ItemScore,
	MaturityBand,
	MaturityBandName,
} from "./types.js";

/**
 * Per-item numeric value, treating "n/a" as null.
 */
function scoreNumeric(score: ItemScore["score"]): number | null {
	if (score === "n/a") return null;
	return score;
}

export interface CategorySubtotal {
	id: CategoryId;
	rawSum: number; // sum of 0/0.5/1 values, ignoring n/a
	weighted: number; // rawSum × weight
	maxRaw: number; // adjusted for n/a
	maxWeighted: number; // adjusted for n/a
}

export function categorySubtotals(items: ItemScore[]): CategorySubtotal[] {
	return RUBRIC_CATEGORIES.map((cat) => {
		const inCat = items.filter((s) => {
			const item = getRubricItem(s.itemId);
			return item.categoryId === cat.id;
		});

		let rawSum = 0;
		let countAssessed = 0;
		for (const s of inCat) {
			const numeric = scoreNumeric(s.score);
			if (numeric === null) continue;
			rawSum += numeric;
			countAssessed += 1;
		}

		const weighted = rawSum * cat.weight;
		const maxRaw = countAssessed; // each assessed item contributes max 1.0 to raw
		const maxWeighted = countAssessed * cat.weight;

		return {
			id: cat.id,
			rawSum,
			weighted,
			maxRaw,
			maxWeighted,
		};
	});
}

export interface OverallScore {
	rawScore: number;
	rawScoreMax: number;
	weightedScore: number;
	weightedScoreMax: number;
	scorePercent: number;
	band: MaturityBand;
}

export function computeOverallScore(items: ItemScore[]): OverallScore {
	const subtotals = categorySubtotals(items);

	const rawScore = subtotals.reduce((sum, s) => sum + s.rawSum, 0);
	const rawScoreMax = subtotals.reduce((sum, s) => sum + s.maxRaw, 0);
	const weightedScore = subtotals.reduce((sum, s) => sum + s.weighted, 0);
	const weightedScoreMax = subtotals.reduce((sum, s) => sum + s.maxWeighted, 0);

	const scorePercent =
		weightedScoreMax > 0 ? (weightedScore / weightedScoreMax) * 100 : 0;
	const band = classifyBand(scorePercent);

	return {
		rawScore,
		rawScoreMax,
		weightedScore,
		weightedScoreMax,
		scorePercent,
		band,
	};
}

export function classifyBand(scorePercent: number): MaturityBand {
	for (const band of MATURITY_BANDS) {
		if (scorePercent >= band.min && scorePercent <= band.max) {
			return band;
		}
	}
	// Fallback — shouldn't happen given the bands cover the full range
	return MATURITY_BANDS[MATURITY_BANDS.length - 1];
}

export function bandByName(name: MaturityBandName): MaturityBand {
	const band = MATURITY_BANDS.find((b) => b.name === name);
	if (!band) {
		throw new Error(`Unknown maturity band: ${name}`);
	}
	return band;
}

/** Returns the unweighted-max constants for diagnostics. */
export function maxScores(): { raw: number; weighted: number } {
	return { raw: MAX_RAW_SCORE, weighted: MAX_WEIGHTED_SCORE };
}

/**
 * Validate that a list of ItemScores covers all 12 items exactly once.
 * Returns missing item IDs (empty array if valid).
 */
export function findMissingItems(items: ItemScore[]): number[] {
	const expected = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
	for (const s of items) expected.delete(s.itemId);
	return [...expected].sort((a, b) => a - b);
}
