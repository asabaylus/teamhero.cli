import { describe, expect, it } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// Tops up a staged kit dir with every file the post-copy kit-presence
// validator (§3c) requires (executable entrypoints included), so a
// test focused on something else doesn't trip kit validation.
function fleshOutKit(kitDir: string): void {
	const required = [
		"INTERVIEW_RULES.md",
		"PRIVACY_RELEASE.md",
		"RUBRIC_OVERVIEW.md",
		"start.sh",
		"end.sh",
		"lib/privacy-gate.sh",
	];
	for (const rel of required) {
		const full = join(kitDir, rel);
		if (!existsSync(full)) {
			if (rel.includes("/"))
				mkdirSync(join(kitDir, "lib"), { recursive: true });
			writeFileSync(full, "# kit\n");
		}
		if (rel === "start.sh" || rel === "end.sh") chmodSync(full, 0o755);
	}
}
import {
	type GeneratedProject,
	type GeneratorClient,
	generateProject,
} from "../../../../../src/services/interview/bootstrap/project-generator.js";
import type { RoleConfig } from "../../../../../src/services/interview/bootstrap/role-config.js";

function role(overrides: Partial<RoleConfig> = {}): RoleConfig {
	return {
		roleSlug: "security-test",
		roleTitle: "Security Test Role",
		stack: "TypeScript",
		domain: "Testing",
		featureDescription: "Security boundary testing",
		timeBoxMinutes: 90,
		projectMode: "A",
		analysisMode: "ai-assisted",
		rubricMode: "default",
		outputDir: "(set per test)",
		...overrides,
	};
}

function validModeAProject(): GeneratedProject {
	const padLines = Array.from(
		{ length: 100 },
		(_, k) => `export const v${k} = ${k};`,
	).join("\n");
	return {
		files: [
			{ path: "README.md", content: "# Project\n" },
			{ path: "GLOSSARY.md", content: "# Glossary\n" },
			{ path: "src/deep-one.ts", content: padLines },
			{ path: "src/deep-two.ts", content: padLines },
			{
				path: "tests/feature.spec.ts",
				content:
					'import { describe, it } from "bun:test";\ndescribe.skip("feature", () => { it("todo", () => {}); });\n',
			},
			{
				path: "src/pad.ts",
				content: Array.from({ length: 300 }, (_, k) => `// line ${k}`).join(
					"\n",
				),
			},
		],
	};
}

function clientFor(project: GeneratedProject): GeneratorClient {
	return {
		async generate() {
			return project;
		},
	};
}

