import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenAIGeneratorClient } from "../../../../../src/services/interview/bootstrap/openai-generator-client.js";
import type { RoleConfig } from "../../../../../src/services/interview/bootstrap/role-config.js";

function role(overrides: Partial<RoleConfig> = {}): RoleConfig {
	return {
		roleSlug: "senior-backend",
		roleTitle: "Senior Backend Engineer",
		stack: "TypeScript",
		domain: "Payments",
		featureDescription: "Add idempotency keys to the refunds endpoint",
		timeBoxMinutes: 90,
		projectMode: "A",
		analysisMode: "ai-assisted",
		rubricMode: "default",
		outputDir: "/tmp/test-output",
		...overrides,
	};
}

/**
 * Builds a minimal OpenAI client fake that captures the prompt and returns a
 * valid project JSON string. We test the internal prompt-building logic
 * indirectly through the public `generate` method.
 */
function fakeOpenAI(
	outputFiles: Array<{ path: string; content: string }> = [
		{ path: "README.md", content: "# Project\n" },
	],
	capturedPrompts?: { calls: Array<{ input: string; model: string }> },
) {
	return {
		responses: {
			create: async (opts: {
				model: string;
				input: string;
				text: unknown;
			}) => {
				if (capturedPrompts) {
					capturedPrompts.calls.push({ input: opts.input, model: opts.model });
				}
				return {
					output_text: JSON.stringify({ files: outputFiles }),
				};
			},
		},
	};
}

