import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type GeneratorClient,
	type GeneratedProject,
	generateProject,
	validateGenerated,
} from "../../../../../src/services/interview/bootstrap/project-generator.js";
import type { RoleConfig } from "../../../../../src/services/interview/bootstrap/role-config.js";

function role(overrides: Partial<RoleConfig> = {}): RoleConfig {
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
		outputDir: "(set per test)",
		...overrides,
	};
}

function stubModeAProject(loc = 500, withFailingTest = true): GeneratedProject {
	const padLines = Array.from(
		{ length: 100 },
		(_, k) => `export const v${k} = ${k};`,
	).join("\n");
	const files = [
		{ path: "CLAUDE.md", content: "# Project\nCandidate context.\n" },
		{ path: "GLOSSARY.md", content: "# Glossary\n- term: definition\n" },
		{ path: "src/deep-one.ts", content: padLines },
		{ path: "src/deep-two.ts", content: padLines },
	];
	if (withFailingTest) {
		files.push({
			path: "tests/feature.spec.ts",
			content:
				'import { describe, it } from "bun:test";\ndescribe.skip("feature", () => { it("todo", () => {}); });\n',
		});
	}
	const totalCurrent = padLines.split("\n").length * 2;
	if (loc > totalCurrent) {
		const remaining = loc - totalCurrent;
		files.push({
			path: "src/pad.ts",
			content: Array.from({ length: remaining }, (_, k) => `// line ${k}`).join(
				"\n",
			),
		});
	}
	return { files };
}

function stubModeBProject(): GeneratedProject {
	return {
		files: [
			{
				path: "BRIEF.md",
				content: `# Brief\n\n## Time-box\n90 minutes\n\n## Acceptance criteria\n- Works.\n\n## Deliverables\n- A repo with passing tests.\n`,
			},
		],
	};
}

function clientReturning(...projects: GeneratedProject[]): GeneratorClient {
	let i = 0;
	return {
		async generate() {
			const project = projects[Math.min(i, projects.length - 1)];
			i += 1;
			return project;
		},
	};
}

describe("generateProject (Mode A)", () => {
	it("writes generated files into outputDir and reports success", async () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-gen-"));
		try {
			const client = clientReturning(stubModeAProject());
			const result = await generateProject(role({ outputDir: dir }), client);
			expect(result.ok).toBe(true);
			expect(existsSync(join(dir, "CLAUDE.md"))).toBe(true);
			expect(existsSync(join(dir, "GLOSSARY.md"))).toBe(true);
			expect(existsSync(join(dir, "src", "deep-one.ts"))).toBe(true);
			expect(result.attempts).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("retries up to 3 times when validation fails, then succeeds on a later attempt", async () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-gen-"));
		try {
			// First two attempts return malformed projects (no CLAUDE.md), third succeeds
			const malformed: GeneratedProject = {
				files: [{ path: "README.md", content: "incomplete" }],
			};
			const client = clientReturning(
				malformed,
				malformed,
				stubModeAProject(),
			);
			const result = await generateProject(role({ outputDir: dir }), client);
			expect(result.ok).toBe(true);
			expect(result.attempts).toBe(3);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reports failure with diagnostic after 3 failed attempts", async () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-gen-"));
		try {
			const malformed: GeneratedProject = {
				files: [{ path: "README.md", content: "incomplete" }],
			};
			const client = clientReturning(malformed, malformed, malformed);
			const result = await generateProject(role({ outputDir: dir }), client);
			expect(result.ok).toBe(false);
			expect(result.attempts).toBe(3);
			expect(result.failures.length).toBeGreaterThan(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("copies the embedded interview-kit templates into outputDir", async () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-gen-"));
		try {
			const client = clientReturning(stubModeAProject());
			const kitSrc = mkdtempSync(join(tmpdir(), "iv-kit-"));
			// stage a fake kit
			const { writeFileSync, mkdirSync } = await import("node:fs");
			mkdirSync(join(kitSrc, ".claude"), { recursive: true });
			writeFileSync(join(kitSrc, "start.sh"), "#!/usr/bin/env bash\n");
			writeFileSync(
				join(kitSrc, ".claude", "settings.json"),
				'{"hooks":{}}\n',
			);
			try {
				const result = await generateProject(role({ outputDir: dir }), client, {
					kitTemplateDir: kitSrc,
				});
				expect(result.ok).toBe(true);
				expect(existsSync(join(dir, "start.sh"))).toBe(true);
				expect(existsSync(join(dir, ".claude", "settings.json"))).toBe(true);
			} finally {
				rmSync(kitSrc, { recursive: true, force: true });
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("validateGenerated", () => {
	it("re-runs validation against an already-written output dir (Mode A)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-gen-"));
		try {
			const client = clientReturning(stubModeAProject());
			const cfg = role({ outputDir: dir });
			const result = await generateProject(cfg, client);
			expect(result.ok).toBe(true);
			const revalidation = validateGenerated(cfg);
			expect(revalidation.ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns the failure list when the output dir is malformed", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-gen-"));
		try {
			const cfg = role({ outputDir: dir, projectMode: "B" });
			const result = validateGenerated(cfg);
			expect(result.ok).toBe(false);
			expect(result.failures.length).toBeGreaterThan(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("generateProject (Mode B)", () => {
	it("writes a BRIEF.md and reports success", async () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-gen-"));
		try {
			const client = clientReturning(stubModeBProject());
			const result = await generateProject(
				role({ outputDir: dir, projectMode: "B" }),
				client,
			);
			expect(result.ok).toBe(true);
			const brief = readFileSync(join(dir, "BRIEF.md"), "utf8");
			expect(brief.length).toBeGreaterThan(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
