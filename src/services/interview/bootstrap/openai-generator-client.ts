import OpenAI from "openai";
import { getEnv } from "../../../lib/env.js";
import { getDimensions, getRubricVersion } from "../shared/rubric.js";
import type {
	GeneratedProject,
	GeneratorClient,
} from "./project-generator.js";
import type { RoleConfig } from "./role-config.js";

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
	const rubric = getDimensions()
		.map(
			(d) => `- **${d.title}** (${d.id}, ${d.evidenceMode}): ${d.description}`,
		)
		.join("\n");

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

	return `You are generating a candidate coding interview project for the role: ${config.roleTitle}.
Stack: ${config.stack}. Domain: ${config.domain}. Feature focus: ${config.featureDescription}.
Time-box: ${config.timeBoxMinutes} minutes.

This is attempt ${attempt}.${retryNote}

${modeSpec}

Rubric (interview-reviewer v${getRubricVersion()}) — the project must give the candidate room to demonstrate each dimension:
${rubric}

Return a JSON object with a "files" array. Each entry has "path" (repo-relative) and "content" (full file content).`;
}

export class OpenAIGeneratorClient implements GeneratorClient {
	private readonly client: OpenAI;
	private readonly model: string;

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
			text: {
				format: {
					type: "json_schema",
					name: "interview_project",
					schema: PROJECT_RESPONSE_SCHEMA,
					strict: true,
				},
			},
		});
		const text = (response as { output_text?: string }).output_text;
		if (!text) {
			throw new Error("OpenAI Responses API returned no output_text");
		}
		const parsed = JSON.parse(text) as ProjectResponse;
		return { files: parsed.files };
	}
}
