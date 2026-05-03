import { describe, expect, it } from "bun:test";
import {
	defaultCollectors,
	runAllCollectors,
} from "../../../../src/services/maturity/evidence-collectors.js";
import type { ScopeDescriptor } from "../../../../src/services/maturity/types.js";

const SELF_SCOPE: ScopeDescriptor = {
	mode: "local-repo",
	localPath: process.cwd(),
	displayName: "self",
};

describe("evidence collectors against this repo", () => {
	it("returns 12 collectors in id order", () => {
		const cs = defaultCollectors();
		expect(cs).toHaveLength(12);
		expect(cs.map((c) => c.itemId)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
		]);
	});

	it("item 1 finds the bootstrap surface (justfile / scripts)", async () => {
		const facts = await runAllCollectors(defaultCollectors().slice(0, 1), {
			scope: SELF_SCOPE,
			tier: "gh",
			adjacentRepos: [],
		});
		const positive = facts.filter(
			(f) => f.itemId === 1 && f.signal === "positive",
		);
		expect(positive.length).toBeGreaterThan(0);
	});

	it("item 7 finds CLAUDE.md / AGENTS.md in this repo", async () => {
		const cs = defaultCollectors().filter((c) => c.itemId === 7);
		const facts = await runAllCollectors(cs, {
			scope: SELF_SCOPE,
			tier: "gh",
			adjacentRepos: [],
		});
		const positive = facts.find((f) => f.signal === "positive");
		expect(positive).toBeDefined();
		expect(positive?.summary).toMatch(/CLAUDE|AGENTS/i);
	});

	it("item 3 finds test files in this repo", async () => {
		const cs = defaultCollectors().filter((c) => c.itemId === 3);
		const facts = await runAllCollectors(cs, {
			scope: SELF_SCOPE,
			tier: "gh",
			adjacentRepos: [],
		});
		const positive = facts.find((f) => f.signal === "positive");
		expect(positive).toBeDefined();
		expect(positive?.summary).toMatch(/test file/i);
	});

	it("git-only tier annotates capped items 2/3/9/11", async () => {
		const cs = defaultCollectors().filter((c) =>
			[2, 3, 9, 11].includes(c.itemId),
		);
		const facts = await runAllCollectors(cs, {
			scope: SELF_SCOPE,
			tier: "git-only",
			adjacentRepos: [],
		});
		for (const id of [2, 3, 9, 11]) {
			const cap = facts.find(
				(f) => f.itemId === id && /capped/i.test(f.summary),
			);
			expect(cap).toBeDefined();
		}
	});

	it("no-localPath scope still produces interview-only facts for items 8 and 12", async () => {
		const cs = defaultCollectors().filter((c) => [8, 12].includes(c.itemId));
		const facts = await runAllCollectors(cs, {
			scope: { mode: "org", org: "acme", displayName: "acme" },
			tier: "gh",
			adjacentRepos: [],
		});
		expect(facts.find((f) => f.itemId === 8)).toBeDefined();
		expect(facts.find((f) => f.itemId === 12)).toBeDefined();
	});
});
