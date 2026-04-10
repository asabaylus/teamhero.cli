import { createHash } from "node:crypto";
import type {
	WeeklyWinsCategory,
	WeeklyWinsConfig,
	WeeklyWinsResult,
} from "../core/types.js";

/**
 * Default configuration for the weekly wins section.
 * Used when no explicit config is provided.
 */
export const DEFAULT_WEEKLY_WINS_CONFIG: WeeklyWinsConfig = {
	subheadings: "auto",
	verbosity: "medium",
	audience: "CTO and executive leadership",
	enabled: true,
};

/** Input data for the weekly wins generator. */
export interface WeeklyWinsInput {
	/** Raw notes, updates, or bullet points for this week. */
	currentWeekData: string;
	/** Last week's generated weekly wins section (for deduplication). */
	previousReport?: string;
	/** Configuration overrides. */
	config?: Partial<WeeklyWinsConfig>;
}

/** Resolved configuration merging defaults with user overrides. */
export function resolveWeeklyWinsConfig(
	overrides?: Partial<WeeklyWinsConfig>,
): WeeklyWinsConfig {
	return {
		...DEFAULT_WEEKLY_WINS_CONFIG,
		...overrides,
	};
}

/**
 * Content-addressable hash for weekly wins caching.
 * Includes all fields that influence the AI prompt so the key changes
 * whenever the prompt inputs change.
 */
export function hashWeeklyWinsInput(
	currentWeekData: string,
	previousReport: string | undefined,
	config: WeeklyWinsConfig,
): string {
	const payload = JSON.stringify({
		currentWeekData,
		previousReport: previousReport ?? "",
		subheadings: config.subheadings,
		verbosity: config.verbosity,
		audience: config.audience,
	});
	return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/**
 * Render weekly wins result into markdown format.
 * Returns the section as a string using `* Category` / `** Win` format.
 */
export function renderWeeklyWinsMarkdown(result: WeeklyWinsResult): string {
	const parts: string[] = [];
	parts.push("## This Week's Technical / Foundational Wins");
	parts.push("");

	for (const category of result.categories) {
		parts.push(`* ${category.category}`);
		for (const win of category.wins) {
			parts.push(`** ${win}`);
		}
		parts.push("");
	}

	return parts.join("\n").trimEnd();
}

/**
 * Validate and normalize AI-generated weekly wins output.
 * Ensures deduplication across categories and filters empty entries.
 */
export function normalizeWeeklyWinsResult(
	raw: WeeklyWinsResult,
): WeeklyWinsResult {
	const seenWins = new Set<string>();
	const categories: WeeklyWinsCategory[] = [];

	for (const cat of raw.categories) {
		const dedupedWins: string[] = [];
		for (const win of cat.wins) {
			const normalized = win.trim();
			if (normalized.length === 0) continue;
			const key = normalized.toLowerCase();
			if (seenWins.has(key)) continue;
			seenWins.add(key);
			dedupedWins.push(normalized);
		}
		if (dedupedWins.length > 0 || cat.category.trim().length > 0) {
			categories.push({
				category: cat.category.trim(),
				wins: dedupedWins,
			});
		}
	}

	return { categories };
}
