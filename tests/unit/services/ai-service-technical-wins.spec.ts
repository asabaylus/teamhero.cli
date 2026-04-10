import { describe, expect, it, mock, spyOn } from "bun:test";
import type { TechnicalFoundationalWinsResult } from "../../../src/core/types.js";
import { AIService } from "../../../src/services/ai.service.js";
import type { TechnicalWinsContext } from "../../../src/services/ai-prompts.js";

function makeContext(
	overrides: Partial<TechnicalWinsContext> = {},
): TechnicalWinsContext {
	return {
		windowStart: "2026-04-03",
		windowEnd: "2026-04-10",
		verbosity: "standard",
		subheadings: "auto",
		audience: "CTO and executive leadership",
		currentWeekItems: ["Deployed new monitoring stack"],
		previousWeekItems: [],
		...overrides,
	};
}

function makeMockResult(): TechnicalFoundationalWinsResult {
	return {
		categories: [
			{
				category: "AI / Engineering",
				wins: ["Subscribed to Anthropic Team plan"],
			},
			{
				category: "IT / Centre",
				wins: ["Deployed ActivTrak to 130 users"],
			},
		],
	};
}

describe("AIService.generateTechnicalWinsSection", () => {
	it("throws when AI service is disabled (no API key)", async () => {
		const service = new AIService({ apiKey: "" });

		await expect(
			service.generateTechnicalWinsSection(makeContext()),
		).rejects.toThrow(
			/AI service is required for Technical \/ Foundational Wins/,
		);
	});

	it("returns a typed TechnicalFoundationalWinsResult from structured JSON", async () => {
		const mockResult = makeMockResult();
		const mockResponse = {
			output_text: JSON.stringify(mockResult),
			usage: { input_tokens: 100, output_tokens: 50 },
		};

		const service = new AIService({ apiKey: "test-key" });
		spyOn(service as never, "createClient").mockReturnValue({
			responses: {
				create: mock().mockResolvedValue(mockResponse),
			},
		} as never);

		const result = await service.generateTechnicalWinsSection(makeContext());
		expect(result).toEqual(mockResult);
		expect(result.categories).toHaveLength(2);
		expect(result.categories[0].category).toBe("AI / Engineering");
		expect(result.categories[1].wins).toContain(
			"Deployed ActivTrak to 130 users",
		);
	});

	it("uses technicalWinsModel from config", async () => {
		const mockResponse = {
			output_text: JSON.stringify({ categories: [] }),
		};
		const createFn = mock().mockResolvedValue(mockResponse);

		const service = new AIService({
			apiKey: "test-key",
			technicalWinsModel: "gpt-5-pro",
		});
		spyOn(service as never, "createClient").mockReturnValue({
			responses: { create: createFn },
		} as never);

		await service.generateTechnicalWinsSection(makeContext());

		expect(createFn).toHaveBeenCalledWith(
			expect.objectContaining({ model: "gpt-5-pro" }),
		);
	});

	it("passes text.format with TECHNICAL_WINS_SCHEMA to the Responses API", async () => {
		const mockResponse = {
			output_text: JSON.stringify({ categories: [] }),
		};
		const createFn = mock().mockResolvedValue(mockResponse);

		const service = new AIService({ apiKey: "test-key" });
		spyOn(service as never, "createClient").mockReturnValue({
			responses: { create: createFn },
		} as never);

		await service.generateTechnicalWinsSection(makeContext());

		const callArgs = createFn.mock.calls[0][0];
		expect(callArgs.text).toBeDefined();
		expect(callArgs.text.format.type).toBe("json_schema");
		expect(callArgs.text.format.strict).toBe(true);
		expect(callArgs.text.format.name).toBe("technical_foundational_wins");
	});

	it("throws on empty AI response", async () => {
		const mockResponse = { output_text: null };

		const service = new AIService({ apiKey: "test-key" });
		spyOn(service as never, "createClient").mockReturnValue({
			responses: {
				create: mock().mockResolvedValue(mockResponse),
			},
		} as never);

		await expect(
			service.generateTechnicalWinsSection(makeContext()),
		).rejects.toThrow(/Empty AI response for Technical \/ Foundational Wins/);
	});

	it("wraps API errors via rethrowAsConnectionOrAuthError", async () => {
		const service = new AIService({ apiKey: "test-key" });
		spyOn(service as never, "createClient").mockReturnValue({
			responses: {
				create: mock().mockImplementation(async () => {
					throw Object.assign(new Error("fetch failed"), { status: 502 });
				}),
			},
		} as never);

		try {
			await service.generateTechnicalWinsSection(makeContext());
			throw new Error("expected generateTechnicalWinsSection to throw");
		} catch (error) {
			expect(String(error)).toMatch(
				/Failed to generate Technical \/ Foundational Wins|fetch failed/,
			);
		}
	});

	it("sends a prompt containing context data", async () => {
		const mockResponse = {
			output_text: JSON.stringify({ categories: [] }),
		};
		const createFn = mock().mockResolvedValue(mockResponse);

		const service = new AIService({ apiKey: "test-key" });
		spyOn(service as never, "createClient").mockReturnValue({
			responses: { create: createFn },
		} as never);

		await service.generateTechnicalWinsSection(
			makeContext({
				currentWeekItems: ["Subscribed to Anthropic Team plan"],
			}),
		);

		const callArgs = createFn.mock.calls[0][0];
		expect(typeof callArgs.input).toBe("string");
		expect(callArgs.input).toContain("Subscribed to Anthropic Team plan");
		expect(callArgs.input).toContain("Technical / Foundational Wins");
	});

	it("forwards onStatus callbacks during generation", async () => {
		const mockResponse = {
			output_text: JSON.stringify({ categories: [] }),
		};

		const service = new AIService({ apiKey: "test-key" });
		spyOn(service as never, "createClient").mockReturnValue({
			responses: {
				create: mock().mockResolvedValue(mockResponse),
			},
		} as never);

		const statuses: string[] = [];
		await service.generateTechnicalWinsSection(
			makeContext({ onStatus: (s) => statuses.push(s) }),
		);

		expect(statuses.length).toBeGreaterThan(0);
		expect(statuses.some((s) => s.toLowerCase().includes("generating"))).toBe(
			true,
		);
	});
});
