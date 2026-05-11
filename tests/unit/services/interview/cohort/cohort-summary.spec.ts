import { describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditFrontmatter } from "../../../../../src/services/interview/review/audit-writer.js";
import {
	loadCohort,
	renderCohortSummary,
	writeCohortSummary,
} from "../../../../../src/services/interview/cohort/cohort-summary.js";

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
	writeFileSync(join(dir, "summary.md"), "stub");
}

describe("loadCohort", () => {
	it("returns an empty list when the role directory does not exist", () => {
		expect(loadCohort("/tmp/definitely-not-real")).toEqual([]);
	});

	it("reads audit.json from each candidate subfolder", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-cohort-"));
		try {
			makeCandidate(dir, "alice", { candidate: "Alice Chen" });
			makeCandidate(dir, "bob", { candidate: "Bob Park" });
			const records = loadCohort(dir);
			expect(records).toHaveLength(2);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("skips subfolders without an audit.json", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-cohort-"));
		try {
			makeCandidate(dir, "alice", { candidate: "Alice" });
			mkdirSync(join(dir, "incomplete"));
			expect(loadCohort(dir)).toHaveLength(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("renderCohortSummary", () => {
	it("places the advisory warning banner at the top", () => {
		const body = renderCohortSummary("senior-backend", []);
		expect(body).toMatch(/THIS COHORT REPORT IS ADVISORY/);
		expect(body).toMatch(/not a score/);
	});

	it("emits the required columns and no score column", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-cohort-"));
		try {
			makeCandidate(dir, "alice", { candidate: "Alice" });
			const body = renderCohortSummary("senior-backend", loadCohort(dir));
			expect(body).toContain(
				"| Candidate | Interviewed | Sign-off | Recommendation | Audit |",
			);
			// No score column or numerical totals column in the header.
			expect(body).not.toMatch(/\|\s*Score\s*\|/i);
			expect(body).not.toMatch(/\|\s*Total\s*\|/i);
			expect(body).not.toMatch(/\|\s*Rank\s*\|/i);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("marks pending sign-offs with ⏳ and reviewed with ✅", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-cohort-"));
		try {
			makeCandidate(dir, "alice", {
				candidate: "Alice",
				signed_off: true,
				recommendation: "Hire",
			});
			makeCandidate(dir, "bob", { candidate: "Bob", signed_off: false });
			const body = renderCohortSummary("senior-backend", loadCohort(dir));
			expect(body).toMatch(/Alice.*Reviewed/);
			expect(body).toMatch(/Bob.*Pending/);
			expect(body).toMatch(/Alice.*Hire/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("orders alphabetically by default", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-cohort-"));
		try {
			makeCandidate(dir, "zelda", { candidate: "Zelda" });
			makeCandidate(dir, "alice", { candidate: "Alice" });
			const body = renderCohortSummary("senior-backend", loadCohort(dir));
			expect(body.indexOf("Alice")).toBeLessThan(body.indexOf("Zelda"));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("orders chronologically when requested", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-cohort-"));
		try {
			makeCandidate(dir, "zelda", {
				candidate: "Zelda",
				date: "2026-05-01",
			});
			makeCandidate(dir, "alice", {
				candidate: "Alice",
				date: "2026-05-15",
			});
			const body = renderCohortSummary("senior-backend", loadCohort(dir), {
				order: "chronological",
			});
			expect(body.indexOf("Zelda")).toBeLessThan(body.indexOf("Alice"));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("renders a friendly message when there are no candidates", () => {
		const body = renderCohortSummary("senior-backend", []);
		expect(body).toContain("No candidates yet");
	});

	it("counts pending vs reviewed in the header", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-cohort-"));
		try {
			makeCandidate(dir, "alice", { signed_off: true, recommendation: "Hire" });
			makeCandidate(dir, "bob", { signed_off: false });
			makeCandidate(dir, "carol", { signed_off: false });
			const body = renderCohortSummary("senior-backend", loadCohort(dir));
			expect(body).toMatch(/3 \(2 pending sign-off, 1 reviewed\)/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("writeCohortSummary", () => {
	it("writes COHORT.md inside the role directory", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-cohort-"));
		try {
			makeCandidate(dir, "alice", { candidate: "Alice" });
			const out = writeCohortSummary({
				roleDir: dir,
				roleSlug: "senior-backend",
			});
			expect(existsSync(out.path)).toBe(true);
			expect(out.recordCount).toBe(1);
			const body = readFileSync(out.path, "utf8");
			expect(body).toContain("THIS COHORT REPORT IS ADVISORY");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
