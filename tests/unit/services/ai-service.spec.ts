import {
	afterAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import * as fsPromisesMod from "node:fs/promises";
import * as openaiMod from "openai";
import * as envMod from "../../../src/lib/env.js";
import { mocked } from "../../helpers/mocked.js";

mock.module("openai", () => {
	const MockOpenAI = mock().mockImplementation(() => ({
		responses: { create: mock() },
	}));
	return { ...openaiMod, default: MockOpenAI };
});

mock.module("../../../src/lib/env.js", () => ({
	...envMod,
	getEnv: mock(() => undefined),
}));

afterAll(() => {
	mock.restore();
});

spyOn(fsPromisesMod, "appendFile").mockResolvedValue(undefined as never);
spyOn(fsPromisesMod, "mkdir").mockResolvedValue(undefined as never);

const { AIService } = await import(
	new URL(
		"../../../src/services/ai.service.js?ai-service-spec",
		import.meta.url,
	).href
);
const { getEnv } = await import("../../../src/lib/env.js");

function mockClient(outputText: string | null, usage?: Record<string, number>) {
	const createFn = mock().mockResolvedValue({
		output_text: outputText,
		output: [{ stop_reason: "stop" }],
		usage: usage ?? { input_tokens: 100, output_tokens: 50 },
	});
	return { createFn, mockReturnValue: { responses: { create: createFn } } };
}

function makeTeamContext(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		organization: "acme",
		windowHuman: "Feb 1-8",
		windowStart: "2026-02-01",
		windowEnd: "2026-02-08",
		totals: {
			prs: 3,
			prsMerged: 2,
			repoCount: 1,
			contributorCount: 2,
		},
		highlights: [],
		individualUpdates: [],
		...overrides,
	};
}

function makeMemberMetrics(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		login: "alice",
		displayName: "Alice",
		commits: 3,
		prsOpened: 1,
		prsClosed: 0,
		prsMerged: 1,
		linesAdded: 20,
		linesDeleted: 5,
		linesAddedInProgress: 0,
		linesDeletedInProgress: 0,
		reviews: 2,
		approvals: 1,
		changesRequested: 0,
		commented: 1,
		reviewComments: 1,
		aiSummary: "",
		highlights: [],
		prHighlights: [],
		commitHighlights: [],
		taskTracker: {
			status: "disabled",
			tasks: [],
			message: "Integration disabled.",
		},
		...overrides,
	};
}

describe("AIService — constructor / enabled", () => {
	beforeEach(() => {
		mocked(getEnv).mockReturnValue(undefined);
	});

	it("is disabled when no API key is configured", () => {
		const service = new AIService({});
		expect((service as any).enabled).toBe(false);
	});

	it("is enabled when apiKey is provided in config", () => {
		const service = new AIService({ apiKey: "sk-test" });
		expect((service as any).enabled).toBe(true);
	});

	it("reads API key from OPENAI_API_KEY env var", () => {
		mocked(getEnv).mockImplementation((key: string) =>
			key === "OPENAI_API_KEY" ? "sk-from-env" : undefined,
		);
		const service = new AIService({});
		expect((service as any).enabled).toBe(true);
	});

	it("reads API key from AI_API_KEY env var as fallback", () => {
		mocked(getEnv).mockImplementation((key: string) =>
			key === "AI_API_KEY" ? "sk-fallback" : undefined,
		);
		const service = new AIService({});
		expect((service as any).enabled).toBe(true);
	});

	it("uses config model over default", () => {
		const service = new AIService({ model: "gpt-5-turbo" });
		expect((service as any).model).toBe("gpt-5-turbo");
	});

	it("uses default model gpt-5-mini when none configured", () => {
		const service = new AIService({});
		expect((service as any).model).toBe("gpt-5-mini");
	});

	it("allows per-method model overrides", () => {
		const service = new AIService({
			teamHighlightModel: "gpt-5-team",
			memberHighlightsModel: "gpt-5-member",
			individualSummariesModel: "gpt-5-individual",
			visibleWinsModel: "gpt-5-wins",
			discrepancyAnalysisModel: "gpt-5-audit",
		});
		expect((service as any).teamHighlightModel).toBe("gpt-5-team");
		expect((service as any).memberHighlightsModel).toBe("gpt-5-member");
		expect((service as any).individualSummariesModel).toBe("gpt-5-individual");
		expect((service as any).visibleWinsModel).toBe("gpt-5-wins");
		expect((service as any).discrepancyAnalysisModel).toBe("gpt-5-audit");
	});

	it("enables flex processing via config", () => {
		const service = new AIService({ enableFlexProcessing: true });
		expect((service as any).enableFlexProcessing).toBe(true);
	});

	it("reads flex processing from env", () => {
		mocked(getEnv).mockImplementation((key: string) =>
			key === "OPENAI_SERVICE_TIER" ? "flex" : undefined,
		);
		const service = new AIService({});
		expect((service as any).enableFlexProcessing).toBe(true);
	});
});

