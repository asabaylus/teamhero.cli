import { describe, expect, it } from "bun:test";
import {
	buildPrSearchQuery,
	classifyPr,
	type PrSearchItem,
	tallyPrs,
} from "../../../src/lib/pr-search.js";

/** Helper to fabricate a fixtured search item with sensible defaults. */
function pr(over: Partial<PrSearchItem> & { number: number }): PrSearchItem {
	return {
		authorLogin: "login-a",
		state: "closed",
		mergedAt: "2026-01-10T00:00:00Z",
		title: `PR ${over.number}`,
		url: `https://example/pr/${over.number}`,
		...over,
	};
}

describe("classifyPr", () => {
	it("treats a set merged_at as merged even when state is closed", () => {
		expect(
			classifyPr({ state: "closed", mergedAt: "2026-01-10T00:00:00Z" }),
		).toBe("merged");
	});
	it("treats closed without merged_at as closed-unmerged", () => {
		expect(classifyPr({ state: "closed", mergedAt: null })).toBe(
			"closed-unmerged",
		);
	});
	it("treats open as open", () => {
		expect(classifyPr({ state: "open", mergedAt: null })).toBe("open");
	});
});

describe("buildPrSearchQuery", () => {
	it("builds an org-wide, all-states, created-in-window query with UTC dates", () => {
		expect(
			buildPrSearchQuery({
				login: "login-a",
				org: "the-org",
				startISO: "2026-01-01T00:00:00.000Z",
				endISO: "2026-01-31T00:00:00.000Z",
			}),
		).toBe("type:pr author:login-a org:the-org created:2026-01-01..2026-01-31");
	});
});

describe("tallyPrs", () => {
	it("splits merged, closed-unmerged, and open distinctly", () => {
		const counts = tallyPrs([
			pr({ number: 1, mergedAt: "2026-01-02T00:00:00Z", state: "closed" }),
			pr({ number: 2, mergedAt: null, state: "closed" }),
			pr({ number: 3, mergedAt: null, state: "open" }),
		]);
		expect(counts).toEqual({ merged: 1, closedUnmerged: 1, open: 1 });
	});

	it("sums across a Person's logins (the 22 -> 26 fragmented-lead case)", () => {
		// Active login carries the bulk; a second account carries the rest. The
		// org-wide search count is their union — 26, not the per-repo 22.
		const activeLogin: PrSearchItem[] = Array.from({ length: 24 }, (_, i) =>
			pr({ number: 100 + i, authorLogin: "login-a", mergedAt: "x" }),
		);
		const secondAccount: PrSearchItem[] = [
			pr({ number: 200, authorLogin: "login-a-legacy", mergedAt: "x" }),
			pr({
				number: 201,
				authorLogin: "login-a-legacy",
				mergedAt: null,
				state: "closed",
			}),
		];
		const counts = tallyPrs([...activeLogin, ...secondAccount]);
		expect(counts.merged + counts.closedUnmerged + counts.open).toBe(26);
		expect(counts.merged).toBe(25);
		expect(counts.closedUnmerged).toBe(1);
	});

	it("does not let a zero-PR legacy account change the count", () => {
		const withLegacy = tallyPrs([
			...[pr({ number: 1, mergedAt: "x" }), pr({ number: 2, mergedAt: "x" })],
			...[], // legacy account returned no PRs
		]);
		expect(withLegacy).toEqual({ merged: 2, closedUnmerged: 0, open: 0 });
	});

	it("dedupes a PR surfaced under two logins by url", () => {
		const counts = tallyPrs([
			pr({ number: 5, url: "https://example/pr/5", mergedAt: "x" }),
			pr({ number: 5, url: "https://example/pr/5", mergedAt: "x" }),
		]);
		expect(counts.merged).toBe(1);
	});
});
