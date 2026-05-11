import { readFileSync } from "node:fs";
import OpenAI from "openai";
import { getEnv } from "../../../lib/env.js";
import type { RoleConfig } from "../bootstrap/role-config.js";
import { getDimensions, getRubricVersion } from "../shared/rubric.js";
import type { EvidenceEvent, Observation } from "./types.js";

/**
 * AI observer. Produces narrative observations for the 5 LLM-judge and
 * hybrid dimensions. Refuses to emit numerical scores via strict json_schema.
 *
 * Critical commitments:
 *  - The interviewer-bias guard instruction appears verbatim in every prompt.
 *  - The strict json_schema lists ONLY the observation fields; no `score`,
 *    `weighted_total`, `band`. The Responses API rejects responses with
 *    extra fields at the provider level.
 *  - The session_recording_url (if provided as metadata) is NEVER included
 *    in the prompt input — it is metadata for the frontmatter only.
 */

export const INTERVIEWER_BIAS_GUARD = `The audio transcript and interviewer notes are provided as context about what was happening during the session. Treat the interviewer's verbal commentary as situational context only — do NOT weight it as evidence of the candidate's skill, competence, or character. Your observations must be grounded in the candidate's *actions* (prompts they wrote, tools they used, code they produced, tests they ran, decisions they made) — not in the interviewer's framing of those actions. If an interviewer remark could be interpreted multiple ways, do not let it bias your observation; rely on the directly observable artifacts (interview.log, terminal.cast, repo state).`;

const OBSERVABLE_DIMENSION_IDS = [
	"upfront-design",
	"context-engineering",
	"critical-evaluation",
	"course-correction",
	"architectural-quality",
] as const;

export const OBSERVATION_RESPONSE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["observations"],
	properties: {
		observations: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: [
					"dimension_id",
					"observation",
					"reasoning",
					"evidence_excerpts",
				],
				properties: {
					dimension_id: {
						type: "string",
						enum: OBSERVABLE_DIMENSION_IDS,
					},
					observation: { type: "string" },
					reasoning: { type: "string" },
					evidence_excerpts: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							required: ["source", "content"],
							properties: {
								timestamp: { type: "string" },
								source: { type: "string" },
								content: { type: "string" },
							},
						},
					},
					caveats: { type: "string" },
				},
			},
		},
	},
} as const;

const FORBIDDEN_FIELDS = [
	"score",
	"weighted_total",
	"raw_total",
	"band",
	"signal_count",
];

export interface BuildPromptInput {
	readonly config: RoleConfig;
	readonly events: readonly EvidenceEvent[];
	/** Optional interviewer notes file path. */
	readonly interviewerNotesPath?: string;
	/**
	 * Optional session recording URL. Captured for frontmatter only —
	 * this function deliberately DOES NOT include it in the prompt.
	 */
	readonly sessionRecordingUrl?: string;
}

export interface BuiltPrompt {
	readonly instructions: string;
	readonly input: string;
}

