import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AuditFrontmatter,
	renderAudit,
	renderSummary,
	validateSignOff,
	writeAudit,
} from "../../../../../src/services/interview/review/audit-writer.js";
import type {
	Observation,
	ReviewResult,
} from "../../../../../src/services/interview/review/types.js";

function frontmatter(
	overrides: Partial<AuditFrontmatter> = {},
): AuditFrontmatter {
	return {
		tags: ["hiring", "candidate", "senior-backend"],
		candidate: "Jane Doe",
		role: "senior-backend",
		date: "2026-05-10",
		rubric_version: "1.0.0",
		rubric_mode: "default",
		signed_off: false,
		...overrides,
	};
}

function sampleObservation(): Observation {
	return {
		dimension_id: "upfront-design",
		observation:
			"The candidate sketched the data model and aligned with the prompt before generating code.",
		reasoning:
			"At 10:02 they wrote a paragraph describing the API and only at 10:05 did they prompt the agent for code.",
		evidence_excerpts: [
			{
				timestamp: "2026-05-10T10:02:00Z",
				source: "interview.log",
				content: "Let me sketch the data model first…",
			},
		],
	};
}

function sampleResult(): ReviewResult {
	return {
		rubric_version: "1.0.0",
		candidate_id: "jane-doe-2026-05-10",
		role_slug: "senior-backend",
		observed_at: "2026-05-10T11:00:00Z",
		observations: [sampleObservation()],
		measurements: [
			{
				dimension_id: "verification",
				facts: [
					{ label: "Total test runs", value: 8 },
					{ label: "Test runs immediately after a prompt", value: 5 },
				],
			},
			{
				dimension_id: "test-pass",
				facts: [
					{ label: "Passing tests", value: 12 },
					{ label: "Failing tests", value: 0 },
				],
			},
		],
	};
}

describe("renderSummary", () => {
	it("starts with the YAML frontmatter", () => {
		const body = renderSummary({
			result: sampleResult(),
			frontmatter: frontmatter(),
			outputDir: "/tmp/x",
		});
		expect(body.startsWith("---\n")).toBe(true);
		expect(body).toContain("candidate: Jane Doe");
		expect(body).toContain("rubric_version: 1.0.0");
	});

	it("renders the mandatory warning banner", () => {
		const body = renderSummary({
			result: sampleResult(),
			frontmatter: frontmatter(),
			outputDir: "/tmp/x",
		});
		expect(body).toMatch(/THIS AUDIT IS ADVISORY/);
		expect(body).toMatch(/not a score/);
	});

	it("preserves the AI's reasoning chain (not just the observation)", () => {
		const body = renderSummary({
			result: sampleResult(),
			frontmatter: frontmatter(),
			outputDir: "/tmp/x",
		});
		expect(body).toContain("paragraph describing the API");
	});

	it("renders measurements for deterministic dimensions", () => {
		const body = renderSummary({
			result: sampleResult(),
			frontmatter: frontmatter(),
			outputDir: "/tmp/x",
		});
		expect(body).toContain("Total test runs: 8");
		expect(body).toContain("Passing tests: 12");
	});

	it("includes the sign-off section with categorical recommendation choices", () => {
		const body = renderSummary({
			result: sampleResult(),
			frontmatter: frontmatter(),
			outputDir: "/tmp/x",
		});
		expect(body).toContain("Sign-off (MANDATORY)");
		expect(body).toContain("Hire | Hire with notes | No hire");
	});

	it("includes session_recording_url in frontmatter when provided", () => {
		const body = renderSummary({
			result: sampleResult(),
			frontmatter: frontmatter({
				session_recording_url: "https://zoom.us/rec/xyz",
				session_platform: "zoom",
				session_date: "2026-05-10",
			}),
			outputDir: "/tmp/x",
		});
		// URL is quoted because it contains characters (`:`, `/`) that YAML
		// parsers can mishandle in bare scalars. Quoting makes the audit.json
		// round-trip safe even when the URL has colons, hashes, etc.
		expect(body).toContain(`session_recording_url: "https://zoom.us/rec/xyz"`);
		expect(body).toContain("session_platform: zoom");
	});
});

describe("renderAudit", () => {
	it("includes the warning banner just like summary.md", () => {
		const body = renderAudit({
			result: sampleResult(),
			frontmatter: frontmatter(),
			outputDir: "/tmp/x",
		});
		expect(body).toMatch(/THIS AUDIT IS ADVISORY/);
	});

	it("preserves the reasoning chain (transparency across tiers)", () => {
		const body = renderAudit({
			result: sampleResult(),
			frontmatter: frontmatter(),
			outputDir: "/tmp/x",
		});
		expect(body).toContain("paragraph describing the API");
	});

	it("renders evidence excerpts without truncation", () => {
		const long = "x".repeat(400);
		const res: ReviewResult = {
			...sampleResult(),
			observations: [
				{
					...sampleObservation(),
					evidence_excerpts: [{ source: "interview.log", content: long }],
				},
			],
		};
		const body = renderAudit({
			result: res,
			frontmatter: frontmatter(),
			outputDir: "/tmp/x",
		});
		expect(body).toContain(long);
	});
});

describe("writeAudit", () => {
	it("produces summary.md, audit.md, audit.json, and evidence/", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-audit-"));
		try {
			const outputs = writeAudit({
				result: sampleResult(),
				frontmatter: frontmatter(),
				outputDir: dir,
			});
			expect(existsSync(outputs.summaryPath)).toBe(true);
			expect(existsSync(outputs.auditPath)).toBe(true);
			expect(existsSync(outputs.auditJsonPath)).toBe(true);
			expect(existsSync(outputs.evidenceDir)).toBe(true);
			const json = JSON.parse(readFileSync(outputs.auditJsonPath, "utf8"));
			expect(json.frontmatter.candidate).toBe("Jane Doe");
			expect(json.result.observations).toHaveLength(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("validateSignOff", () => {
	it("requires a categorical recommendation", () => {
		const r = validateSignOff({
			recommendation: "Maybe",
			reasoning: "x".repeat(50),
		});
		expect(r.ok).toBe(false);
		expect(r.failures.some((f) => /recommendation/.test(f))).toBe(true);
	});

	it("rejects empty reasoning", () => {
		const r = validateSignOff({ recommendation: "Hire", reasoning: "" });
		expect(r.ok).toBe(false);
		expect(r.failures.some((f) => /reasoning/.test(f))).toBe(true);
	});

	it("rejects too-short reasoning", () => {
		const r = validateSignOff({ recommendation: "Hire", reasoning: "yes." });
		expect(r.ok).toBe(false);
	});

	it("accepts Hire with substantive reasoning", () => {
		const r = validateSignOff({
			recommendation: "Hire",
			reasoning:
				"They showed solid context engineering and clean architecture, with appropriate caution on the destructive operations.",
		});
		expect(r.ok).toBe(true);
	});

	it("accepts Hire with notes and No hire as valid categorical choices", () => {
		expect(
			validateSignOff({
				recommendation: "Hire with notes",
				reasoning:
					"Strong overall, but I want a check-in on the verification habits in week 2.",
			}).ok,
		).toBe(true);
		expect(
			validateSignOff({
				recommendation: "No hire",
				reasoning:
					"The architectural choices and lack of test discipline indicate a mismatch with the role's needs.",
			}).ok,
		).toBe(true);
	});
});
