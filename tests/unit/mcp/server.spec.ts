/**
 * Tests for the MCP server tool handlers.
 *
 * Strategy: Import the server module and verify the handlers return
 * expected shapes. We mock the Server class so no actual stdio transport
 * is opened, and we test the handler logic directly via the captured callbacks.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

import * as mcpServerMod from "@modelcontextprotocol/sdk/server/index.js";
import * as mcpStdioMod from "@modelcontextprotocol/sdk/server/stdio.js";
import * as mcpTypesMod from "@modelcontextprotocol/sdk/types.js";
import * as envMod from "../../../src/lib/env.js";
import * as serviceFactoryMod from "../../../src/lib/service-factory.js";

// ---------------------------------------------------------------------------
// Mock the MCP SDK so no real server is instantiated
// ---------------------------------------------------------------------------

const capturedHandlers: Record<string, (...args: any[]) => any> = {};
let mockListToolsSchema: object;
let mockCallToolSchema: object;

mock.module("@modelcontextprotocol/sdk/server/index.js", () => {
	class MockServer {
		setRequestHandler(schema: object, handler: (...args: any[]) => any) {
			// Capture by schema reference identity
			if (schema === mockListToolsSchema) {
				capturedHandlers.ListTools = handler;
			} else if (schema === mockCallToolSchema) {
				capturedHandlers.CallTool = handler;
			}
		}
		connect() {
			return Promise.resolve();
		}
	}
	return { ...mcpServerMod, Server: MockServer };
});

mock.module("@modelcontextprotocol/sdk/server/stdio.js", () => ({
	...mcpStdioMod,
	StdioServerTransport: class {},
}));

mock.module("@modelcontextprotocol/sdk/types.js", () => {
	mockListToolsSchema = { _tag: "ListToolsRequestSchema" };
	mockCallToolSchema = { _tag: "CallToolRequestSchema" };
	return {
		...mcpTypesMod,
		ListToolsRequestSchema: mockListToolsSchema,
		CallToolRequestSchema: mockCallToolSchema,
	};
});

// ---------------------------------------------------------------------------
// Mock heavy dependencies — we only want to test handler logic
// ---------------------------------------------------------------------------

mock.module("../../../src/lib/service-factory.js", () => ({
	...serviceFactoryMod,
	createReportService: mock(),
}));

mock.module("../../../src/lib/env.js", () => ({
	...envMod,
	getEnv: mock().mockReturnValue(undefined),
	loadDotenv: mock().mockReturnValue({}),
}));

afterAll(() => {
	mock.restore();
});

// ---------------------------------------------------------------------------
// Load the module under test (after mocks are in place)
// ---------------------------------------------------------------------------

// Dynamic import is deferred until inside tests so mocks are registered first.
async function loadServer() {
	// Reset module registry each time to ensure fresh handler capture
	return import("../../../src/mcp/server.js");
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeMinimalRenderInput() {
	return {
		schemaVersion: 1,
		orgSlug: "test-org",
		generatedAt: "2026-01-01T00:00:00Z",
		filters: {
			includeBots: false,
			excludePrivate: false,
			includeArchived: false,
		},
		showDetails: false,
		window: { start: "2026-01-01", end: "2026-01-07", human: "Jan 1–7" },
		totals: {
			prs: 0,
			prsMerged: 0,
			repoCount: 1,
			contributorCount: 0,
		},
		memberMetrics: [],
		globalHighlights: [],
		metricsDefinition: "",
		archivedNote: "",
		sections: { git: true, taskTracker: false },
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MCP server", () => {
	beforeEach(async () => {
		// Clear call counts on mocked module exports without undoing mock.module() registrations
		const { createReportService } = await import(
			"../../../src/lib/service-factory.js"
		);
		const { getEnv, loadDotenv } = await import("../../../src/lib/env.js");
		(createReportService as any).mockClear();
		(getEnv as any).mockClear();
		(loadDotenv as any).mockClear();
		// Ensure handlers are captured by loading the module
		await loadServer();
	});

	describe("ListTools handler", () => {
		it("returns exactly 4 tools", async () => {
			const handler = capturedHandlers.ListTools;
			expect(handler).toBeDefined();
			const result = await handler({});
			expect(result.tools).toHaveLength(4);
		});

		it("includes teamhero_generate_report", async () => {
			const handler = capturedHandlers.ListTools;
			const result = await handler({});
			const names = result.tools.map((t: { name: string }) => t.name);
			expect(names).toContain("teamhero_generate_report");
		});

		it("includes teamhero_render_report", async () => {
			const handler = capturedHandlers.ListTools;
			const result = await handler({});
			const names = result.tools.map((t: { name: string }) => t.name);
			expect(names).toContain("teamhero_render_report");
		});

		it("includes teamhero_list_templates", async () => {
			const handler = capturedHandlers.ListTools;
			const result = await handler({});
			const names = result.tools.map((t: { name: string }) => t.name);
			expect(names).toContain("teamhero_list_templates");
		});

		it("teamhero_generate_report requires 'org' in schema", async () => {
			const handler = capturedHandlers.ListTools;
			const result = await handler({});
			const tool = result.tools.find(
				(t: { name: string }) => t.name === "teamhero_generate_report",
			);
			expect(tool?.inputSchema.required).toContain("org");
		});

		it("teamhero_render_report requires 'reportData' in schema", async () => {
			const handler = capturedHandlers.ListTools;
			const result = await handler({});
			const tool = result.tools.find(
				(t: { name: string }) => t.name === "teamhero_render_report",
			);
			expect(tool?.inputSchema.required).toContain("reportData");
		});
	});

	describe("CallTool handler — teamhero_list_templates", () => {
		it("returns JSON with at least 3 templates", async () => {
			const handler = capturedHandlers.CallTool;
			expect(handler).toBeDefined();
			const result = await handler({
				params: { name: "teamhero_list_templates", arguments: {} },
			});
			expect(result.content).toHaveLength(1);
			const templates = JSON.parse(result.content[0].text);
			expect(Array.isArray(templates)).toBe(true);
			expect(templates.length).toBeGreaterThanOrEqual(3);
		});

		it("each template has name and description", async () => {
			const handler = capturedHandlers.CallTool;
			const result = await handler({
				params: { name: "teamhero_list_templates", arguments: {} },
			});
			const templates = JSON.parse(result.content[0].text);
			for (const t of templates) {
				expect(typeof t.name).toBe("string");
				expect(typeof t.description).toBe("string");
			}
		});

		it("includes 'detailed', 'executive', and 'individual' templates", async () => {
			const handler = capturedHandlers.CallTool;
			const result = await handler({
				params: { name: "teamhero_list_templates", arguments: {} },
			});
			const templates = JSON.parse(result.content[0].text);
			const names = templates.map((t: { name: string }) => t.name);
			expect(names).toContain("detailed");
			expect(names).toContain("executive");
			expect(names).toContain("individual");
		});
	});

	describe("CallTool handler — teamhero_render_report", () => {
		it("renders markdown using the 'detailed' template by default", async () => {
			const handler = capturedHandlers.CallTool;
			const result = await handler({
				params: {
					name: "teamhero_render_report",
					arguments: { reportData: makeMinimalRenderInput() },
				},
			});
			expect(result.content).toHaveLength(1);
			expect(result.content[0].type).toBe("text");
			expect(typeof result.content[0].text).toBe("string");
			expect(result.content[0].text.length).toBeGreaterThan(0);
		});

		it("renders with the 'executive' template when specified", async () => {
			const handler = capturedHandlers.CallTool;
			const result = await handler({
				params: {
					name: "teamhero_render_report",
					arguments: {
						reportData: makeMinimalRenderInput(),
						template: "executive",
					},
				},
			});
			expect(result.content[0].type).toBe("text");
			expect(typeof result.content[0].text).toBe("string");
		});

		it("throws when an unknown template is specified", async () => {
			const handler = capturedHandlers.CallTool;
			await expect(
				handler({
					params: {
						name: "teamhero_render_report",
						arguments: {
							reportData: makeMinimalRenderInput(),
							template: "nonexistent-template",
						},
					},
				}),
			).rejects.toThrow(/nonexistent-template/);
		});

		it("throws when reportData is missing", async () => {
			const handler = capturedHandlers.CallTool;
			await expect(
				handler({
					params: {
						name: "teamhero_render_report",
						arguments: {},
					},
				}),
			).rejects.toThrow(/reportData/);
		});
	});

	describe("CallTool handler — unknown tool", () => {
		it("throws for an unrecognized tool name", async () => {
			const handler = capturedHandlers.CallTool;
			await expect(
				handler({
					params: {
						name: "teamhero_nonexistent",
						arguments: {},
					},
				}),
			).rejects.toThrow(/Unknown tool: teamhero_nonexistent/);
		});
	});
});
