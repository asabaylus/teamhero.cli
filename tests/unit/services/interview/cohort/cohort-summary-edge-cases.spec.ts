import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadCohort,
	renderCohortSummary,
} from "../../../../../src/services/interview/cohort/cohort-summary.js";
import type { AuditFrontmatter } from "../../../../../src/services/interview/review/audit-writer.js";

function makeCandidate(
	roleDir: string,
	slug: string,
	fm: Partial<AuditFrontmatter>,
): void {
	const dir = join(roleDir, slug);
	mkdirSync(dir, { recursive: true });
	const full: AuditFrontmatter = {
		tags: ["hiring"],
		candidate: slug,
		role: "senior-backend",
		date: "2026-05-10",
		rubric_version: "1.0.0",
		rubric_mode: "default",
		signed_off: false,
		...fm,
	};
	writeFileSync(
		join(dir, "audit.json"),
		JSON.stringify({ frontmatter: full, result: {} }),
	);
}

describe("loadCohort — edge cases", () => {
	it("skips non-directory entries (e.g. loose files) in the role directory", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-cohort-edge-"));
		try {
			// Create a loose file (not a directory) at the top level of roleDir
			writeFileSync(join(dir, "COHORT.md"), "# Cohort\n");
			writeFileSync(join(dir, "some-file.txt"), "random");
			// Create one valid candidate folder
			makeCandidate(dir, "alice", { candidate: "Alice" });
			const records = loadCohort(dir);
			// Only alice should be picked up; the loose files are not directories
			expect(records).toHaveLength(1);
			expect(records[0].frontmatter.candidate).toBe("Alice");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("skips subdirectories with malformed audit.json", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-cohort-edge-"));
		try {
			// Good candidate
			makeCandidate(dir, "alice", { candidate: "Alice" });
			// Bad candidate: malformed JSON
			const badDir = join(dir, "bob");
			mkdirSync(badDir, { recursive: true });
			writeFileSync(join(badDir, "audit.json"), "{ not valid json }");
			const records = loadCohort(dir);
			// Only alice (bad JSON silently skipped)
			expect(records).toHaveLength(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("skips audit.json files missing required frontmatter fields", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-cohort-edge-"));
		try {
			makeCandidate(dir, "alice", { candidate: "Alice" });
			// audit.json missing the 'candidate' field
			const incompleteDir = join(dir, "bob");
			mkdirSync(incompleteDir, { recursive: true });
			writeFileSync(
				join(incompleteDir, "audit.json"),
				JSON.stringify({
					frontmatter: { role: "backend", date: "2026-05-10" },
				}),
			);
			const records = loadCohort(dir);
			expect(records).toHaveLength(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("skips audit.json files where frontmatter is not an object", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-cohort-edge-"));
		try {
			makeCandidate(dir, "alice", { candidate: "Alice" });
			const badDir = join(dir, "carol");
			mkdirSync(badDir, { recursive: true });
			writeFileSync(
				join(badDir, "audit.json"),
				JSON.stringify({ frontmatter: "just a string" }),
			);
			const records = loadCohort(dir);
			expect(records).toHaveLength(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns an empty list when the roleDir is empty", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-cohort-edge-"));
		try {
			expect(loadCohort(dir)).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("renderCohortSummary — session_date priority for display", () => {
	it("uses session_date instead of date in the Interviewed column when available", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-cohort-edge-"));
		try {
			// date = 2026-05-10, session_date = 2026-06-01
			makeCandidate(dir, "alice", {
				candidate: "Alice",
				date: "2026-05-10",
				session_date: "2026-06-01",
			});
			const body = renderCohortSummary("senior-backend", loadCohort(dir));
			expect(body).toContain("2026-06-01");
			// The submission date should NOT appear in place of the session date
			expect(body).not.toContain("2026-05-10");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("falls back to date when session_date is absent", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-cohort-edge-"));
		try {
			makeCandidate(dir, "alice", {
				candidate: "Alice",
				date: "2026-05-10",
			});
			const body = renderCohortSummary("senior-backend", loadCohort(dir));
			expect(body).toContain("2026-05-10");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("renderCohortSummary — sorting edge cases", () => {
	it("orders chronologically using session_date when available", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-cohort-edge-"));
		try {
			makeCandidate(dir, "carol", {
				candidate: "Carol",
				date: "2026-05-20",
				session_date: "2026-05-20",
			});
			makeCandidate(dir, "alice", {
				candidate: "Alice",
				date: "2026-05-01",
				session_date: "2026-05-01",
			});
			const body = renderCohortSummary("senior-backend", loadCohort(dir), {
				order: "chronological",
			});
			expect(body.indexOf("Alice")).toBeLessThan(body.indexOf("Carol"));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("renders link to summary.md using the subfolder name", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-cohort-edge-"));
		try {
			makeCandidate(dir, "alice-2026-05-12", { candidate: "Alice" });
			const body = renderCohortSummary("senior-backend", loadCohort(dir));
			expect(body).toContain("alice-2026-05-12/summary.md");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("shows recommendation as — for pending sign-offs", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-cohort-edge-"));
		try {
			makeCandidate(dir, "bob", { candidate: "Bob", signed_off: false });
			const body = renderCohortSummary("senior-backend", loadCohort(dir));
			// Recommendation column for unsigned should be "—"
			expect(body).toContain("| — |");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does NOT include score, rank, or total columns regardless of data", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-cohort-edge-"));
		try {
			makeCandidate(dir, "alice", {
				candidate: "Alice",
				signed_off: true,
				recommendation: "Hire",
			});
			makeCandidate(dir, "bob", { candidate: "Bob", signed_off: false });
			const body = renderCohortSummary("senior-backend", loadCohort(dir));
			expect(body).not.toMatch(/\|\s*Score\s*\|/i);
			expect(body).not.toMatch(/\|\s*Total\s*\|/i);
			expect(body).not.toMatch(/\|\s*Rank\s*\|/i);
			expect(body).not.toMatch(/\d+\.\d+/); // no decimal numbers (scores)
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("renderCohortSummary — includes role name in the title", () => {
	it("renders the role slug in the cohort heading", () => {
		const body = renderCohortSummary("senior-backend-engineer", []);
		expect(body).toContain("# Cohort: senior-backend-engineer");
	});
});
