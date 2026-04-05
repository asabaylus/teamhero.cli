import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { consola } from "consola";
import { getEnv, writeEnvFile } from "../lib/env.js";
import { configDir } from "../lib/paths.js";
import { createDefaultRegistry } from "../lib/renderer-registry.js";
import type { ReportRenderInput } from "../lib/report-renderer.js";
import { createReportService } from "../lib/service-factory.js";

const server = new Server(
	{ name: "teamhero", version: "0.1.0" },
	{ capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: [
		{
			name: "teamhero_generate_report",
			description:
				"Generate a team engineering report. Returns markdown and JSON data.",
			inputSchema: {
				type: "object" as const,
				properties: {
					org: {
						type: "string",
						description: "GitHub organization slug",
					},
					since: {
						type: "string",
						description: "Start date (YYYY-MM-DD)",
					},
					until: {
						type: "string",
						description: "End date (YYYY-MM-DD)",
					},
					template: {
						type: "string",
						description: "Report template: detailed, executive, individual",
						default: "detailed",
					},
					members: {
						type: "array",
						items: { type: "string" },
						description: "Filter to specific member logins",
					},
					repos: {
						type: "array",
						items: { type: "string" },
						description: "Filter to specific repository names",
					},
				},
				required: ["org"],
			},
		},
		{
			name: "teamhero_render_report",
			description:
				"Re-render existing report data with a different template. Pure function, instant.",
			inputSchema: {
				type: "object" as const,
				properties: {
					reportData: {
						type: "object",
						description:
							"ReportRenderInput JSON blob from a previous report run",
					},
					template: {
						type: "string",
						description: "Template name: detailed, executive, individual",
						default: "detailed",
					},
				},
				required: ["reportData"],
			},
		},
		{
			name: "teamhero_list_templates",
			description: "List available report templates.",
			inputSchema: {
				type: "object" as const,
				properties: {},
			},
		},
		{
			name: "teamhero_setup",
			description:
				"Configure TeamHero credentials and settings. Validates credentials against their APIs before saving. Returns validation results for each credential.",
			inputSchema: {
				type: "object" as const,
				properties: {
					credentials: {
						type: "object",
						description: "API credentials to configure",
						properties: {
							github_token: {
								type: "string",
								description:
									"GitHub Personal Access Token or OAuth token",
							},
							openai_api_key: {
								type: "string",
								description: "OpenAI API key",
							},
							asana_api_token: {
								type: "string",
								description:
									"Asana Personal Access Token (optional)",
							},
						},
					},
					settings: {
						type: "object",
						description:
							"Additional .env settings (e.g., AI_MODEL, TEAMHERO_LOG_LEVEL)",
						additionalProperties: { type: "string" },
					},
					config: {
						type: "object",
						description:
							"Report configuration written to config.json",
						properties: {
							org: {
								type: "string",
								description: "GitHub organization slug",
							},
							members: {
								type: "array",
								items: { type: "string" },
								description: "GitHub usernames to include",
							},
							repos: {
								type: "array",
								items: { type: "string" },
								description: "Repository names to include",
							},
							useAllRepos: {
								type: "boolean",
								description:
									"Use all org repos (default: true)",
							},
						},
					},
					validate: {
						type: "boolean",
						description:
							"Validate credentials against APIs (default: true)",
					},
				},
			},
		},
	],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name, arguments: args } = request.params;

	switch (name) {
		case "teamhero_generate_report": {
			if (!args || typeof args.org !== "string") {
				throw new Error('Missing required argument: "org"');
			}
			const service = await createReportService();
			const result = await service.generateReport({
				org: args.org as string,
				since: args.since as string | undefined,
				until: args.until as string | undefined,
				template: (args.template as string | undefined) ?? "detailed",
				members: args.members as string[] | undefined,
				repos: args.repos as string[] | undefined,
				includeBots: false,
				excludePrivate: false,
				includeArchived: false,
				detailed: false,
				sections: {
					dataSources: {
						git: true,
						asana: !!getEnv("ASANA_API_TOKEN"),
					},
					reportSections: {
						visibleWins: true,
						individualContributions: true,
						discrepancyLog: false,
						loc: true,
					},
				},
				mode: "headless",
				outputFormat: "both",
			});
			return {
				content: [
					{
						type: "text" as const,
						text: `Report generated: ${result.outputPath}`,
					},
					{
						type: "text" as const,
						text: JSON.stringify(result.reportData, null, 2),
					},
				],
			};
		}

		case "teamhero_render_report": {
			if (
				!args ||
				typeof args.reportData !== "object" ||
				args.reportData === null
			) {
				throw new Error('Missing required argument: "reportData"');
			}
			const registry = createDefaultRegistry();
			const template = (args.template as string | undefined) ?? "detailed";
			const renderer = registry.getOrThrow(template);
			const markdown = renderer.render(args.reportData as ReportRenderInput);
			return {
				content: [{ type: "text" as const, text: markdown }],
			};
		}

		case "teamhero_list_templates": {
			const registry = createDefaultRegistry();
			const templates = registry.list().map((r) => ({
				name: r.name,
				description: r.description,
			}));
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(templates, null, 2),
					},
				],
			};
		}

		case "teamhero_setup": {
			const result = await handleSetup(args ?? {});
			return result;
		}

		default:
			throw new Error(`Unknown tool: ${name}`);
	}
});

