import { describe, expect, it } from "bun:test";
import {
	getDimension,
	getDimensions,
	getEvidenceMode,
	getRubricVersion,
	RUBRIC_VERSION,
} from "../../../../../src/services/interview/shared/rubric.js";

describe("interview rubric", () => {
	it("exports a non-empty RUBRIC_VERSION string", () => {
		expect(typeof RUBRIC_VERSION).toBe("string");
		expect(RUBRIC_VERSION.length).toBeGreaterThan(0);
	});

	it("getRubricVersion() returns the same value as RUBRIC_VERSION", () => {
		expect(getRubricVersion()).toBe(RUBRIC_VERSION);
	});

	it("getDimensions() returns exactly 9 dimensions", () => {
		expect(getDimensions()).toHaveLength(9);
	});

	it("getDimension(id) returns the dimension for each known id", () => {
		const knownIds = [
			"upfront-design",
			"context-engineering",
			"critical-evaluation",
			"verification",
			"course-correction",
			"risk-awareness",
			"architectural-quality",
			"test-pass",
			"throughput",
		] as const;
		for (const id of knownIds) {
			const dim = getDimension(id);
			expect(dim).toBeDefined();
			expect(dim?.id).toBe(id);
		}
	});

	it("getEvidenceMode classifies the 4 deterministic dimensions", () => {
		const deterministicIds = [
			"verification",
			"risk-awareness",
			"test-pass",
			"throughput",
		] as const;
		for (const id of deterministicIds) {
			expect(getEvidenceMode(id)).toBe("deterministic");
		}
	});

	it("getEvidenceMode classifies the 2 hybrid dimensions", () => {
		const hybridIds = ["context-engineering", "course-correction"] as const;
		for (const id of hybridIds) {
			expect(getEvidenceMode(id)).toBe("hybrid");
		}
	});

	it("getEvidenceMode classifies the 3 llm-judge dimensions", () => {
		const llmJudgeIds = [
			"upfront-design",
			"critical-evaluation",
			"architectural-quality",
		] as const;
		for (const id of llmJudgeIds) {
			expect(getEvidenceMode(id)).toBe("llm-judge");
		}
	});

	it("every dimension has all required fields populated", () => {
		for (const dim of getDimensions()) {
			expect(typeof dim.id).toBe("string");
			expect(dim.id.length).toBeGreaterThan(0);
			expect(typeof dim.title).toBe("string");
			expect(dim.title.length).toBeGreaterThan(0);
			expect(typeof dim.description).toBe("string");
			expect(dim.description.length).toBeGreaterThan(0);
			expect(["deterministic", "hybrid", "llm-judge"]).toContain(
				dim.evidenceMode,
			);
			expect(["process", "outcome"]).toContain(dim.group);
			expect(Array.isArray(dim.maturityLineage)).toBe(true);
			expect(dim.maturityLineage.length).toBeGreaterThan(0);
		}
	});

	it("dimensions are grouped as 6 process and 3 outcome", () => {
		const dims = getDimensions();
		const process = dims.filter((d) => d.group === "process");
		const outcome = dims.filter((d) => d.group === "outcome");
		expect(process).toHaveLength(6);
		expect(outcome).toHaveLength(3);
		// Outcome dims must be the three "what they produced" dims
		expect(outcome.map((d) => d.id).sort()).toEqual(
			["architectural-quality", "test-pass", "throughput"].sort(),
		);
	});

	it("getDimension(unknownId) returns undefined", () => {
		// Cast through unknown — the call site is allowed to pass arbitrary strings
		// (e.g. user input, deserialized JSON) and must safely return undefined.
		expect(getDimension("not-a-real-dimension" as unknown as never)).toBeUndefined();
	});
});