describe("AIService.createClient", () => {
	it("throws when API key is not configured", () => {
		const service = new AIService({});
		expect(() => (service as any).createClient()).toThrow(
			"AI client requested but API key not configured",
		);
	});

	it("creates client with API key", () => {
		const service = new AIService({ apiKey: "sk-test" });
		const client = (service as any).createClient();
		expect(client).toBeDefined();
		expect(client.responses).toBeDefined();
	});
});

describe("AIService.generateTeamHighlight", () => {
	it("throws when disabled", async () => {
		const service = new AIService({});
		await expect(
			service.generateTeamHighlight(makeTeamContext() as any),
		).rejects.toThrow("AI service is required for team highlights");
	});

	it("returns normalized sentence from AI response", async () => {
		const { createFn, mockReturnValue } = mockClient(
			"The team shipped 3 features this week",
		);
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		const result = await service.generateTeamHighlight(
			makeTeamContext() as any,
		);

		expect(result).toBe("The team shipped 3 features this week.");
		expect(createFn).toHaveBeenCalled();
	});

	it("throws on empty AI response", async () => {
		const { mockReturnValue } = mockClient(null);
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		await expect(
			service.generateTeamHighlight(makeTeamContext() as any),
		).rejects.toThrow("Empty AI response for team highlight");
	});

	it("wraps auth errors with helpful message", async () => {
		const service = new AIService({ apiKey: "sk-bad" });
		spyOn(service as any, "createClient").mockReturnValue({
			responses: {
				create: mock().mockRejectedValue(
					Object.assign(new Error("Unauthorized"), { status: 401 }),
				),
			},
		});

		await expect(
			service.generateTeamHighlight(makeTeamContext() as any),
		).rejects.toThrow(/invalid API key/);
	});

	it("calls onStatus callback with progress messages", async () => {
		const { mockReturnValue } = mockClient("Great week for the team");
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		const statusMessages: string[] = [];
		await service.generateTeamHighlight(
			makeTeamContext({
				onStatus: (msg: string) => statusMessages.push(msg),
			}) as any,
		);

		expect(statusMessages.length).toBeGreaterThanOrEqual(2);
		expect(statusMessages[0]).toContain("Sending");
		expect(statusMessages[statusMessages.length - 1]).toContain("Received");
	});
});

