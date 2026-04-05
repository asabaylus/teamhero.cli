import { getEnv } from "../lib/env.js";
import type {
	ContributorSummaryPayload,
	ContributorSummaryUsage,
} from "../models/individual-summary.js";

export interface SummarizerDriverResult {
	login: string;
	summary: string;
	usage?: ContributorSummaryUsage;
}

export type SummarizerDriver = (
	payloads: ContributorSummaryPayload[],
) => Promise<SummarizerDriverResult[]>;

export type SummarizerJobStatus = "completed" | "failed";

export interface SummarizerJobResult {
	login: string;
	status: SummarizerJobStatus;
	summary?: string;
	usage?: ContributorSummaryUsage;
	error?: string;
}

export interface IndividualSummarizerOptions {
	driver: SummarizerDriver;
	batchSize?: number;
	maxRetries?: number;
	retryDelayMs?: number;
}

export class IndividualSummarizerService {
	private readonly driver: SummarizerDriver;
	private readonly batchSize: number;
	private readonly maxRetries: number;
	private readonly retryDelayMs: number;

	constructor(options: IndividualSummarizerOptions) {
		this.driver = options.driver;
		this.batchSize = Math.max(
			1,
			options.batchSize ??
				Number.parseInt(getEnv("TEAMHERO_INDIVIDUAL_BATCH_SIZE") ?? "5", 10),
		);
		this.maxRetries = Math.max(0, options.maxRetries ?? 2);
		this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);
	}

	async process(
		payloads: ContributorSummaryPayload[],
	): Promise<Map<string, SummarizerJobResult>> {
		const results = new Map<string, SummarizerJobResult>();
		const batches = this.chunk(payloads, this.batchSize);

		for (const batch of batches) {
			let attempt = 0;
			while (true) {
				try {
					const summaries = await this.driver(batch);
					this.applySuccess(results, summaries, batch);
					break;
				} catch (error) {
					attempt += 1;
					if (!this.shouldRetry(error) || attempt > this.maxRetries) {
						this.applyFailure(results, batch, error);
						break;
					}
					await this.delay(this.retryDelayMs * attempt);
				}
			}
		}

		return results;
	}

	private applySuccess(
		results: Map<string, SummarizerJobResult>,
		summaries: SummarizerDriverResult[],
		batch: ContributorSummaryPayload[],
	): void {
		const byLogin = new Map<string, SummarizerDriverResult>();
		for (const entry of summaries) {
			byLogin.set(entry.login, entry);
		}

		for (const payload of batch) {
			const summary = byLogin.get(payload.contributor.login);
			if (!summary) {
				results.set(payload.contributor.login, {
					login: payload.contributor.login,
					status: "failed",
					error: "Summarizer did not return a result.",
				});
				continue;
			}
			results.set(payload.contributor.login, {
				login: payload.contributor.login,
				status: "completed",
				summary: summary.summary,
				usage: summary.usage,
			});
		}
	}

	private applyFailure(
		results: Map<string, SummarizerJobResult>,
		batch: ContributorSummaryPayload[],
		error: unknown,
	): void {
		const message = error instanceof Error ? error.message : String(error);
		for (const payload of batch) {
			results.set(payload.contributor.login, {
				login: payload.contributor.login,
				status: "failed",
				error: message,
			});
		}
	}

	private shouldRetry(error: unknown): boolean {
		if (!error) {
			return false;
		}
		const status = (error as any)?.status as number | undefined;
		if (
			typeof status === "number" &&
			(status === 429 || (status >= 500 && status < 600))
		) {
			return true;
		}
		const message =
			error instanceof Error
				? error.message.toLowerCase()
				: String(error).toLowerCase();
		return (
			message.includes("rate limit") || message.includes("too many requests")
		);
	}

	private chunk<T>(items: T[], size: number): T[][] {
		const result: T[][] = [];
		for (let index = 0; index < items.length; index += size) {
			result.push(items.slice(index, index + size));
		}
		return result;
	}

	private async delay(ms: number): Promise<void> {
		if (ms <= 0) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, ms));
	}
}