describe("generateProject — path traversal security (resolveWithinRoot)", () => {
	it("rejects absolute paths returned by the LLM generator", async () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-sec-"));
		try {
			const malicious: GeneratedProject = {
				files: [
					// Absolute path — must be rejected
					{ path: "/etc/passwd", content: "evil" },
				],
			};
			await expect(
				generateProject(role({ outputDir: dir }), clientFor(malicious)),
			).rejects.toThrow(/absolute/i);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects path-traversal sequences that escape the output directory", async () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-sec-"));
		try {
			const malicious: GeneratedProject = {
				files: [
					// Relative traversal escaping outputDir
					{ path: "../../etc/passwd", content: "evil" },
				],
			};
			await expect(
				generateProject(role({ outputDir: dir }), clientFor(malicious)),
			).rejects.toThrow(/escapes/i);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("accepts deeply-nested paths that stay within the output directory", async () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-sec-"));
		try {
			const safe: GeneratedProject = {
				files: [
					...validModeAProject().files,
					{ path: "src/nested/deep/module.ts", content: "export const x = 1;" },
				],
			};
			const result = await generateProject(
				role({ outputDir: dir }),
				clientFor(safe),
			);
			expect(result.ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects paths containing null bytes (potential injection vector)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-sec-"));
		try {
			// On Linux, null bytes in paths cause ENOENT or ENAMETOOLONG — the
			// security boundary is that we never write outside the root.
			// A path like "foo\0../../etc/passwd" resolves before the null byte
			// on most OS path APIs, so the resolve() call catches this.
			const malicious: GeneratedProject = {
				files: [{ path: "src/a.ts\0../../etc/evil", content: "evil" }],
			};
			// This may throw with any error (path error, traversal error) — the
			// important thing is that we never silently succeed.
			await expect(
				generateProject(role({ outputDir: dir }), clientFor(malicious)),
			).rejects.toThrow();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("generateProject — assertSafeToClear guards", () => {
	it("refuses to use a filesystem-root path as outputDir", async () => {
		// We can't actually point outputDir at / (it would be destructive) so we
		// validate the guard via a custom generator that won't even be called
		// because assertSafeToClear throws before calling the client.
		let called = false;
		const tracer: GeneratorClient = {
			async generate() {
				called = true;
				return validModeAProject();
			},
		};
		await expect(
			generateProject(role({ outputDir: "/" }), tracer),
		).rejects.toThrow(/root/i);
		expect(called).toBe(false);
	});

	it("refuses to use the home directory as outputDir", async () => {
		const home = homedir();
		if (!home) return; // skip in pathological environments
		let called = false;
		const tracer: GeneratorClient = {
			async generate() {
				called = true;
				return validModeAProject();
			},
		};
		await expect(
			generateProject(role({ outputDir: home }), tracer),
		).rejects.toThrow(/home/i);
		expect(called).toBe(false);
	});

	it("accepts /tmp as outputDir (it is a safe, standard temp directory)", async () => {
		// The assertSafeToClear guard rejects '/' (filesystem root) and the
		// user's home directory, but NOT /tmp — /tmp is a valid and safe temp dir.
		// dirname('/tmp') returns '/', which is NOT equal to '/tmp', so the
		// parent === abs guard does not trigger.
		// We just need to ensure a nested subdir under /tmp works correctly.
		const dir = mkdtempSync(join(tmpdir(), "iv-sec-validate-"));
		try {
			// Use a valid project so we can check the full flow succeeds
			const result = await generateProject(
				role({ outputDir: dir }),
				clientFor(validModeAProject()),
			);
			// The project should succeed — /tmp-based dirs are safe
			expect(result.ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("succeeds with a safe output dir that is not root/home", async () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-sec-safe-"));
		try {
			// A temporary directory nested under tmpdir is safe.
			const result = await generateProject(
				role({ outputDir: dir }),
				clientFor(validModeAProject()),
			);
			expect(result.ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("generateProject — kit template conflict resolution", () => {
	it("kit files take precedence over generator-produced files at the same path", async () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-kit-prio-"));
		const kitDir = mkdtempSync(join(tmpdir(), "iv-kit-src-"));
		try {
			// The generator writes GLOSSARY.md with "Generator content"
			// (using GLOSSARY rather than README so we don't model the AI
			// authoring something it must not author per the new contract).
			const overriddenProject: GeneratedProject = {
				files: [
					...validModeAProject().files.filter((f) => f.path !== "GLOSSARY.md"),
					{ path: "GLOSSARY.md", content: "Generator content\n" },
				],
			};
			// The kit also has GLOSSARY.md with "Kit content" — kit wins
			writeFileSync(join(kitDir, "GLOSSARY.md"), "Kit content\n");
			fleshOutKit(kitDir);

			const result = await generateProject(
				role({ outputDir: dir }),
				clientFor(overriddenProject),
				{ kitTemplateDir: kitDir },
			);
			expect(result.ok).toBe(true);
			const content = readFileSync(join(dir, "GLOSSARY.md"), "utf8");
			expect(content).toBe("Kit content\n");
		} finally {
			rmSync(dir, { recursive: true, force: true });
			rmSync(kitDir, { recursive: true, force: true });
		}
	});
});

describe("generateProject — retry passes previous failures to the client", () => {
	it("provides previousFailures from the last attempt on retry", async () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-retry-"));
		try {
			const callLog: Array<{
				attempt: number;
				previousFailures: readonly string[] | undefined;
			}> = [];
			const trackingClient: GeneratorClient = {
				async generate(input) {
					callLog.push({
						attempt: input.attempt,
						previousFailures: input.previousFailures,
					});
					if (input.attempt < 2) {
						// Return a malformed project on first attempt
						return { files: [{ path: "NOTES.md", content: "incomplete" }] };
					}
					return validModeAProject();
				},
			};

			const result = await generateProject(
				role({ outputDir: dir }),
				trackingClient,
				{ maxAttempts: 3 },
			);
			expect(result.ok).toBe(true);
			expect(callLog).toHaveLength(2);
			// First call: no previous failures
			expect(callLog[0].attempt).toBe(1);
			// Second call: receives the failures from attempt 1
			expect(callLog[1].attempt).toBe(2);
			expect((callLog[1].previousFailures ?? []).length).toBeGreaterThan(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