describe("AIService.generateMemberHighlights", () => {
	it("throws when disabled", async () => {
		const service = new AIService({});
		await expect(
			service.generateMemberHighlights({
				members: [makeMemberMetrics()],
				windowHuman: "Feb 1-8",
			} as any),
		).rejects.toThrow("AI service is required for member highlights");
	});

	it("returns empty map when no members provided", async () => {
		const service = new AIService({ apiKey: "sk-test" });
		const result = await service.generateMemberHighlights({
			members: [],
			windowHuman: "Feb 1-8",
		});
		expect(result).toBeInstanceOf(Map);
		expect(result.size).toBe(0);
	});

	it("returns map of login -> sentence from JSON response", async () => {
		const responseJson = JSON.stringify({
			alice: "Alice shipped the dashboard feature",
			bob: "Bob reviewed 12 pull requests",
		});
		const { mockReturnValue } = mockClient(responseJson);
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		const result = await service.generateMemberHighlights({
			members: [
				makeMemberMetrics(),
				makeMemberMetrics({ login: "bob", displayName: "Bob" }),
			],
			windowHuman: "Feb 1-8",
		} as any);

		expect(result.get("alice")).toBe("Alice shipped the dashboard feature.");
		expect(result.get("bob")).toBe("Bob reviewed 12 pull requests.");
	});

	it("handles markdown code block wrapping in response", async () => {
		const json = JSON.stringify({ alice: "Great work on the API" });
		const wrappedResponse = `\`\`\`json\n${json}\n\`\`\``;
		const { mockReturnValue } = mockClient(wrappedResponse);
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		const result = await service.generateMemberHighlights({
			members: [makeMemberMetrics()],
			windowHuman: "Feb 1-8",
		} as any);

		expect(result.get("alice")).toBe("Great work on the API.");
	});

	it("handles bare code block wrapping (no json tag)", async () => {
		const json = JSON.stringify({ alice: "Fixed the bug" });
		const wrappedResponse = `\`\`\`\n${json}\n\`\`\``;
		const { mockReturnValue } = mockClient(wrappedResponse);
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		const result = await service.generateMemberHighlights({
			members: [makeMemberMetrics()],
			windowHuman: "Feb 1-8",
		} as any);

		expect(result.get("alice")).toBe("Fixed the bug.");
	});

	it("throws when response is empty", async () => {
		const { mockReturnValue } = mockClient(null);
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		await expect(
			service.generateMemberHighlights({
				members: [makeMemberMetrics()],
				windowHuman: "Feb 1-8",
			} as any),
		).rejects.toThrow("Empty AI response for member highlights");
	});

	it("throws when response is not valid JSON", async () => {
		const { mockReturnValue } = mockClient("not json at all");
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		await expect(
			service.generateMemberHighlights({
				members: [makeMemberMetrics()],
				windowHuman: "Feb 1-8",
			} as any),
		).rejects.toThrow("Invalid AI response for member highlights");
	});

	it("throws when response is an array instead of object", async () => {
		const { mockReturnValue } = mockClient(JSON.stringify(["alice"]));
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		await expect(
			service.generateMemberHighlights({
				members: [makeMemberMetrics()],
				windowHuman: "Feb 1-8",
			} as any),
		).rejects.toThrow("Invalid AI response for member highlights");
	});

	it("throws when a member key is missing from response", async () => {
		const { mockReturnValue } = mockClient(JSON.stringify({ bob: "text" }));
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		await expect(
			service.generateMemberHighlights({
				members: [makeMemberMetrics()],
				windowHuman: "Feb 1-8",
			} as any),
		).rejects.toThrow("Missing AI response for member highlight: Alice");
	});

	it("throws when a member value is not a string", async () => {
		const { mockReturnValue } = mockClient(JSON.stringify({ alice: 42 }));
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		await expect(
			service.generateMemberHighlights({
				members: [makeMemberMetrics()],
				windowHuman: "Feb 1-8",
			} as any),
		).rejects.toThrow("Missing AI response for member highlight: Alice");
	});
});

describe("AIService.generateMemberHighlight (single)", () => {
	it("delegates to generateMemberHighlights for a single member", async () => {
		const responseJson = JSON.stringify({
			alice: "Alice shipped a feature",
		});
		const { mockReturnValue } = mockClient(responseJson);
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		const result = await service.generateMemberHighlight({
			member: makeMemberMetrics(),
			windowHuman: "Feb 1-8",
		} as any);

		expect(result).toBe("Alice shipped a feature.");
	});

	it("throws when single member highlight is empty in batch response", async () => {
		// Response has the key but generateMemberHighlights will throw before we get here
		// Test the case where batch returns no entry for this login
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service, "generateMemberHighlights").mockResolvedValue(new Map());

		await expect(
			service.generateMemberHighlight({
				member: {
					login: "alice",
					displayName: "Alice",
					activityBlock: "...",
				},
				windowHuman: "Feb 1-8",
			}),
		).rejects.toThrow("Empty AI response for member highlight: Alice");
	});
});

