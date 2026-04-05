/**
 * JSON-lines progress reporter for IPC between Go TUI and TypeScript services.
 * Writes structured JSON events to a writable stream (default: stdout).
 *
 * Protocol:
 *   {"type":"progress","step":"...","status":"start"}
 *   {"type":"progress","step":"...","status":"update","message":"...","progress":0.5}
 *   {"type":"progress","step":"...","status":"done","message":"..."}
 *   {"type":"progress","step":"...","status":"error","message":"..."}
 *   {"type":"result","outputPath":"..."}
 *   {"type":"error","message":"..."}
 */

import type { ProgressHandle } from "./progress.js";

export interface ProgressEvent {
	type: "progress";
	step: string;
	status: "start" | "update" | "done" | "error";
	message?: string;
	progress?: number;
}

export interface ResultEvent {
	type: "result";
	outputPath: string;
	/** Path to the JSON data file (when outputFormat is "json" or "both"). */
	jsonOutputPath?: string;
}

export interface ErrorEvent {
	type: "error";
	message: string;
}

/** Shape of a single discrepancy item in IPC events. */
export interface DiscrepancyEventItem {
	contributor: string;
	contributorDisplayName: string;
	sourceA: { sourceName: string; state: string; url?: string; itemId?: string };
	sourceB: { sourceName: string; state: string; url?: string; itemId?: string };
	suggestedResolution: string;
	confidence: number;
	message: string;
	rule: string;
	sectionName?: string;
}

/** Discrepancy event carrying per-contributor discrepancy data (Epic 5, Story 5.4). */
export interface DiscrepancyEvent {
	type: "discrepancy";
	/** Total number of discrepancies after filtering. */
	totalCount: number;
	/** Discrepancies grouped by contributor login (filtered). */
	byContributor: Record<string, DiscrepancyEventItem[]>;
	/** Discrepancies without a clear contributor (filtered). */
	unattributed: DiscrepancyEventItem[];
	/** Flat list of filtered discrepancies sorted by confidence ascending (most severe first). */
	items: DiscrepancyEventItem[];
	/** ALL discrepancies (unfiltered) sorted by confidence ascending — for the discrepancy log. */
	allItems?: DiscrepancyEventItem[];
	/** Confidence threshold for report display (log retains all items). */
	discrepancyThreshold?: number;
}

/** Report data event carrying the full serialized report data for JSON output mode. */
export interface ReportDataEvent {
	type: "report-data";
	/** The full serialized report data as a JSON-safe object. */
	data: Record<string, unknown>;
}

export type JsonLinesEvent =
	| ProgressEvent
	| ResultEvent
	| ErrorEvent
	| DiscrepancyEvent
	| ReportDataEvent;

export class JsonLinesProgressDisplay {
	private readonly stream: NodeJS.WritableStream;

	constructor(stream?: NodeJS.WritableStream) {
		this.stream = stream ?? process.stdout;
	}

	private emit(event: JsonLinesEvent): void {
		this.stream.write(`${JSON.stringify(event)}\n`);
	}

	start(text: string): ProgressHandle {
		this.emit({ type: "progress", step: text, status: "start" });

		let finished = false;
		const step = text;

		return {
			succeed: (message?: string) => {
				if (finished) return;
				finished = true;
				this.emit({
					type: "progress",
					step,
					status: "done",
					message: message ?? step,
				});
			},
			fail: (message?: string) => {
				if (finished) return;
				finished = true;
				this.emit({
					type: "progress",
					step,
					status: "error",
					message: message ?? step,
				});
			},
			update: (next: string, progress?: number) => {
				if (finished || next.trim().length === 0) return;
				this.emit({
					type: "progress",
					step,
					status: "update",
					message: next,
					progress,
				});
			},
		};
	}

	instantSuccess(message: string): void {
		this.emit({ type: "progress", step: message, status: "start" });
		this.emit({ type: "progress", step: message, status: "done", message });
	}

	emitResult(outputPath: string, jsonOutputPath?: string): void {
		this.emit({
			type: "result",
			outputPath,
			...(jsonOutputPath ? { jsonOutputPath } : {}),
		});
	}

	emitError(message: string): void {
		this.emit({ type: "error", message });
	}

	/** Emit per-contributor discrepancy data for TUI preview (Epic 5, Story 5.4). */
	emitDiscrepancy(event: Omit<DiscrepancyEvent, "type">): void {
		this.emit({ type: "discrepancy", ...event });
	}

	/** Emit full serialized report data for JSON output mode. */
	emitReportData(data: Record<string, unknown>): void {
		this.emit({ type: "report-data", data });
	}

	cleanup(): void {
		// No-op for JSON-lines — no terminal state to restore
	}
}
