/**
 * Value types specific to the Agent Maturity Assessment feature.
 *
 * Port interfaces live in src/core/types.ts (see MaturityProvider, InterviewTransport,
 * AuditStore there). This file holds concrete data shapes only.
 */

/** Bumped whenever the rubric content or scoring math changes. Cache key includes this. */
export const RUBRIC_VERSION = "1.0.0";

export type EvidenceTier = "gh" | "github-mcp" | "git-only";

export type CategoryId = "A" | "B" | "C" | "D";

export type ItemScoreValue = 0 | 0.5 | 1 | "n/a";

export interface RubricItem {
	/** Item number 1–12, used in tables and IDs. */
	id: number;
	/** Stable string id (e.g. "reproducible-dev-environments"). */
	slug: string;
	/** Short title used in score tables. */
	title: string;
	/** Category identifier (A/B/C/D). */
	categoryId: CategoryId;
	/** Score-level definitions: what 1.0 / 0.5 / 0.0 look like. */
	scoreLevels: { one: string; half: string; zero: string };
	/** Repo-check guidance — single sentence describing where to look. */
	repoCheck?: string;
	/** Diagnostic shell commands referenced in criteria.md. Markdown lines. */
	diagnosticCommands: string[];
	/** Why this item matters — used as supporting context for the AI prompt. */
	whyItMatters: string;
	/**
	 * Phase-1 interview question id this item depends on (if any).
	 * "primary" = item is scored mainly from interview; "combine" = combined with repo evidence.
	 */
	interviewLink?: {
		questionId: InterviewQuestionId;
		mode: "primary" | "combine";
	};
	/**
	 * If true, tier-3 (git-only) audits cap this item at 0.5 — GitHub-side data is required
	 * to confidently award 1.0 (per references/preflight.md).
	 */
	tier3Cap?: boolean;
}

export interface RubricCategory {
	id: CategoryId;
	title: string;
	weight: number;
	maxRaw: number;
	maxWeighted: number;
	itemIds: number[];
}

export type InterviewQuestionId =
	| "q1"
	| "q2"
	| "q3"
	| "q4"
	| "q5"
	| "q6"
	| "q7";

export interface InterviewQuestion {
	id: InterviewQuestionId;
	prompt: string;
	options: string[];
	/** When true, allow the user to enter free-text (in addition to choosing an option). */
	allowFreeText: boolean;
	/** CONFIG.md heading the answer is stored under. */
	configHeading: string;
}

export interface InterviewAnswer {
	questionId: InterviewQuestionId;
	/** Verbatim answer text. "unknown" → maps to n/a for the linked criterion. */
	value: string;
	/** True if the user chose an option; false if they used free-text. */
	isOption: boolean;
}

/** A single piece of evidence for an item, gathered by a deterministic detector. */
export interface EvidenceFact {
	/** The item this evidence supports. */
	itemId: number;
	/** Signal strength: positive (counts toward 1.0), neutral, or negative. */
	signal: "positive" | "neutral" | "negative";
	/** Human-readable summary used in the AI prompt and JSON output. */
	summary: string;
	/** Optional structured details for debugging / re-audit. */
	details?: Record<string, unknown>;
	/** The collector that produced this fact (for traceability). */
	source: string;
}

export interface ScopeDescriptor {
	mode: "org" | "local-repo" | "both";
	org?: string;
	repos?: string[];
	localPath?: string;
	/** Human-friendly name used in the audit title and filename. */
	displayName: string;
}

export interface AdjacentRepo {
	owner: string;
	name: string;
	/** Why we think this repo is adjacent (e.g. "uses: in workflow", "tf module"). */
	reason: string;
}

export interface ItemScore {
	itemId: number;
	score: ItemScoreValue;
	whyThisScore: string;
}

export interface TopFix {
	itemId: number;
	owner?: string;
	whatGoodLooksLike: string;
	whyThisOne: string;
}

export interface AssessmentArtifact {
	scope: ScopeDescriptor;
	tier: EvidenceTier;
	rubricVersion: string;
	auditDate: string;
	items: ItemScore[];
	topFixes: TopFix[];
	strengths: string[];
	oneLineTake: string;
	adjacentRepos: AdjacentRepo[];
	notesForReaudit: string[];
	interviewAnswers: InterviewAnswer[];
	rawScore: number;
	rawScoreMax: number;
	weightedScore: number;
	weightedScoreMax: number;
	scorePercent: number;
	band: MaturityBandName;
	categorySubtotals: Array<{
		id: CategoryId;
		raw: number;
		weighted: number;
		max: number;
	}>;
}

export type MaturityBandName =
	| "Excellent"
	| "Healthy"
	| "Functional but slow"
	| "Significant dysfunction"
	| "Triage";

export interface MaturityBand {
	name: MaturityBandName;
	min: number;
	max: number;
	rangeLabel: string;
	interpretation: string;
}

/** Top-level command input — what scripts/run-assess.ts reads from stdin. */
export interface AssessCommandInput {
	scope: ScopeDescriptor;
	/** Override tier detection. Default: "auto". */
	evidenceTier?: EvidenceTier | "auto";
	/** Path to a JSON file with pre-supplied interview answers (headless mode). */
	interviewAnswersPath?: string;
	/** Override audit output path. Default: ./teamhero-maturity-<scope>-<date>.md */
	outputPath?: string;
	/** Output format. Default: "both". */
	outputFormat?: "markdown" | "json" | "both";
	/** Flush cached assessment(s) before running. */
	flushCache?: boolean;
	/** Skip the AI scorer (useful for tests / debugging). */
	dryRun?: boolean;
	mode?: "interactive" | "headless";
	/** When true, allow stdin to receive interview-answer events from the TUI. */
	interactiveInterview?: boolean;
}

export interface AssessResult {
	outputPath: string;
	jsonOutputPath?: string;
	artifact: AssessmentArtifact;
}