describe("AIService.generateIndividualSummaries", () => {
	const makePayloads = () => [
		{
			contributor: { login: "alice", displayName: "Alice" },
			reportingWindow: {
				startISO: "2026-02-01",
				endISO: "2026-02-08",
				human: "Feb 1-8",
			},
			metrics: {
				commits: 10,
				prsTotal: 3,
				prsMerged: 2,
				linesAdded: 500,
				linesDeleted: 200,
				reviews: 5,
			},
			pullRequests: [],
			asana: { status: "matched" as const, tasks: [] },
			highlights: [],
			prHighlights: [],
			commitHighlights: [],
		},
	];

	it("throws when disabled", async () => {
		const service = new AIService({});
		await expect(
			service.generateIndividualSummaries(makePayloads()),
		).rejects.toThrow(
			"AI service is required for individual contributor summaries",
		);
	});

	it("returns empty array for empty payloads", async () => {
		const service = new AIService({ apiKey: "sk-test" });
		const result = await service.generateIndividualSummaries([]);
		expect(result).toEqual([]);
	});

	it("returns summaries keyed by login", async () => {
		const responseJson = JSON.stringify({
			summaries: [
				{
					login: "alice",
					summary: "Alice contributed significantly to the codebase.",
				},
			],
		});
		const { mockReturnValue } = mockClient(responseJson);
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		const result = await service.generateIndividualSummaries(makePayloads());

		expect(result).toHaveLength(1);
		expect(result[0].login).toBe("alice");
		expect(result[0].summary).toBe(
			"Alice contributed significantly to the codebase.",
		);
	});

	it("throws on empty AI response", async () => {
		const { mockReturnValue } = mockClient(null);
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		await expect(
			service.generateIndividualSummaries(makePayloads()),
		).rejects.toThrow("Empty AI response for individual contributor summaries");
	});

	it("throws on invalid JSON", async () => {
		const { mockReturnValue } = mockClient("not json");
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		await expect(
			service.generateIndividualSummaries(makePayloads()),
		).rejects.toThrow("Invalid JSON from individual summaries response");
	});

	it("throws when summaries array is missing", async () => {
		const { mockReturnValue } = mockClient(JSON.stringify({ results: [] }));
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		await expect(
			service.generateIndividualSummaries(makePayloads()),
		).rejects.toThrow("AI response missing 'summaries' array");
	});

	it("throws when a contributor is missing from the response", async () => {
		const responseJson = JSON.stringify({
			summaries: [{ login: "bob", summary: "Not alice." }],
		});
		const { mockReturnValue } = mockClient(responseJson);
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		await expect(
			service.generateIndividualSummaries(makePayloads()),
		).rejects.toThrow("Empty AI response for individual summary: Alice");
	});

	it("skips entries with empty or invalid login/summary", async () => {
		const responseJson = JSON.stringify({
			summaries: [
				{ login: "", summary: "empty login" },
				{ login: "alice", summary: "Alice did great." },
				{ login: 123, summary: "bad login type" },
			],
		});
		const { mockReturnValue } = mockClient(responseJson);
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		const result = await service.generateIndividualSummaries(makePayloads());
		expect(result).toHaveLength(1);
		expect(result[0].login).toBe("alice");
	});
});