// ---------------------------------------------------------------------------
// Credential validation helpers
// ---------------------------------------------------------------------------

interface ValidationResult {
	status: string;
	detail?: string;
}

async function validateGitHubCredential(
	token: string,
): Promise<ValidationResult> {
	try {
		const res = await fetch("https://api.github.com/user", {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"User-Agent": "teamhero-mcp",
			},
		});
		if (!res.ok) return { status: "invalid", detail: `HTTP ${res.status}` };
		const user = (await res.json()) as { login: string };
		return { status: "valid", detail: `Connected as @${user.login}` };
	} catch (e) {
		return { status: "invalid", detail: String(e) };
	}
}

async function validateOpenAICredential(
	apiKey: string,
): Promise<ValidationResult> {
	try {
		const res = await fetch("https://api.openai.com/v1/models", {
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
		});
		if (res.status === 401)
			return { status: "invalid", detail: "HTTP 401 Unauthorized" };
		if (!res.ok) return { status: "invalid", detail: `HTTP ${res.status}` };
		return { status: "valid" };
	} catch (e) {
		return { status: "invalid", detail: String(e) };
	}
}

async function validateAsanaCredential(
	token: string,
): Promise<ValidationResult> {
	try {
		const res = await fetch("https://app.asana.com/api/1.0/users/me", {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/json",
			},
		});
		if (!res.ok) return { status: "invalid", detail: `HTTP ${res.status}` };
		const data = (await res.json()) as { data: { name: string } };
		return { status: "valid", detail: `Connected as ${data.data.name}` };
	} catch (e) {
		return { status: "invalid", detail: String(e) };
	}
}

// ---------------------------------------------------------------------------
// Setup handler
// ---------------------------------------------------------------------------

const CREDENTIAL_KEY_MAP: Record<string, string> = {
	github_token: "GITHUB_PERSONAL_ACCESS_TOKEN",
	openai_api_key: "OPENAI_API_KEY",
	asana_api_token: "ASANA_API_TOKEN",
};

const CREDENTIAL_VALIDATORS: Record<
	string,
	(value: string) => Promise<ValidationResult>
> = {
	github_token: validateGitHubCredential,
	openai_api_key: validateOpenAICredential,
	asana_api_token: validateAsanaCredential,
};

async function handleSetup(args: Record<string, unknown>) {
	const credentials = (args.credentials as Record<string, string>) ?? {};
	const settings = (args.settings as Record<string, string>) ?? {};
	const config = args.config as Record<string, unknown> | undefined;
	const shouldValidate = args.validate !== false;

	// Build env updates map
	const envUpdates: Record<string, string> = {};

	// Map credential keys to env var names
	for (const [inputKey, envKey] of Object.entries(CREDENTIAL_KEY_MAP)) {
		if (inputKey in credentials && credentials[inputKey]) {
			envUpdates[envKey] = credentials[inputKey];
		}
	}

	// Add extra settings
	for (const [key, value] of Object.entries(settings)) {
		if (value) {
			envUpdates[key] = value;
		}
	}

	// Validate credentials if requested
	const credentialResults: Array<{
		key: string;
		status: string;
		detail?: string;
	}> = [];

	for (const [inputKey, envKey] of Object.entries(CREDENTIAL_KEY_MAP)) {
		if (!(inputKey in credentials) || !credentials[inputKey]) {
			credentialResults.push({ key: envKey, status: "skipped" });
			continue;
		}

		if (shouldValidate && CREDENTIAL_VALIDATORS[inputKey]) {
			consola.debug(`[mcp-setup] Validating ${envKey}...`);
			const result = await CREDENTIAL_VALIDATORS[inputKey](
				credentials[inputKey],
			);
			credentialResults.push({
				key: envKey,
				status: result.status,
				detail: result.detail,
			});
		} else {
			credentialResults.push({ key: envKey, status: "saved" });
		}
	}

	// Check for invalid credentials — still write but warn
	const invalidCreds = credentialResults.filter(
		(r) => r.status === "invalid",
	);
	if (invalidCreds.length > 0) {
		consola.warn(
			`[mcp-setup] Some credentials failed validation: ${invalidCreds.map((c) => c.key).join(", ")}`,
		);
	}

	// Write .env file
	if (Object.keys(envUpdates).length > 0) {
		writeEnvFile(envUpdates);
		consola.debug(
			`[mcp-setup] Wrote ${Object.keys(envUpdates).length} env var(s)`,
		);
	}

	// Write config.json if provided
	let configSaved = false;
	if (config) {
		const dir = configDir();
		mkdirSync(dir, { recursive: true });
		const configPath = join(dir, "config.json");

		// Merge with existing config if present
		let existingConfig: Record<string, unknown> = {};
		try {
			existingConfig = JSON.parse(
				readFileSync(configPath, "utf8"),
			) as Record<string, unknown>;
		} catch {
			// No existing config
		}

		const merged = { ...existingConfig, ...config };
		writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n", {
			mode: 0o600,
		});
		configSaved = true;
		consola.debug(`[mcp-setup] Wrote config.json`);
	}

	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({
					success: invalidCreds.length === 0,
					credentials: credentialResults,
					settingsWritten: Object.keys(settings).length,
					configSaved,
				}),
			},
		],
	};
}

export async function startServer(): Promise<void> {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}
