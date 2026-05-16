import { readFileSync } from "node:fs";
import { consola } from "consola";
import OpenAI from "openai";
import { getEnv } from "../../../lib/env.js";
import type {
	GeneratedProject,
	GeneratorClient,
} from "./project-generator.js";
import type { RoleConfig } from "./role-config.js";

// readJobDescription returns the JD body when the role config has
// asked the JD to shape project generation. Empty string when either
// the influence flag is off or the file can't be read — the
// generation prompt simply omits the context block in those cases.
//
// We trust the validator to have asserted the file exists before
// reaching this point; the try/catch is defence in depth so a
// transient FS error (e.g., the proctor moved the file between
// validation and generation) downgrades to "no JD context" rather
// than killing the whole run.
function readJobDescription(config: RoleConfig): string {
	if (!config.jdInfluencesProject) return "";
	if (!config.jdPath || config.jdPath.trim().length === 0) return "";
	try {
		return readFileSync(config.jdPath, "utf8").trim();
	} catch {
		return "";
	}
}

interface GeneratedFileResponse {
	path: string;
	content: string;
}

interface ProjectResponse {
	files: GeneratedFileResponse[];
}

const PROJECT_RESPONSE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["files"],
	properties: {
		files: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["path", "content"],
				properties: {
					path: { type: "string" },
					content: { type: "string" },
				},
			},
		},
	},
} as const;

function buildPrompt(
	config: RoleConfig,
	attempt: number,
	previousFailures: readonly string[] = [],
): string {
	// The full 9-dimension rubric block used to be included verbatim here
	// so the model could "build for observability against each
	// dimension." In practice the dimensions are how the AI REVIEWER
	// scores the candidate — the generator just needs to produce a
	// substantive project. Inlining ~600 input tokens of review-side
	// context per call wasn't earning its keep, especially after a
	// proctor reported a single Mode B run cost $1.36. A one-line
	// summary preserves the intent without the bloat; the full rubric
	// still drives the review-side prompt in ai-observer.ts.
	const rubricSummary =
		"Build something the candidate can engage with thoughtfully — enough decision points, naming choices, and edge cases for them to demonstrate engineering judgment under AI augmentation. Don't pad or over-design.";

	const retryNote =
		previousFailures.length > 0
			? `\n\nPrevious attempt failed validation with: ${previousFailures.join("; ")}\nPlease address these specific failures in this attempt.\n`
			: "";

	const modeSpec =
		config.projectMode === "A"
			? `Generate a Mode A "AI-bootstrap extension" project — a realistic starter codebase the candidate extends within the time-box.

REQUIRED FILES:
- README.md at the root — written FOR THE CANDIDATE in plain language. Sections:
  (1) "What you're building" — what this project is and the feature/extension the candidate will implement (${config.featureDescription}).
  (2) "Time-box" — state the time-box explicitly as ${config.timeBoxMinutes} minutes.
  (3) "Getting started" — exact command(s) to install deps. Tell the candidate they are expected to write their own tests; do NOT reference any pre-existing failing test.
  (4) "Acceptance criteria" — bullet list of what "done" looks like for this slice.
  (5) "Process" — one sentence pointing to INTERVIEW_RULES.md for the recording/interview workflow.
  DO NOT write agent operating instructions. DO NOT mention rubric dimensions or what the observer is looking for. DO NOT coach the candidate on how to work with their AI agent. Agent guidance is shipped separately by the kit; the AI generator must not author it.
- Source files under src/ — split the work into a few cohesive modules (domain types, a service/orchestrator, helpers as appropriate for ${config.stack}). Right-size for the ${config.timeBoxMinutes}-minute time-box: substantive enough that a candidate can demonstrate judgment about architecture and naming, not so large that they can't read it in the first 10 minutes.
- A working test framework setup (package.json/go.mod/etc as appropriate for ${config.stack}) so the candidate can immediately write and run their own tests. Include only the dependency manifest and any required config — NO test files.

DO NOT GENERATE (these would hint at the answer or break the evaluation):
- Any test files. The candidate writes their own tests as part of the evaluation; pre-existing tests (even skipped ones) would leak the API shape, function names, or expected behaviors.
- GLOSSARY.md. A glossary would hint at the domain concepts the candidate is expected to identify themselves.
- CLAUDE.md or AGENTS.md. Those are provided by the interview kit at copy time; writing one would overwrite carefully-authored proctor content with hallucinated instructions.`
			: `Generate a Mode B "greenfield brief" project. The output MUST include only:
- BRIEF.md with required sections: ## Time-box (state ${config.timeBoxMinutes} minutes), ## Acceptance criteria, ## Deliverables
${
	config.stackByCandidate
		? `- A "## Tech stack" section in BRIEF.md that EXPLICITLY states the candidate selects their own tech stack. Mention "${config.stack}" only as context for the kind of tooling the hiring team uses internally — do NOT require it. The candidate's stack choice is itself evaluated.`
		: `- A "## Tech stack" section in BRIEF.md that REQUIRES the candidate to use ${config.stack}.`
}
- No starter code at all. The candidate writes everything from scratch.
- DO NOT generate a CLAUDE.md or an AGENTS.md. Those files are provided by the interview kit at copy time.`;

	// Job description context — included only when the proctor opted to
	// let the JD influence project generation. The model uses this to
	// calibrate the project's complexity and domain character: e.g., a
	// junior healthtech JD nudges toward an EHR-flavoured feature; a
	// staff platform-engineering JD nudges toward systems-level
	// concerns. Placed BEFORE the rubric so the structural rules
	// (README required, no tests/glossary/CLAUDE.md) remain the final
	// authoritative instruction the model reads.
	const jd = readJobDescription(config);
	const jdContext =
		jd.length > 0
			? `\n\nJob description context — use this to calibrate the project's complexity, seniority, and domain character. Do not echo it back to the candidate or reference it in the README; treat it as background that shapes what you build:\n---\n${jd}\n---\n`
			: "";

	// Domain: when a JD is attached the wizard skips the Domain question
	// (the JD already describes it), so render an instruction to the
	// model rather than an empty "Domain: ." line. The jdContext block
	// below has the actual JD body for inference.
	const domainLine =
		config.domain && config.domain.trim().length > 0
			? `Domain: ${config.domain}.`
			: "Domain: infer from the job description context below.";

	return `You are generating a candidate coding interview project for the role: ${config.roleTitle}.
Stack: ${config.stack}. ${domainLine} Feature focus: ${config.featureDescription}.
Time-box: ${config.timeBoxMinutes} minutes.

This is attempt ${attempt}.${retryNote}${jdContext}

${modeSpec}

Project surface area: ${rubricSummary}

Return a JSON object with a "files" array. Each entry has "path" (repo-relative) and "content" (full file content).`;
}