describe("AIService.generateFinalReport", () => {
	it("returns rendered markdown", async () => {
		const reportRenderer = await import("../../../src/lib/report-renderer.js");
		spyOn(reportRenderer, "renderReport").mockReturnValue(
			"## Report\n### Alice (@alice)\nSummary here",
		);

		const service = new AIService({ apiKey: "sk-test" });
		const result = await service.generateFinalReport({
			report: {
				orgSlug: "acme",
				generatedAt: "2026-02-08",
				window: { start: "2026-02-01", end: "2026-02-08", human: "Feb 1-8" },
				totals: { prs: 10, prsMerged: 8, repoCount: 3, contributorCount: 2 },
				sections: {},
				memberMetrics: [
					{
						login: "alice",
						displayName: "Alice",
						commits: 10,
						prsOpened: 3,
						prsClosed: 1,
						prsMerged: 2,
						linesAdded: 500,
						linesDeleted: 200,
						reviews: 5,
						approvals: 3,
						changesRequested: 1,
						commented: 1,
						reviewComments: 2,
						aiSummary: "Great contributions.",
						highlights: [],
						prHighlights: [],
						commitHighlights: [],
						taskTracker: { status: "matched", tasks: [] },
					},
				],
			} as any,
		});

		expect(result).toContain("Report");
	});

	it("throws when contributor section is missing from rendered report", async () => {
		const reportRenderer = await import("../../../src/lib/report-renderer.js");
		spyOn(reportRenderer, "renderReport").mockReturnValue(
			"## Report\nNo individual sections",
		);

		const service = new AIService({ apiKey: "sk-test" });
		await expect(
			service.generateFinalReport({
				report: {
					orgSlug: "acme",
					generatedAt: "2026-02-08",
					window: { start: "2026-02-01", end: "2026-02-08", human: "Feb 1-8" },
					totals: { prs: 10, prsMerged: 8, repoCount: 3, contributorCount: 2 },
					sections: {},
					memberMetrics: [
						{
							login: "alice",
							displayName: "Alice",
							commits: 10,
							prsOpened: 3,
							prsClosed: 1,
							prsMerged: 2,
							linesAdded: 500,
							linesDeleted: 200,
							reviews: 5,
							approvals: 3,
							changesRequested: 1,
							commented: 1,
							reviewComments: 2,
							aiSummary: "",
							highlights: [],
							prHighlights: [],
							commitHighlights: [],
							taskTracker: { status: "matched", tasks: [] },
						},
					],
				} as any,
			}),
		).rejects.toThrow("Final report omitted contributor sections");
	});

	it("skips contributor check when individualContributions is false", async () => {
		const reportRenderer = await import("../../../src/lib/report-renderer.js");
		spyOn(reportRenderer, "renderReport").mockReturnValue(
			"## Report\nNo contributors listed",
		);

		const service = new AIService({ apiKey: "sk-test" });
		const result = await service.generateFinalReport({
			report: {
				orgSlug: "acme",
				generatedAt: "2026-02-08",
				window: { start: "2026-02-01", end: "2026-02-08", human: "Feb 1-8" },
				totals: { prs: 10, prsMerged: 8, repoCount: 3, contributorCount: 2 },
				sections: { individualContributions: false },
				memberMetrics: [
					{
						login: "alice",
						displayName: "Alice",
						commits: 10,
						prsOpened: 3,
						prsClosed: 1,
						prsMerged: 2,
						linesAdded: 500,
						linesDeleted: 200,
						reviews: 5,
						approvals: 3,
						changesRequested: 1,
						commented: 1,
						reviewComments: 2,
						aiSummary: "",
						highlights: [],
						prHighlights: [],
						commitHighlights: [],
						taskTracker: { status: "matched", tasks: [] },
					},
				],
			} as any,
		});

		// Should not throw even though Alice's heading is missing
		expect(result).toBeDefined();
	});
});

