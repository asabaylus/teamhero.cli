import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type GeneratedProject,
	type GeneratorClient,
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

// stubModeAProject returns a minimal Mode A project that passes the
// current validator: README.md and a source file. GLOSSARY.md and
// sample tests were removed from the requirements (they leaked hints
// to the candidate), and the kit-overlaid CLAUDE.md was removed for
// the same reason.
function stubModeAProject(): GeneratedProject {
	return {
		files: [
			{
				path: "README.md",
				content: "# Project\nWhat you're building: a thing.\n",
			},
			{ path: "src/main.ts", content: "export const main = () => {};\n" },
		],
	};
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
			expect(existsSync(join(dir, "README.md"))).toBe(true);
			expect(existsSync(join(dir, "src", "main.ts"))).toBe(true);
			expect(result.attempts).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("retries when validation fails, then succeeds on a later attempt within the default budget", async () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-gen-"));
		try {
			// First attempt returns a malformed project (no README.md);
			// second attempt succeeds. Default budget is 3 attempts.
			const malformed: GeneratedProject = {
				files: [{ path: "NOTES.md", content: "incomplete" }],
			};
			const client = clientReturning(malformed, stubModeAProject());
			const result = await generateProject(role({ outputDir: dir }), client);
			expect(result.ok).toBe(true);
			expect(result.attempts).toBe(2);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reports failure with diagnostic after exhausting the default attempt budget", async () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-gen-"));
		try {
			const malformed: GeneratedProject = {
				files: [{ path: "NOTES.md", content: "incomplete" }],
			};
			// clientReturning clamps to the last project when it runs out, so
			// this returns malformed for every attempt and exhausts the
			// default 3-attempt budget. The single structural check
			// (missing README.md) drives failure here.
			const client = clientReturning(malformed);
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
			writeFileSync(join(kitSrc, ".claude", "settings.json"), '{"hooks":{}}\n');
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

	it("substitutes {{TIME_BOX}} placeholders when copying kit templates", async () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-gen-tb-"));
		try {
			const client = clientReturning(stubModeAProject());
			const kitSrc = mkdtempSync(join(tmpdir(), "iv-kit-tb-"));
			const { writeFileSync } = await import("node:fs");
			writeFileSync(
				join(kitSrc, "INTERVIEW_RULES.md"),
				"# Rules\n\nTime-box: **`{{TIME_BOX}}`** minutes.\n",
			);
			writeFileSync(
				join(kitSrc, "no-template.md"),
				"This file has no placeholders.\n",
			);
			try {
				const result = await generateProject(
					role({ outputDir: dir, timeBoxMinutes: 75 }),
					client,
					{ kitTemplateDir: kitSrc },
				);
				expect(result.ok).toBe(true);
				const body = readFileSync(join(dir, "INTERVIEW_RULES.md"), "utf8");
				expect(body).toContain("**`75`** minutes");
				expect(body).not.toContain("{{TIME_BOX}}");
				// Files without placeholders should pass through unchanged.
				const untouched = readFileSync(join(dir, "no-template.md"), "utf8");
				expect(untouched).toBe("This file has no placeholders.\n");
			} finally {
				rmSync(kitSrc, { recursive: true, force: true });
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("injects the {{AI_OBSERVER_DISCLOSURE}} clause only in ai-assisted mode", async () => {
		const { writeFileSync } = await import("node:fs");
		const RELEASE =
			"# Release\n\nCommitment.\n\n{{AI_OBSERVER_DISCLOSURE}}\n---\n";

		// human-only: the token collapses to nothing.
		const humanDir = mkdtempSync(join(tmpdir(), "iv-gen-ho-"));
		const humanKit = mkdtempSync(join(tmpdir(), "iv-kit-ho-"));
		try {
			writeFileSync(join(humanKit, "PRIVACY_RELEASE.md"), RELEASE);
			const result = await generateProject(
				role({ outputDir: humanDir, analysisMode: "human-only" }),
				clientReturning(stubModeAProject()),
				{ kitTemplateDir: humanKit },
			);
			expect(result.ok).toBe(true);
			const body = readFileSync(join(humanDir, "PRIVACY_RELEASE.md"), "utf8");
			expect(body).not.toContain("{{AI_OBSERVER_DISCLOSURE}}");
			expect(body).not.toMatch(/Automated analysis/);
		} finally {
			rmSync(humanKit, { recursive: true, force: true });
			rmSync(humanDir, { recursive: true, force: true });
		}

		// ai-assisted: the disclosure clause is substituted in.
		const aiDir = mkdtempSync(join(tmpdir(), "iv-gen-ai-"));
		const aiKit = mkdtempSync(join(tmpdir(), "iv-kit-ai-"));
		try {
			writeFileSync(join(aiKit, "PRIVACY_RELEASE.md"), RELEASE);
			const result = await generateProject(
				role({ outputDir: aiDir, analysisMode: "ai-assisted" }),
				clientReturning(stubModeAProject()),
				{ kitTemplateDir: aiKit },
			);
			expect(result.ok).toBe(true);
			const body = readFileSync(join(aiDir, "PRIVACY_RELEASE.md"), "utf8");
			expect(body).not.toContain("{{AI_OBSERVER_DISCLOSURE}}");
			expect(body).toMatch(/Automated analysis of this session/);
			expect(body).toMatch(/never a\s+score/);
		} finally {
			rmSync(aiKit, { recursive: true, force: true });
			rmSync(aiDir, { recursive: true, force: true });
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
