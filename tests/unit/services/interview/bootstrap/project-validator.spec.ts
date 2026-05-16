import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	validateModeAProject,
	validateModeBProject,
} from "../../../../../src/services/interview/bootstrap/project-validator.js";

function makeTempProject(): string {
	return mkdtempSync(join(tmpdir(), "iv-validator-"));
}

function writeModeAFixture(
	dir: string,
	opts: { withReadme?: boolean } = {},
): void {
	const o = { withReadme: true, ...opts };
	if (o.withReadme) writeFileSync(join(dir, "README.md"), "# Project\n");
	mkdirSync(join(dir, "src"), { recursive: true });
	writeFileSync(join(dir, "src", "main.ts"), "export const main = () => {};\n");
}

describe("project-validator (Mode A)", () => {
	it("passes with only a README.md (the single structural requirement)", () => {
		// The candidate-facing brief is the only required file. GLOSSARY,
		// sample tests, and the kit's CLAUDE.md have all been removed —
		// they hinted at the answer or coached the candidate's agent in
		// ways that undermined the evaluation.
		const dir = makeTempProject();
		try {
			writeModeAFixture(dir);
			const result = validateModeAProject(dir);
			expect(result.ok).toBe(true);
			expect(result.failures).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fails when README.md is missing", () => {
		const dir = makeTempProject();
		try {
			writeModeAFixture(dir, { withReadme: false });
			const result = validateModeAProject(dir);
			expect(result.ok).toBe(false);
			expect(result.failures.some((f) => /README\.md/i.test(f))).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does NOT require GLOSSARY.md (regression: glossary leaked domain hints)", () => {
		// Pin the contract: a project without GLOSSARY.md must pass.
		// Removed because a glossary lists the domain concepts the
		// candidate is being evaluated on identifying themselves.
		const dir = makeTempProject();
		try {
			writeFileSync(join(dir, "README.md"), "# Project\n");
			const result = validateModeAProject(dir);
			expect(result.ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does NOT require sample tests (regression: pre-existing tests leaked the API shape)", () => {
		// Pin the contract: a project without any test files must pass.
		// Removed because a pre-existing `describe.skip("addUser", ...)`
		// reveals the function name the candidate is expected to write.
		// The candidate writes their own tests as part of the work.
		const dir = makeTempProject();
		try {
			writeFileSync(join(dir, "README.md"), "# Project\n");
			const result = validateModeAProject(dir);
			expect(result.ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("project-validator (Mode B)", () => {
	it("passes when BRIEF.md exists with required sections", () => {
		const dir = makeTempProject();
		try {
			writeFileSync(
				join(dir, "BRIEF.md"),
				`# Brief\n\n## Time-box\n90 minutes\n\n## Acceptance criteria\n- Works\n\n## Deliverables\n- A repo\n`,
			);
			const result = validateModeBProject(dir);
			expect(result.ok).toBe(true);
			expect(result.failures).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fails when BRIEF.md is missing", () => {
		const dir = makeTempProject();
		try {
			const result = validateModeBProject(dir);
			expect(result.ok).toBe(false);
			expect(result.failures.some((f) => /BRIEF\.md/i.test(f))).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fails when BRIEF.md is empty", () => {
		const dir = makeTempProject();
		try {
			writeFileSync(join(dir, "BRIEF.md"), "");
			const result = validateModeBProject(dir);
			expect(result.ok).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fails when BRIEF.md is missing required sections", () => {
		const dir = makeTempProject();
		try {
			writeFileSync(join(dir, "BRIEF.md"), "# Brief\n\nJust a title.\n");
			const result = validateModeBProject(dir);
			expect(result.ok).toBe(false);
			expect(
				result.failures.some((f) => /acceptance|deliverable|time-box/i.test(f)),
			).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
