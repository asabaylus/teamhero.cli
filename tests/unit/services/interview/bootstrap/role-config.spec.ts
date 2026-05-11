import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type RoleConfig,
	readRoleConfig,
	validateRoleConfig,
	writeRoleConfig,
} from "../../../../../src/services/interview/bootstrap/role-config.js";

function baseConfig(): RoleConfig {
	return {
		roleSlug: "senior-backend",
		roleTitle: "Senior Backend Engineer",
		stack: "TypeScript / Node",
		domain: "Payments",
		featureDescription: "Add idempotency keys to the refunds endpoint.",
		timeBoxMinutes: 90,
		projectMode: "A",
		analysisMode: "ai-assisted",
		rubricMode: "default",
		outputDir: "./roles/senior-backend",
	};
}

describe("role-config validation", () => {
	it("accepts a valid default-rubric config", () => {
		const r = validateRoleConfig(baseConfig());
		expect(r.ok).toBe(true);
	});

	it("rejects missing roleSlug", () => {
		const c = baseConfig();
		// @ts-expect-error testing invalid input
		c.roleSlug = "";
		const r = validateRoleConfig(c);
		expect(r.ok).toBe(false);
		expect(r.failures.some((f) => /roleSlug/i.test(f))).toBe(true);
	});

	it("rejects rubricMode=custom without a non-empty customPrompt", () => {
		const c: RoleConfig = { ...baseConfig(), rubricMode: "custom" };
		const r = validateRoleConfig(c);
		expect(r.ok).toBe(false);
		expect(r.failures.some((f) => /customPrompt/i.test(f))).toBe(true);
	});

	it("accepts rubricMode=custom with a non-empty customPrompt", () => {
		const c: RoleConfig = {
			...baseConfig(),
			rubricMode: "custom",
			customPrompt: "Look for X and Y.",
		};
		expect(validateRoleConfig(c).ok).toBe(true);
	});

	it("rejects rubricMode=default+jd without a jdPath", () => {
		const c: RoleConfig = { ...baseConfig(), rubricMode: "default+jd" };
		const r = validateRoleConfig(c);
		expect(r.ok).toBe(false);
		expect(r.failures.some((f) => /jdPath/i.test(f))).toBe(true);
	});

	it("rejects rubricMode=default+jd when jdPath does not exist on disk", () => {
		const c: RoleConfig = {
			...baseConfig(),
			rubricMode: "default+jd",
			jdPath: "/definitely/not/a/real/path/jd.md",
		};
		const r = validateRoleConfig(c);
		expect(r.ok).toBe(false);
		expect(r.failures.some((f) => /jdPath/i.test(f))).toBe(true);
	});

	it("accepts rubricMode=default+jd when jdPath exists", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-jd-"));
		try {
			const jdPath = join(dir, "jd.md");
			writeFileSync(jdPath, "# JD\n");
			const c: RoleConfig = {
				...baseConfig(),
				rubricMode: "default+jd",
				jdPath,
			};
			expect(validateRoleConfig(c).ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects unsupported timeBoxMinutes", () => {
		const c: RoleConfig = { ...baseConfig(), timeBoxMinutes: 7 };
		const r = validateRoleConfig(c);
		expect(r.ok).toBe(false);
		expect(r.failures.some((f) => /time.?box/i.test(f))).toBe(true);
	});

	it("accepts custom timeBoxMinutes when explicitly provided", () => {
		const c: RoleConfig = { ...baseConfig(), timeBoxMinutes: 45 };
		// 45 is allowed as a custom value as long as it is between 15 and 240
		expect(validateRoleConfig(c).ok).toBe(true);
	});
});

describe("role-config persistence", () => {
	it("round-trips through writeRoleConfig / readRoleConfig", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-roleio-"));
		try {
			const cfg = baseConfig();
			writeRoleConfig(dir, cfg);
			const read = readRoleConfig(dir);
			expect(read).toEqual(cfg);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("readRoleConfig returns null when no config file exists", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-roleio-"));
		try {
			expect(readRoleConfig(dir)).toBeNull();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("writeRoleConfig refuses to write an invalid config", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-roleio-"));
		try {
			const bad = { ...baseConfig(), roleSlug: "" };
			// @ts-expect-error testing invalid input
			expect(() => writeRoleConfig(dir, bad)).toThrow();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
