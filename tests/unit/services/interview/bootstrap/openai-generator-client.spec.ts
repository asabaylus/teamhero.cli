import { describe, expect, it } from "bun:test";
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
		expect(prompt).toContain("README.md");
		expect(prompt).toContain("GLOSSARY.md");
		// The scaffold requirements no longer use the literal "deep module"
		// phrase — replaced by an explicit "AT LEAST 2 source files must
		// each contain 80 or more lines" rule that's more actionable for
		// the model. This assertion pins the new wording so future prompt
		// tweaks can't silently drop the dual-file requirement.
		expect(prompt).toMatch(/AT LEAST 2 source files must each contain 80/);
	});

	it("emphasizes the LOC size target as a hard constraint (regression: first-attempt undersize)", async () => {
		// gpt-5-mini was repeatedly landing at ~200-300 LOC with one deep
		// module on attempt 1, then needing retries-with-feedback to climb
		// into the 400-700 range. The prompt now states the LOC budget at
		// the TOP of the Mode A spec, calls it out as auto-rejected
		// outside the range, and gives a concrete file budget table so the
		// model commits to a substantial decomposition on attempt 1.
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
		await client.generate({ config: role({ projectMode: "A" }), attempt: 1 });
		const prompt = captured.calls[0].input;
		expect(prompt).toContain("ABSOLUTE SIZE REQUIREMENTS");
		expect(prompt).toContain("AUTOMATICALLY REJECTS");
		expect(prompt).toContain("400 and 700");
		// Concrete file budget — the failure mode we're guarding against is
		// the model producing a single ~250-LOC blob. Naming files and line
		// ranges in the prompt redirects it to a real decomposition.
		expect(prompt).toMatch(/4-5 source files/i);
		expect(prompt).toMatch(/100-150 lines per file/i);
	});

	it("on retry, includes a measured correction note quoting the prior LOC count", async () => {
		// Regression guard for retry-with-feedback: when the validator
		// reports "LOC out of range: 266 lines of code", the next attempt's
		// prompt must include that NUMBER and a concrete "double it" target.
		// Abstract retry notes ("please address these failures") were not
		// enough to nudge gpt-5-mini past the 266-LOC ceiling.
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
		await client.generate({
			config: role({ projectMode: "A" }),
			attempt: 2,
			previousFailures: [
				"LOC out of range: 266 lines of code; expected 400-700.",
				"Expected at least 2 deep modules (>=80 lines); found 1.",
			],
		});
		const prompt = captured.calls[0].input;
		expect(prompt).toContain("CORRECTION REQUIRED");
		// Must quote the measured numbers so the model knows the exact delta.
		expect(prompt).toMatch(/266/);
		expect(prompt).toMatch(/double/i);
		expect(prompt).toMatch(/1 file\(s\) with 80\+ lines/);
	});

	it("explicitly forbids the AI from authoring CLAUDE.md or AGENTS.md (Mode A)", async () => {
		// The prompt MUST tell the model not to write agent-facing files; those
		// are owned by the kit. Otherwise the model hallucinates "Agent guidance"
		// blocks that the candidate's agent then reads at run time.
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
		await client.generate({ config: role({ projectMode: "A" }), attempt: 1 });
		const prompt = captured.calls[0].input;
		expect(prompt).toMatch(/DO NOT (generate|write).*CLAUDE\.md/i);
		expect(prompt).toMatch(/DO NOT (generate|write).*AGENTS\.md/i);
	});

	it("explicitly forbids the AI from authoring CLAUDE.md or AGENTS.md (Mode B)", async () => {
		const captured: { calls: Array<{ input: string; model: string }> } = { calls: [] };
		const client = new OpenAIGeneratorClient(fakeOpenAI([], captured) as never);
		await client.generate({ config: role({ projectMode: "B" }), attempt: 1 });
		const prompt = captured.calls[0].input;
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
			previousFailures: ["Missing README.md at project root.", "LOC out of range: 150 lines"],
		});
		const prompt = captured.calls[0].input;
		expect(prompt).toContain("Missing README.md");
		expect(prompt).toContain("LOC out of range");
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