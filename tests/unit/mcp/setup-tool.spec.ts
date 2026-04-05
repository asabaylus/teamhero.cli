/**
 * Tests for the teamhero_setup MCP tool.
 *
 * Strategy: Mirror the server.spec.ts mock pattern — capture the handler
 * callbacks from the Server class, then test the setup handler directly.
 * We mock fetch for credential validation and writeEnvFile/configDir for writes.
 */
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as mcpServerMod from "@modelcontextprotocol/sdk/server/index.js";
import * as mcpStdioMod from "@modelcontextprotocol/sdk/server/stdio.js";
import * as mcpTypesMod from "@modelcontextprotocol/sdk/types.js";
import * as envMod from "../../../src/lib/env.js";
import * as pathsMod from "../../../src/lib/paths.js";
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
// Mock heavy dependencies
// ---------------------------------------------------------------------------

mock.module("../../../src/lib/service-factory.js", () => ({
	...serviceFactoryMod,
	createReportService: mock(),
}));

const mockWriteEnvFile = mock();
mock.module("../../../src/lib/env.js", () => ({
	...envMod,
	getEnv: mock().mockReturnValue(undefined),
	loadDotenv: mock().mockReturnValue({}),
	writeEnvFile: (...args: any[]) => mockWriteEnvFile(...args),
}));

const mockConfigDir = mock();
mock.module("../../../src/lib/paths.js", () => ({
	...pathsMod,
	configDir: () => mockConfigDir(),
}));

afterAll(() => {
	mock.restore();
});

// ---------------------------------------------------------------------------
// Load the module under test (after mocks are in place)
// ---------------------------------------------------------------------------

async function loadServer() {
	return import("../../../src/mcp/server.js");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let tempDir: string;
let fetchSpy: ReturnType<typeof spyOn>;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "teamhero-setup-test-"));
	mockConfigDir.mockReturnValue(tempDir);
	mockWriteEnvFile.mockClear();
	// Ensure handlers are captured
	await loadServer();
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
	mockConfigDir.mockClear();
	if (fetchSpy) {
		fetchSpy.mockRestore();
	}
});

