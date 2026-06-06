import { describe, expect, it } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	validateKitFiles,
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

describe("project-validator (Mode A) — in-memory: no database packages (§3a)", () => {
	const FEATURE = "Build an in-memory spool tracker with no database.";

	it("fails when a .csproj references a database driver and the feature is in-memory", () => {
		const dir = makeTempProject();
		try {
			writeFileSync(join(dir, "README.md"), "# Project\n");
			mkdirSync(join(dir, "src"), { recursive: true });
			writeFileSync(
				join(dir, "src", "Api.csproj"),
				`<Project Sdk="Microsoft.NET.Sdk.Web">\n  <ItemGroup>\n    <PackageReference Include="MongoDB.Driver" Version="2.24.0" />\n  </ItemGroup>\n</Project>\n`,
			);
			const result = validateModeAProject(dir, { featureDescription: FEATURE });
			expect(result.ok).toBe(false);
			expect(result.failures.some((f) => /database driver/i.test(f))).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fails when package.json pulls in a database driver and the feature is in-memory", () => {
		const dir = makeTempProject();
		try {
			writeFileSync(join(dir, "README.md"), "# Project\n");
			writeFileSync(
				join(dir, "package.json"),
				JSON.stringify({ dependencies: { mongoose: "^8.0.0" } }, null, 2),
			);
			const result = validateModeAProject(dir, { featureDescription: FEATURE });
			expect(result.ok).toBe(false);
			expect(result.failures.some((f) => /database driver/i.test(f))).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("passes when an in-memory project ships no database driver", () => {
		const dir = makeTempProject();
		try {
			writeFileSync(join(dir, "README.md"), "# Project\n");
			writeFileSync(
				join(dir, "package.json"),
				JSON.stringify({ dependencies: { express: "^4.0.0" } }, null, 2),
			);
			const result = validateModeAProject(dir, { featureDescription: FEATURE });
			expect(result.ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does NOT flag a database driver when the feature is not in-memory", () => {
		// Without the in-memory signal the check is off — some roles do
		// legitimately want a persistence layer.
		const dir = makeTempProject();
		try {
			writeFileSync(join(dir, "README.md"), "# Project\n");
			writeFileSync(
				join(dir, "package.json"),
				JSON.stringify({ dependencies: { mongoose: "^8.0.0" } }, null, 2),
			);
			const result = validateModeAProject(dir, {
				featureDescription: "Build a persistent user store.",
			});
			expect(result.ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("project-validator (Mode A) — README code-block formatting (§3b)", () => {
	it("fails when README has an indented command line instead of a fenced block", () => {
		const dir = makeTempProject();
		try {
			writeFileSync(
				join(dir, "README.md"),
				"# Project\n\nGetting started:\n\n dotnet restore\n npm install\n",
			);
			const result = validateModeAProject(dir);
			expect(result.ok).toBe(false);
			expect(result.failures.some((f) => /indented command/i.test(f))).toBe(
				true,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("passes when commands are inside a properly fenced code block", () => {
		const dir = makeTempProject();
		try {
			writeFileSync(
				join(dir, "README.md"),
				"# Project\n\n```bash\ndotnet restore\nnpm install\n```\n",
			);
			const result = validateModeAProject(dir);
			expect(result.ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("project-validator — kit file presence (§3c)", () => {
	function writeKit(
		dir: string,
		opts: { omit?: string; nonExec?: boolean } = {},
	): void {
		const files = [
			"INTERVIEW_RULES.md",
			"PRIVACY_RELEASE.md",
			"RUBRIC_OVERVIEW.md",
			"start.sh",
			"end.sh",
			"lib/privacy-gate.sh",
		];
		for (const rel of files) {
			if (rel === opts.omit) continue;
			const full = join(dir, rel);
			mkdirSync(join(dir, rel.includes("/") ? "lib" : "."), {
				recursive: true,
			});
			writeFileSync(full, "# kit file\n");
			if (rel === "start.sh" || rel === "end.sh") {
				chmodSync(full, opts.nonExec ? 0o644 : 0o755);
			}
		}
	}

	it("passes when all kit files are present and the entrypoints are executable", () => {
		const dir = makeTempProject();
		try {
			writeKit(dir);
			const result = validateKitFiles(dir);
			expect(result.ok).toBe(true);
			expect(result.failures).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fails when a required kit file is missing", () => {
		const dir = makeTempProject();
		try {
			writeKit(dir, { omit: "PRIVACY_RELEASE.md" });
			const result = validateKitFiles(dir);
			expect(result.ok).toBe(false);
			expect(
				result.failures.some((f) => /PRIVACY_RELEASE\.md/.test(f)),
			).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fails when start.sh / end.sh are not executable", () => {
		const dir = makeTempProject();
		try {
			writeKit(dir, { nonExec: true });
			const result = validateKitFiles(dir);
			expect(result.ok).toBe(false);
			expect(result.failures.some((f) => /not executable/i.test(f))).toBe(true);
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
