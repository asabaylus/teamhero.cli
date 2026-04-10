import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type ConsolaInstance, consola } from "consola";
import OpenAI from "openai";
import type {
	SectionAuditContext,
	SectionDiscrepancy,
	TechnicalFoundationalWinsResult,
} from "../core/types.js";
import { getEnv } from "../lib/env.js";
import { cacheDir } from "../lib/paths.js";
import {
	type ReportMemberMetrics,
	renderReport,
} from "../lib/report-renderer.js";
import type { ContributorSummaryPayload } from "../models/individual-summary.js";
import type { ProjectAccomplishment } from "../models/visible-wins.js";
import {
	buildDiscrepancyAnalysisPrompt,
	buildIndividualSummariesPrompt,
	buildMemberHighlightsPrompt,
	buildRoadmapSynthesisPrompt,
	buildTechnicalWinsPrompt,
	buildTeamPrompt,
	buildVisibleWinsExtractionPrompt,
	DISCREPANCY_ANALYSIS_SCHEMA,
	type FinalReportContext,
	type IndividualSummariesContext,
	type MemberHighlightContext,
	type MemberHighlightsContext,
	ROADMAP_SYNTHESIS_SCHEMA,
	TECHNICAL_WINS_SCHEMA,
	type RoadmapSynthesisContext,
	type TeamHighlightContext,
	type TechnicalWinsContext,
	VISIBLE_WINS_SCHEMA,
	type VisibleWinsExtractionContext,
} from "./ai-prompts.js";
import type { SummarizerDriverResult } from "./individual-summarizer.service.js";

const AI_BATCH_LOG_PATH = join(cacheDir(), "logs", "ai-batches.log");

interface RateLimitInfo {
	requests?: {
		limit?: number;
		remaining?: number;
		reset?: number;
	};
	tokens?: {
		limit?: number;
		remaining?: number;
		reset?: number;
	};
}

async function appendBatchLog(message: string): Promise<void> {
	await mkdir(dirname(AI_BATCH_LOG_PATH), { recursive: true });
	await appendFile(AI_BATCH_LOG_PATH, message, "utf8");
}

export interface AIServiceConfig {
	model?: string;
	teamHighlightModel?: string;
	memberHighlightsModel?: string;
	individualSummariesModel?: string;
	visibleWinsModel?: string;
	technicalWinsModel?: string;
	discrepancyAnalysisModel?: string;
	apiKey?: string;
	baseUrl?: string;
	logger?: ConsolaInstance;
	project?: string;
	// When true, emit verbose debug logs in addition to progress updates
	// Defaults to disabled; enable via TEAMHERO_AI_DEBUG=1 for troubleshooting
	verbose?: boolean;
	// Enable flex processing for lower costs (slower responses)
	enableFlexProcessing?: boolean;
	// Request timeout for flex processing (default: 15 minutes)
	flexTimeoutMs?: number;
	// Retry configuration for transient 5xx failures
	maxRetries?: number; // default: 2
	baseRetryDelayMs?: number; // default: 500ms
	// Per-request timeout for discrepancy analysis (default: 2 minutes)
	discrepancyTimeoutMs?: number;
}

export class AIService {
	private readonly model: string;
	private readonly teamHighlightModel: string;
	private readonly memberHighlightsModel: string;
	private readonly individualSummariesModel: string;
	private readonly visibleWinsModel: string;
	private readonly technicalWinsModel: string;
	private readonly discrepancyAnalysisModel: string;
	private readonly apiKey?: string;
	private readonly baseUrl?: string;
	private readonly logger: ConsolaInstance;
	private readonly emitDebugLogs: boolean;
	private readonly project?: string;
	private readonly enableFlexProcessing: boolean;
	private readonly flexTimeoutMs: number;
	private readonly maxRetries: number;
	private readonly baseRetryDelayMs: number;
	private readonly discrepancyTimeoutMs: number;
	private loggedEnabledNotice = false;
	private loggedClientReady = false;
	// Policy: Do NOT implement silent fallbacks for AI-generated content.
	// Any missing or malformed AI response must surface as an explicit error
	// unless the repository owner explicitly authorizes a fallback strategy.

