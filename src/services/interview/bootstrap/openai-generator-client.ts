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

// extractLocFromFailure returns the integer LOC value that the validator
// reports in its "LOC out of range: <n> lines of code" failure string, or
// 0 when no LOC failure is present. We feed this back into the retry
// prompt so the model sees a concrete delta to close, not just an
// abstract "previous attempt was wrong" note.
function extractLocFromFailure(failures: readonly string[]): number {
	for (const f of failures) {
		const m = f.match(/LOC out of range:\s*(\d+)\s+lines/i);
		if (m) {
			const n = Number.parseInt(m[1], 10);
			if (Number.isFinite(n)) return n;
		}
	}
	return 0;
}

function extractDeepModuleCount(failures: readonly string[]): number {
	for (const f of failures) {
		const m = f.match(/found\s+(\d+)\s*\./i);
		if (m) {
			const n = Number.parseInt(m[1], 10);
			if (Number.isFinite(n)) return n;
		}
	}
	return -1;
}

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

	// Build a high-signal retry note. The default "address these failures"
	// phrasing is too abstract — gpt-5-mini routinely produces another small
	// project on retry. When we can extract concrete numbers from the
	// validator's failure list, restate them as a SPECIFIC correction target
	// so the model commits to a larger decomposition.
	let retryNote = "";
	if (previousFailures.length > 0) {
		const priorLoc = extractLocFromFailure(previousFailures);
		const priorDeepModules = extractDeepModuleCount(previousFailures);
		const lines = [
			"",
			"",
			"CORRECTION REQUIRED — your previous attempt was rejected.",
			"Specific validator failures:",
			...previousFailures.map((f) => `  - ${f}`),
			"",
		];
		if (priorLoc > 0 && priorLoc < 400) {
			lines.push(
				`Your last attempt produced ${priorLoc} total source LOC. The validator requires AT LEAST 400. For this attempt, target ~550 LOC — you must roughly DOUBLE the previous output. Add additional source files; do not just enlarge existing ones with comments.`,
			);
		}
		if (priorDeepModules >= 0 && priorDeepModules < 2) {
			lines.push(
				`Your last attempt had ${priorDeepModules} file(s) with 80+ lines. You need AT LEAST 2 such files. The fix is to split logic across MORE source files under src/, each containing 100+ lines of real implementation.`,
			);
		}
		lines.push(
			"Do not produce another minimal 'happy path' sketch. Write substantive, realistic code that a candidate could meaningfully extend.",
			"",
		);
		retryNote = lines.join("\n");
	}

	const modeSpec =
		config.projectMode === "A"
			? `Generate a Mode A "AI-bootstrap extension" project.

ABSOLUTE SIZE REQUIREMENTS (hard constraint — the validator AUTOMATICALLY REJECTS projects outside this range):
- Total source LOC under src/ MUST be between 400 and 700. Target ~550 — do NOT aim for the 400 floor; recent attempts that landed at 399-410 LOC have been one stray comment away from rejection.
- AT LEAST 2 source files must each contain 80 or more lines of real logic. Target 100-150 lines per file. A 79-line file is REJECTED — give yourself margin.
- Plan for 4-5 source files. A typical safe decomposition:
    src/types.ts (or equivalent for ${config.stack})          ~80-120 lines  — domain types, schemas, error classes
    src/<feature>-service.ts                                   ~120-180 lines — main orchestrator with the failing-test gap
    src/<feature>-validators.ts                                ~80-120 lines  — input parsing and validation
    src/<feature>-helpers.ts                                   ~60-100 lines  — formatters, utilities, mappers
    src/<feature>-store.ts (optional)                          ~80-120 lines  — persistence or in-memory state
- The line-count guidance above is REAL — count your output before returning. Anything below 400 LOC will be rejected and the run will retry.
- Do NOT pad with empty lines or trivial boilerplate. Write actual domain logic the candidate can read, modify, and extend.

REQUIRED FILES:
- README.md at the root — written FOR THE CANDIDATE in plain language. Sections:
  (1) "What you're building" — what this project is and the feature/extension the candidate will implement (${config.featureDescription}).
  (2) "Time-box" — state the time-box explicitly as ${config.timeBoxMinutes} minutes.
  (3) "Getting started" — exact command(s) to install deps and run the tests; point the candidate to the failing/skipped test that marks where they pick up.
  (4) "Acceptance criteria" — bullet list of what "done" looks like for this slice.
  (5) "Process" — one sentence pointing to INTERVIEW_RULES.md for the recording/interview workflow.
  DO NOT write agent operating instructions. DO NOT mention rubric dimensions or what the observer is looking for. DO NOT coach the candidate on how to work with their AI agent. Agent guidance is shipped separately by the kit; the AI generator must not author it.
- GLOSSARY.md at the root (domain terms — at least 6 entries with one-line definitions).
- The 4-5 source files described in the SIZE REQUIREMENTS above.
- At least 1 failing or skipped test under tests/ that marks the gap the candidate fills (use describe.skip or "not yet implemented").
- A working test framework setup (package.json/go.mod/etc as appropriate for ${config.stack}) so the candidate can run tests immediately.
- DO NOT generate a CLAUDE.md or an AGENTS.md. Those files are provided by the interview kit at copy time. If you write one, you will be overwriting carefully-authored proctor content with hallucinated instructions.`
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
