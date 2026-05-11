import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const SKILL_PATH = resolve(
	import.meta.dir,
	"../../../../../skills/teamhero-interview/SKILL.md",
);

function loadSkill(): string {
	return readFileSync(SKILL_PATH, "utf8");
}

describe("teamhero-interview Claude skill", () => {
	it("exists in skills/teamhero-interview/SKILL.md", () => {
		expect(existsSync(SKILL_PATH)).toBe(true);
	});

	it("has YAML frontmatter declaring name and description", () => {
		const body = loadSkill();
		const fm = body.match(/^---\n([\s\S]*?)\n---/);
		expect(fm).not.toBeNull();
		const block = fm?.[1] ?? "";
		expect(block).toMatch(/^name:\s*teamhero-interview\b/m);
		expect(block).toMatch(/^description:\s+/m);
	});

	it("documents all 3 MVP verbs with example invocations", () => {
		const body = loadSkill();
		for (const verb of ["bootstrap", "grade", "cohort"]) {
			expect(body).toContain(`teamhero interview ${verb}`);
		}
	});

	it("mentions the v1.5 verb stubs (list-roles, list-candidates)", () => {
		const body = loadSkill();
		expect(body).toContain("list-roles");
		expect(body).toContain("list-candidates");
	});

	it("includes the ethical framing — observations not scores, bias diversification, human-in-the-loop", () => {
		const body = loadSkill();
		expect(body).toMatch(/Observations, not scores/i);
		expect(body).toMatch(/bias diversification/i);
		expect(body).toMatch(/Human-in-the-loop/i);
	});

	it("instructs explicit refusal when the user asks for a numerical score", () => {
		const body = loadSkill();
		expect(body).toMatch(/Do not produce scores/i);
	});

	it("describes cohort orchestration (read role config → grade each → run cohort)", () => {
		const body = loadSkill();
		expect(body).toMatch(/Cohort orchestration/);
		expect(body).toMatch(/role config/);
		expect(body).toMatch(/sign-off/);
	});

	it("explicitly states the skill contains no business logic", () => {
		const body = loadSkill();
		expect(body).toMatch(/no business logic/i);
		expect(body).toMatch(/src\/services\/interview/);
	});

	it("warns against feeding session_recording_url to the AI observer", () => {
		const body = loadSkill();
		expect(body).toMatch(/session_recording_url/);
		expect(body).toMatch(/not.*feed|do not.*observer/i);
	});
});