	constructor(config: AIServiceConfig = {}) {
		const defaultModel = config.model ?? getEnv("AI_MODEL") ?? "gpt-5-mini";
		this.model = defaultModel;
		this.teamHighlightModel =
			config.teamHighlightModel ??
			getEnv("AI_TEAM_HIGHLIGHT_MODEL") ??
			defaultModel;
		this.memberHighlightsModel =
			config.memberHighlightsModel ??
			getEnv("AI_MEMBER_HIGHLIGHTS_MODEL") ??
			defaultModel;
		const summarizerDefault = "gpt-5-nano";
		this.individualSummariesModel =
			config.individualSummariesModel ??
			getEnv("AI_INDIVIDUAL_SUMMARIES_MODEL") ??
			getEnv("AI_SUMMARIZER_MODEL") ??
			summarizerDefault;
		this.visibleWinsModel =
			config.visibleWinsModel ??
			getEnv("VISIBLE_WINS_AI_MODEL") ??
			defaultModel;
		this.technicalWinsModel =
			config.technicalWinsModel ??
			getEnv("AI_TECHNICAL_WINS_MODEL") ??
			defaultModel;
		this.discrepancyAnalysisModel =
			config.discrepancyAnalysisModel ??
			getEnv("AI_DISCREPANCY_ANALYSIS_MODEL") ??
			defaultModel;
		this.apiKey =
			config.apiKey ?? getEnv("OPENAI_API_KEY") ?? getEnv("AI_API_KEY");
		this.baseUrl = config.baseUrl ?? getEnv("AI_API_BASE_URL");
		this.logger = config.logger ?? consola.withTag("teamhero:ai");
		this.emitDebugLogs =
			config.verbose ??
			["1", "true", "on", "yes"].includes(
				(getEnv("TEAMHERO_AI_DEBUG") ?? "").toLowerCase(),
			);
		this.project =
			config.project ?? getEnv("OPENAI_PROJECT") ?? getEnv("AI_PROJECT");
		this.enableFlexProcessing =
			config.enableFlexProcessing ?? getEnv("OPENAI_SERVICE_TIER") === "flex";
		this.flexTimeoutMs =
			config.flexTimeoutMs ??
			Number.parseInt(getEnv("OPENAI_FLEX_TIMEOUT") ?? "900000", 10); // 15 minutes default
		this.maxRetries =
			config.maxRetries ??
			Number.parseInt(getEnv("TEAMHERO_AI_MAX_RETRIES") ?? "2", 10);
		this.baseRetryDelayMs =
			config.baseRetryDelayMs ??
			Number.parseInt(getEnv("TEAMHERO_AI_RETRY_DELAY_MS") ?? "500", 10);
		this.discrepancyTimeoutMs =
			config.discrepancyTimeoutMs ??
			Number.parseInt(
				getEnv("TEAMHERO_AI_DISCREPANCY_TIMEOUT") ?? "120000",
				10,
			);
	}

	private get enabled(): boolean {
		return Boolean(this.apiKey);
	}

	private createClient() {
		if (!this.enabled) {
			throw new Error("AI client requested but API key not configured");
		}
		const client = new OpenAI({
			apiKey: this.apiKey!,
			baseURL: this.baseUrl,
			defaultHeaders: this.project
				? { "OpenAI-Project": this.project }
				: undefined,
			timeout: this.enableFlexProcessing ? this.flexTimeoutMs : undefined,
		});
		if (this.emitDebugLogs && !this.loggedClientReady) {
			this.loggedClientReady = true;
			this.logger.debug(
				`AI client ready (defaultModel=${this.model}, baseUrl=${this.baseUrl ?? "https://api.openai.com"}, flexProcessing=${this.enableFlexProcessing})`,
			);
		}
		return client;
	}

	private rethrowAsConnectionOrAuthError(
		source: string,
		error: unknown,
	): never {
		const asError = error instanceof Error ? error : new Error(String(error));
		const message = asError.message?.toLowerCase() ?? "";
		const anyErr = asError as any;
		const status: number | undefined =
			anyErr?.status ?? anyErr?.response?.status;

		const isAuth =
			status === 401 ||
			status === 403 ||
			message.includes("invalid api key") ||
			message.includes("unauthorized") ||
			message.includes("forbidden");
		if (isAuth) {
			throw new Error(
				`${source}: invalid API key. Set OPENAI_API_KEY (or AI_API_KEY) and try again.`,
			);
		}

		const isNetwork =
			status === 502 ||
			status === 503 ||
			status === 504 ||
			message.includes("fetch failed") ||
			message.includes("network") ||
			message.includes("etimedout") ||
			message.includes("econnrefused") ||
			message.includes("enotfound");

		if (isNetwork) {
			throw new Error(
				`${source}: could not connect to AI service. Check network or AI_API_BASE_URL.`,
			);
		}

		// Handle 429 rate limit errors with detailed information
		if (status === 429) {
			const rateLimitInfo = this.extractRateLimitInfo(anyErr);
			const errorType = anyErr?.error?.type || anyErr?.type || "unknown";
			const errorCode = anyErr?.error?.code || anyErr?.code || "unknown";

			let detailedMessage = `${source}: ${asError.message || "Rate limit exceeded"}`;

			// Add error type information
			detailedMessage += "\n\n📋 Error Details:";
			detailedMessage += `\n   Type: ${errorType}`;
			detailedMessage += `\n   Code: ${errorCode}`;

			// Add rate limit information if available
			if (rateLimitInfo) {
				detailedMessage += `\n\n${this.formatRateLimitMessage(rateLimitInfo)}`;
			} else {
				detailedMessage += `\n\n${this.formatRateLimitMessage(null)}`;
			}

			throw new Error(detailedMessage);
		}

		throw new Error(`${source}: ${asError.message || "AI request failed"}`);
	}