describe("AIService.analyzeSectionDiscrepancies", () => {
	it("throws when disabled", async () => {
		const service = new AIService({});
		await expect(
			service.analyzeSectionDiscrepancies({
				sectionName: "teamHighlight",
				claims: "claim text",
				evidence: "evidence text",
			}),
		).rejects.toThrow("AI service is required for report audit");
	});

	it("returns parsed discrepancies from AI response", async () => {
		const responseJson = JSON.stringify({
			discrepancies: [
				{
					summary: "PR merged but task not closed",
					explanation:
						"PR #123 was merged but corresponding Asana task is still open",
					sourceA: {
						sourceName: "GitHub",
						state: "MERGED",
						url: "https://github.com/pr/123",
						itemId: "123",
					},
					sourceB: {
						sourceName: "Asana",
						state: "In Progress",
						url: "https://app.asana.com/task/456",
						itemId: "456",
					},
					suggestedResolution: "Close the Asana task",
					confidence: 85,
					rule: "merged-pr-open-task",
					contributorLogin: "alice",
					contributorDisplayName: "Alice",
				},
			],
		});
		const { mockReturnValue } = mockClient(responseJson);
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		const result = await service.analyzeSectionDiscrepancies({
			sectionName: "individualContribution",
			claims: "claim text",
			evidence: "evidence text",
			contributor: "alice",
			contributorDisplayName: "Alice",
		});

		expect(result).toHaveLength(1);
		expect(result[0].sectionName).toBe("individualContribution");
		expect(result[0].summary).toBe("PR merged but task not closed");
		expect(result[0].confidence).toBe(85);
		expect(result[0].sourceA.sourceName).toBe("GitHub");
		expect(result[0].sourceB.sourceName).toBe("Asana");
	});

	it("clamps confidence to 0-100 range", async () => {
		const responseJson = JSON.stringify({
			discrepancies: [
				{
					summary: "test",
					explanation: "test",
					sourceA: { sourceName: "A", state: "s", url: "", itemId: "" },
					sourceB: { sourceName: "B", state: "s", url: "", itemId: "" },
					suggestedResolution: "fix",
					confidence: 150,
					rule: "test",
					contributorLogin: "alice",
					contributorDisplayName: "Alice",
				},
			],
		});
		const { mockReturnValue } = mockClient(responseJson);
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		const result = await service.analyzeSectionDiscrepancies({
			sectionName: "teamHighlight",
			claims: "claims",
			evidence: "evidence",
		});

		expect(result[0].confidence).toBe(100);
	});

	it("defaults confidence to 50 when not a number", async () => {
		const responseJson = JSON.stringify({
			discrepancies: [
				{
					summary: "test",
					explanation: "test",
					sourceA: { sourceName: "A", state: "s", url: "", itemId: "" },
					sourceB: { sourceName: "B", state: "s", url: "", itemId: "" },
					suggestedResolution: "fix",
					confidence: "high",
					rule: "test",
					contributorLogin: "",
					contributorDisplayName: "",
				},
			],
		});
		const { mockReturnValue } = mockClient(responseJson);
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		const result = await service.analyzeSectionDiscrepancies({
			sectionName: "teamHighlight",
			claims: "claims",
			evidence: "evidence",
		});

		expect(result[0].confidence).toBe(50);
	});

	it("converts empty url/itemId to undefined", async () => {
		const responseJson = JSON.stringify({
			discrepancies: [
				{
					summary: "test",
					explanation: "test",
					sourceA: { sourceName: "A", state: "s", url: "", itemId: "" },
					sourceB: { sourceName: "B", state: "s", url: "", itemId: "" },
					suggestedResolution: "fix",
					confidence: 50,
					rule: "test",
					contributorLogin: "",
					contributorDisplayName: "",
				},
			],
		});
		const { mockReturnValue } = mockClient(responseJson);
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		const result = await service.analyzeSectionDiscrepancies({
			sectionName: "teamHighlight",
			claims: "claims",
			evidence: "evidence",
		});

		expect(result[0].sourceA.url).toBeUndefined();
		expect(result[0].sourceA.itemId).toBeUndefined();
	});

	it("throws on empty AI response", async () => {
		const { mockReturnValue } = mockClient(null);
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		await expect(
			service.analyzeSectionDiscrepancies({
				sectionName: "teamHighlight",
				claims: "claims",
				evidence: "evidence",
			}),
		).rejects.toThrow("Empty AI response for discrepancy analysis");
	});

	it("uses context contributor when response contributorLogin is empty", async () => {
		const responseJson = JSON.stringify({
			discrepancies: [
				{
					summary: "test",
					explanation: "test",
					sourceA: { sourceName: "A", state: "s", url: "", itemId: "" },
					sourceB: { sourceName: "B", state: "s", url: "", itemId: "" },
					suggestedResolution: "fix",
					confidence: 50,
					rule: "test",
					contributorLogin: "",
					contributorDisplayName: "",
				},
			],
		});
		const { mockReturnValue } = mockClient(responseJson);
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue(mockReturnValue);

		const result = await service.analyzeSectionDiscrepancies({
			sectionName: "individualContribution",
			claims: "claims",
			evidence: "evidence",
			contributor: "bob",
			contributorDisplayName: "Bob",
		});

		expect(result[0].contributor).toBe("bob");
		expect(result[0].contributorDisplayName).toBe("Bob");
	});
});

describe("AIService.rethrowAsConnectionOrAuthError", () => {
	it("wraps 403 as auth error", () => {
		const service = new AIService({ apiKey: "sk-test" });
		const error = Object.assign(new Error("Forbidden"), { status: 403 });
		expect(() =>
			(service as any).rethrowAsConnectionOrAuthError("Test", error),
		).toThrow(/invalid API key/);
	});

	it("wraps 502 as network error", () => {
		const service = new AIService({ apiKey: "sk-test" });
		const error = Object.assign(new Error("Bad Gateway"), { status: 502 });
		expect(() =>
			(service as any).rethrowAsConnectionOrAuthError("Test", error),
		).toThrow(/could not connect to AI service/);
	});

	it("wraps 503 as network error", () => {
		const service = new AIService({ apiKey: "sk-test" });
		const error = Object.assign(new Error("Service Unavailable"), {
			status: 503,
		});
		expect(() =>
			(service as any).rethrowAsConnectionOrAuthError("Test", error),
		).toThrow(/could not connect to AI service/);
	});

	it("wraps ECONNREFUSED as network error", () => {
		const service = new AIService({ apiKey: "sk-test" });
		const error = new Error("connect ECONNREFUSED 127.0.0.1:443");
		expect(() =>
			(service as any).rethrowAsConnectionOrAuthError("Test", error),
		).toThrow(/could not connect to AI service/);
	});

	it("wraps 429 with rate limit details", () => {
		const service = new AIService({ apiKey: "sk-test" });
		const error = Object.assign(new Error("Rate limit exceeded"), {
			status: 429,
			error: { type: "rate_limit", code: "rate_limit_exceeded" },
		});
		expect(() =>
			(service as any).rethrowAsConnectionOrAuthError("Test", error),
		).toThrow(/Rate limit exceeded/);
	});

	it("passes through generic errors", () => {
		const service = new AIService({ apiKey: "sk-test" });
		const error = new Error("Something unexpected");
		expect(() =>
			(service as any).rethrowAsConnectionOrAuthError("Test", error),
		).toThrow("Test: Something unexpected");
	});

	it("handles non-Error arguments", () => {
		const service = new AIService({ apiKey: "sk-test" });
		expect(() =>
			(service as any).rethrowAsConnectionOrAuthError("Test", "string error"),
		).toThrow("Test: string error");
	});
});

