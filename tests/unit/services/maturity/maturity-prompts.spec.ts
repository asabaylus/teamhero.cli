import { describe, expect, it } from "bun:test";
import {
	buildMaturityPrompt,
	MATURITY_ASSESSMENT_SCHEMA,
} from "../../../../src/services/maturity/maturity-prompts.js";

describe("buildMaturityPrompt", () => {
	it("includes the rubric, evidence, and interview blocks", () => {
		const prompt = buildMaturityPrompt({
			scope: {
				mode: "local-repo",
				localPath: ".",
				displayName: "test",
			},
			tier: "gh",
			adjacentRepos: [
				{ owner: "acme", name: "ci-templates", reason: "workflow uses" },
			],
			evidence: [
				{
					itemId: 1,
					signal: "positive",
					summary: "justfile present",
					source: "test",
				},
			],
			interviewAnswers: [
				{
					questionId: "q1",
					value: "Company-paid Claude with policy",
					isOption: true,
				},
			],
		});

		expect(prompt).toContain("Agent Maturity Assessment");
		expect(prompt).toContain("Item 1 — Reproducible dev environments");
		expect(prompt).toContain(
			"Item 12 — Interviews assess judgment under AI augmentation",
		);
		expect(prompt).toContain("acme/ci-templates");
		expect(prompt).toContain("justfile present");
		expect(prompt).toContain("Company-paid Claude with policy");
		expect(prompt).toContain("agent_maturity_assessment schema");
	});

	it("handles missing evidence and answers gracefully", () => {
		const prompt = buildMaturityPrompt({
			scope: { mode: "org", org: "acme", displayName: "acme" },
			tier: "git-only",
			adjacentRepos: [],
			evidence: [],
			interviewAnswers: [],
		});
		expect(prompt).toContain("(none detected)");
		expect(prompt).toContain("(no deterministic evidence collected)");
		expect(prompt).toContain("_No interview answers supplied._");
	});

	it("mentions tier-3 cap rule", () => {
		const prompt = buildMaturityPrompt({
			scope: { mode: "org", org: "acme", displayName: "acme" },
			tier: "git-only",
			adjacentRepos: [],
			evidence: [],
			interviewAnswers: [],
		});
		expect(prompt).toMatch(/cap them at 0\.5/);
	});
});

describe("MATURITY_ASSESSMENT_SCHEMA", () => {
	it("uses strict mode and the canonical name", () => {
		expect(MATURITY_ASSESSMENT_SCHEMA.strict).toBe(true);
		expect(MATURITY_ASSESSMENT_SCHEMA.name).toBe("agent_maturity_assessment");
	});
});
