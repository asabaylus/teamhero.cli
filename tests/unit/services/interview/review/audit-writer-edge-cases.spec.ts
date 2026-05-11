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
import type { ReviewResult } from "../../../../../src/services/interview/review/types.js";

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

function emptyResult(): ReviewResult {
	return {
		rubric_version: "1.0.0",
		candidate_id: "jane-doe-2026-05-10",
		role_slug: "senior-backend",
		observed_at: "2026-05-10T11:00:00Z",
		observations: [],
		measurements: [],
	};
}

describe("YAML frontmatter — yamlScalar quoting for special characters", () => {
	it("quotes a candidate name containing a colon", () => {
		const body = renderSummary({
			result: emptyResult(),
			frontmatter: frontmatter({ candidate: "Doe, Jane: III" }),
			outputDir: "/tmp/x",
		});
		// The colon in the name requires YAML quoting; unquoted "Jane: III" would be parsed as mapping
		expect(body).toMatch(/candidate:\s*"Doe, Jane: III"/);
	});

	it("quotes a candidate name containing a hash (comment marker)", () => {
		const body = renderSummary({
			result: emptyResult(),
			frontmatter: frontmatter({ candidate: "Jane #Doe" }),
			outputDir: "/tmp/x",
		});
		expect(body).toMatch(/candidate:\s*"Jane #Doe"/);
	});

	it("quotes a candidate name with leading whitespace", () => {
		const body = renderSummary({
			result: emptyResult(),
			frontmatter: frontmatter({ candidate: " Jane Doe" }),
			outputDir: "/tmp/x",
		});
		expect(body).toMatch(/candidate:\s*" Jane Doe"/);
	});

	it("does NOT quote a plain candidate name with no special chars", () => {
		const body = renderSummary({
			result: emptyResult(),
			frontmatter: frontmatter({ candidate: "Jane Doe" }),
			outputDir: "/tmp/x",
		});
		// Plain name — no quoting needed
		expect(body).toContain("candidate: Jane Doe");
		expect(body).not.toContain('candidate: "Jane Doe"');
	});

	it("quotes a tag containing commas or brackets", () => {
		const body = renderSummary({
			result: emptyResult(),
			frontmatter: frontmatter({ tags: ["hiring", "role: senior-backend"] }),
			outputDir: "/tmp/x",
		});
		// The tag "role: senior-backend" contains a colon and must be quoted inside the array
		expect(body).toMatch(/tags: \[.*"role: senior-backend".*\]/);
	});

	it("places the YAML block before the warning banner", () => {
		const body = renderSummary({
			result: emptyResult(),
			frontmatter: frontmatter(),
			outputDir: "/tmp/x",
		});
		const yamlEnd = body.indexOf("---\n", 4); // second ---
		const bannerStart = body.indexOf("THIS AUDIT IS ADVISORY");
		expect(yamlEnd).toBeGreaterThan(0);
		expect(bannerStart).toBeGreaterThan(yamlEnd);
	});

	it("includes recommendation in frontmatter only when signed_off is true", () => {
		const signed = renderSummary({
			result: emptyResult(),
			frontmatter: frontmatter({
				signed_off: true,
				recommendation: "Hire with notes",
			}),
			outputDir: "/tmp/x",
		});
		const unsigned = renderSummary({
			result: emptyResult(),
			frontmatter: frontmatter({ signed_off: false }),
			outputDir: "/tmp/x",
		});
		expect(signed).toContain("recommendation:");
		expect(unsigned).not.toContain("recommendation:");
	});

	it("omits optional session fields when not provided", () => {
		const body = renderSummary({
			result: emptyResult(),
			frontmatter: frontmatter(),
			outputDir: "/tmp/x",
		});
		expect(body).not.toContain("session_recording_url:");
		expect(body).not.toContain("session_platform:");
		expect(body).not.toContain("session_date:");
	});
});

describe("renderSummary — evidence excerpt truncation at 200 chars", () => {
	it("truncates evidence content to 200 chars in summary tier", () => {
		const long = "x".repeat(300);
		const result: ReviewResult = {
			...emptyResult(),
			observations: [
				{
					dimension_id: "upfront-design",
					observation: "The candidate planned carefully.",
					reasoning: "Clear planning before coding.",
					evidence_excerpts: [{ source: "interview.log", content: long }],
				},
			],
		};
		const body = renderSummary({
			result,
			frontmatter: frontmatter(),
			outputDir: "/tmp/x",
		});
		// Summary truncates at 200; the 201st+ characters should not appear
		expect(body).not.toContain(long);
		// But the first 200 chars should be present
		expect(body).toContain("x".repeat(200));
		// Ellipsis appended after truncation
		expect(body).toContain("…");
	});
});

