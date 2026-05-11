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
		{ path: "CLAUDE.md", content: "# Project\n" },
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
			{ path: "CLAUDE.md", content: "# Project\n" },
			{ path: "src/main.ts", content: "export const x = 1;\n" },
		];
		const client = new OpenAIGeneratorClient(fakeOpenAI(files) as never);
		const result = await client.generate({ config: role(), attempt: 1 });
		expect(result.files).toHaveLength(2);
		expect(result.files[0].path).toBe("CLAUDE.md");
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
		expect(prompt).toContain("CLAUDE.md");
		expect(prompt).toContain("GLOSSARY.md");
		expect(prompt).toContain("deep module");
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
			previousFailures: ["Missing CLAUDE.md at project root.", "LOC out of range: 150 lines"],
		});
		const prompt = captured.calls[0].input;
		expect(prompt).toContain("Missing CLAUDE.md");
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