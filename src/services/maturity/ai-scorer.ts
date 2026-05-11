import { type ConsolaInstance, consola } from "consola";
import OpenAI from "openai";
import { getEnv } from "../../lib/env.js";
import {
	buildMaturityPrompt,
	MATURITY_ASSESSMENT_SCHEMA,
	type MaturityScoringContext,
} from "./maturity-prompts.js";
import { RUBRIC_ITEMS } from "./rubric.js";
import type { ItemScore, ItemScoreValue, TopFix } from "./types.js";

export interface MaturityAIResult {
	oneLineTake: string;
	items: ItemScore[];
	topFixes: TopFix[];
	strengths: string[];
	notesForReaudit: string[];
}

export interface MaturityAIScorerOptions {
	apiKey?: string;
	model?: string;
	baseUrl?: string;
	logger?: ConsolaInstance;
	/** Set true in tests / dry-run to skip the network call. */
	dryRun?: boolean;
}

const TIER3_CAPPED = new Set([2, 3, 9, 11]);

/**
 * Convert a score string produced by the AI into a typed `ItemScoreValue`.
 *
 * @param raw - The raw score string (expected: `"0"`, `"1"`, `"0.5"`, or `"n/a"`).
 * @returns `0`, `1`, `0.5`, or `"n/a"` corresponding to the input string.
 * @throws Error if `raw` is not one of the expected strings.
 */
function parseScore(raw: string): ItemScoreValue {
	if (raw === "0") return 0;
	if (raw === "1") return 1;
	if (raw === "0.5") return 0.5;
	if (raw === "n/a") return "n/a";
	throw new Error(`Invalid score string: ${raw}`);
}

/**
 * Apply tier-3 capping rules to item scores for git-only audits.
 *
 * For `tier === "git-only"`, any item whose `itemId` is in `TIER3_CAPPED` and
 * whose score equals `1` will be downgraded to `0.5` and have a marker
 * appended to `whyThisScore`. Returns the adjusted items and explanatory notes.
 *
 * @param items - The list of item scores to process
 * @param tier - The audit tier; caps are applied only when equal to `"git-only"`
 * @returns An object containing `items` (the possibly modified scores) and `notes` (explanations for any caps applied)
 */
function applyTier3Caps(
	items: ItemScore[],
	tier: MaturityScoringContext["tier"],
): { items: ItemScore[]; notes: string[] } {
	if (tier !== "git-only") return { items, notes: [] };
	const notes: string[] = [];
	const capped = items.map((s) => {
		if (TIER3_CAPPED.has(s.itemId) && s.score === 1) {
			notes.push(
				`Item ${s.itemId} was capped at 0.5 by the tier-3 rule (no GitHub-side evidence available).`,
			);
			return {
				...s,
				score: 0.5 as ItemScoreValue,
				whyThisScore: `${s.whyThisScore} [Tier-3 cap applied.]`,
			};
		}
		return s;
	});
	return { items: capped, notes };
}

/**
 * Ensures the returned item list includes every rubric item (IDs 1–12) by adding neutral placeholders for any missing entries.
 *
 * @returns An object with `items`: the original items augmented with placeholder `ItemScore` entries for missing rubric IDs (sorted by `itemId`), and `missing`: an array of rubric IDs that were absent from the input.
 */
function ensureAllItems(items: ItemScore[]): {
	items: ItemScore[];
	missing: number[];
} {
	const seen = new Set(items.map((i) => i.itemId));
	const missing: number[] = [];
	const filled = [...items];
	for (const item of RUBRIC_ITEMS) {
		if (!seen.has(item.id)) {
			missing.push(item.id);
			filled.push({
				itemId: item.id,
				score: "n/a",
				whyThisScore: "Missing from AI response — rescore in next audit.",
			});
		}
	}
	filled.sort((a, b) => a.itemId - b.itemId);
	return { items: filled, missing };
}

export class MaturityAIScorer {
	private readonly apiKey?: string;
	private readonly model: string;
	private readonly baseUrl?: string;
	private readonly logger: ConsolaInstance;
	private readonly dryRun: boolean;

	constructor(options: MaturityAIScorerOptions = {}) {
		this.apiKey = options.apiKey ?? getEnv("OPENAI_API_KEY") ?? undefined;
		this.model =
			options.model ??
			getEnv("MATURITY_AI_MODEL") ??
			getEnv("AI_MODEL") ??
			"gpt-5-mini";
		this.baseUrl = options.baseUrl ?? getEnv("OPENAI_BASE_URL") ?? undefined;
		this.logger = options.logger ?? consola.withTag("maturity-ai");
		this.dryRun = options.dryRun ?? false;
	}

	async score(context: MaturityScoringContext): Promise<MaturityAIResult> {
		const prompt = buildMaturityPrompt(context);

		if (this.dryRun) {
			return this.dryRunResult();
		}

		if (!this.apiKey) {
			throw new Error(
				"OPENAI_API_KEY required for maturity assessment AI scoring (or pass --dry-run for a placeholder).",
			);
		}

		const client = new OpenAI({
			apiKey: this.apiKey,
			...(this.baseUrl ? { baseURL: this.baseUrl } : {}),
		});

		this.logger.debug(
			`Maturity AI scoring (model=${this.model}, prompt=${prompt.length} chars)`,
		);

		const response = await client.responses.create({
			model: this.model,
			input: prompt,
			text: { format: MATURITY_ASSESSMENT_SCHEMA },
		} as Parameters<typeof client.responses.create>[0]);

		const outputText = (response as unknown as Record<string, unknown>)
			.output_text as string | undefined;

		if (!outputText) {
			throw new Error("Empty AI response for maturity assessment");
		}

		const parsed = JSON.parse(outputText) as {
			oneLineTake: string;
			items: Array<{ itemId: number; score: string; whyThisScore: string }>;
			topFixes: Array<{
				itemId: number;
				whyThisOne: string;
				whatGoodLooksLike: string;
				owner: string;
			}>;
			strengths: string[];
			notesForReaudit: string[];
		};

		const itemScores: ItemScore[] = parsed.items.map((i) => ({
			itemId: i.itemId,
			score: parseScore(i.score),
			whyThisScore: i.whyThisScore,
		}));

		const { items: capped, notes: capNotes } = applyTier3Caps(
			itemScores,
			context.tier,
		);
		const { items: filled, missing } = ensureAllItems(capped);

		const notes = [...parsed.notesForReaudit, ...capNotes];
		if (missing.length > 0) {
			notes.push(`AI response was missing item(s): ${missing.join(", ")}.`);
		}

		const topFixes: TopFix[] = parsed.topFixes.map((f) => {
			const fix: TopFix = {
				itemId: f.itemId,
				whyThisOne: f.whyThisOne,
				whatGoodLooksLike: f.whatGoodLooksLike,
			};
			if (f.owner && f.owner.toLowerCase() !== "unassigned") {
				fix.owner = f.owner;
			}
			return fix;
		});

		return {
			oneLineTake: parsed.oneLineTake,
			items: filled,
			topFixes,
			strengths: parsed.strengths,
			notesForReaudit: notes,
		};
	}

	private dryRunResult(): MaturityAIResult {
		const items: ItemScore[] = RUBRIC_ITEMS.map((item) => ({
			itemId: item.id,
			score: 0.5 as ItemScoreValue,
			whyThisScore:
				"Dry-run placeholder — rerun without --dry-run for real scoring.",
		}));
		return {
			oneLineTake: "Dry-run audit — no AI scoring performed.",
			items,
			topFixes: [],
			strengths: [],
			notesForReaudit: ["Dry-run mode was active — rerun without --dry-run."],
		};
	}
}
