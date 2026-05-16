import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildObserverPrompt,
	humanOnlyObservations,
	INTERVIEWER_BIAS_GUARD,
	OBSERVATION_RESPONSE_SCHEMA,
	OpenAIObserverClient,
	rejectIfScored,
} from "../../../../../src/services/interview/review/ai-observer.js";
import type { RoleConfig } from "../../../../../src/services/interview/bootstrap/role-config.js";
import type { EvidenceEvent } from "../../../../../src/services/interview/review/types.js";

function role(overrides: Partial<RoleConfig> = {}): RoleConfig {
	return {
		roleSlug: "senior-backend",
		roleTitle: "Senior Backend Engineer",
		stack: "TypeScript",
		domain: "Payments",
		featureDescription: "Add idempotency keys",
		timeBoxMinutes: 90,
		projectMode: "A",
		analysisMode: "ai-assisted",
		rubricMode: "default",
		outputDir: "/tmp/out",
		...overrides,
	};
}

const evt: EvidenceEvent = {
	type: "prompt",
	timestamp: "2026-05-10T10:00:00Z",
	source: "interview.log",
	text: "add an idempotency middleware",
};

describe("buildObserverPrompt", () => {
	it("includes the interviewer-bias guard verbatim", () => {
		const prompt = buildObserverPrompt({ config: role(), events: [evt] });
		expect(prompt.instructions).toContain(INTERVIEWER_BIAS_GUARD);
	});

	it("includes role metadata in the user input", () => {
		const prompt = buildObserverPrompt({ config: role(), events: [evt] });
		expect(prompt.input).toContain("Senior Backend Engineer");
		expect(prompt.input).toContain("Payments");
	});

	it("includes the rubric for the 5 observable dimensions only", () => {
		const prompt = buildObserverPrompt({ config: role(), events: [evt] });
		const observable = [
			"upfront-design",
			"context-engineering",
			"critical-evaluation",
			"course-correction",
			"architectural-quality",
		];
		for (const id of observable) {
			expect(prompt.instructions).toContain(id);
		}
		// Deterministic dims should NOT appear in the observer rubric block.
		// (They may still appear elsewhere as context, but not in the rubric list.)
		expect(prompt.instructions).not.toContain("- verification (");
		expect(prompt.instructions).not.toContain("- test-pass (");
	});

	it("includes the custom prompt when rubricMode is custom", () => {
		const prompt = buildObserverPrompt({
			config: role({ rubricMode: "custom", customPrompt: "watch for X" }),
			events: [evt],
		});
		expect(prompt.instructions).toContain("watch for X");
	});

	it("includes the JD content whenever jdPath is set (independent of rubric mode)", () => {
		// Standalone JD: the observer now references the JD whenever
		// it's been provided, regardless of whether the rubric is
		// "default" or "custom". The old "default+jd" coupling forced
		// the proctor to choose between custom rubric guidance and JD
		// context — now they can combine both.
		const dir = mkdtempSync(join(tmpdir(), "iv-jd-"));
		try {
			const path = join(dir, "jd.md");
			writeFileSync(path, "Looking for someone with payments domain depth.");
			const prompt = buildObserverPrompt({
				config: role({ rubricMode: "default", jdPath: path }),
				events: [evt],
			});
			expect(prompt.instructions).toContain("payments domain depth");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("combines custom rubric guidance AND JD content when both are supplied", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-jd-combo-"));
		try {
			const path = join(dir, "jd.md");
			writeFileSync(path, "Senior engineer, FHIR/HL7 background expected.");
			const prompt = buildObserverPrompt({
				config: role({
					rubricMode: "custom",
					customPrompt: "watch for X",
					jdPath: path,
				}),
				events: [evt],
			});
			expect(prompt.instructions).toContain("watch for X");
			expect(prompt.instructions).toContain("FHIR/HL7");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does NOT include the session recording URL in the prompt", () => {
		const prompt = buildObserverPrompt({
			config: role(),
			events: [evt],
			sessionRecordingUrl: "https://zoom.us/rec/secret-123",
		});
		expect(prompt.input).not.toContain("zoom.us");
		expect(prompt.input).not.toContain("secret-123");
		expect(prompt.instructions).not.toContain("zoom.us");
	});

	it("includes interviewer notes when provided", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-notes-"));
		try {
			const path = join(dir, "notes.md");
			writeFileSync(path, "Candidate seemed prepared.");
			const prompt = buildObserverPrompt({
				config: role(),
				events: [evt],
				interviewerNotesPath: path,
			});
			expect(prompt.input).toContain("Candidate seemed prepared.");
			// And the bias guard is still in instructions, NOT in input
			expect(prompt.instructions).toContain(INTERVIEWER_BIAS_GUARD);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("OBSERVATION_RESPONSE_SCHEMA", () => {
	it("declares strict json_schema with NO score/weighted_total/band fields anywhere", () => {
		const s = JSON.stringify(OBSERVATION_RESPONSE_SCHEMA);
		expect(s).not.toContain('"score"');
		expect(s).not.toContain('"weighted_total"');
		expect(s).not.toContain('"raw_total"');
		expect(s).not.toContain('"band"');
		expect(s).not.toContain('"signal_count"');
		// Critical: additionalProperties must be false at every object level
		expect(OBSERVATION_RESPONSE_SCHEMA.additionalProperties).toBe(false);
	});
});

describe("rejectIfScored", () => {
	it("throws when the response contains a 'score' field", () => {
		expect(() =>
			rejectIfScored({
				observations: [{ dimension_id: "upfront-design", score: 0.6 }],
			}),
		).toThrow(/score/);
	});

	it("throws when the response contains a 'weighted_total' field", () => {
		expect(() =>
			rejectIfScored({
				observations: [],
				weighted_total: 0.8,
			}),
		).toThrow(/weighted_total/);
	});

	it("accepts a clean response", () => {
		expect(() =>
			rejectIfScored({
				observations: [
					{
						dimension_id: "upfront-design",
						observation: "x",
						reasoning: "y",
						evidence_excerpts: [],
					},
				],
			}),
		).not.toThrow();
	});
});

describe("summarizeEvents (indirect via buildObserverPrompt)", () => {
	it("renders all event types — prompt, tool-use, command, commit, transcript", () => {
		const events: EvidenceEvent[] = [
			{
				type: "prompt",
				timestamp: "2026-05-10T10:00:00Z",
				source: "interview.log",
				text: "design the API",
			},
			{
				type: "tool-use",
				timestamp: "2026-05-10T10:00:30Z",
				source: "interview.log",
				tool: "Edit",
			},
			{
				type: "command",
				timestamp: "2026-05-10T10:01:00Z",
				source: "terminal.cast",
				command: "bun test",
			},
			{
				type: "commit",
				timestamp: "2026-05-10T10:02:00Z",
				source: "git",
				sha: "abc1234",
				message: "initial",
				insertions: 10,
				deletions: 2,
			},
			{
				type: "transcript-line",
				timestamp: "2026-05-10T10:03:00Z",
				source: "transcript",
				speaker: "Interviewer",
				text: "How are you thinking about this?",
			},
		];
		const prompt = buildObserverPrompt({ config: role(), events });
		expect(prompt.input).toContain("PROMPT: design the API");
		expect(prompt.input).toContain("TOOL: Edit");
		expect(prompt.input).toContain("$ bun test");
		expect(prompt.input).toContain("COMMIT abc1234");
		expect(prompt.input).toContain("(transcript) Interviewer:");
	});

	it("shows '(no events recorded)' when given an empty event list", () => {
		const prompt = buildObserverPrompt({ config: role(), events: [] });
		expect(prompt.input).toContain("(no events recorded)");
	});
});

describe("OpenAIObserverClient", () => {
	it("calls the OpenAI Responses API, parses output_text, and rejects scored responses", async () => {
		const fakeOpenAI = {
			responses: {
				create: async () => ({
					output_text: JSON.stringify({
						observations: [
							{
								dimension_id: "upfront-design",
								observation: "Candidate sketched the API first.",
								reasoning: "First prompt described data flow.",
								evidence_excerpts: [
									{
										source: "interview.log",
										content: "design the API",
									},
								],
							},
						],
					}),
				}),
			},
		};
		const client = new OpenAIObserverClient(
			fakeOpenAI as unknown as ConstructorParameters<typeof OpenAIObserverClient>[0],
		);
		const result = await client.observe({
			instructions: "test",
			input: "test",
		});
		expect(result.observations).toHaveLength(1);
		expect(result.observations[0].dimension_id).toBe("upfront-design");
	});

	it("throws when output_text is missing", async () => {
		const fakeOpenAI = {
			responses: {
				create: async () => ({}),
			},
		};
		const client = new OpenAIObserverClient(
			fakeOpenAI as unknown as ConstructorParameters<typeof OpenAIObserverClient>[0],
		);
		await expect(
			client.observe({ instructions: "test", input: "test" }),
		).rejects.toThrow(/no output_text/);
	});

	it("rejects scored responses returned by the API (defense-in-depth)", async () => {
		const fakeOpenAI = {
			responses: {
				create: async () => ({
					output_text: JSON.stringify({
						observations: [
							{ dimension_id: "upfront-design", score: 0.7 },
						],
					}),
				}),
			},
		};
		const client = new OpenAIObserverClient(
			fakeOpenAI as unknown as ConstructorParameters<typeof OpenAIObserverClient>[0],
		);
		await expect(
			client.observe({ instructions: "test", input: "test" }),
		).rejects.toThrow(/forbidden field 'score'/);
	});
});

describe("humanOnlyObservations", () => {
	it("returns exactly the 5 observable-dimension placeholders", () => {
		const obs = humanOnlyObservations();
		expect(obs).toHaveLength(5);
		const ids = obs.map((o) => o.dimension_id).sort();
		expect(ids).toEqual(
			[
				"architectural-quality",
				"context-engineering",
				"course-correction",
				"critical-evaluation",
				"upfront-design",
			].sort(),
		);
		for (const o of obs) {
			expect(o.observation).toContain("manager to write");
		}
	});
});