export class OpenAIGeneratorClient implements GeneratorClient {
	private readonly client: OpenAI;
	public readonly model: string;

	constructor(client?: OpenAI, model?: string) {
		this.client = client ?? new OpenAI({ apiKey: getEnv("OPENAI_API_KEY") });
		this.model = model ?? getEnv("AI_MODEL") ?? "gpt-5-mini";
	}

	async generate(input: {
		readonly config: RoleConfig;
		readonly attempt: number;
		readonly previousFailures?: readonly string[];
	}): Promise<GeneratedProject> {
		const prompt = buildPrompt(
			input.config,
			input.attempt,
			input.previousFailures,
		);
		const response = await this.client.responses.create({
			model: this.model,
			input: prompt,
			// gpt-5-mini and gpt-5 default to "medium" reasoning effort,
			// which spends a large number of internal reasoning tokens on
			// a structured-output generation task. A proctor reported a
			// single Mode B run cost $1.36 / 143k tokens; reasoning was
			// the dominant share. "low" still produces high-quality
			// scaffolds for this kind of file-list task and meaningfully
			// shortens the billed tokens. Override via AI_REASONING_EFFORT
			// if a future use case wants medium/high.
			reasoning: {
				effort:
					(getEnv("AI_REASONING_EFFORT") as
						| "minimal"
						| "low"
						| "medium"
						| "high"
						| undefined) ?? "low",
			},
			text: {
				format: {
					type: "json_schema",
					name: "interview_project",
					schema: PROJECT_RESPONSE_SCHEMA,
					strict: true,
				},
			},
		});
		// Log token usage at info level so a proctor can see the
		// per-attempt cost without --debug. The Responses API returns a
		// usage object with input/output/(reasoning) counts; field
		// shape is the standard OpenAI v2 shape (input_tokens,
		// output_tokens, output_tokens_details.reasoning_tokens). The
		// cast is defensive — older mocks may omit usage entirely.
		const usage = (
			response as {
				usage?: {
					input_tokens?: number;
					output_tokens?: number;
					total_tokens?: number;
					output_tokens_details?: { reasoning_tokens?: number };
				};
			}
		).usage;
		if (usage) {
			const reasoning = usage.output_tokens_details?.reasoning_tokens ?? 0;
			consola.info(
				`openai.usage model=${this.model} attempt=${input.attempt} input=${usage.input_tokens ?? 0} output=${usage.output_tokens ?? 0} reasoning=${reasoning} total=${usage.total_tokens ?? 0}`,
			);
		}
		const text = (response as { output_text?: string }).output_text;
		if (!text) {
			throw new Error("OpenAI Responses API returned no output_text");
		}
		const parsed = JSON.parse(text) as ProjectResponse;
		return { files: parsed.files };
	}
}