	private extractRateLimitInfo(error: any): RateLimitInfo | null {
		try {
			// Debug: Log the error structure to understand what we're working with
			if (this.emitDebugLogs) {
				this.logger.debug(
					`Rate limit error structure: ${JSON.stringify(
						{
							hasResponse: !!error?.response,
							hasHeaders: !!error?.headers,
							status: error?.status || error?.response?.status,
							message: error?.message,
							errorType: error?.error?.type,
							errorCode: error?.code,
						},
						null,
						2,
					)}`,
				);
			}

			// OpenAI errors have headers directly on the error object, not under response
			const headers = error?.headers || error?.response?.headers;
			if (!headers) {
				if (this.emitDebugLogs) {
					this.logger.debug("No headers found in error object");
				}
				return null;
			}

			// Debug: Log all headers to see what's available
			if (this.emitDebugLogs) {
				this.logger.debug(
					`Available headers: ${JSON.stringify(headers, null, 2)}`,
				);
			}

			const rateLimitInfo: RateLimitInfo = {};

			// Extract request-based rate limits (handle both lowercase and case variations)
			const requestLimit =
				headers["x-ratelimit-limit-requests"] ||
				headers["X-RateLimit-Limit-Requests"];
			const requestRemaining =
				headers["x-ratelimit-remaining-requests"] ||
				headers["X-RateLimit-Remaining-Requests"];
			const requestReset =
				headers["x-ratelimit-reset-requests"] ||
				headers["X-RateLimit-Reset-Requests"];

			if (
				requestLimit !== undefined ||
				requestRemaining !== undefined ||
				requestReset !== undefined
			) {
				rateLimitInfo.requests = {
					limit: requestLimit
						? Number.parseInt(String(requestLimit), 10)
						: undefined,
					remaining:
						requestRemaining !== undefined
							? Number.parseInt(String(requestRemaining), 10)
							: undefined,
					reset: requestReset
						? Number.parseInt(String(requestReset), 10)
						: undefined,
				};
			}

			// Extract token-based rate limits (handle both lowercase and case variations)
			const tokenLimit =
				headers["x-ratelimit-limit-tokens"] ||
				headers["X-RateLimit-Limit-Tokens"];
			const tokenRemaining =
				headers["x-ratelimit-remaining-tokens"] ||
				headers["X-RateLimit-Remaining-Tokens"];
			const tokenReset =
				headers["x-ratelimit-reset-tokens"] ||
				headers["X-RateLimit-Reset-Tokens"];

			if (
				tokenLimit !== undefined ||
				tokenRemaining !== undefined ||
				tokenReset !== undefined
			) {
				rateLimitInfo.tokens = {
					limit: tokenLimit
						? Number.parseInt(String(tokenLimit), 10)
						: undefined,
					remaining:
						tokenRemaining !== undefined
							? Number.parseInt(String(tokenRemaining), 10)
							: undefined,
					reset: tokenReset
						? Number.parseInt(String(tokenReset), 10)
						: undefined,
				};
			}

			// Debug: Log what we extracted
			if (this.emitDebugLogs) {
				this.logger.debug(
					`Extracted rate limit info: ${JSON.stringify(rateLimitInfo, null, 2)}`,
				);
			}

			return Object.keys(rateLimitInfo).length > 0 ? rateLimitInfo : null;
		} catch (parseError) {
			// If parsing fails, return null to fall back to generic error message
			if (this.emitDebugLogs) {
				this.logger.debug(`Error parsing rate limit info: ${parseError}`);
			}
			return null;
		}
	}

	private formatRateLimitMessage(info: RateLimitInfo | null): string {
		const lines: string[] = [];

		if (info?.requests) {
			const req = info.requests;
			lines.push("\n🔢 Request Limits:");
			if (req.limit !== undefined) {
				lines.push(`   Limit: ${req.limit} requests per minute`);
			}
			if (req.remaining !== undefined) {
				lines.push(`   Remaining: ${req.remaining} requests`);
			}
			if (req.reset !== undefined) {
				const resetDate = new Date(req.reset * 1000);
				const backoffSeconds = Math.ceil(
					(resetDate.getTime() - Date.now()) / 1000,
				);
				lines.push(
					`   Resets in: ${backoffSeconds} seconds (${resetDate.toLocaleTimeString()})`,
				);
			}
		}

		if (info?.tokens) {
			const tok = info.tokens;
			lines.push("\n💰 Token Limits:");
			if (tok.limit !== undefined) {
				lines.push(`   Limit: ${tok.limit.toLocaleString()} tokens per minute`);
			}
			if (tok.remaining !== undefined) {
				lines.push(`   Remaining: ${tok.remaining.toLocaleString()} tokens`);
			}
			if (tok.reset !== undefined) {
				const resetDate = new Date(tok.reset * 1000);
				const backoffSeconds = Math.ceil(
					(resetDate.getTime() - Date.now()) / 1000,
				);
				lines.push(
					`   Resets in: ${backoffSeconds} seconds (${resetDate.toLocaleTimeString()})`,
				);
			}
		}

		if (lines.length === 0) {
			lines.push("\n💡 Recommendations:");
			lines.push(
				"   • This appears to be a quota/billing limit (insufficient_quota), not rate limiting",
			);
			lines.push("   • Rate limit headers are not included with quota errors");
			lines.push(
				"   • Check your OpenAI account at https://platform.openai.com/settings/organization/billing",
			);
			lines.push(
				"   • Verify your API key has an active payment method and sufficient credits",
			);
			lines.push(
				"   • Consider upgrading your plan or adding credits to your account",
			);
			lines.push("\n🔧 Workarounds:");
			lines.push(
				"   • Skip member highlights: TEAMHERO_SKIP_MEMBER_HIGHLIGHTS=true",
			);
			lines.push(
				"   • Use flex pricing: OPENAI_SERVICE_TIER=flex (lower cost, slower responses)",
			);
		}

		return lines.join("\n");
	}

