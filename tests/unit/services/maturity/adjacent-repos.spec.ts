import { describe, expect, it } from "bun:test";
import { detectAdjacentRepos } from "../../../../src/services/maturity/adjacent-repos.js";
import type { ScopeDescriptor } from "../../../../src/services/maturity/types.js";

describe("detectAdjacentRepos against this repo", () => {
	it("returns an array (may include detected workflow refs)", async () => {
		const scope: ScopeDescriptor = {
			mode: "local-repo",
			localPath: process.cwd(),
			displayName: "self",
		};
		const result = await detectAdjacentRepos(scope);
		expect(Array.isArray(result)).toBe(true);
	});

	it("returns [] for an org-only scope without local path", async () => {
		const scope: ScopeDescriptor = {
			mode: "org",
			org: "acme",
			displayName: "acme",
		};
		const result = await detectAdjacentRepos(scope);
		expect(result).toEqual([]);
	});
});
