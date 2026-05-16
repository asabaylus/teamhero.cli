import { describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBootstrap } from "../../../../../src/services/interview/bootstrap/orchestrator.js";
import type {
	GeneratedProject,
	GeneratorClient,
} from "../../../../../src/services/interview/bootstrap/project-generator.js";
import type { RoleConfig } from "../../../../../src/services/interview/bootstrap/role-config.js";
import { readRoleConfig } from "../../../../../src/services/interview/bootstrap/role-config.js";

function modeAStub(loc = 500): GeneratedProject {
	const padLines = Array.from(
		{ length: 100 },
		(_, k) => `export const v${k} = ${k};`,
	).join("\n");
	const files = [
		{ path: "README.md", content: "# Project\n" },
		{ path: "GLOSSARY.md", content: "# Glossary\n" },
		{ path: "src/a.ts", content: padLines },
		{ path: "src/b.ts", content: padLines },
		{
			path: "tests/x.spec.ts",
			content:
				'import { describe, it } from "bun:test";\ndescribe.skip("x", () => { it("todo", () => {}); });\n',
		},
	];
	const cur = padLines.split("\n").length * 2;
	if (loc > cur) {
		files.push({
			path: "src/pad.ts",
			content: Array.from({ length: loc - cur }, (_, k) => `// ${k}`).join(
				"\n",
			),
		});
	}
	return { files };
}

function client(...projects: GeneratedProject[]): GeneratorClient {
	let i = 0;
	return {
		async generate() {
			return projects[Math.min(i++, projects.length - 1)];
		},
	};
}

function baseConfig(outputDir: string): RoleConfig {
	return {
		roleSlug: "senior-backend",
		roleTitle: "Senior Backend Engineer",
		stack: "TypeScript",
		domain: "Payments",
		featureDescription: "Add idempotency keys",
		timeBoxMinutes: 90,
		projectMode: "A",
		analysisMode: "ai-assisted",
		rubricMode: "default",
		outputDir,
	};
}

describe("runBootstrap", () => {
	it("validates config, generates the project, and writes role-config.json", async () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-orch-"));
		try {
			const result = await runBootstrap(baseConfig(dir), {
				client: client(modeAStub()),
			});
			expect(result.ok).toBe(true);
			expect(existsSync(join(dir, "role-config.json"))).toBe(true);
			expect(existsSync(join(dir, "README.md"))).toBe(true);
			const persisted = readRoleConfig(dir);
			expect(persisted?.roleSlug).toBe("senior-backend");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects an invalid config without calling the generator", async () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-orch-"));
		try {
			let called = false;
			const tracer: GeneratorClient = {
				async generate() {
					called = true;
					return modeAStub();
				},
			};
			const result = await runBootstrap(
				{ ...baseConfig(dir), rubricMode: "custom" },
				{ client: tracer },
			);
			expect(result.ok).toBe(false);
			expect(called).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("writes an index.html placeholder for Mode B (greenfield) runs", async () => {
		// The user picking Mode B (candidate brings their own) needs
		// something concrete to open after running `bun run`. The
		// orchestrator drops a minimal index.html so a candidate has a
		// landing pad — without it Mode B output is just a markdown
		// brief and the empty role-config.json. The stub deliberately
		// references BRIEF.md and avoids prescribing any framework.
		const dir = mkdtempSync(join(tmpdir(), "iv-orch-mode-b-"));
		try {
			const briefStub: GeneratedProject = {
				files: [
					{
						path: "BRIEF.md",
						content:
							"# Brief\n\n## Time-box\n60 minutes\n\n## Acceptance criteria\n- Works.\n\n## Deliverables\n- A repo.\n",
					},
				],
			};
			const cfg: RoleConfig = { ...baseConfig(dir), projectMode: "B" };
			const result = await runBootstrap(cfg, { client: client(briefStub) });
			expect(result.ok).toBe(true);
			expect(existsSync(join(dir, "index.html"))).toBe(true);
			const html = readFileSync(join(dir, "index.html"), "utf8");
			expect(html).toContain("BRIEF.md");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does NOT write an index.html stub for Mode A (would clobber generated source)", async () => {
		// Mode A already has full source files; auto-writing an
		// index.html could overwrite an AI-generated one or confuse
		// the candidate about what's source vs scaffold. Pin this so
		// a refactor can't accidentally extend the stub to Mode A.
		const dir = mkdtempSync(join(tmpdir(), "iv-orch-mode-a-noindex-"));
		try {
			const result = await runBootstrap(baseConfig(dir), {
				client: client(modeAStub()),
			});
			expect(result.ok).toBe(true);
			expect(existsSync(join(dir, "index.html"))).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("preserves an AI-generated index.html instead of clobbering it", async () => {
		// If the AI's Mode B output happens to include its own
		// index.html, the orchestrator must NOT overwrite it. The
		// stub is a fallback for when the AI didn't author one.
		const dir = mkdtempSync(join(tmpdir(), "iv-orch-mode-b-keep-"));
		try {
			const customHtml = "<!doctype html><h1>AI-authored landing</h1>";
			const project: GeneratedProject = {
				files: [
					{
						path: "BRIEF.md",
						content:
							"# Brief\n\n## Time-box\n60 minutes\n\n## Acceptance criteria\n- Works.\n\n## Deliverables\n- A repo.\n",
					},
					{ path: "index.html", content: customHtml },
				],
			};
			const cfg: RoleConfig = { ...baseConfig(dir), projectMode: "B" };
			const result = await runBootstrap(cfg, { client: client(project) });
			expect(result.ok).toBe(true);
			const html = readFileSync(join(dir, "index.html"), "utf8");
			expect(html).toBe(customHtml);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("uses an embedded kit template directory when provided", async () => {
		const projectDir = mkdtempSync(join(tmpdir(), "iv-orch-"));
		const kitDir = mkdtempSync(join(tmpdir(), "iv-kit-"));
		try {
			writeFileSync(join(kitDir, "INTERVIEW_RULES.md"), "# Rules\n");
			const result = await runBootstrap(baseConfig(projectDir), {
				client: client(modeAStub()),
				kitTemplateDir: kitDir,
			});
			expect(result.ok).toBe(true);
			expect(existsSync(join(projectDir, "INTERVIEW_RULES.md"))).toBe(true);
		} finally {
			rmSync(projectDir, { recursive: true, force: true });
			rmSync(kitDir, { recursive: true, force: true });
		}
	});
});