describe("OpenAIGeneratorClient.generate", () => {
	it("returns the files array from the API response", async () => {
		const files = [
			{ path: "README.md", content: "# Project\n" },
			{ path: "src/main.ts", content: "export const x = 1;\n" },
		];
		const client = new OpenAIGeneratorClient(fakeOpenAI(files) as never);
		const result = await client.generate({ config: role(), attempt: 1 });
		expect(result.files).toHaveLength(2);
		expect(result.files[0].path).toBe("README.md");
		expect(result.files[1].path).toBe("src/main.ts");
	});

	it("throws when the API returns no output_text", async () => {
		const badOpenAI = {
			responses: {
				create: async () => ({}),
			},
		};
		const client = new OpenAIGeneratorClient(badOpenAI as never);
		await expect(
			client.generate({ config: role(), attempt: 1 }),
		).rejects.toThrow(/no output_text/);
	});

	it("passes the role title, stack, and domain in the prompt input", async () => {
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
		await client.generate({ config: role(), attempt: 1 });
		expect(captured.calls).toHaveLength(1);
		const prompt = captured.calls[0].input;
		expect(prompt).toContain("Senior Backend Engineer");
		expect(prompt).toContain("TypeScript");
		expect(prompt).toContain("Payments");
		expect(prompt).toContain("Add idempotency keys");
	});

	it("includes Mode A scaffold requirements in prompt for projectMode=A", async () => {
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
		await client.generate({ config: role({ projectMode: "A" }), attempt: 1 });
		const prompt = captured.calls[0].input;
		// README.md is the only required candidate-facing file. Right-sizing
		// hint nudges the model toward a substantive decomposition without
		// encoding a hard LOC band that the validator would auto-reject.
		expect(prompt).toContain("README.md");
		expect(prompt).toMatch(/cohesive modules/i);
	});

	it("explicitly forbids the AI from generating test files (Mode A)", async () => {
		// A pre-existing skipped test like `describe.skip("addUser", ...)`
		// leaks the API shape and function names the candidate is
		// expected to design themselves. The prompt must tell the model
		// not to author tests; the candidate writes their own as part of
		// the evaluation.
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
		await client.generate({ config: role({ projectMode: "A" }), attempt: 1 });
		const prompt = captured.calls[0].input;
		expect(prompt).toContain("DO NOT GENERATE");
		expect(prompt).toContain("Any test files");
		// Regression: the old prompt said "include a failing or skipped
		// test under tests/". That phrasing must not return — it's
		// exactly what we just removed.
		expect(prompt).not.toMatch(/include.*(failing|skipped) test/i);
	});

	it("explicitly forbids the AI from generating GLOSSARY.md (Mode A)", async () => {
		// A glossary lists domain concepts; identifying those concepts
		// is part of what's being evaluated, so a pre-baked GLOSSARY.md
		// gives away the answer.
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
		await client.generate({ config: role({ projectMode: "A" }), attempt: 1 });
		const prompt = captured.calls[0].input;
		expect(prompt).toContain("DO NOT GENERATE");
		expect(prompt).toMatch(/GLOSSARY\.md\.\s+A glossary/);
	});

	it("does NOT encode a hard LOC band or deep-module quota in the prompt", async () => {
		// Regression guard for the removed size validator: prior versions
		// of this prompt asserted a 400-700 LOC range and an "AT LEAST 2
		// source files of 80+ lines" rule, mirrored on the validator side.
		// Both have been removed because they weren't in the product spec
		// and they were producing real friction (retries on
		// perfectly-serviceable 300-LOC outputs). If a future prompt edit
		// reintroduces these phrases, this test fails so we revisit
		// whether the matching validator rule should come back too.
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
		await client.generate({ config: role({ projectMode: "A" }), attempt: 1 });
		const prompt = captured.calls[0].input;
		expect(prompt).not.toContain("400 and 700");
		expect(prompt).not.toContain("ABSOLUTE SIZE REQUIREMENTS");
		expect(prompt).not.toMatch(/AT LEAST 2 source files must each contain 80/);
	});

	it("explicitly forbids the AI from authoring CLAUDE.md or AGENTS.md (Mode A)", async () => {
		// The prompt MUST tell the model not to write agent-facing files; those
		// are owned by the kit. Otherwise the model hallucinates "Agent guidance"
		// blocks that the candidate's agent then reads at run time.
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
		await client.generate({ config: role({ projectMode: "A" }), attempt: 1 });
		const prompt = captured.calls[0].input;
		expect(prompt).toContain("DO NOT GENERATE");
		expect(prompt).toContain("CLAUDE.md or AGENTS.md");
	});

	it("explicitly forbids the AI from authoring CLAUDE.md or AGENTS.md (Mode B)", async () => {
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
		await client.generate({ config: role({ projectMode: "B" }), attempt: 1 });
		const prompt = captured.calls[0].input;
		// Mode B uses a different prompt shape (single-line directives in
		// the BRIEF.md spec); the original regex still matches there.
		expect(prompt).toMatch(/DO NOT (generate|write).*CLAUDE\.md/i);
		expect(prompt).toMatch(/DO NOT (generate|write).*AGENTS\.md/i);
	});

	it("includes Mode B brief requirements in prompt for projectMode=B", async () => {
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
		await client.generate({
			config: role({ projectMode: "B" }),
			attempt: 1,
		});
		const prompt = captured.calls[0].input;
		expect(prompt).toContain("BRIEF.md");
		// Mode B must NOT include Mode A scaffolding requirements
		expect(prompt).not.toContain("deep module");
	});

	it("Mode B with stackByCandidate=false REQUIRES the named stack in BRIEF.md", async () => {
		// Wizard's "Greenfield (use your stack)" option lands here. The
		// brief must constrain the candidate to the stack the proctor
		// already chose at Q3 — otherwise the proctor's stack signal is
		// wasted.
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
		await client.generate({
			config: role({ projectMode: "B", stack: "Go" }),
			attempt: 1,
		});
		const prompt = captured.calls[0].input;
		expect(prompt).toMatch(/REQUIRES the candidate to use Go/);
		// The stack-by-candidate path must NOT activate here.
		expect(prompt).not.toMatch(/candidate selects their own tech stack/);
	});

	it("renders 'Domain: infer from the job description' when domain is empty (JD-supplied path)", async () => {
		// The wizard skips the Domain question when a JD is attached
		// (the JD describes the domain). The prompt must NOT render a
		// bare "Domain: ." — instead it tells the model to derive the
		// domain from the JD context block.
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
		await client.generate({ config: role({ domain: "" }), attempt: 1 });
		const prompt = captured.calls[0].input;
		expect(prompt).toMatch(/Domain:\s+infer from the job description/i);
		expect(prompt).not.toMatch(/Domain:\s*\./);
	});

	it("renders explicit 'Domain: X.' when the proctor supplied a domain", async () => {
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
		await client.generate({
			config: role({ domain: "Payments" }),
			attempt: 1,
		});
		expect(captured.calls[0].input).toMatch(/Domain:\s+Payments\./);
	});

	it("injects JD content into the generation prompt when jdInfluencesProject is true", async () => {
		// The user's example: a junior healthtech JD should nudge the
		// generator toward an EHR-flavoured feature. The mechanism is
		// the project-generation prompt reading the JD body and giving
		// it to the model as background context. This test pins that
		// the JD content actually reaches the prompt.
		const dir = mkdtempSync(join(tmpdir(), "iv-jd-gen-"));
		try {
			const jdPath = join(dir, "jd.md");
			writeFileSync(
				jdPath,
				"# Junior Healthcare Engineer\nFamiliarity with FHIR, HL7, EHR concepts.",
			);
			const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
			const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
			await client.generate({
				config: role({
					jdPath,
					jdInfluencesProject: true,
				}),
				attempt: 1,
			});
			const prompt = captured.calls[0].input;
			expect(prompt).toContain("Job description context");
			expect(prompt).toContain("FHIR, HL7, EHR");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("omits the JD when jdInfluencesProject is false even if jdPath is set", async () => {
		// JD-without-influence: the JD goes only to the post-interview
		// observer, not the project-generation prompt. The proctor might
		// want the observer to see the JD without letting it leak
		// EHR-flavoured features into the candidate-facing project.
		const dir = mkdtempSync(join(tmpdir(), "iv-jd-no-influence-"));
		try {
			const jdPath = join(dir, "jd.md");
			writeFileSync(jdPath, "Sensitive JD content the candidate should not see.");
			const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
			const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
			await client.generate({
				config: role({ jdPath, jdInfluencesProject: false }),
				attempt: 1,
			});
			const prompt = captured.calls[0].input;
			expect(prompt).not.toContain("Sensitive JD content");
			expect(prompt).not.toContain("Job description context");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("Mode B with stackByCandidate=true tells the BRIEF.md the candidate picks the stack", async () => {
		// Wizard's "Greenfield (candidate picks stack)" option lands
		// here. The brief must EXPLICITLY tell the candidate they
		// choose the tooling — that's part of what's being evaluated.
		// The proctor-stated stack should appear only as context, not
		// as a requirement, so the candidate's choice itself is judged.
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
		await client.generate({
			config: role({ projectMode: "B", stack: "Go", stackByCandidate: true }),
			attempt: 1,
		});
		const prompt = captured.calls[0].input;
		expect(prompt).toMatch(/candidate selects their own tech stack/);
		// Must not also demand the proctor's stack.
		expect(prompt).not.toMatch(/REQUIRES the candidate to use Go/);
	});

	it("includes the attempt number in the prompt", async () => {
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
		await client.generate({ config: role(), attempt: 2 });
		const prompt = captured.calls[0].input;
		expect(prompt).toContain("attempt 2");
	});

	it("includes previousFailures in the prompt on retry", async () => {
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
		await client.generate({
			config: role(),
			attempt: 2,
			previousFailures: [
				"Missing README.md at project root.",
				"No failing or skipped tests found.",
			],
		});
		const prompt = captured.calls[0].input;
		expect(prompt).toContain("Missing README.md");
		expect(prompt).toContain("No failing or skipped tests");
	});

	it("does NOT include previousFailures section on the first attempt", async () => {
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
		await client.generate({ config: role(), attempt: 1 });
		const prompt = captured.calls[0].input;
		expect(prompt).not.toContain("Previous attempt failed");
	});

	it("includes rubric dimension IDs in the prompt", async () => {
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
		await client.generate({ config: role(), attempt: 1 });
		const prompt = captured.calls[0].input;
		// The rubric block from getDimensions() should appear in the prompt
		expect(prompt).toContain("upfront-design");
		expect(prompt).toContain("context-engineering");
		expect(prompt).toContain("verification");
	});

	it("uses the custom model when specified in the constructor", async () => {
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never, "gpt-4o");
		await client.generate({ config: role(), attempt: 1 });
		expect(captured.calls[0].model).toBe("gpt-4o");
	});

	it("passes the time-box in the prompt", async () => {
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
		await client.generate({ config: role({ timeBoxMinutes: 60 }), attempt: 1 });
		expect(captured.calls[0].input).toContain("60");
	});

	it("does NOT include any 'hiring manager addendum' block (the projectPrompt addendum was removed — the feature description is the single source)", async () => {
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
		await client.generate({ config: role(), attempt: 1 });
		// Regression guard: the proctor-addendum block used to wrap the
		// projectPrompt field. After collapsing the wizard's redundant
		// "Project prompt" step into the single feature-description either/or,
		// the addendum block must never resurface — otherwise the prompt
		// implies a second free-form field the user can't actually set.
		expect(captured.calls[0].input).not.toContain("Additional instructions from the hiring manager");
	});
});

describe("OpenAIGeneratorClient — JSON schema guard (PROJECT_RESPONSE_SCHEMA)", () => {
	it("the API call uses strict json_schema with a 'files' array", async () => {
		let capturedTextFormat: unknown;
		const interceptOpenAI = {
			responses: {
				create: async (opts: { text: { format: unknown } }) => {
					capturedTextFormat = opts.text;
					return {
						output_text: JSON.stringify({ files: [] }),
					};
				},
			},
		};
		const client = new OpenAIGeneratorClient(interceptOpenAI as never);
		await client.generate({ config: role(), attempt: 1 });
		const format = (capturedTextFormat as { format: { type: string; strict: boolean; schema: { properties: { files: unknown } } } }).format;
		expect(format.type).toBe("json_schema");
		expect(format.strict).toBe(true);
		expect(format.schema.properties.files).toBeDefined();
	});
});