	private async makeFlexRequest(
		model: string,
		input: string,
		context: { onStatus?: (message: string) => void },
		retryCount = 0,
	): Promise<any> {
		const client = this.createClient();
		const maxRetries = this.maxRetries;

		try {
			context.onStatus?.(
				`Making ${this.enableFlexProcessing ? "flex" : "standard"} request (attempt ${retryCount + 1}/${maxRetries + 1})`,
			);

			const requestOptions: any = {
				model,
				input,
			};

			// Add flex processing if enabled (only available for certain models)
			if (this.enableFlexProcessing) {
				requestOptions.service_tier = "flex";
			}

			const response = await client.responses.create(requestOptions);
			return response;
		} catch (error: any) {
			const status = error?.status;
			const errorCode = error?.error?.code;

			// Retry on 5xx errors and specific 429 resource unavailable
			const shouldRetry5xx =
				typeof status === "number" && status >= 500 && status < 600;
			const isResourceUnavailable =
				status === 429 && errorCode === "resource_unavailable";
			if (
				(shouldRetry5xx || isResourceUnavailable) &&
				retryCount < maxRetries
			) {
				const backoffMs = Math.min(
					30_000,
					this.baseRetryDelayMs * 2 ** retryCount,
				);
				context.onStatus?.(
					`Transient error (status=${status}${errorCode ? `, code=${errorCode}` : ""}), retrying in ${backoffMs}ms...`,
				);
				await new Promise((resolve) => setTimeout(resolve, backoffMs));
				return this.makeFlexRequest(model, input, context, retryCount + 1);
			}

			// Handle timeout errors (408) with fallback to standard processing
			if (status === 408 && this.enableFlexProcessing && retryCount === 0) {
				context.onStatus?.(
					"Flex processing timed out, falling back to standard processing...",
				);
				const fallbackOptions: any = { model, input };
				const response = await client.responses.create(fallbackOptions);
				return response;
			}

			// Re-throw other errors
			throw error;
		}
	}

	async generateTeamHighlight(context: TeamHighlightContext): Promise<string> {
		if (!this.enabled) {
			throw new Error(
				"AI service is required for team highlights. Please configure OPENAI_API_KEY.",
			);
		}

		try {
			this.logEnabledNotice();
			const _client = this.createClient();
			const model = this.teamHighlightModel;
			const prompt = buildTeamPrompt(context);
			const sendMsg = `Sending team highlight request (promptLength=${prompt.length})`;
			if (this.emitDebugLogs && !context.onStatus) this.logger.debug(sendMsg);
			context.onStatus?.(sendMsg);

			// Log AI batch for team highlight
			const batchHeader = [
				`[${new Date().toISOString()}] team-highlight batch 1/1`,
				`organization=${context.organization}`,
				`promptLength=${prompt.length}`,
				`estimatedTokens=${Math.ceil(prompt.length / 3)}`,
			].join(" | ");
			await appendBatchLog(`${batchHeader}\n${prompt}\n\n`);
			const response = await this.makeFlexRequest(model, prompt, context);
			const text = (response as any)?.output_text as string | undefined;
			const finishReason =
				(response as any)?.output?.[0]?.stop_reason ??
				(response as any)?.output?.[0]?.finish_reason ??
				"unknown";
			const promptTokens =
				(response as any)?.usage?.input_tokens ??
				(response as any)?.usage?.prompt_tokens;
			const completionTokens =
				(response as any)?.usage?.output_tokens ??
				(response as any)?.usage?.completion_tokens;
			const usage =
				promptTokens != null && completionTokens != null
					? { promptTokens, completionTokens }
					: undefined;
			const recvMsg = `Received team highlight response (textLength=${text?.length ?? 0}, finishReason=${finishReason ?? "unknown"}, tokens=${usage ? `${usage.promptTokens}+${usage.completionTokens}` : "unknown"})`;
			if (this.emitDebugLogs && !context.onStatus) this.logger.debug(recvMsg);
			context.onStatus?.(recvMsg);
			const sentence = this.normalizeSentence(text);
			if (!sentence) {
				throw new Error("Empty AI response for team highlight");
			}
			return sentence;
		} catch (error) {
			this.rethrowAsConnectionOrAuthError(
				"Failed to generate team highlight",
				error,
			);
		}
	}

	async generateTechnicalWinsSection(
		context: TechnicalWinsContext,
	): Promise<TechnicalFoundationalWinsResult> {
		if (!this.enabled) {
			throw new Error(
				"AI service is required for Technical / Foundational Wins generation. Please configure OPENAI_API_KEY.",
			);
		}

		try {
			this.logEnabledNotice();
			const client = this.createClient();
			const model = this.technicalWinsModel;
			const prompt = buildTechnicalWinsPrompt(context);

			const batchHeader = [
				`[${new Date().toISOString()}] technical-wins`,
				`model=${model}`,
				`promptLength=${prompt.length}`,
				`estimatedTokens=${Math.ceil(prompt.length / 3)}`,
			].join(" | ");
			await appendBatchLog(`${batchHeader}\n${prompt}\n\n`);

			if (this.emitDebugLogs) {
				this.logger.debug(
					`Sending technical wins request (model=${model}, promptLength=${prompt.length})`,
				);
			}

			context.onStatus?.(
				"Generating Technical / Foundational Wins via AI...",
			);

			const requestOptions: Record<string, unknown> = {
				model,
				input: prompt,
				text: { format: TECHNICAL_WINS_SCHEMA },
			};

			if (this.enableFlexProcessing) {
				requestOptions.service_tier = "flex";
			}

			const response = await client.responses.create(
				requestOptions as Parameters<typeof client.responses.create>[0],
			);

			const outputText = (response as Record<string, unknown>).output_text as
				| string
				| undefined;

			if (this.emitDebugLogs) {
				const usage = (response as Record<string, unknown>).usage as
					| Record<string, number>
					| undefined;
				const inputTokens = usage?.input_tokens ?? usage?.prompt_tokens;
				const outputTokens = usage?.output_tokens ?? usage?.completion_tokens;
				this.logger.debug(
					`Received technical wins response (textLength=${outputText?.length ?? 0}, tokens=${inputTokens != null && outputTokens != null ? `${inputTokens}+${outputTokens}` : "unknown"})`,
				);
			}

			if (!outputText) {
				throw new Error(
					"Empty AI response for Technical / Foundational Wins generation",
				);
			}

			context.onStatus?.("Processing Technical / Foundational Wins response...");

			const parsed = JSON.parse(outputText) as TechnicalFoundationalWinsResult;
			return parsed;
		} catch (error) {
			this.rethrowAsConnectionOrAuthError(
				"Failed to generate Technical / Foundational Wins",
				error,
			);
		}
	}

