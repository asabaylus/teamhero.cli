import { appendUnifiedLog } from "./unified-log.js";

export interface RunLogEntry {
	timestamp: string;
	event: string;
	runId: string;
	[key: string]: unknown;
}

export async function appendRunLogEntry(entry: RunLogEntry): Promise<void> {
	await appendUnifiedLog({
		...entry,
		category: "run",
	});
}
