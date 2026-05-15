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
	opts: {
		withReadme?: boolean;
		withGlossary?: boolean;
		deepModuleCount?: number;
		shallowModuleCount?: number;
		withFailingTests?: boolean;
		linesOfCode?: number;
	} = {},
): void {
	const o = {
		withReadme: true,
		withGlossary: true,
		deepModuleCount: 2,
		shallowModuleCount: 0,
		withFailingTests: true,
		linesOfCode: 500,
		...opts,
	};

	if (o.withReadme) writeFileSync(join(dir, "README.md"), "# Project\n");
	if (o.withGlossary) writeFileSync(join(dir, "GLOSSARY.md"), "# Glossary\n");

	mkdirSync(join(dir, "src"), { recursive: true });
	for (let i = 0; i < o.deepModuleCount; i++) {
		// "Deep" — long enough to count: > 80 lines
		const body = Array.from(
			{ length: 100 },
			(_, k) => `export const v${i}_${k} = ${k};`,
		).join("\n");
		writeFileSync(join(dir, "src", `deep-${i}.ts`), body);
	}
	for (let i = 0; i < o.shallowModuleCount; i++) {
		writeFileSync(join(dir, "src", `shallow-${i}.ts`), "export const x = 1;");
	}

	mkdirSync(join(dir, "tests"), { recursive: true });
	if (o.withFailingTests) {
		writeFileSync(
			join(dir, "tests", "feature.spec.ts"),
			`import { describe, it } from "bun:test";\ndescribe.skip("feature", () => {\n  it("not yet implemented", () => {});\n});\n`,
		);
	}

	// Pad LOC to target if necessary. Test files are excluded from the LOC
	// count by the validator (TEST_NAME_PATTERN), so we only count deep
	// modules here.
	const currentLoc = o.deepModuleCount * 100;
	const remaining = o.linesOfCode - currentLoc;
	if (remaining > 0) {
		writeFileSync(
			join(dir, "src", "pad.ts"),
			Array.from({ length: remaining }, (_, k) => `// line ${k}`).join("\n"),
		);
	}
}

describe("project-validator (Mode A)", () => {
	it("passes when project has README.md, GLOSSARY.md, 2+ deep modules, failing tests, LOC in range", () => {
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

	it("fails when GLOSSARY.md is missing", () => {
		const dir = makeTempProject();
		try {
			writeModeAFixture(dir, { withGlossary: false });
			const result = validateModeAProject(dir);
			expect(result.ok).toBe(false);
			expect(result.failures.some((f) => /GLOSSARY\.md/i.test(f))).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fails when there are fewer than 2 deep modules (sprawl-only)", () => {
		const dir = makeTempProject();
		try {
			writeModeAFixture(dir, { deepModuleCount: 0, shallowModuleCount: 10 });
			const result = validateModeAProject(dir);
			expect(result.ok).toBe(false);
			expect(result.failures.some((f) => /deep modules?/i.test(f))).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fails when no failing/skipped tests are present", () => {
		const dir = makeTempProject();
		try {
			writeModeAFixture(dir, { withFailingTests: false });
			const result = validateModeAProject(dir);
			expect(result.ok).toBe(false);
			expect(result.failures.some((f) => /failing|skipped test/i.test(f))).toBe(
				true,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fails when LOC is below the 400-700 range", () => {
		const dir = makeTempProject();
		try {
			writeModeAFixture(dir, { linesOfCode: 200 });
			const result = validateModeAProject(dir);
			expect(result.ok).toBe(false);
			expect(result.failures.some((f) => /LOC|lines of code/i.test(f))).toBe(
				true,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fails when LOC is above the 400-700 range", () => {
		const dir = makeTempProject();
		try {
			writeModeAFixture(dir, { linesOfCode: 1500 });
			const result = validateModeAProject(dir);
			expect(result.ok).toBe(false);
			expect(result.failures.some((f) => /LOC|lines of code/i.test(f))).toBe(
				true,
			);
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
