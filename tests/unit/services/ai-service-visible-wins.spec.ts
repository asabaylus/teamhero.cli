import { describe, expect, it, mock, spyOn } from "bun:test";
import type { VisibleWinsExtractionContext } from "../../../src/core/types.js";
import type { ProjectAccomplishment } from "../../../src/models/visible-wins.js";
import { AIService } from "../../../src/services/ai.service.js";

function makeContext(
	overrides: Partial<VisibleWinsExtractionContext> = {},
): VisibleWinsExtractionContext {
	return {
		projects: [],
		associations: [],
		notes: [],
		...overrides,
	};
}

function makeMockAccomplishments(): ProjectAccomplishment[] {
	return [
		{
			projectName: "Dashboard",
			projectGid: "gid-1",
			bullets: [
				{
					text: "Completed dashboard redesign improving load time by 40%",
					subBullets: ["Migrated to server-side rendering"],
					sourceDates: ["2026-01-28"],
					sourceFigures: ["40%"],
					sourceNoteFile: "standup.md",
				},
			],
		},
	];
}

describe("AIService.extractProjectAccomplishments", () => {
	it("throws when AI service is disabled (no API key)", async () => {
		const service = new AIService({ apiKey: "" });

		await expect(
			service.extractProjectAccomplishments(makeContext()),
		).rejects.toThrow("AI service is required for visible wins extraction");
	});

	it("returns ProjectAccomplishment[] from structured JSON response", async () => {
		const mockAccomplishments = makeMockAccomplishments();
		const mockResponse = {
			output_text: JSON.stringify({
				accomplishments: mockAccomplishments,
			}),
			usage: { input_tokens: 100, output_tokens: 50 },
		};

		const service = new AIService({ apiKey: "test-key" });
		spyOn(service as never, "createClient").mockReturnValue({
			responses: {
				create: mock().mockResolvedValue(mockResponse),
			},
		} as never);

		const result = await service.extractProjectAccomplishments(makeContext());

		expect(result).toEqual(mockAccomplishments);
		expect(result[0].projectName).toBe("Dashboard");
		expect(result[0].projectGid).toBe("gid-1");
		expect(result[0].bullets[0].text).toContain("dashboard redesign");
	});

	it("uses visibleWinsModel from config", async () => {
		const mockResponse = {
			output_text: JSON.stringify({ accomplishments: [] }),
		};
		const createFn = mock().mockResolvedValue(mockResponse);

		const service = new AIService({
			apiKey: "test-key",
			visibleWinsModel: "gpt-5-mega",
		});
		spyOn(service as never, "createClient").mockReturnValue({
			responses: { create: createFn },
		} as never);

		await service.extractProjectAccomplishments(makeContext());

		expect(createFn).toHaveBeenCalledWith(
			expect.objectContaining({ model: "gpt-5-mega" }),
		);
	});

	it("passes text.format with VISIBLE_WINS_SCHEMA to API", async () => {
		const mockResponse = {
			output_text: JSON.stringify({ accomplishments: [] }),
		};
		const createFn = mock().mockResolvedValue(mockResponse);

		const service = new AIService({ apiKey: "test-key" });
		spyOn(service as never, "createClient").mockReturnValue({
			responses: { create: createFn },
		} as never);

		await service.extractProjectAccomplishments(makeContext());

		const callArgs = createFn.mock.calls[0][0];
		expect(callArgs.text).toBeDefined();
		expect(callArgs.text.format.type).toBe("json_schema");
		expect(callArgs.text.format.strict).toBe(true);
		expect(callArgs.text.format.name).toBe("visible_wins_extraction");
	});

	it("handles empty accomplishments array", async () => {
		const mockResponse = {
			output_text: JSON.stringify({ accomplishments: [] }),
		};

		const service = new AIService({ apiKey: "test-key" });
		spyOn(service as never, "createClient").mockReturnValue({
			responses: {
				create: mock().mockResolvedValue(mockResponse),
			},
		} as never);

		const result = await service.extractProjectAccomplishments(makeContext());

		expect(result).toEqual([]);
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
			service.extractProjectAccomplishments(makeContext()),
		).rejects.toThrow("Empty AI response for visible wins extraction");
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
			await service.extractProjectAccomplishments(makeContext());
			throw new Error("expected extractProjectAccomplishments to throw");
		} catch (error) {
			expect(String(error)).toMatch(
				/Failed to extract project accomplishments|fetch failed/,
			);
		}
	});

	it("sends prompt built from context", async () => {
		const mockResponse = {
			output_text: JSON.stringify({ accomplishments: [] }),
		};
		const createFn = mock().mockResolvedValue(mockResponse);

		const service = new AIService({ apiKey: "test-key" });
		spyOn(service as never, "createClient").mockReturnValue({
			responses: { create: createFn },
		} as never);

		await service.extractProjectAccomplishments(makeContext());

		const callArgs = createFn.mock.calls[0][0];
		expect(callArgs.input).toBeDefined();
		expect(typeof callArgs.input).toBe("string");
		expect(callArgs.input).toContain("accomplishment bullets");
	});
});
