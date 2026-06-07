import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const KIT_DIR = resolve(
	import.meta.dir,
	"../../../../../teamhero-interview-kit",
);

function stageKit(): { dir: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), "iv-kit-smoke-"));
	cpSync(KIT_DIR, dir, { recursive: true });
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function sign(dir: string): void {
	const path = join(dir, "PRIVACY_RELEASE.md");
	const body = readFileSync(path, "utf8")
		.replace(/\(placeholder — candidate signs here\)/, "Jane Doe")
		.replace(/\(placeholder — candidate dates here.*\)/, "2026-05-10");
	writeFileSync(path, body);
}

describe("interview kit smoke", () => {
	it("start.sh refuses to proceed when the release is unsigned", () => {
		const { dir, cleanup } = stageKit();
		try {
			const result = spawnSync("bash", [join(dir, "start.sh")], {
				env: { ...process.env, SKIP_RECORD: "1" },
				encoding: "utf8",
			});
			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("not signed");
		} finally {
			cleanup();
		}
	});

	it("start.sh proceeds when the release is signed", () => {
		const { dir, cleanup } = stageKit();
		try {
			sign(dir);
			const result = spawnSync("bash", [join(dir, "start.sh")], {
				env: { ...process.env, SKIP_RECORD: "1" },
				encoding: "utf8",
			});
			expect(result.status).toBe(0);
			expect(result.stdout).toContain("Privacy gate passed");
		} finally {
			cleanup();
		}
	});

	it("settings.json declares both UserPromptSubmit and PreToolUse hooks", () => {
		const body = readFileSync(
			join(KIT_DIR, ".claude", "settings.json"),
			"utf8",
		);
		const cfg = JSON.parse(body);
		expect(cfg.hooks.UserPromptSubmit).toBeDefined();
		expect(cfg.hooks.PreToolUse).toBeDefined();
		const hookCmd = cfg.hooks.UserPromptSubmit[0].hooks[0].command;
		// Portable Node script, not jq — jq isn't installed by default on
		// Windows/WSL and Node is already a project prerequisite.
		expect(hookCmd).toContain("log-agent-event.mjs");
		expect(hookCmd).not.toContain("jq");
	});

	it("ships the cross-platform agent-log hook script (replaces jq)", () => {
		const body = readFileSync(
			join(KIT_DIR, "scripts", "log-agent-event.mjs"),
			"utf8",
		);
		expect(body).toContain("interview.log");
		expect(body).toContain("appendFileSync");
	});

	it("ships .codex and .cursor hook configs that call the Node script", () => {
		const codex = JSON.parse(
			readFileSync(join(KIT_DIR, ".codex", "hooks.json"), "utf8"),
		);
		const cursor = JSON.parse(
			readFileSync(join(KIT_DIR, ".cursor", "hooks.json"), "utf8"),
		);
		expect(JSON.stringify(codex)).toContain("log-agent-event.mjs");
		expect(JSON.stringify(cursor)).toContain("log-agent-event.mjs");
	});

	it("ships .claude/CLAUDE.md mirroring AGENTS.md (cross-tool agent guidance)", () => {
		const claude = readFileSync(join(KIT_DIR, ".claude", "CLAUDE.md"), "utf8");
		const agents = readFileSync(join(KIT_DIR, "AGENTS.md"), "utf8");
		expect(claude).toMatch(/candidate/i);
		expect(agents).toMatch(/mirrors `\.claude\/CLAUDE\.md`/);
	});

	it("ships PROCESS.md, .gitignore, and the candidate-prep email template", () => {
		expect(readFileSync(join(KIT_DIR, "PROCESS.md"), "utf8")).toMatch(
			/AI tools used/,
		);
		expect(readFileSync(join(KIT_DIR, ".gitignore"), "utf8")).toMatch(
			/terminal\.cast/,
		);
		expect(
			readFileSync(join(KIT_DIR, "docs", "candidate-prep-email.md"), "utf8"),
		).toMatch(/Preparing for Your Technical Interview/);
	});

	it("start.sh reports optional hooks without hard-failing when they are absent", () => {
		const { dir, cleanup } = stageKit();
		try {
			sign(dir);
			// Remove all hook configs — start.sh must still pass.
			rmSync(join(dir, ".claude", "settings.json"), { force: true });
			rmSync(join(dir, ".codex"), { recursive: true, force: true });
			rmSync(join(dir, ".cursor"), { recursive: true, force: true });
			const result = spawnSync("bash", [join(dir, "start.sh")], {
				env: { ...process.env, SKIP_RECORD: "1" },
				encoding: "utf8",
			});
			expect(result.status).toBe(0);
			expect(result.stdout).toContain("none found");
		} finally {
			cleanup();
		}
	});

	it("start.sh lists the present hook configs in its optional report", () => {
		const { dir, cleanup } = stageKit();
		try {
			sign(dir);
			const result = spawnSync("bash", [join(dir, "start.sh")], {
				env: { ...process.env, SKIP_RECORD: "1" },
				encoding: "utf8",
			});
			expect(result.status).toBe(0);
			expect(result.stdout).toContain(".claude/settings.json");
			expect(result.stdout).toContain(".codex/hooks.json");
		} finally {
			cleanup();
		}
	});

	it("end.sh refuses when start.sh has not been run", () => {
		const { dir, cleanup } = stageKit();
		try {
			sign(dir);
			const result = spawnSync("bash", [join(dir, "end.sh")], {
				env: { ...process.env, SKIP_RECORD: "1", SKIP_COMMIT: "1" },
				encoding: "utf8",
			});
			expect(result.status).not.toBe(0);
		} finally {
			cleanup();
		}
	});

	it("start.sh → end.sh round-trip works when release is signed (SKIP modes)", () => {
		const { dir, cleanup } = stageKit();
		try {
			sign(dir);
			const start = spawnSync("bash", [join(dir, "start.sh")], {
				env: { ...process.env, SKIP_RECORD: "1" },
				encoding: "utf8",
			});
			expect(start.status).toBe(0);
			const end = spawnSync("bash", [join(dir, "end.sh")], {
				env: { ...process.env, SKIP_RECORD: "1", SKIP_COMMIT: "1" },
				encoding: "utf8",
			});
			expect(end.status).toBe(0);
			expect(end.stdout).toContain("artifacts ready");
		} finally {
			cleanup();
		}
	});

	it("INTERVIEW_RULES.md mentions WSL setup for Windows candidates", () => {
		const body = readFileSync(join(KIT_DIR, "INTERVIEW_RULES.md"), "utf8");
		expect(body).toMatch(/WSL/);
	});

	it("RUBRIC_OVERVIEW.md mentions all 9 dimensions", () => {
		const body = readFileSync(join(KIT_DIR, "RUBRIC_OVERVIEW.md"), "utf8");
		for (const heading of [
			"Upfront design",
			"Context engineering",
			"Critical evaluation",
			"Verification",
			"Course correction",
			"Risk awareness",
			"Architectural quality",
			"Test pass",
			"Throughput",
		]) {
			expect(body).toContain(heading);
		}
	});

	it("PRIVACY_RELEASE.md states a plain-language, human-proctor privacy commitment", () => {
		const body = readFileSync(join(KIT_DIR, "PRIVACY_RELEASE.md"), "utf8");
		expect(body).toMatch(/Our privacy commitment to you/i);
		expect(body).toMatch(/Human review/);
		// The candidate-facing default is human-proctored: it carries no
		// AI-evaluation language. The AI disclosure is injected at generation
		// time only when the proctor opts into ai-assisted analysis (see the
		// project-generator spec), so the raw template holds only the token.
		expect(body).toContain("{{AI_OBSERVER_DISCLOSURE}}");
		expect(body).not.toMatch(/NO training use/);
		expect(body).not.toMatch(/AI observer/);
	});
});
