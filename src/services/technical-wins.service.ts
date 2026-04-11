import { createHash } from "node:crypto";
import type {
	TechnicalFoundationalWinsCategory,
	TechnicalFoundationalWinsResult,
} from "../core/types.js";
import { getEnv } from "../lib/env.js";
import type { TechnicalWinsSubheadings } from "./ai-prompts.js";

/**
 * Parse the TECHNICAL_WINS_SUBHEADINGS env var into the typed
 * {@link TechnicalWinsSubheadings} form accepted by the prompt builder.
 *
 * Values:
 *   - empty / "auto"   → "auto" (AI infers groupings)
 *   - "A, B, C"         → ["A", "B", "C"]
 */
export function resolveTechnicalWinsSubheadings(
	raw?: string,
): TechnicalWinsSubheadings {
	const value = (raw ?? getEnv("TECHNICAL_WINS_SUBHEADINGS") ?? "").trim();
	if (!value || value.toLowerCase() === "auto") {
		return "auto";
	}
	const parts = value
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	return parts.length > 0 ? parts : "auto";
}

/**
 * Content-addressable hash for Technical / Foundational Wins caching.
 * Includes every field that influences the AI prompt so the key changes
 * whenever the prompt inputs change.
 */
export function hashTechnicalWinsInput(args: {
	currentWeekItems: string[];
	previousWeekItems: string[];
	verbosity: string;
	subheadings: TechnicalWinsSubheadings;
	audience: string | undefined;
	windowStart: string;
	windowEnd: string;
	visibleWinsSummary?: string;
	roadmapContext?: string;
}): string {
	const payload = JSON.stringify({
		currentWeekItems: args.currentWeekItems,
		previousWeekItems: args.previousWeekItems,
		verbosity: args.verbosity,
		subheadings: args.subheadings,
		audience: args.audience ?? "",
		windowStart: args.windowStart,
		windowEnd: args.windowEnd,
		visibleWinsSummary: args.visibleWinsSummary ?? "",
		roadmapContext: args.roadmapContext ?? "",
	});
	return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/**
 * Normalize an AI-generated Technical / Foundational Wins result:
 *   - Trim whitespace on category names and wins.
 *   - Drop empty wins.
 *   - Deduplicate wins across the entire result (case-insensitive).
 *   - Preserve empty-wins categories only if the category name is non-empty.
 */
export function normalizeTechnicalWinsResult(
	raw: TechnicalFoundationalWinsResult,
): TechnicalFoundationalWinsResult {
	const seenWins = new Set<string>();
	const categories: TechnicalFoundationalWinsCategory[] = [];

	for (const cat of raw.categories ?? []) {
		const dedupedWins: string[] = [];
		for (const win of cat.wins ?? []) {
			const normalized = (win ?? "").trim();
			if (normalized.length === 0) continue;
			const key = normalized.toLowerCase();
			if (seenWins.has(key)) continue;
			seenWins.add(key);
			dedupedWins.push(normalized);
		}
		const categoryName = (cat.category ?? "").trim();
		if (dedupedWins.length > 0 || categoryName.length > 0) {
			categories.push({
				category: categoryName,
				wins: dedupedWins,
			});
		}
	}

	return { categories };
}

/**
 * Flatten a Technical / Foundational Wins result into a list of bullet
 * strings, prefixed with their category name for disambiguation.
 * Used as prior-week input for deduplication on subsequent runs.
 */
export function flattenTechnicalWinsForDedup(
	result: TechnicalFoundationalWinsResult | string | undefined,
): string[] {
	if (!result) return [];
	if (typeof result === "string") {
		// Legacy snapshot format (PR #3 stored the raw markdown string).
		return result
			.split("\n")
			.map((line) => line.replace(/^[#*\-\s]+/, "").trim())
			.filter((line) => line.length > 0);
	}
	const out: string[] = [];
	for (const cat of result.categories ?? []) {
		for (const win of cat.wins ?? []) {
			const trimmed = win.trim();
			if (trimmed.length === 0) continue;
			out.push(cat.category ? `${cat.category}: ${trimmed}` : trimmed);
		}
	}
	return out;
}