describe("renderAudit — evidence excerpt NOT truncated", () => {
	it("does not truncate evidence content in the audit tier", () => {
		const long = "x".repeat(400);
		const result: ReviewResult = {
			...emptyResult(),
			observations: [
				{
					dimension_id: "upfront-design",
					observation: "Planned carefully.",
					reasoning: "Detailed reasoning.",
					evidence_excerpts: [{ source: "interview.log", content: long }],
				},
			],
		};
		const body = renderAudit({
			result,
			frontmatter: frontmatter(),
			outputDir: "/tmp/x",
		});
		// Full content preserved in audit tier
		expect(body).toContain(long);
		// No ellipsis for full content
		expect(body).not.toContain(long.slice(0, 200) + "…");
	});

	it("renders evidence with optional timestamp when provided", () => {
		const result: ReviewResult = {
			...emptyResult(),
			observations: [
				{
					dimension_id: "upfront-design",
					observation: "Planned.",
					reasoning: "Reasoning.",
					evidence_excerpts: [
						{
							timestamp: "2026-05-10T10:05:00Z",
							source: "terminal.cast",
							content: "git commit -m 'initial'",
						},
					],
				},
			],
		};
		const body = renderAudit({
			result,
			frontmatter: frontmatter(),
			outputDir: "/tmp/x",
		});
		expect(body).toContain("[2026-05-10T10:05:00Z]");
		expect(body).toContain("terminal.cast");
	});
});

describe("renderSummary / renderAudit — dimensions with no evidence", () => {
	it("shows a fallback message for dimensions with no observation or measurement", () => {
		const body = renderSummary({
			result: emptyResult(),
			frontmatter: frontmatter(),
			outputDir: "/tmp/x",
		});
		// With empty obs/meas, all dimensions should show the fallback
		expect(body).toContain("No evidence captured");
	});
});

describe("renderSummary — caveats field", () => {
	it("renders caveats when present on an observation", () => {
		const result: ReviewResult = {
			...emptyResult(),
			observations: [
				{
					dimension_id: "critical-evaluation",
					observation: "Could not determine clearly.",
					reasoning: "Limited evidence.",
					evidence_excerpts: [],
					caveats: "The terminal recording was missing for the first 20 minutes.",
				},
			],
		};
		const body = renderSummary({
			result,
			frontmatter: frontmatter(),
			outputDir: "/tmp/x",
		});
		expect(body).toContain("The terminal recording was missing");
		expect(body).toContain("Caveats:");
	});

	it("does NOT render a Caveats line when the caveats field is absent", () => {
		const result: ReviewResult = {
			...emptyResult(),
			observations: [
				{
					dimension_id: "upfront-design",
					observation: "Planned well.",
					reasoning: "Reasoning.",
					evidence_excerpts: [],
				},
			],
		};
		const body = renderSummary({
			result,
			frontmatter: frontmatter(),
			outputDir: "/tmp/x",
		});
		expect(body).not.toContain("**Caveats:**");
	});
});

describe("validateSignOff — boundary cases", () => {
	it("accepts reasoning of exactly 20 characters", () => {
		const r = validateSignOff({
			recommendation: "Hire",
			reasoning: "x".repeat(20),
		});
		expect(r.ok).toBe(true);
	});

	it("rejects reasoning of exactly 19 characters (one below minimum)", () => {
		const r = validateSignOff({
			recommendation: "Hire",
			reasoning: "x".repeat(19),
		});
		expect(r.ok).toBe(false);
	});

	it("trims whitespace before checking reasoning length", () => {
		// Spaces-only reasoning is effectively blank
		const r = validateSignOff({
			recommendation: "Hire",
			reasoning: " ".repeat(25),
		});
		expect(r.ok).toBe(false);
	});

	it("returns multiple failures when both recommendation and reasoning are invalid", () => {
		const r = validateSignOff({ recommendation: "Unsure", reasoning: "" });
		expect(r.ok).toBe(false);
		expect(r.failures.length).toBeGreaterThanOrEqual(2);
	});
});

describe("writeAudit — output structure", () => {
	it("audit.json round-trips the frontmatter and result faithfully", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-audit-edge-"));
		try {
			const fm = frontmatter({
				signed_off: true,
				recommendation: "No hire",
				session_platform: "zoom",
				session_date: "2026-05-10",
			});
			const result: ReviewResult = {
				...emptyResult(),
				observations: [
					{
						dimension_id: "upfront-design",
						observation: "No planning observed.",
						reasoning: "Jumped straight to prompting.",
						evidence_excerpts: [],
					},
				],
			};
			const outputs = writeAudit({ result, frontmatter: fm, outputDir: dir });
			const json = JSON.parse(readFileSync(outputs.auditJsonPath, "utf8"));
			expect(json.frontmatter.recommendation).toBe("No hire");
			expect(json.frontmatter.session_platform).toBe("zoom");
			expect(json.result.observations[0].dimension_id).toBe("upfront-design");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("produces an evidence/ directory even when no evidence files are provided", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-audit-edge-"));
		try {
			const outputs = writeAudit({
				result: emptyResult(),
				frontmatter: frontmatter(),
				outputDir: dir,
			});
			expect(existsSync(outputs.evidenceDir)).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