	async generateMemberHighlight(
		context: MemberHighlightContext,
	): Promise<string> {
		const highlights = await this.generateMemberHighlights({
			members: [context.member],
			windowHuman: context.windowHuman,
			onStatus: context.onStatus,
		});
		const sentence = highlights.get(context.member.login);
		if (!sentence) {
			const details = {
				model: this.memberHighlightsModel,
				baseUrl: this.baseUrl,
				windowHuman: context.windowHuman,
				memberLogin: context.member.login,
			};
			throw new Error(
				`Empty AI response for member highlight: ${context.member.displayName}` +
					`\nDetails: ${JSON.stringify(details, null, 2)}`,
			);
		}
		return sentence;
	}

	async generateMemberHighlights(
		context: MemberHighlightsContext,
	): Promise<Map<string, string>> {
		if (!this.enabled) {
			throw new Error(
				"AI service is required for member highlights. Please configure OPENAI_API_KEY.",
			);
		}
		if (context.members.length === 0) {
			return new Map();
		}

		try {
			this.logEnabledNotice();
			const _client = this.createClient();
			const model = this.memberHighlightsModel;
			const prompt = buildMemberHighlightsPrompt(context);
			const promptLength = prompt.length;
			const sendMsg = `Sending member highlights request (count=${context.members.length}, promptLength=${promptLength})`;
			if (this.emitDebugLogs && !context.onStatus) this.logger.debug(sendMsg);
			context.onStatus?.(sendMsg);

			// Log AI batch for member highlights
			const batchHeader = [
				`[${new Date().toISOString()}] member-highlights batch 1/1`,
				`members=${context.members.map((member) => member.login).join(",")}`,
				`count=${context.members.length}`,
				`promptLength=${promptLength}`,
				`estimatedTokens=${Math.ceil(promptLength / 3)}`,
			].join(" | ");
			await appendBatchLog(`${batchHeader}\n${prompt}\n\n`);
			const response = await this.makeFlexRequest(model, prompt, context);
			const text = (response as any)?.output_text as string | undefined;
			const finishReason =
				(response as any)?.output?.[0]?.stop_reason ??
				(response as any)?.output?.[0]?.finish_reason ??
				"unknown";
			const promptTokens =
				(response as any)?.usage?.input_tokens ??
				(response as any)?.usage?.prompt_tokens;
			const completionTokens =
				(response as any)?.usage?.output_tokens ??
				(response as any)?.usage?.completion_tokens;
			const usage =
				promptTokens != null && completionTokens != null
					? { promptTokens, completionTokens }
					: undefined;
			const recvMsg = `Received member highlights response (count=${context.members.length}, textLength=${text?.length ?? 0}, finishReason=${finishReason ?? "unknown"}, tokens=${usage ? `${usage.promptTokens}+${usage.completionTokens}` : "unknown"})`;
			if (this.emitDebugLogs && !context.onStatus) this.logger.debug(recvMsg);
			context.onStatus?.(recvMsg);

			const normalized = text?.trim();
			if (!normalized) {
				const details = {
					model,
					baseUrl: this.baseUrl,
					windowHuman: context.windowHuman,
					memberCount: context.members.length,
					prompt,
				};
				throw new Error(
					`Empty AI response for member highlights batch\nDetails: ${JSON.stringify(details, null, 2)}`,
				);
			}

			// Strip markdown code blocks if present
			let jsonText = normalized;
			if (jsonText.startsWith("```json")) {
				jsonText = jsonText.replace(/^```json\s*/, "").replace(/\s*```$/, "");
			} else if (jsonText.startsWith("```")) {
				jsonText = jsonText.replace(/^```\s*/, "").replace(/\s*```$/, "");
			}

			let parsed: unknown;
			try {
				parsed = JSON.parse(jsonText);
			} catch (_error) {
				const details = {
					model,
					baseUrl: this.baseUrl,
					windowHuman: context.windowHuman,
					memberCount: context.members.length,
					prompt,
					preview: jsonText.slice(0, 240),
				};
				throw new Error(
					`Invalid AI response for member highlights batch (expected JSON object).\nDetails: ${JSON.stringify(details, null, 2)}`,
				);
			}

			if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
				const details = {
					model,
					baseUrl: this.baseUrl,
					windowHuman: context.windowHuman,
					memberCount: context.members.length,
					prompt,
					parsedType: Array.isArray(parsed) ? "array" : typeof parsed,
				};
				throw new Error(
					`Invalid AI response for member highlights batch (expected JSON object).\nDetails: ${JSON.stringify(details, null, 2)}`,
				);
			}

			const record = parsed as Record<string, unknown>;
			const results = new Map<string, string>();

			for (const member of context.members) {
				const raw = record[member.login];
				if (typeof raw !== "string") {
					const details = {
						model,
						baseUrl: this.baseUrl,
						windowHuman: context.windowHuman,
						memberLogin: member.login,
						memberDisplayName: member.displayName,
						prompt,
					};
					throw new Error(
						`Missing AI response for member highlight: ${member.displayName}` +
							`\nDetails: ${JSON.stringify(details, null, 2)}`,
					);
				}

				const sentence = this.normalizeSentence(raw);
				if (!sentence) {
					const details = {
						model,
						baseUrl: this.baseUrl,
						windowHuman: context.windowHuman,
						memberLogin: member.login,
						memberDisplayName: member.displayName,
						prompt,
						raw,
					};
					throw new Error(
						`Empty AI response for member highlight: ${member.displayName}` +
							`\nDetails: ${JSON.stringify(details, null, 2)}`,
					);
				}

				results.set(member.login, sentence);
			}

			return results;
		} catch (error) {
			this.rethrowAsConnectionOrAuthError(
				"Failed to generate member highlights",
				error,
			);
		}
	}

	async generateIndividualSummaries(
		payloads: ContributorSummaryPayload[],
	): Promise<SummarizerDriverResult[]> {
		if (!this.enabled) {
			throw new Error(
				"AI service is required for individual contributor summaries. Please configure OPENAI_API_KEY.",
			);
		}
		if (payloads.length === 0) {
			return [];
		}

		try {
			this.logEnabledNotice();
			const _client = this.createClient();
			const model = this.individualSummariesModel;
			const windowHuman = payloads[0].reportingWindow.human;
			const prompt = buildIndividualSummariesPrompt({
				payloads,
				windowHuman,
			} satisfies IndividualSummariesContext);
			const sendMsg = `Sending individual contributor summary request (count=${payloads.length}, promptLength=${prompt.length})`;
			if (this.emitDebugLogs) this.logger.debug(sendMsg);

			// Log AI batch for individual summaries
			const batchHeader = [
				`[${new Date().toISOString()}] individual-summaries batch 1/1`,
				`contributors=${payloads.map((payload) => payload.contributor.login).join(",")}`,
				`count=${payloads.length}`,
				`promptLength=${prompt.length}`,
				`estimatedTokens=${Math.ceil(prompt.length / 3)}`,
			].join(" | ");
			await appendBatchLog(`${batchHeader}\n${prompt}\n\n`);
			const response = await this.makeFlexRequest(model, prompt, {});
			const text = (response as any)?.output_text as string | undefined;
			const finishReason =
				(response as any)?.output?.[0]?.stop_reason ??
				(response as any)?.output?.[0]?.finish_reason ??
				"unknown";
			const promptTokens =
				(response as any)?.usage?.input_tokens ??
				(response as any)?.usage?.prompt_tokens;
			const completionTokens =
				(response as any)?.usage?.output_tokens ??
				(response as any)?.usage?.completion_tokens;
			const usage =
				promptTokens != null && completionTokens != null
					? { promptTokens, completionTokens }
					: undefined;
			const recvMsg = `Received individual contributor summaries (finishReason=${finishReason}, tokens=${usage ? `${usage.promptTokens}+${usage.completionTokens}` : "unknown"})`;
			if (this.emitDebugLogs) this.logger.debug(recvMsg);

			if (!text) {
				throw new Error(
					"Empty AI response for individual contributor summaries",
				);
			}

			let parsed: unknown;
			try {
				parsed = JSON.parse(text);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(
					`Invalid JSON from individual summaries response: ${message}`,
				);
			}

			const summaries = Array.isArray((parsed as any)?.summaries)
				? ((parsed as any).summaries as Array<{
						login?: string;
						summary?: string;
					}>)
				: null;

			if (!summaries) {
				throw new Error(
					"AI response missing 'summaries' array for individual contributor summaries",
				);
			}

			const byLogin = new Map<string, string>();
			for (const entry of summaries) {
				if (
					!entry ||
					typeof entry.login !== "string" ||
					typeof entry.summary !== "string"
				) {
					continue;
				}
				const login = entry.login.trim();
				const summary = entry.summary.trim();
				if (login.length > 0 && summary.length > 0) {
					byLogin.set(login, summary);
				}
			}

			const missing = payloads.filter(
				(payload) => !byLogin.has(payload.contributor.login),
			);
			if (missing.length > 0) {
				const names = missing
					.map(
						(item) =>
							`${item.contributor.displayName} (@${item.contributor.login})`,
					)
					.join(", ");
				throw new Error(`Empty AI response for individual summary: ${names}`);
			}

			return payloads.map((payload) => ({
				login: payload.contributor.login,
				summary: byLogin.get(payload.contributor.login)!,
				usage,
			}));
		} catch (error) {
			this.rethrowAsConnectionOrAuthError(
				"Failed to generate individual contributor summaries",
				error,
			);
		}
	}

	async generateFinalReport(context: FinalReportContext): Promise<string> {
		const markdown = renderReport(context.report);
		if (context.report.sections.individualContributions !== false) {
			this.ensureAllContributorsPresent(markdown, context.report.memberMetrics);
		}
		return markdown;
	}

	async extractProjectAccomplishments(
		context: VisibleWinsExtractionContext,
	): Promise<ProjectAccomplishment[]> {
		if (!this.enabled) {
			throw new Error(
				"AI service is required for visible wins extraction. Please configure OPENAI_API_KEY.",
			);
		}

		try {
			this.logEnabledNotice();
			const client = this.createClient();
			const model = this.visibleWinsModel;
			const prompt = buildVisibleWinsExtractionPrompt(context);

			const batchHeader = [
				`[${new Date().toISOString()}] visible-wins-extraction batch 1/1`,
				`model=${model}`,
				`promptLength=${prompt.length}`,
				`estimatedTokens=${Math.ceil(prompt.length / 3)}`,
			].join(" | ");
			await appendBatchLog(`${batchHeader}\n${prompt}\n\n`);

			if (this.emitDebugLogs) {
				this.logger.debug(
					`Sending visible wins extraction request (model=${model}, promptLength=${prompt.length})`,
				);
			}

			context.onStatus?.(
				`Sending AI request (${context.projects.length} projects, ${context.notes.length} notes)...`,
			);

			const requestOptions: Record<string, unknown> = {
				model,
				input: prompt,
				text: { format: VISIBLE_WINS_SCHEMA },
			};

			if (this.enableFlexProcessing) {
				requestOptions.service_tier = "flex";
			}

			const response = await client.responses.create(
				requestOptions as Parameters<typeof client.responses.create>[0],
			);
			const outputText = (response as Record<string, unknown>).output_text as
				| string
				| undefined;

			if (this.emitDebugLogs) {
				const usage = (response as Record<string, unknown>).usage as
					| Record<string, number>
					| undefined;
				const inputTokens = usage?.input_tokens ?? usage?.prompt_tokens;
				const outputTokens = usage?.output_tokens ?? usage?.completion_tokens;
				this.logger.debug(
					`Received visible wins extraction response (textLength=${outputText?.length ?? 0}, tokens=${inputTokens != null && outputTokens != null ? `${inputTokens}+${outputTokens}` : "unknown"})`,
				);
			}

			if (!outputText) {
				throw new Error("Empty AI response for visible wins extraction");
			}

			context.onStatus?.("Processing AI response...");

			const parsed = JSON.parse(outputText) as {
				accomplishments: ProjectAccomplishment[];
			};

			// Validate AI-returned GIDs against known projects; remap unknown GIDs
			const knownGids = new Set(context.projects.map((p) => p.gid));
			for (const acc of parsed.accomplishments) {
				if (!knownGids.has(acc.projectGid)) {
					const match = context.projects.find(
						(p) =>
							p.name.toLowerCase().includes(acc.projectName.toLowerCase()) ||
							acc.projectName.toLowerCase().includes(p.name.toLowerCase()) ||
							(p.customFields?.["Child Tasks"] as string | undefined)
								?.toLowerCase()
								.includes(acc.projectName.toLowerCase()),
					);
					if (match) {
						this.logger.warn(
							`[visible-wins] Remapping AI-generated project "${acc.projectName}" (${acc.projectGid}) → "${match.name}" (${match.gid})`,
						);
						acc.projectGid = match.gid;
						acc.projectName = match.name;
					} else {
						this.logger.warn(
							`[visible-wins] Unknown project from AI: "${acc.projectName}" (${acc.projectGid}) — keeping as-is`,
						);
					}
				}
			}

			for (const acc of parsed.accomplishments) {
				const count = acc.bullets.length;
				context.onStatus?.(
					count > 0
						? `Extracted: ${acc.projectName} — ${count} accomplishment${count !== 1 ? "s" : ""}`
						: `Extracted: ${acc.projectName} — No Change`,
				);
			}

			return parsed.accomplishments;
		} catch (error) {
			this.rethrowAsConnectionOrAuthError(
				"Failed to extract project accomplishments",
				error,
			);
		}
	}

	async analyzeSectionDiscrepancies(
		context: SectionAuditContext,
	): Promise<SectionDiscrepancy[]> {
		if (!this.enabled) {
			throw new Error(
				"AI service is required for report audit. Please configure OPENAI_API_KEY.",
			);
		}

		try {
			this.logEnabledNotice();
			const client = this.createClient();
			const model = this.discrepancyAnalysisModel;
			const prompt = buildDiscrepancyAnalysisPrompt(context);

			const batchHeader = [
				`[${new Date().toISOString()}] discrepancy-analysis ${context.sectionName}`,
				`model=${model}`,
				`contributor=${context.contributor ?? "n/a"}`,
				`promptLength=${prompt.length}`,
				`estimatedTokens=${Math.ceil(prompt.length / 3)}`,
			].join(" | ");
			await appendBatchLog(`${batchHeader}\n${prompt}\n\n`);

			if (this.emitDebugLogs) {
				this.logger.debug(
					`Sending discrepancy analysis request (section=${context.sectionName}, model=${model}, promptLength=${prompt.length})`,
				);
			}

			const requestOptions: Record<string, unknown> = {
				model,
				input: prompt,
				text: { format: DISCREPANCY_ANALYSIS_SCHEMA },
			};

			if (this.enableFlexProcessing) {
				requestOptions.service_tier = "flex";
			}

			const abortController = new AbortController();
			const timeoutId = setTimeout(
				() => abortController.abort(),
				this.discrepancyTimeoutMs,
			);
			let response;
			try {
				response = await client.responses.create(
					requestOptions as Parameters<typeof client.responses.create>[0],
					{ signal: abortController.signal } as Parameters<
						typeof client.responses.create
					>[1],
				);
			} catch (err) {
				if (abortController.signal.aborted) {
					throw new Error(
						`Discrepancy analysis timed out after ${this.discrepancyTimeoutMs}ms for ${context.sectionName}${context.contributor ? ` (${context.contributor})` : ""}`,
					);
				}
				throw err;
			} finally {
				clearTimeout(timeoutId);
			}
			const outputText = (response as Record<string, unknown>).output_text as
				| string
				| undefined;

			if (!outputText) {
				throw new Error(
					`Empty AI response for discrepancy analysis (${context.sectionName})`,
				);
			}

			const parsed = JSON.parse(outputText) as {
				discrepancies: Array<{
					summary: string;
					explanation: string;
					sourceA: {
						sourceName: string;
						state: string;
						url: string;
						itemId: string;
					};
					sourceB: {
						sourceName: string;
						state: string;
						url: string;
						itemId: string;
					};
					suggestedResolution: string;
					confidence: number;
					rule: string;
					contributorLogin: string;
					contributorDisplayName: string;
				}>;
			};

			return parsed.discrepancies.map((d) => ({
				sectionName: context.sectionName,
				contributor: d.contributorLogin || context.contributor,
				contributorDisplayName:
					d.contributorDisplayName || context.contributorDisplayName,
				summary: d.summary,
				explanation: d.explanation,
				sourceA: {
					sourceName: d.sourceA.sourceName,
					state: d.sourceA.state,
					url: d.sourceA.url || undefined,
					itemId: d.sourceA.itemId || undefined,
				},
				sourceB: {
					sourceName: d.sourceB.sourceName,
					state: d.sourceB.state,
					url: d.sourceB.url || undefined,
					itemId: d.sourceB.itemId || undefined,
				},
				suggestedResolution: d.suggestedResolution,
				confidence:
					typeof d.confidence === "number"
						? Math.max(0, Math.min(100, d.confidence))
						: 50,
				rule: d.rule,
			}));
		} catch (error) {
			this.rethrowAsConnectionOrAuthError(
				`Failed to analyze discrepancies for ${context.sectionName}`,
				error,
			);
		}
	}

	async synthesizeRoadmapTable(context: RoadmapSynthesisContext): Promise<
		{
			gid: string;
			displayName: string;
			overallStatus: string;
			nextMilestone: string;
			keyNotes: string;
		}[]
	> {
		if (!this.enabled) {
			throw new Error(
				"AI service is required for roadmap synthesis. Please configure OPENAI_API_KEY.",
			);
		}

		try {
			this.logEnabledNotice();
			const client = this.createClient();
			const model = this.visibleWinsModel;
			const prompt = buildRoadmapSynthesisPrompt(context);

			const batchHeader = [
				`[${new Date().toISOString()}] roadmap-synthesis`,
				`model=${model}`,
				`itemCount=${context.roadmapItems.length}`,
				`mode=${context.mode}`,
				`promptLength=${prompt.length}`,
				`estimatedTokens=${Math.ceil(prompt.length / 3)}`,
			].join(" | ");
			await appendBatchLog(`${batchHeader}\n${prompt}\n\n`);

			if (this.emitDebugLogs) {
				this.logger.debug(
					`Sending roadmap synthesis request (model=${model}, items=${context.roadmapItems.length}, mode=${context.mode}, promptLength=${prompt.length})`,
				);
			}

			const requestOptions: Record<string, unknown> = {
				model,
				input: prompt,
				text: { format: ROADMAP_SYNTHESIS_SCHEMA },
			};

			if (this.enableFlexProcessing) {
				requestOptions.service_tier = "flex";
			}

			const response = await client.responses.create(
				requestOptions as Parameters<typeof client.responses.create>[0],
			);
			const outputText = (response as Record<string, unknown>).output_text as
				| string
				| undefined;

			if (!outputText) {
				throw new Error("Empty AI response for roadmap synthesis");
			}

			const parsed = JSON.parse(outputText) as {
				items: Array<{
					gid: string;
					displayName: string;
					overallStatus: string;
					nextMilestone: string;
					keyNotes: string;
				}>;
			};

			return parsed.items;
		} catch (error) {
			this.rethrowAsConnectionOrAuthError(
				"Failed to synthesize roadmap table",
				error,
			);
		}
	}

	private normalizeSentence(text: string | null | undefined): string | null {
		if (!text) {
			return null;
		}
		const trimmed = text.trim().replace(/\s+/g, " ");
		if (!trimmed.endsWith(".")) {
			return `${trimmed}.`;
		}
		return trimmed;
	}

	private ensureAllContributorsPresent(
		markdown: string,
		members: ReportMemberMetrics[],
	): void {
		const missing = members
			.map((member) => `### ${member.displayName} (@${member.login})`)
			.filter((heading) => !markdown.includes(heading));
		if (missing.length > 0) {
			throw new Error(
				`Final report omitted contributor sections for: ${missing.join(", ")}. Rerun the report after increasing model output capacity or adjusting instructions.`,
			);
		}
	}

	private logEnabledNotice(): void {
		if (!this.loggedEnabledNotice) {
			this.loggedEnabledNotice = true;
			if (this.emitDebugLogs) {
				const overrides: string[] = [];
				const collectOverride = (label: string, value: string) => {
					if (value !== this.model) {
						overrides.push(`${label}=${value}`);
					}
				};
				collectOverride("teamHighlight", this.teamHighlightModel);
				collectOverride("memberHighlights", this.memberHighlightsModel);
				collectOverride("individualSummaries", this.individualSummariesModel);
				const suffix =
					overrides.length > 0 ? ` (overrides: ${overrides.join(", ")})` : "";
				this.logger.debug(
					`AI summaries enabled (default=${this.model})${suffix}.`,
				);
			}
		}
	}
}
