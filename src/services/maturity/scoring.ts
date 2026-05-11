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
 * Convert an item's score to a numeric value, returning `null` for `"n/a"`.
 *
 * @param score - The item's score, which may be a number or the string `"n/a"`
 * @returns The numeric score, or `null` if `score` is `"n/a"`
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

/**
 * Compute per-category subtotals for the provided item scores.
 *
 * Items with `"n/a"` scores are excluded from sums and assessment counts.
 *
 * @param items - Array of item scores to aggregate by rubric category
 * @returns An array of `CategorySubtotal` objects (one per rubric category, in the same order as `RUBRIC_CATEGORIES`). Each subtotal includes:
 * - `id`: category id
 * - `rawSum`: sum of numeric scores in the category
 * - `weighted`: `rawSum` multiplied by the category weight
 * - `maxRaw`: number of assessed items in the category (each contributes at most 1.0)
 * - `maxWeighted`: `maxRaw` multiplied by the category weight
 */
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

/**
 * Computes aggregated raw and weighted scores, the percent score, and its maturity band for the supplied item scores.
 *
 * @param items - Array of `ItemScore` entries to include; `"n/a"` scores are excluded from numeric aggregates.
 * @returns An `OverallScore` object containing:
 * - `rawScore`: sum of raw (unweighted) scores across categories
 * - `rawScoreMax`: maximum possible raw score given assessed items
 * - `weightedScore`: sum of category-weighted scores
 * - `weightedScoreMax`: maximum possible weighted score given assessed items
 * - `scorePercent`: weighted score expressed as a percentage of `weightedScoreMax` (0 when `weightedScoreMax` is 0)
 * - `band`: the maturity band corresponding to `scorePercent`
 */
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

/**
 * Selects the maturity band whose inclusive range contains the given score percentage.
 *
 * @param scorePercent - The score percentage (typically 0–100) to classify
 * @returns The `MaturityBand` whose `min`..`max` range includes `scorePercent`; if no band matches, returns the last entry of `MATURITY_BANDS` as a fallback
 */
export function classifyBand(scorePercent: number): MaturityBand {
	for (const band of MATURITY_BANDS) {
		if (scorePercent >= band.min && scorePercent <= band.max) {
			return band;
		}
	}
	// Fallback — shouldn't happen given the bands cover the full range
	return MATURITY_BANDS[MATURITY_BANDS.length - 1];
}

/**
 * Get the maturity band for the given band name.
 *
 * @param name - The name of the maturity band to look up
 * @returns The `MaturityBand` whose `name` matches `name`
 * @throws Error if no maturity band with the provided name exists
 */
export function bandByName(name: MaturityBandName): MaturityBand {
	const band = MATURITY_BANDS.find((b) => b.name === name);
	if (!band) {
		throw new Error(`Unknown maturity band: ${name}`);
	}
	return band;
}

/**
 * Provide the maximum attainable raw and weighted scores for diagnostics.
 *
 * @returns An object with `raw` equal to the maximum raw score and `weighted` equal to the maximum weighted score
 */
export function maxScores(): { raw: number; weighted: number } {
	return { raw: MAX_RAW_SCORE, weighted: MAX_WEIGHTED_SCORE };
}

/**
 * Identify which of the 12 expected rubric item IDs (1–12) are not present in the provided scores.
 *
 * This compares against the fixed set of expected IDs {1..12} and returns those that never appear in `items`.
 * Duplicate or extra entries in `items` are ignored; only the presence of an `itemId` matters.
 *
 * @param items - Array of scored items to check for coverage
 * @returns A sorted array of missing item IDs from 1 through 12; empty if all are present
 */
export function findMissingItems(items: ItemScore[]): number[] {
	const expected = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
	for (const s of items) expected.delete(s.itemId);
	return [...expected].sort((a, b) => a - b);
}
