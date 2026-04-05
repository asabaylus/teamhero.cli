import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { consola } from "consola";
import { cacheDir } from "../lib/paths.js";
import type { Discrepancy } from "../models/visible-wins.js";

const LOG_PATH = join(cacheDir(), "logs", "discrepancy-review.log");

/**
 * Format a single discrepancy as a detailed, multi-line log entry.
 */
function formatDiscrepancyEntry(d: Discrepancy, index: number): string {
	const lines = [
		`  ${index}. [${d.projectName}] ${d.type} discrepancy`,
		`     AI value:    "${d.aiValue}"`,
		`     Source note: ${d.sourceFile}`,
		`     Bullet:      "${d.bulletText}"`,
		`     Rationale:   ${d.rationale}`,
	];
	return lines.join("\n");
}

/**
 * Log factual discrepancies to a file and print a summary count.
 * Replaces the previous interactive confirmation flow — the report always continues.
 */
export async function logDiscrepancies(
	discrepancies: Discrepancy[],
	options?: { onStatus?: (message: string) => void },
): Promise<void> {
	if (discrepancies.length === 0) {
		return;
	}

	const timestamp = new Date().toISOString();
	const header = `\n--- Discrepancy Review: ${timestamp} ---\nFound ${discrepancies.length} factual ${discrepancies.length === 1 ? "discrepancy" : "discrepancies"}:\n`;
	const entries = discrepancies
		.map((d, i) => formatDiscrepancyEntry(d, i + 1))
		.join("\n\n");
	const block = `${header}\n${entries}\n`;

	await mkdir(dirname(LOG_PATH), { recursive: true });
	await appendFile(LOG_PATH, block, "utf8");

	const message = `Found ${discrepancies.length} factual ${discrepancies.length === 1 ? "discrepancy" : "discrepancies"} — details written to ${LOG_PATH}`;
	if (options?.onStatus) {
		options.onStatus(message);
	} else {
		consola.info(message);
	}
}