function readIfExists(path: string | undefined): string {
	if (!path) return "";
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

function rubricBlock(): string {
	return getDimensions()
		.filter((d) => OBSERVABLE_DIMENSION_IDS.includes(d.id as never))
		.map(
			(d) =>
				`- ${d.id} (${d.title}, ${d.evidenceMode}, group ${d.group}): ${d.description}`,
		)
		.join("\n");
}

function rubricModeAddendum(config: RoleConfig): string {
	switch (config.rubricMode) {
		case "default":
			return "";
		case "custom":
			return `\n\nAdditional rubric guidance from the hiring manager (custom mode):\n${config.customPrompt ?? ""}`;
		case "default+jd": {
			const jd = readIfExists(config.jdPath);
			return jd
				? `\n\nJob description supplied by the hiring manager (default+jd mode):\n---\n${jd}\n---`
				: "";
		}
	}
}

function summarizeEvents(events: readonly EvidenceEvent[]): string {
	const lines: string[] = [];
	for (const e of events) {
		switch (e.type) {
			case "prompt":
				lines.push(
					`[${e.timestamp}] PROMPT: ${e.text.slice(0, 500).replace(/\n/g, " ")}`,
				);
				break;
			case "tool-use":
				lines.push(`[${e.timestamp}] TOOL: ${e.tool}`);
				break;
			case "command":
				lines.push(`[${e.timestamp}] $ ${e.command.slice(0, 200)}`);
				break;
			case "commit":
				lines.push(
					`[${e.timestamp}] COMMIT ${e.sha.slice(0, 7)} (+${e.insertions}/-${e.deletions}): ${e.message}`,
				);
				break;
			case "transcript-line":
				lines.push(
					`[${e.timestamp}] (transcript) ${e.speaker}: ${e.text.slice(0, 400)}`,
				);
				break;
		}
	}
	return lines.join("\n");
}

export function buildObserverPrompt(input: BuildPromptInput): BuiltPrompt {
	const instructions = `You are an interview observer. You read the candidate's session artifacts and produce structured narrative observations for the dimensions listed below.

CRITICAL RULES:
- You do NOT produce scores, weights, totals, or bands. Your json_schema response only includes observations, reasoning, and evidence excerpts.
- ${INTERVIEWER_BIAS_GUARD}
- For each dimension you observe, write a 1-3 sentence narrative observation, a multi-sentence reasoning chain, and 1-3 evidence excerpts citing source + content.
- The hiring manager reads your output as one input among many. Be specific, be cautious where you are uncertain, and prefer caveats over confident generalizations.

Rubric version: ${getRubricVersion()}.
Dimensions you observe (others are deterministic and handled separately):
${rubricBlock()}
${rubricModeAddendum(input.config)}`;

	const interviewerNotes = readIfExists(input.interviewerNotesPath);
	const candidateActions = summarizeEvents(input.events);
	const eventBlock = candidateActions || "(no events recorded)";

	const userText = `Role: ${input.config.roleTitle} (${input.config.roleSlug})
Stack: ${input.config.stack} | Domain: ${input.config.domain} | Feature: ${input.config.featureDescription}
Time-box: ${input.config.timeBoxMinutes} minutes

Candidate session evidence (in chronological order):
${eventBlock}
${interviewerNotes ? `\nInterviewer notes (situational context only; remember the bias guard above):\n${interviewerNotes}` : ""}`;

	return { instructions, input: userText };
}

export function rejectIfScored(response: unknown): void {
	const s = JSON.stringify(response);
	for (const field of FORBIDDEN_FIELDS) {
		if (new RegExp(`"${field}"\\s*:`).test(s)) {
			throw new Error(
				`AI observer response contained forbidden field '${field}'. ` +
					"This rubric is observation-only; numerical scoring is rejected at the schema and validator layers.",
			);
		}
	}
}

export interface ObserverClient {
	observe(input: BuiltPrompt): Promise<{ readonly observations: readonly Observation[] }>;
}

export class OpenAIObserverClient implements ObserverClient {
	private readonly client: OpenAI;
	private readonly model: string;

	constructor(client?: OpenAI, model = "gpt-5-mini") {
		this.client = client ?? new OpenAI({ apiKey: getEnv("OPENAI_API_KEY") });
		this.model = model;
	}

	async observe(prompt: BuiltPrompt) {
		const response = await this.client.responses.create({
			model: this.model,
			instructions: prompt.instructions,
			input: prompt.input,
			text: {
				format: {
					type: "json_schema",
					name: "interview_observations",
					schema: OBSERVATION_RESPONSE_SCHEMA,
					strict: true,
				},
			},
		});
		const text = (response as { output_text?: string }).output_text;
		if (!text) throw new Error("Observer API returned no output_text");
		const parsed = JSON.parse(text) as {
			observations: readonly Observation[];
		};
		rejectIfScored(parsed);
		return { observations: parsed.observations };
	}
}

/**
 * Builds observation records when role config requests human-only mode. The
 * returned observations are "blank fillable templates" with a clear marker so
 * the audit-writer renders them as gaps the manager fills in.
 */
export function humanOnlyObservations(): readonly Observation[] {
	return OBSERVABLE_DIMENSION_IDS.map<Observation>((id) => ({
		dimension_id: id,
		observation: "(human-only mode — manager to write observation)",
		reasoning: "(human-only mode — manager to write reasoning)",
		evidence_excerpts: [],
	}));
}
