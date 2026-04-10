import { describe, expect, it } from "bun:test";
import {
	buildTechnicalWinsPrompt,
	TECHNICAL_WINS_SCHEMA,
	type TechnicalWinsContext,
} from "../../../src/services/ai-prompts.js";

// ---------------------------------------------------------------------------
// TECHNICAL_WINS_SCHEMA
// ---------------------------------------------------------------------------

describe("TECHNICAL_WINS_SCHEMA", () => {
	it("has the expected structure", () => {
		expect(TECHNICAL_WINS_SCHEMA.type).toBe("json_schema");
		expect(TECHNICAL_WINS_SCHEMA.name).toBe("technical_foundational_wins");
		expect(TECHNICAL_WINS_SCHEMA.strict).toBe(true);
		const props = TECHNICAL_WINS_SCHEMA.schema.properties;
		expect(props.categories).toBeDefined();
		const item = props.categories.items;
		expect(item.properties.category).toBeDefined();
		expect(item.properties.wins).toBeDefined();
		expect(item.required).toEqual(["category", "wins"]);
		expect(item.additionalProperties).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// buildTechnicalWinsPrompt
// ---------------------------------------------------------------------------

const baseContext: TechnicalWinsContext = {
	windowStart: "2026-04-03",
	windowEnd: "2026-04-10",
	verbosity: "standard",
	subheadings: "auto",
	audience: "CTO and executive leadership",
	currentWeekItems: ["Deployed new monitoring stack"],
};

describe("buildTechnicalWinsPrompt", () => {
	it("includes current week data in the prompt", () => {
		const prompt = buildTechnicalWinsPrompt(baseContext);
		expect(prompt).toContain("Deployed new monitoring stack");
		expect(prompt).toContain("Current-week source items:");
	});

	it("includes the audience and the 'do not mention' guardrail", () => {
		const prompt = buildTechnicalWinsPrompt(baseContext);
		expect(prompt).toContain("CTO and executive leadership");
		expect(prompt).toContain("Do NOT mention the audience explicitly");
	});

	it("falls back to engineering leadership when audience is unset", () => {
		const prompt = buildTechnicalWinsPrompt({
			...baseContext,
			audience: undefined,
		});
		expect(prompt).toContain("engineering leadership");
	});

	it("includes verbosity guidance for 'concise'", () => {
		expect(
			buildTechnicalWinsPrompt({ ...baseContext, verbosity: "concise" }),
		).toContain("Terse, outcome-only");
	});

	it("includes verbosity guidance for 'standard'", () => {
		expect(
			buildTechnicalWinsPrompt({ ...baseContext, verbosity: "standard" }),
		).toContain("Include brief context");
	});

	it("includes verbosity guidance for 'detailed'", () => {
		expect(
			buildTechnicalWinsPrompt({ ...baseContext, verbosity: "detailed" }),
		).toContain("Include impact or rationale");
	});

	it("uses the auto-grouping instruction when subheadings is 'auto'", () => {
		expect(buildTechnicalWinsPrompt(baseContext)).toContain(
			"Infer 2-5 logical groupings",
		);
	});

	it("uses explicit subheadings when provided and instructs the AI to reuse them in order", () => {
		const prompt = buildTechnicalWinsPrompt({
			...baseContext,
			subheadings: ["AI / Engineering", "IT / Centre", "DevOps"],
		});
		expect(prompt).toContain('"AI / Engineering"');
		expect(prompt).toContain('"IT / Centre"');
		expect(prompt).toContain('"DevOps"');
		expect(prompt).toContain("No material changes this week");
	});

	it("includes the date window", () => {
		const prompt = buildTechnicalWinsPrompt(baseContext);
		expect(prompt).toContain("2026-04-03");
		expect(prompt).toContain("2026-04-10");
	});

	it("includes deduplication rules and the previous wins when previousWeekItems is non-empty", () => {
		const prompt = buildTechnicalWinsPrompt({
			...baseContext,
			previousWeekItems: ["AI: Deployed model A"],
		});
		expect(prompt).toContain("Deduplication rules:");
		expect(prompt).toContain("Do NOT repeat wins");
		expect(prompt).toContain("AI: Deployed model A");
	});

	it("omits the deduplication section when previousWeekItems is empty", () => {
		const prompt = buildTechnicalWinsPrompt(baseContext);
		expect(prompt).not.toContain("Deduplication rules:");
		expect(prompt).not.toContain("Previous report wins");
	});

	it("instructs the model to return structured JSON", () => {
		expect(buildTechnicalWinsPrompt(baseContext)).toContain(
			"Return structured JSON",
		);
	});

	it("falls back to '(none)' when current-week items are empty", () => {
		const prompt = buildTechnicalWinsPrompt({
			...baseContext,
			currentWeekItems: [],
		});
		expect(prompt).toContain("- (none)");
	});
});
