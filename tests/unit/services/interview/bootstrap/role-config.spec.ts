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

	it("rejects retired rubricMode 'default+jd'", () => {
		// "default+jd" was retired in favour of a standalone JD field
		// (jdPath, jdInfluencesProject). The validator must surface a
		// clear error if a stale config file still uses the old value.
		const c = {
			...baseConfig(),
			rubricMode: "default+jd" as never,
		} as RoleConfig;
		const r = validateRoleConfig(c);
		expect(r.ok).toBe(false);
		expect(r.failures.some((f) => /rubricMode/i.test(f))).toBe(true);
	});

	it("rejects a jdPath that does not exist on disk", () => {
		// jdPath is now optional regardless of rubric mode, but when
		// supplied it must point at a real file — otherwise the AI
		// observer will read nothing.
		const c: RoleConfig = {
			...baseConfig(),
			rubricMode: "default",
			jdPath: "/definitely/not/a/real/path/jd.md",
		};
		const r = validateRoleConfig(c);
		expect(r.ok).toBe(false);
		expect(r.failures.some((f) => /jdPath/i.test(f))).toBe(true);
	});

	it("accepts a jdPath alongside the default rubric (independent inputs)", () => {
		// The proctor can now combine ANY rubric with a JD — the old
		// coupling was an unnecessary restriction.
		const dir = mkdtempSync(join(tmpdir(), "iv-jd-"));
		try {
			const jdPath = join(dir, "jd.md");
			writeFileSync(jdPath, "# JD\n");
			const c: RoleConfig = {
				...baseConfig(),
				rubricMode: "default",
				jdPath,
			};
			expect(validateRoleConfig(c).ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects jdInfluencesProject=true without a jdPath", () => {
		// The influence flag tells the generator to read the JD; without
		// a path there's nothing to read. Caught at validation time so
		// the bun subprocess never sees an inconsistent config.
		const c: RoleConfig = {
			...baseConfig(),
			rubricMode: "default",
			jdInfluencesProject: true,
		};
		const r = validateRoleConfig(c);
		expect(r.ok).toBe(false);
		expect(r.failures.some((f) => /jdInfluencesProject/i.test(f))).toBe(true);
	});

	it("accepts an empty domain when a jdPath is attached (JD describes the domain)", () => {
		// The wizard skips the Domain question whenever a JD is
		// provided; the role-config produced has an empty domain.
		// Validation must accept this — otherwise headless callers
		// hitting the same shape would crash. The OpenAI prompt
		// renders a "Domain: infer from the job description" line
		// for the model.
		const dir = mkdtempSync(join(tmpdir(), "iv-jd-no-domain-"));
		try {
			const jdPath = join(dir, "jd.md");
			writeFileSync(jdPath, "# Healthtech\nWe build EHR integrations.\n");
			const c: RoleConfig = {
				...baseConfig(),
				domain: "", // skipped by the wizard because JD is attached
				jdPath,
			};
			expect(validateRoleConfig(c).ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects an empty domain when no jdPath is attached", () => {
		const c: RoleConfig = { ...baseConfig(), domain: "" };
		const r = validateRoleConfig(c);
		expect(r.ok).toBe(false);
		expect(r.failures.some((f) => /domain/i.test(f))).toBe(true);
	});

	it("accepts jdInfluencesProject=true paired with a real jdPath", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-jd-influence-"));
		try {
			const jdPath = join(dir, "jd.md");
			writeFileSync(
				jdPath,
				"# Junior Healthcare Engineer\nFamiliarity with FHIR, HL7, or EHR concepts.\n",
			);
			const c: RoleConfig = {
				...baseConfig(),
				rubricMode: "default",
				jdPath,
				jdInfluencesProject: true,
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

	it("accepts stackByCandidate=true when paired with projectMode 'B'", () => {
		// "Greenfield (candidate picks stack)" — the brief tells the
		// candidate they pick the tooling. Only valid with Mode B (no
		// starter code), where letting the candidate choose is coherent.
		const c: RoleConfig = {
			...baseConfig(),
			projectMode: "B",
			stackByCandidate: true,
		};
		expect(validateRoleConfig(c).ok).toBe(true);
	});

	it("rejects stackByCandidate=true with projectMode 'A'", () => {
		// Mode A scaffolds code IN a specific stack, so "candidate picks
		// the stack" is incoherent. Validator catches the misconfiguration
		// before a confused brownfield project + greenfield brief ships.
		const c: RoleConfig = {
			...baseConfig(),
			projectMode: "A",
			stackByCandidate: true,
		};
		const r = validateRoleConfig(c);
		expect(r.ok).toBe(false);
		expect(r.failures.some((f) => /stackByCandidate/i.test(f))).toBe(true);
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