describe("AIService.normalizeSentence", () => {
	it("appends period if missing", () => {
		const service = new AIService({});
		const result = (service as any).normalizeSentence("Hello world");
		expect(result).toBe("Hello world.");
	});

	it("does not double-period", () => {
		const service = new AIService({});
		const result = (service as any).normalizeSentence("Hello world.");
		expect(result).toBe("Hello world.");
	});

	it("returns null for null/undefined/empty", () => {
		const service = new AIService({});
		expect((service as any).normalizeSentence(null)).toBeNull();
		expect((service as any).normalizeSentence(undefined)).toBeNull();
		expect((service as any).normalizeSentence("")).toBeNull();
	});

	it("collapses whitespace", () => {
		const service = new AIService({});
		const result = (service as any).normalizeSentence("  Hello   world  ");
		expect(result).toBe("Hello world.");
	});
});

describe("AIService.makeFlexRequest", () => {
	it("retries on 5xx errors", async () => {
		const createFn = mock();
		createFn.mockRejectedValueOnce(
			Object.assign(new Error("Server Error"), { status: 500 }),
		);
		createFn.mockResolvedValueOnce({ output_text: "ok" });

		const service = new AIService({
			apiKey: "sk-test",
			maxRetries: 2,
			baseRetryDelayMs: 1,
		});
		spyOn(service as any, "createClient").mockReturnValue({
			responses: { create: createFn },
		});

		const result = await (service as any).makeFlexRequest(
			"gpt-5-mini",
			"test prompt",
			{},
		);
		expect(result.output_text).toBe("ok");
		expect(createFn).toHaveBeenCalledTimes(2);
	});

	it("retries on 429 resource_unavailable", async () => {
		const createFn = mock();
		createFn.mockRejectedValueOnce(
			Object.assign(new Error("Resource unavailable"), {
				status: 429,
				error: { code: "resource_unavailable" },
			}),
		);
		createFn.mockResolvedValueOnce({ output_text: "ok" });

		const service = new AIService({
			apiKey: "sk-test",
			maxRetries: 2,
			baseRetryDelayMs: 1,
		});
		spyOn(service as any, "createClient").mockReturnValue({
			responses: { create: createFn },
		});

		const result = await (service as any).makeFlexRequest(
			"gpt-5-mini",
			"test",
			{},
		);
		expect(result.output_text).toBe("ok");
	});

	it("falls back to standard on 408 timeout in flex mode", async () => {
		const createFn = mock();
		createFn.mockRejectedValueOnce(
			Object.assign(new Error("Timeout"), { status: 408 }),
		);
		createFn.mockResolvedValueOnce({ output_text: "fallback ok" });

		const service = new AIService({
			apiKey: "sk-test",
			enableFlexProcessing: true,
			baseRetryDelayMs: 1,
		});
		spyOn(service as any, "createClient").mockReturnValue({
			responses: { create: createFn },
		});

		const result = await (service as any).makeFlexRequest(
			"gpt-5-mini",
			"test",
			{},
		);
		expect(result.output_text).toBe("fallback ok");
		// First call is flex, second is fallback (no service_tier)
		expect(createFn).toHaveBeenCalledTimes(2);
	});

	it("throws non-retryable errors immediately", async () => {
		const createFn = mock().mockRejectedValue(
			Object.assign(new Error("Bad Request"), { status: 400 }),
		);

		const service = new AIService({
			apiKey: "sk-test",
			maxRetries: 2,
			baseRetryDelayMs: 1,
		});
		spyOn(service as any, "createClient").mockReturnValue({
			responses: { create: createFn },
		});

		await expect(
			(service as any).makeFlexRequest("gpt-5-mini", "test", {}),
		).rejects.toThrow("Bad Request");
		// Only called once since 400 is not retryable
		expect(createFn).toHaveBeenCalledTimes(1);
	});
});

