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
			? `Generate a Mode A "AI-bootstrap extension" project. The output MUST include:
- README.md at the root — written FOR THE CANDIDATE in plain language. Sections:
  (1) "What you're building" — what this project is and the feature/extension the candidate will implement (${config.featureDescription}).
  (2) "Time-box" — state the time-box explicitly as ${config.timeBoxMinutes} minutes.
  (3) "Getting started" — exact command(s) to install deps and run the tests; point the candidate to the failing/skipped test that marks where they pick up.
  (4) "Acceptance criteria" — bullet list of what "done" looks like for this slice.
  (5) "Process" — one sentence pointing to INTERVIEW_RULES.md for the recording/interview workflow.
  DO NOT write agent operating instructions. DO NOT mention rubric dimensions or what the observer is looking for. DO NOT coach the candidate on how to work with their AI agent. Agent guidance is shipped separately by the kit; the AI generator must not author it.
- GLOSSARY.md at the root (domain terms)
- At least 2 "deep modules" (>=80 lines each) under src/
- At least 1 failing or skipped test under tests/ that marks the gap the candidate fills (use describe.skip or "not yet implemented")
- Total source LOC must be between 400 and 700 lines (inclusive)
- A working test framework setup so the candidate can run tests immediately
- DO NOT generate a CLAUDE.md or an AGENTS.md. Those files are provided by the interview kit at copy time. If you write one, you will be overwriting carefully-authored proctor content with hallucinated instructions.`
			: `Generate a Mode B "greenfield brief" project. The output MUST include only:
- BRIEF.md with required sections: ## Time-box (state ${config.timeBoxMinutes} minutes), ## Acceptance criteria, ## Deliverables
- No starter code at all. The candidate writes everything from scratch.
- DO NOT generate a CLAUDE.md or an AGENTS.md. Those files are provided by the interview kit at copy time.`;

	// Proctor addendum: free-form hiring-manager text appended after the
	// rubric so the structural requirements (README.md, LOC budget, etc.)
	// stay authoritative and the proctor adds context on top instead of
	// overriding the contract. Empty/whitespace-only = no addendum.
	const proctorAddendum =
		config.projectPrompt && config.projectPrompt.trim().length > 0
			? `\n\nAdditional instructions from the hiring manager (apply where they do not conflict with the structural requirements above):\n${config.projectPrompt.trim()}\n`
			: "";

	return `You are generating a candidate coding interview project for the role: ${config.roleTitle}.
Stack: ${config.stack}. Domain: ${config.domain}. Feature focus: ${config.featureDescription}.
Time-box: ${config.timeBoxMinutes} minutes.

This is attempt ${attempt}.${retryNote}

${modeSpec}

Rubric (interview-reviewer v${getRubricVersion()}) — the project must give the candidate room to demonstrate each dimension:
${rubric}${proctorAddendum}

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
