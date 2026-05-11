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
import { gradeCandidate } from "../../../../../src/services/interview/assess/grade-orchestrator.js";
import { writeRoleConfig } from "../../../../../src/services/interview/bootstrap/role-config.js";

function stageRepo(opts: { analysisMode?: "ai-assisted" | "human-only" } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "iv-grade-"));
	writeRoleConfig(dir, {
		roleSlug: "senior-backend",
		roleTitle: "Senior Backend Engineer",
		stack: "TypeScript",
		domain: "Payments",
		featureDescription: "Add idempotency",
		timeBoxMinutes: 90,
		projectMode: "A",
		analysisMode: opts.analysisMode ?? "ai-assisted",
		rubricMode: "default",
		outputDir: dir,
	});
	writeFileSync(
		join(dir, "interview.log"),
		`${JSON.stringify({
			event: "user-prompt-submit",
			timestamp: "2026-05-10T10:00:00Z",
			prompt: "let me sketch the data model",
		})}\n${JSON.stringify({
			event: "pre-tool-use",
			timestamp: "2026-05-10T10:00:30Z",
			tool_name: "Bash",
			tool_input: { command: "bun test" },
		})}\n`,
	);
	const castHeader = JSON.stringify({
		version: 2,
		width: 80,
		height: 24,
		timestamp: 1747876800, // 2026-05-22T00:00:00Z-ish
	});
	const castEvents = [
		[0.1, "i", "b"],
		[0.2, "i", "u"],
		[0.3, "i", "n"],
		[0.4, "i", " "],
		[0.5, "i", "t"],
		[0.6, "i", "e"],
		[0.7, "i", "s"],
		[0.8, "i", "t"],
		[1.0, "i", "\r"],
	]
		.map((e) => JSON.stringify(e))
		.join("\n");
	writeFileSync(join(dir, "terminal.cast"), `${castHeader}\n${castEvents}\n`);
	writeFileSync(
		join(dir, "PRIVACY_RELEASE.md"),
		"# Privacy Release\n## Signed\nJane Doe\n## Date\n2026-05-10\n",
	);
	mkdirSync(join(dir, "src"));
	writeFileSync(join(dir, "package.json"), '{"name":"x","scripts":{"test":"echo nothing"}}');
	return dir;
}

const stubObserver = {
	async observe() {
		return {
			observations: [
				{
					dimension_id: "upfront-design" as const,
					observation: "Sketched the data model before code.",
					reasoning: "Prompt timing shows design-first.",
					evidence_excerpts: [
						{
							source: "interview.log" as const,
							content: "let me sketch the data model",
						},
					],
				},
			],
		};
	},
};

describe("gradeCandidate orchestrator", () => {
	it("produces summary.md, audit.md, audit.json, and evidence/ for a complete repo", async () => {
		const repo = stageRepo();
		const out = mkdtempSync(join(tmpdir(), "iv-out-"));
		try {
			const outcome = await gradeCandidate(
				{
					repoUrl: "stub",
					candidateName: "Jane Doe",
					localRepoPath: repo,
					outputDir: out,
				},
				{
					observer: stubObserver,
					testRunner: () => ({ passed: 1, failed: 0, output: "" }),
				},
			);
			expect(outcome.ok).toBe(true);
			expect(outcome.outputs).toBeDefined();
			if (!outcome.outputs) throw new Error("no outputs");
			expect(existsSync(outcome.outputs.summaryPath)).toBe(true);
			expect(existsSync(outcome.outputs.auditPath)).toBe(true);
			expect(existsSync(outcome.outputs.auditJsonPath)).toBe(true);
			// Privacy release is copied to evidence/
			expect(existsSync(join(outcome.outputs.evidenceDir, "PRIVACY_RELEASE.md"))).toBe(true);
		} finally {
			rmSync(repo, { recursive: true, force: true });
			rmSync(out, { recursive: true, force: true });
		}
	});

	it("fails clearly when the candidate repo has no role-config.json", async () => {
		const repo = mkdtempSync(join(tmpdir(), "iv-bad-"));
		const out = mkdtempSync(join(tmpdir(), "iv-out-"));
		try {
			const outcome = await gradeCandidate(
				{
					repoUrl: "stub",
					candidateName: "Jane",
					localRepoPath: repo,
					outputDir: out,
				},
				{ observer: stubObserver },
			);
			expect(outcome.ok).toBe(false);
			expect(outcome.failures.join(" ")).toMatch(/role-config\.json/);
		} finally {
			rmSync(repo, { recursive: true, force: true });
			rmSync(out, { recursive: true, force: true });
		}
	});

	it("uses human-only blank templates when role config requests human-only mode", async () => {
		const repo = stageRepo({ analysisMode: "human-only" });
		const out = mkdtempSync(join(tmpdir(), "iv-out-"));
		// Observer should NOT be called.
		let observerCalls = 0;
		const observer = {
			async observe() {
				observerCalls += 1;
				return { observations: [] };
			},
		};
		try {
			const outcome = await gradeCandidate(
				{
					repoUrl: "stub",
					candidateName: "Jane",
					localRepoPath: repo,
					outputDir: out,
				},
				{
					observer,
					testRunner: () => ({ passed: 0, failed: 0, output: "" }),
				},
			);
			expect(outcome.ok).toBe(true);
			expect(observerCalls).toBe(0);
			const summary = readFileSync(outcome.outputs?.summaryPath ?? "", "utf8");
			expect(summary).toContain("manager to write");
		} finally {
			rmSync(repo, { recursive: true, force: true });
			rmSync(out, { recursive: true, force: true });
		}
	});

	it("session_recording_url ends up in frontmatter but not in the audit prose", async () => {
		const repo = stageRepo();
		const out = mkdtempSync(join(tmpdir(), "iv-out-"));
		try {
			const outcome = await gradeCandidate(
				{
					repoUrl: "stub",
					candidateName: "Jane",
					localRepoPath: repo,
					outputDir: out,
					sessionRecordingUrl: "https://zoom.us/rec/secret-xyz",
					sessionPlatform: "zoom",
					sessionDate: "2026-05-10",
				},
				{
					observer: stubObserver,
					testRunner: () => ({ passed: 1, failed: 0, output: "" }),
				},
			);
			expect(outcome.ok).toBe(true);
			const summary = readFileSync(outcome.outputs?.summaryPath ?? "", "utf8");
			expect(summary).toContain("session_recording_url: https://zoom.us/rec/secret-xyz");
			// Below the frontmatter, the URL must not appear (verifies it didn't leak
			// into the LLM observer's narrative prose).
			const belowFrontmatter = summary.split(/^---$/m).slice(2).join("");
			expect(belowFrontmatter).not.toContain("zoom.us");
			expect(belowFrontmatter).not.toContain("secret-xyz");
		} finally {
			rmSync(repo, { recursive: true, force: true });
			rmSync(out, { recursive: true, force: true });
		}
	});
});
