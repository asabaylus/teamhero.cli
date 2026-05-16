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
		withFailingTests?: boolean;
	} = {},
): void {
	const o = {
		withReadme: true,
		withGlossary: true,
		withFailingTests: true,
		...opts,
	};

	if (o.withReadme) writeFileSync(join(dir, "README.md"), "# Project\n");
	if (o.withGlossary) writeFileSync(join(dir, "GLOSSARY.md"), "# Glossary\n");

	mkdirSync(join(dir, "src"), { recursive: true });
	writeFileSync(join(dir, "src", "main.ts"), "export const main = () => {};\n");

	mkdirSync(join(dir, "tests"), { recursive: true });
	if (o.withFailingTests) {
		writeFileSync(
			join(dir, "tests", "feature.spec.ts"),
			`import { describe, it } from "bun:test";\ndescribe.skip("feature", () => {\n  it("not yet implemented", () => {});\n});\n`,
		);
	}
}

describe("project-validator (Mode A)", () => {
	it("passes when project has README.md, GLOSSARY.md, and a failing/skipped test", () => {
		// Structural-only validation. The LOC + deep-module rules that
		// previously gated this check were removed because they were a
		// heuristic, not a product requirement, and produced friction on
		// perfectly serviceable smaller projects.
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

	it("does NOT reject a small project on size grounds (regression: LOC validator removed)", () => {
		// The validator used to reject any project under 400 source LOC.
		// That rule was a heuristic that produced friction; product spec
		// only requires the structural files. This test pins the new
		// contract — a tiny but structurally-complete project must pass.
		const dir = makeTempProject();
		try {
			writeFileSync(join(dir, "README.md"), "# Project\n");
			writeFileSync(join(dir, "GLOSSARY.md"), "# Glossary\n");
			mkdirSync(join(dir, "src"), { recursive: true });
			// Single ~10-line source file — would have failed the old
			// 400-700 LOC + 2-deep-module gates.
			writeFileSync(
				join(dir, "src", "tiny.ts"),
				"export const tiny = () => 1;\n",
			);
			mkdirSync(join(dir, "tests"), { recursive: true });
			writeFileSync(
				join(dir, "tests", "feature.spec.ts"),
				`import { describe, it } from "bun:test";\ndescribe.skip("feature", () => { it("todo", () => {}); });\n`,
			);
			const result = validateModeAProject(dir);
			expect(result.ok).toBe(true);
			expect(result.failures).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("recognises xUnit Skip-attributed tests in *Tests.cs files", () => {
		// The polyglot test-file detection still matters — the validator
		// must recognise a Skip-attributed [Fact] in C# as a failing test
		// so a .NET interview project passes the failing-test check.
		const dir = makeTempProject();
		try {
			writeFileSync(join(dir, "README.md"), "# Project\n");
			writeFileSync(join(dir, "GLOSSARY.md"), "# Glossary\n");
			mkdirSync(join(dir, "tests"), { recursive: true });
			writeFileSync(
				join(dir, "tests", "FeatureTests.cs"),
				`using Xunit;\npublic class FeatureTests {\n  [Fact(Skip = "not yet implemented")]\n  public void Pending() {}\n}\n`,
			);
			const result = validateModeAProject(dir);
			expect(result.ok).toBe(true);
			expect(result.failures).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("recognises pytest skip markers in test_*.py files", () => {
		const dir = makeTempProject();
		try {
			writeFileSync(join(dir, "README.md"), "# Project\n");
			writeFileSync(join(dir, "GLOSSARY.md"), "# Glossary\n");
			mkdirSync(join(dir, "tests"), { recursive: true });
			writeFileSync(
				join(dir, "tests", "test_feature.py"),
				`import pytest\n@pytest.mark.skip(reason="not yet implemented")\ndef test_pending():\n    pass\n`,
			);
			const result = validateModeAProject(dir);
			expect(result.ok).toBe(true);
			expect(result.failures).toEqual([]);
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
