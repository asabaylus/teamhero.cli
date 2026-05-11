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
		expect(hookCmd).toContain("interview.log");
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
		const body = readFileSync(
			join(KIT_DIR, "INTERVIEW_RULES.md"),
			"utf8",
		);
		expect(body).toMatch(/WSL/);
	});

	it("RUBRIC_OVERVIEW.md mentions all 9 dimensions", () => {
		const body = readFileSync(
			join(KIT_DIR, "RUBRIC_OVERVIEW.md"),
			"utf8",
		);
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

	it("PRIVACY_RELEASE.md includes the no-training clause, appeal mechanism, and REVIEW WITH LEGAL warning", () => {
		const body = readFileSync(
			join(KIT_DIR, "PRIVACY_RELEASE.md"),
			"utf8",
		);
		expect(body).toMatch(/REVIEW WITH LEGAL/);
		expect(body).toMatch(/NO training use|not be used to train/i);
		expect(body).toMatch(/appeal/i);
		expect(body).toMatch(/30 days/);
	});
});
