/**
 * Unified JSONL log — single structured log file for all TeamHero events.
 *
 * Output: ~/.cache/teamhero/logs/teamhero.log (JSONL format, one JSON object per line)
 *
 * Categories:
 *   - "run"          — report lifecycle events (start, success, failure)
 *   - "ai"           — AI request metadata (model, tokens, duration, cost)
 *   - "discrepancy"  — factual discrepancy events
 *   - "cache"        — cache hit/miss/flush events
 */

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { cacheDir } from "./paths.js";

function logDir(): string {
	return join(cacheDir(), "logs");
}

function unifiedLogPath(): string {
	return join(logDir(), "teamhero.log");
}

export type UnifiedLogCategory = "run" | "ai" | "discrepancy" | "cache";

export interface UnifiedLogEntry {
	timestamp: string;
	runId: string;
	category: UnifiedLogCategory;
	event: string;
	[key: string]: unknown;
}

export async function appendUnifiedLog(entry: UnifiedLogEntry): Promise<void> {
	const dir = logDir();
	await mkdir(dir, { recursive: true });
	await appendFile(unifiedLogPath(), `${JSON.stringify(entry)}\n`, "utf8");
}

/**
 * AI debug log — full prompts and responses for troubleshooting.
 * Kept separate from the unified log to avoid bloat.
 *
 * Output: ~/.cache/teamhero/logs/ai-debug.log
 */
function aiDebugLogPath(): string {
	return join(logDir(), "ai-debug.log");
}

export async function appendAiDebugLog(message: string): Promise<void> {
	const dir = logDir();
	await mkdir(dir, { recursive: true });
	await appendFile(aiDebugLogPath(), message, "utf8");
}
