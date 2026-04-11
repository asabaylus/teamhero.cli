import { describe, expect, it } from "bun:test";
import type { TechnicalFoundationalWinsResult } from "../../../src/core/types.js";
import { renderTechnicalWinsSection } from "../../../src/lib/report-renderer.js";

// ---------------------------------------------------------------------------
// renderTechnicalWinsSection (standalone)
// ---------------------------------------------------------------------------

describe("renderTechnicalWinsSection", () => {
	it("renders the section header and categories", () => {
		const result: TechnicalFoundationalWinsResult = {
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

		const output = renderTechnicalWinsSection(result);

		expect(output).toContain(
			"## **This Week's Technical / Foundational Wins**",
		);
		expect(output).toContain("AI / Engineering");
		expect(output).toContain("* Subscribed to Anthropic Team plan");
		expect(output).toContain("* Provisioned Salesforce repo");
		expect(output).toContain("IT / Centre");
		expect(output).toContain("* Deployed ActivTrak to 130 users");
		expect(output).toContain("DevOps");
		expect(output).toContain("* No material changes this week");
	});

	it("renders an empty-categories result as just the header", () => {
		const result: TechnicalFoundationalWinsResult = { categories: [] };
		const output = renderTechnicalWinsSection(result);
		expect(output).toContain(
			"## **This Week's Technical / Foundational Wins**",
		);
	});

	it("keeps the category order the AI produced", () => {
		const result: TechnicalFoundationalWinsResult = {
			categories: [
				{ category: "DevOps", wins: ["D1"] },
				{ category: "AI", wins: ["A1"] },
			],
		};
		const output = renderTechnicalWinsSection(result);
		const devOpsIdx = output.indexOf("DevOps");
		const aiIdx = output.indexOf("AI");
		expect(devOpsIdx).toBeGreaterThan(-1);
		expect(aiIdx).toBeGreaterThan(devOpsIdx);
	});

	it("skips categories with an empty name entirely", () => {
		const result: TechnicalFoundationalWinsResult = {
			categories: [
				{ category: "", wins: ["Orphan win"] },
				{ category: "AI", wins: ["Real win"] },
			],
		};
		const output = renderTechnicalWinsSection(result);
		expect(output).not.toContain("Orphan win");
		expect(output).toContain("AI");
		expect(output).toContain("* Real win");
	});

	it("renders categories with the same heading-plus-bullets layout as visible wins", () => {
		const result: TechnicalFoundationalWinsResult = {
			categories: [
				{
					category: "Release & Delivery",
					wins: ["Completed four deployments", "Scheduled release walkthrough"],
				},
				{
					category: "Reliability",
					wins: ["Recovered service in under five minutes"],
				},
			],
		};

		const output = renderTechnicalWinsSection(result);
		expect(output).toContain(
			"Release & Delivery\n* Completed four deployments\n* Scheduled release walkthrough",
		);
		expect(output).toContain(
			"Reliability\n* Recovered service in under five minutes",
		);
		expect(output).not.toContain("** ");
	});
});
