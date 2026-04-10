import { describe, expect, it } from "bun:test";
import type { WeeklyWinsConfig } from "../../../src/core/types.js";
import {
	buildWeeklyWinsPrompt,
	WEEKLY_WINS_SCHEMA,
} from "../../../src/services/ai-prompts.js";

// ---------------------------------------------------------------------------
// WEEKLY_WINS_SCHEMA
// ---------------------------------------------------------------------------

describe("WEEKLY_WINS_SCHEMA", () => {
	it("has the expected structure", () => {
		expect(WEEKLY_WINS_SCHEMA.type).toBe("json_schema");
		expect(WEEKLY_WINS_SCHEMA.name).toBe("weekly_wins");
		expect(WEEKLY_WINS_SCHEMA.strict).toBe(true);
		expect(WEEKLY_WINS_SCHEMA.schema.properties.categories).toBeDefined();
		expect(
			WEEKLY_WINS_SCHEMA.schema.properties.categories.items.properties.category,
		).toBeDefined();
		expect(
			WEEKLY_WINS_SCHEMA.schema.properties.categories.items.properties.wins,
		).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// buildWeeklyWinsPrompt
// ---------------------------------------------------------------------------

describe("buildWeeklyWinsPrompt", () => {
	const baseConfig: WeeklyWinsConfig = {
		subheadings: "auto",
		verbosity: "medium",
		audience: "CTO and executive leadership",
		enabled: true,
	};

	it("includes current week data in the prompt", () => {
		const prompt = buildWeeklyWinsPrompt({
			currentWeekData: "Deployed new monitoring stack",
			config: baseConfig,
		});

		expect(prompt).toContain("Deployed new monitoring stack");
		expect(prompt).toContain("Current week data:");
	});

	it("includes audience instruction", () => {
		const prompt = buildWeeklyWinsPrompt({
			currentWeekData: "data",
			config: baseConfig,
		});

		expect(prompt).toContain("CTO and executive leadership");
		expect(prompt).toContain("Do NOT mention the audience explicitly");
	});

	it("includes verbosity instruction for medium", () => {
		const prompt = buildWeeklyWinsPrompt({
			currentWeekData: "data",
			config: { ...baseConfig, verbosity: "medium" },
		});

		expect(prompt).toContain("Include brief context");
	});

	it("includes verbosity instruction for low", () => {
		const prompt = buildWeeklyWinsPrompt({
			currentWeekData: "data",
			config: { ...baseConfig, verbosity: "low" },
		});

		expect(prompt).toContain("Terse, outcome-only");
	});

	it("includes verbosity instruction for high", () => {
		const prompt = buildWeeklyWinsPrompt({
			currentWeekData: "data",
			config: { ...baseConfig, verbosity: "high" },
		});

		expect(prompt).toContain("Include impact or rationale");
	});

	it("uses auto grouping instruction when subheadings is 'auto'", () => {
		const prompt = buildWeeklyWinsPrompt({
			currentWeekData: "data",
			config: baseConfig,
		});

		expect(prompt).toContain("Infer 2-5 logical groupings");
	});

	it("uses explicit subheadings when provided", () => {
		const prompt = buildWeeklyWinsPrompt({
			currentWeekData: "data",
			config: {
				...baseConfig,
				subheadings: ["AI", "DevOps", "IT"],
			},
		});

		expect(prompt).toContain('"AI"');
		expect(prompt).toContain('"DevOps"');
		expect(prompt).toContain('"IT"');
		expect(prompt).toContain("No material changes this week");
	});

	it("includes deduplication section when previous report is provided", () => {
		const prompt = buildWeeklyWinsPrompt({
			currentWeekData: "data",
			previousReport: "* AI\n** Old win",
			config: baseConfig,
		});

		expect(prompt).toContain("Deduplication rules:");
		expect(prompt).toContain("Do NOT repeat wins");
		expect(prompt).toContain("* AI\n** Old win");
	});

	it("omits deduplication section when no previous report", () => {
		const prompt = buildWeeklyWinsPrompt({
			currentWeekData: "data",
			config: baseConfig,
		});

		expect(prompt).not.toContain("Deduplication rules:");
		expect(prompt).not.toContain("Previous report");
	});

	it("instructs to return structured JSON", () => {
		const prompt = buildWeeklyWinsPrompt({
			currentWeekData: "data",
			config: baseConfig,
		});

		expect(prompt).toContain("Return structured JSON");
	});
});
