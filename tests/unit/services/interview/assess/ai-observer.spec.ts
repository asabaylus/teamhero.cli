import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildObserverPrompt,
	humanOnlyObservations,
	INTERVIEWER_BIAS_GUARD,
	OBSERVATION_RESPONSE_SCHEMA,
	rejectIfScored,
} from "../../../../../src/services/interview/assess/ai-observer.js";
import type { RoleConfig } from "../../../../../src/services/interview/bootstrap/role-config.js";
import type { EvidenceEvent } from "../../../../../src/services/interview/assess/types.js";

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

	it("includes the JD content when rubricMode is default+jd", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-jd-"));
		try {
			const path = join(dir, "jd.md");
			writeFileSync(path, "Looking for someone with payments domain depth.");
			const prompt = buildObserverPrompt({
				config: role({ rubricMode: "default+jd", jdPath: path }),
				events: [evt],
			});
			expect(prompt.instructions).toContain("payments domain depth");
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