describe("AIService — system prompts", () => {
	beforeEach(() => {
		mocked(getEnv).mockReturnValue(undefined);
	});

	it("getSystemPrompt returns undefined when no prompts configured", () => {
		const service = new AIService({ apiKey: "sk-test" });
		expect((service as any).getSystemPrompt("teamHighlight")).toBeUndefined();
	});

	it("getSystemPrompt returns section-specific prompt", () => {
		const service = new AIService({
			apiKey: "sk-test",
			systemPrompts: {
				teamHighlight: "Be formal.",
				visibleWins: "Focus on revenue.",
			},
		});
		expect((service as any).getSystemPrompt("teamHighlight")).toBe(
			"Be formal.",
		);
		expect((service as any).getSystemPrompt("visibleWins")).toBe(
			"Focus on revenue.",
		);
	});

	it("getSystemPrompt falls back to default when section key missing", () => {
		const service = new AIService({
			apiKey: "sk-test",
			systemPrompts: { default: "Write concisely." },
		});
		expect((service as any).getSystemPrompt("teamHighlight")).toBe(
			"Write concisely.",
		);
		expect((service as any).getSystemPrompt("discrepancyAnalysis")).toBe(
			"Write concisely.",
		);
	});

	it("getSystemPrompt prefers section-specific over default", () => {
		const service = new AIService({
			apiKey: "sk-test",
			systemPrompts: {
				default: "Write concisely.",
				teamHighlight: "Be formal.",
			},
		});
		expect((service as any).getSystemPrompt("teamHighlight")).toBe(
			"Be formal.",
		);
		// Other sections should fall back to default
		expect((service as any).getSystemPrompt("visibleWins")).toBe(
			"Write concisely.",
		);
	});

	it("makeFlexRequest includes instructions when system prompt is set", async () => {
		const createFn = mock().mockResolvedValue({
			output_text: "result",
			output: [{ stop_reason: "stop" }],
			usage: { input_tokens: 10, output_tokens: 5 },
		});
		const service = new AIService({
			apiKey: "sk-test",
			systemPrompts: { default: "Be pirate." },
		});
		spyOn(service as any, "createClient").mockReturnValue({
			responses: { create: createFn },
		});

		await (service as any).makeFlexRequest(
			"gpt-5-mini",
			"test prompt",
			{},
			0,
			"Be pirate.",
		);

		const callArgs = createFn.mock.calls[0][0];
		expect(callArgs.instructions).toBe("Be pirate.");
		expect(callArgs.input).toBe("test prompt");
	});

	it("makeFlexRequest omits instructions when undefined", async () => {
		const createFn = mock().mockResolvedValue({
			output_text: "result",
			output: [{ stop_reason: "stop" }],
			usage: { input_tokens: 10, output_tokens: 5 },
		});
		const service = new AIService({ apiKey: "sk-test" });
		spyOn(service as any, "createClient").mockReturnValue({
			responses: { create: createFn },
		});

		await (service as any).makeFlexRequest(
			"gpt-5-mini",
			"test prompt",
			{},
			0,
			undefined,
		);

		const callArgs = createFn.mock.calls[0][0];
		expect(callArgs.instructions).toBeUndefined();
	});

	it("stores systemPrompts from config", () => {
		const prompts = {
			default: "General prompt.",
			teamHighlight: "Team prompt.",
		};
		const service = new AIService({
			apiKey: "sk-test",
			systemPrompts: prompts,
		});
		expect((service as any).systemPrompts).toEqual(prompts);
	});

	it("defaults systemPrompts to empty object", () => {
		const service = new AIService({ apiKey: "sk-test" });
		expect((service as any).systemPrompts).toEqual({});
	});
});
