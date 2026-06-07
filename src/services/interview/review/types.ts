/**
 * Evidence event types. These are the normalized stream that all four
 * collectors emit into. Downstream extractors and the AI observer consume
 * this stream uniformly.
 */

import type { DimensionId } from "../shared/rubric.js";

export type EvidenceSource =
	| "terminal.cast"
	| "interview.log"
	| "transcript"
	| "git"
	| "repo";

/** A single user-typed prompt to the AI agent. */
export interface PromptEvent {
	readonly type: "prompt";
	readonly timestamp: string; // ISO-8601
	readonly source: EvidenceSource;
	readonly text: string;
}

/** A tool call the agent issued. */
export interface ToolUseEvent {
	readonly type: "tool-use";
	readonly timestamp: string;
	readonly source: EvidenceSource;
	readonly tool: string;
	readonly input?: unknown;
}

/** A shell command observed in the terminal recording. */
export interface CommandEvent {
	readonly type: "command";
	readonly timestamp: string;
	readonly source: EvidenceSource;
	readonly command: string;
	/** Pause before the user hit Enter, in seconds. Useful for risk-awareness. */
	readonly pauseSecondsBeforeEnter?: number;
}

/** A git commit. */
export interface CommitEvent {
	readonly type: "commit";
	readonly timestamp: string;
	readonly source: "git";
	readonly sha: string;
	readonly message: string;
	readonly insertions: number;
	readonly deletions: number;
}

/** A line of the audio transcript. */
export interface TranscriptLineEvent {
	readonly type: "transcript-line";
	readonly timestamp: string;
	readonly source: "transcript";
	readonly speaker: string;
	readonly text: string;
}

export type EvidenceEvent =
	| PromptEvent
	| ToolUseEvent
	| CommandEvent
	| CommitEvent
	| TranscriptLineEvent;

/**
 * Per-dimension observation produced by the AI observer (LLM-judge + hybrid
 * dimensions). Mirrors the strict json_schema we validate the LLM response
 * against. No `score` field — by design.
 */
export interface Observation {
	readonly dimension_id: DimensionId;
	readonly observation: string;
	readonly reasoning: string;
	readonly evidence_excerpts: ReadonlyArray<{
		readonly timestamp?: string;
		readonly source: EvidenceSource;
		readonly content: string;
	}>;
	readonly caveats?: string;
}

/**
 * Per-dimension measurement produced by deterministic extractors and the
 * deterministic half of hybrid dimensions. Raw facts.
 */
export interface Measurement {
	readonly dimension_id: DimensionId;
	readonly facts: ReadonlyArray<{
		readonly label: string;
		readonly value: string | number;
		readonly context?: string;
	}>;
}

/** The top-level result emitted per candidate before audit-writer renders it. */
export interface ReviewResult {
	readonly rubric_version: string;
	readonly candidate_id: string;
	readonly role_slug: string;
	readonly observed_at: string; // ISO-8601 — never "scored_at"
	readonly observations: readonly Observation[];
	readonly measurements: readonly Measurement[];
	/** Free-form metadata captured at review time (e.g., interviewer notes path). */
	readonly metadata?: Readonly<Record<string, string>>;
}
