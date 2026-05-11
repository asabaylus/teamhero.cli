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

describe("validateRoleConfig — boundary and negative cases", () => {
	it("rejects an unknown projectMode (not A or B)", () => {
		const c = { ...baseConfig(), projectMode: "C" } as unknown as RoleConfig;
		const r = validateRoleConfig(c);
		expect(r.ok).toBe(false);
		expect(r.failures.some((f) => /projectMode/i.test(f))).toBe(true);
	});

	it("rejects an unknown analysisMode", () => {
		const c = {
			...baseConfig(),
			analysisMode: "fully-automated",
		} as unknown as RoleConfig;
		const r = validateRoleConfig(c);
		expect(r.ok).toBe(false);
		expect(r.failures.some((f) => /analysisMode/i.test(f))).toBe(true);
	});

	it("rejects an unknown rubricMode", () => {
		const c = {
			...baseConfig(),
			rubricMode: "partial-jd",
		} as unknown as RoleConfig;
		const r = validateRoleConfig(c);
		expect(r.ok).toBe(false);
		expect(r.failures.some((f) => /rubricMode/i.test(f))).toBe(true);
	});

	it("rejects a timeBoxMinutes of exactly 14 (one below minimum of 15)", () => {
		const c: RoleConfig = { ...baseConfig(), timeBoxMinutes: 14 };
		const r = validateRoleConfig(c);
		expect(r.ok).toBe(false);
		expect(r.failures.some((f) => /time.?box/i.test(f))).toBe(true);
	});

	it("accepts a timeBoxMinutes of exactly 15 (the minimum)", () => {
		const c: RoleConfig = { ...baseConfig(), timeBoxMinutes: 15 };
		expect(validateRoleConfig(c).ok).toBe(true);
	});

	it("accepts a timeBoxMinutes of exactly 240 (the maximum)", () => {
		const c: RoleConfig = { ...baseConfig(), timeBoxMinutes: 240 };
		expect(validateRoleConfig(c).ok).toBe(true);
	});

	it("rejects a timeBoxMinutes of exactly 241 (one above maximum)", () => {
		const c: RoleConfig = { ...baseConfig(), timeBoxMinutes: 241 };
		const r = validateRoleConfig(c);
		expect(r.ok).toBe(false);
	});

	it("rejects a non-finite timeBoxMinutes (NaN)", () => {
		const c: RoleConfig = { ...baseConfig(), timeBoxMinutes: Number.NaN };
		const r = validateRoleConfig(c);
		expect(r.ok).toBe(false);
	});

	it("rejects a non-finite timeBoxMinutes (Infinity)", () => {
		const c: RoleConfig = { ...baseConfig(), timeBoxMinutes: Number.POSITIVE_INFINITY };
		const r = validateRoleConfig(c);
		expect(r.ok).toBe(false);
	});

	it("rejects an empty string for featureDescription", () => {
		const c: RoleConfig = { ...baseConfig(), featureDescription: "" };
		const r = validateRoleConfig(c);
		expect(r.ok).toBe(false);
		expect(r.failures.some((f) => /featureDescription/i.test(f))).toBe(true);
	});

	it("rejects a whitespace-only featureDescription", () => {
		const c: RoleConfig = { ...baseConfig(), featureDescription: "   " };
		const r = validateRoleConfig(c);
		expect(r.ok).toBe(false);
	});

	it("rejects rubricMode=custom when customPrompt is only whitespace", () => {
		const c: RoleConfig = {
			...baseConfig(),
			rubricMode: "custom",
			customPrompt: "   ",
		};
		const r = validateRoleConfig(c);
		expect(r.ok).toBe(false);
		expect(r.failures.some((f) => /customPrompt/i.test(f))).toBe(true);
	});

	it("collects multiple failures in a single validation pass", () => {
		const c = {
			...baseConfig(),
			roleSlug: "",
			stack: "",
			timeBoxMinutes: 0,
		} as unknown as RoleConfig;
		const r = validateRoleConfig(c);
		expect(r.ok).toBe(false);
		expect(r.failures.length).toBeGreaterThanOrEqual(3);
	});
});

describe("readRoleConfig — error cases", () => {
	it("throws when role-config.json contains invalid JSON", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-rc-err-"));
		try {
			writeFileSync(join(dir, "role-config.json"), "{ not valid json }");
			expect(() => readRoleConfig(dir)).toThrow(/Malformed/i);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("throws when role-config.json contains a non-object top-level value", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-rc-err-"));
		try {
			writeFileSync(join(dir, "role-config.json"), '"just a string"');
			expect(() => readRoleConfig(dir)).toThrow(/Malformed/i);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("throws when role-config.json contains null", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-rc-err-"));
		try {
			writeFileSync(join(dir, "role-config.json"), "null");
			expect(() => readRoleConfig(dir)).toThrow(/Malformed/i);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("throws when role-config.json parses to valid JSON but fails RoleConfig validation", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-rc-err-"));
		try {
			// Valid JSON object, but missing required fields
			writeFileSync(
				join(dir, "role-config.json"),
				JSON.stringify({ roleSlug: "ok" }),
			);
			expect(() => readRoleConfig(dir)).toThrow(/Invalid/i);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("writeRoleConfig — persistence edge cases", () => {
	it("creates the directory when it does not exist yet", () => {
		const base = mkdtempSync(join(tmpdir(), "iv-rc-"));
		const dir = join(base, "nested", "role-dir");
		try {
			writeRoleConfig(dir, baseConfig());
			const read = readRoleConfig(dir);
			expect(read?.roleSlug).toBe("senior-backend");
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});

	it("overwrites an existing role-config.json", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-rc-overwrite-"));
		try {
			writeRoleConfig(dir, baseConfig());
			const updated: RoleConfig = { ...baseConfig(), domain: "Logistics" };
			writeRoleConfig(dir, updated);
			const read = readRoleConfig(dir);
			expect(read?.domain).toBe("Logistics");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("stores optional jdPath when present", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-rc-optionals-"));
		const jdDir = mkdtempSync(join(tmpdir(), "iv-jd-"));
		try {
			const jdPath = join(jdDir, "jd.md");
			writeFileSync(jdPath, "# JD content\n");
			const cfg: RoleConfig = {
				...baseConfig(),
				rubricMode: "default+jd",
				jdPath,
			};
			writeRoleConfig(dir, cfg);
			const read = readRoleConfig(dir);
			expect(read?.jdPath).toBe(jdPath);
		} finally {
			rmSync(dir, { recursive: true, force: true });
			rmSync(jdDir, { recursive: true, force: true });
		}
	});

	it("stores optional customPrompt when present", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-rc-custom-"));
		try {
			const cfg: RoleConfig = {
				...baseConfig(),
				rubricMode: "custom",
				customPrompt: "Score primarily on architectural decisions",
			};
			writeRoleConfig(dir, cfg);
			const read = readRoleConfig(dir);
			expect(read?.customPrompt).toBe(
				"Score primarily on architectural decisions",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});