describe("teamhero_setup tool", () => {
	describe("ListTools", () => {
		it("includes teamhero_setup in the tool list", async () => {
			const handler = capturedHandlers.ListTools;
			expect(handler).toBeDefined();
			const result = await handler({});
			const names = result.tools.map((t: { name: string }) => t.name);
			expect(names).toContain("teamhero_setup");
		});

		it("teamhero_setup has credentials, settings, config, and validate properties", async () => {
			const handler = capturedHandlers.ListTools;
			const result = await handler({});
			const tool = result.tools.find(
				(t: { name: string }) => t.name === "teamhero_setup",
			);
			expect(tool).toBeDefined();
			const props = tool.inputSchema.properties;
			expect(props.credentials).toBeDefined();
			expect(props.settings).toBeDefined();
			expect(props.config).toBeDefined();
			expect(props.validate).toBeDefined();
		});
	});

	describe("CallTool — credentials with validation disabled", () => {
		it("saves credentials without validation when validate=false", async () => {
			const handler = capturedHandlers.CallTool;
			const result = await handler({
				params: {
					name: "teamhero_setup",
					arguments: {
						credentials: {
							github_token: "ghp_test123",
							openai_api_key: "sk-test456",
						},
						validate: false,
					},
				},
			});

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.success).toBe(true);
			expect(parsed.credentials).toHaveLength(3);

			const ghCred = parsed.credentials.find(
				(c: any) => c.key === "GITHUB_PERSONAL_ACCESS_TOKEN",
			);
			expect(ghCred.status).toBe("saved");

			const oaiCred = parsed.credentials.find(
				(c: any) => c.key === "OPENAI_API_KEY",
			);
			expect(oaiCred.status).toBe("saved");

			const asanaCred = parsed.credentials.find(
				(c: any) => c.key === "ASANA_API_TOKEN",
			);
			expect(asanaCred.status).toBe("skipped");

			// writeEnvFile should have been called with mapped keys
			expect(mockWriteEnvFile).toHaveBeenCalledTimes(1);
			const envArg = mockWriteEnvFile.mock.calls[0][0];
			expect(envArg.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("ghp_test123");
			expect(envArg.OPENAI_API_KEY).toBe("sk-test456");
		});
	});

	describe("CallTool — credential validation with mocked fetch", () => {
		it("validates GitHub token successfully", async () => {
			fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
				async (input: any) => {
					const url =
						typeof input === "string" ? input : input.toString();
					if (url.includes("api.github.com/user")) {
						return new Response(
							JSON.stringify({ login: "testuser" }),
							{ status: 200 },
						);
					}
					return new Response("Not Found", { status: 404 });
				},
			);

			const handler = capturedHandlers.CallTool;
			const result = await handler({
				params: {
					name: "teamhero_setup",
					arguments: {
						credentials: { github_token: "ghp_valid" },
						validate: true,
					},
				},
			});

			const parsed = JSON.parse(result.content[0].text);
			const ghCred = parsed.credentials.find(
				(c: any) => c.key === "GITHUB_PERSONAL_ACCESS_TOKEN",
			);
			expect(ghCred.status).toBe("valid");
			expect(ghCred.detail).toBe("Connected as @testuser");
		});

		it("detects invalid GitHub token", async () => {
			fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
				async () => {
					return new Response("Unauthorized", { status: 401 });
				},
			);

			const handler = capturedHandlers.CallTool;
			const result = await handler({
				params: {
					name: "teamhero_setup",
					arguments: {
						credentials: { github_token: "ghp_bad" },
						validate: true,
					},
				},
			});

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.success).toBe(false);
			const ghCred = parsed.credentials.find(
				(c: any) => c.key === "GITHUB_PERSONAL_ACCESS_TOKEN",
			);
			expect(ghCred.status).toBe("invalid");
			expect(ghCred.detail).toContain("401");
		});

		it("validates OpenAI key successfully", async () => {
			fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
				async (input: any) => {
					const url =
						typeof input === "string" ? input : input.toString();
					if (url.includes("api.openai.com")) {
						return new Response(
							JSON.stringify({ data: [{ id: "gpt-4" }] }),
							{ status: 200 },
						);
					}
					return new Response("Not Found", { status: 404 });
				},
			);

			const handler = capturedHandlers.CallTool;
			const result = await handler({
				params: {
					name: "teamhero_setup",
					arguments: {
						credentials: { openai_api_key: "sk-valid" },
						validate: true,
					},
				},
			});

			const parsed = JSON.parse(result.content[0].text);
			const oaiCred = parsed.credentials.find(
				(c: any) => c.key === "OPENAI_API_KEY",
			);
			expect(oaiCred.status).toBe("valid");
		});

		it("validates Asana token successfully", async () => {
			fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
				async (input: any) => {
					const url =
						typeof input === "string" ? input : input.toString();
					if (url.includes("asana.com")) {
						return new Response(
							JSON.stringify({
								data: { name: "Test User" },
							}),
							{ status: 200 },
						);
					}
					return new Response("Not Found", { status: 404 });
				},
			);

			const handler = capturedHandlers.CallTool;
			const result = await handler({
				params: {
					name: "teamhero_setup",
					arguments: {
						credentials: { asana_api_token: "asana-valid" },
						validate: true,
					},
				},
			});

			const parsed = JSON.parse(result.content[0].text);
			const asanaCred = parsed.credentials.find(
				(c: any) => c.key === "ASANA_API_TOKEN",
			);
			expect(asanaCred.status).toBe("valid");
			expect(asanaCred.detail).toBe("Connected as Test User");
		});

		it("handles fetch errors gracefully", async () => {
			fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
				async () => {
					throw new Error("Network error");
				},
			);

			const handler = capturedHandlers.CallTool;
			const result = await handler({
				params: {
					name: "teamhero_setup",
					arguments: {
						credentials: { github_token: "ghp_unreachable" },
						validate: true,
					},
				},
			});

			const parsed = JSON.parse(result.content[0].text);
			const ghCred = parsed.credentials.find(
				(c: any) => c.key === "GITHUB_PERSONAL_ACCESS_TOKEN",
			);
			expect(ghCred.status).toBe("invalid");
			expect(ghCred.detail).toContain("Network error");
		});
	});

	describe("CallTool — settings", () => {
		it("passes extra settings to writeEnvFile", async () => {
			const handler = capturedHandlers.CallTool;
			await handler({
				params: {
					name: "teamhero_setup",
					arguments: {
						settings: {
							AI_MODEL: "gpt-4o",
							TEAMHERO_LOG_LEVEL: "debug",
						},
						validate: false,
					},
				},
			});

			expect(mockWriteEnvFile).toHaveBeenCalledTimes(1);
			const envArg = mockWriteEnvFile.mock.calls[0][0];
			expect(envArg.AI_MODEL).toBe("gpt-4o");
			expect(envArg.TEAMHERO_LOG_LEVEL).toBe("debug");
		});

		it("reports settingsWritten count", async () => {
			const handler = capturedHandlers.CallTool;
			const result = await handler({
				params: {
					name: "teamhero_setup",
					arguments: {
						settings: { AI_MODEL: "gpt-4o", LOG: "info" },
						validate: false,
					},
				},
			});

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.settingsWritten).toBe(2);
		});
	});

	describe("CallTool — config.json", () => {
		it("writes config.json when config is provided", async () => {
			const handler = capturedHandlers.CallTool;
			const result = await handler({
				params: {
					name: "teamhero_setup",
					arguments: {
						config: {
							org: "my-org",
							members: ["alice", "bob"],
							repos: ["repo1"],
							useAllRepos: false,
						},
						validate: false,
					},
				},
			});

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.configSaved).toBe(true);

			const configContent = await readFile(
				join(tempDir, "config.json"),
				"utf8",
			);
			const config = JSON.parse(configContent);
			expect(config.org).toBe("my-org");
			expect(config.members).toEqual(["alice", "bob"]);
			expect(config.repos).toEqual(["repo1"]);
			expect(config.useAllRepos).toBe(false);
		});

		it("merges with existing config.json", async () => {
			// Write an existing config
			const { writeFileSync, mkdirSync } = await import("node:fs");
			mkdirSync(tempDir, { recursive: true });
			writeFileSync(
				join(tempDir, "config.json"),
				JSON.stringify({ org: "old-org", extra: "keep" }),
			);

			const handler = capturedHandlers.CallTool;
			await handler({
				params: {
					name: "teamhero_setup",
					arguments: {
						config: { org: "new-org" },
						validate: false,
					},
				},
			});

			const configContent = await readFile(
				join(tempDir, "config.json"),
				"utf8",
			);
			const config = JSON.parse(configContent);
			expect(config.org).toBe("new-org");
			expect(config.extra).toBe("keep");
		});

		it("reports configSaved=false when no config is provided", async () => {
			const handler = capturedHandlers.CallTool;
			const result = await handler({
				params: {
					name: "teamhero_setup",
					arguments: {
						credentials: { github_token: "ghp_test" },
						validate: false,
					},
				},
			});

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.configSaved).toBe(false);
		});
	});

	describe("CallTool — empty/no args", () => {
		it("handles empty arguments gracefully", async () => {
			const handler = capturedHandlers.CallTool;
			const result = await handler({
				params: {
					name: "teamhero_setup",
					arguments: {},
				},
			});

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.success).toBe(true);
			expect(parsed.credentials).toHaveLength(3);
			// All should be skipped
			for (const cred of parsed.credentials) {
				expect(cred.status).toBe("skipped");
			}
			expect(parsed.settingsWritten).toBe(0);
			expect(parsed.configSaved).toBe(false);
			// writeEnvFile should NOT be called since there are no updates
			expect(mockWriteEnvFile).not.toHaveBeenCalled();
		});
	});
});
