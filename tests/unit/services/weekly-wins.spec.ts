import { describe, expect, it } from "bun:test";
import type {
	WeeklyWinsConfig,
	WeeklyWinsResult,
} from "../../../src/core/types.js";
import {
	DEFAULT_WEEKLY_WINS_CONFIG,
	hashWeeklyWinsInput,
	normalizeWeeklyWinsResult,
	renderWeeklyWinsMarkdown,
	resolveWeeklyWinsConfig,
} from "../../../src/services/weekly-wins.service.js";

// ---------------------------------------------------------------------------
// resolveWeeklyWinsConfig
// ---------------------------------------------------------------------------

describe("resolveWeeklyWinsConfig", () => {
	it("returns defaults when no overrides are provided", () => {
		const config = resolveWeeklyWinsConfig();
		expect(config).toEqual(DEFAULT_WEEKLY_WINS_CONFIG);
	});

	it("merges partial overrides", () => {
		const config = resolveWeeklyWinsConfig({
			verbosity: "high",
			audience: "Engineers",
		});
		expect(config.verbosity).toBe("high");
		expect(config.audience).toBe("Engineers");
		expect(config.subheadings).toBe("auto");
		expect(config.enabled).toBe(true);
	});

	it("overrides subheadings with explicit list", () => {
		const config = resolveWeeklyWinsConfig({
			subheadings: ["AI", "DevOps", "IT"],
		});
		expect(config.subheadings).toEqual(["AI", "DevOps", "IT"]);
	});

	it("can disable the section", () => {
		const config = resolveWeeklyWinsConfig({ enabled: false });
		expect(config.enabled).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// hashWeeklyWinsInput
// ---------------------------------------------------------------------------

describe("hashWeeklyWinsInput", () => {
	const config: WeeklyWinsConfig = {
		subheadings: "auto",
		verbosity: "medium",
		audience: "CTO",
		enabled: true,
	};

	it("produces a 16-char hex hash", () => {
		const hash = hashWeeklyWinsInput("data", undefined, config);
		expect(hash).toMatch(/^[0-9a-f]{16}$/);
	});

	it("is deterministic for the same inputs", () => {
		const a = hashWeeklyWinsInput("data", "prev", config);
		const b = hashWeeklyWinsInput("data", "prev", config);
		expect(a).toBe(b);
	});

	it("changes when current week data changes", () => {
		const a = hashWeeklyWinsInput("data1", undefined, config);
		const b = hashWeeklyWinsInput("data2", undefined, config);
		expect(a).not.toBe(b);
	});

	it("changes when previous report changes", () => {
		const a = hashWeeklyWinsInput("data", "prev1", config);
		const b = hashWeeklyWinsInput("data", "prev2", config);
		expect(a).not.toBe(b);
	});

	it("changes when config changes", () => {
		const a = hashWeeklyWinsInput("data", undefined, config);
		const b = hashWeeklyWinsInput("data", undefined, {
			...config,
			verbosity: "high",
		});
		expect(a).not.toBe(b);
	});
});

// ---------------------------------------------------------------------------
// normalizeWeeklyWinsResult
// ---------------------------------------------------------------------------

describe("normalizeWeeklyWinsResult", () => {
	it("deduplicates wins within a category", () => {
		const raw: WeeklyWinsResult = {
			categories: [
				{
					category: "AI",
					wins: ["Deployed model A", "Deployed model A", "Deployed model B"],
				},
			],
		};
		const result = normalizeWeeklyWinsResult(raw);
		expect(result.categories[0].wins).toEqual([
			"Deployed model A",
			"Deployed model B",
		]);
	});

	it("deduplicates wins across categories (case-insensitive)", () => {
		const raw: WeeklyWinsResult = {
			categories: [
				{ category: "AI", wins: ["Deployed model A"] },
				{ category: "DevOps", wins: ["deployed model a", "New pipeline"] },
			],
		};
		const result = normalizeWeeklyWinsResult(raw);
		expect(result.categories[0].wins).toEqual(["Deployed model A"]);
		expect(result.categories[1].wins).toEqual(["New pipeline"]);
	});

	it("filters empty win strings", () => {
		const raw: WeeklyWinsResult = {
			categories: [{ category: "IT", wins: ["", "  ", "Real win"] }],
		};
		const result = normalizeWeeklyWinsResult(raw);
		expect(result.categories[0].wins).toEqual(["Real win"]);
	});

	it("trims whitespace from wins and category names", () => {
		const raw: WeeklyWinsResult = {
			categories: [{ category: "  AI / Engineering  ", wins: ["  Win one  "] }],
		};
		const result = normalizeWeeklyWinsResult(raw);
		expect(result.categories[0].category).toBe("AI / Engineering");
		expect(result.categories[0].wins[0]).toBe("Win one");
	});

	it("preserves categories with empty wins but non-empty name", () => {
		const raw: WeeklyWinsResult = {
			categories: [{ category: "DevOps", wins: [] }],
		};
		const result = normalizeWeeklyWinsResult(raw);
		expect(result.categories).toHaveLength(1);
		expect(result.categories[0].category).toBe("DevOps");
	});
});

// ---------------------------------------------------------------------------
// renderWeeklyWinsMarkdown
// ---------------------------------------------------------------------------

describe("renderWeeklyWinsMarkdown", () => {
	it("renders the correct markdown format", () => {
		const result: WeeklyWinsResult = {
			categories: [
				{
					category: "AI / Engineering",
					wins: [
						"Subscribed to Anthropic Team plan",
						"Provisioned Salesforce repo",
					],
				},
				{
					category: "IT / Centre",
					wins: ["Deployed ActivTrak to 130 users"],
				},
				{
					category: "DevOps",
					wins: ["No material changes this week"],
				},
			],
		};

		const md = renderWeeklyWinsMarkdown(result);

		expect(md).toContain("## This Week's Technical / Foundational Wins");
		expect(md).toContain("* AI / Engineering");
		expect(md).toContain("** Subscribed to Anthropic Team plan");
		expect(md).toContain("** Provisioned Salesforce repo");
		expect(md).toContain("* IT / Centre");
		expect(md).toContain("** Deployed ActivTrak to 130 users");
		expect(md).toContain("* DevOps");
		expect(md).toContain("** No material changes this week");
	});

	it("handles empty categories gracefully", () => {
		const result: WeeklyWinsResult = { categories: [] };
		const md = renderWeeklyWinsMarkdown(result);
		expect(md).toContain("## This Week's Technical / Foundational Wins");
	});
});
