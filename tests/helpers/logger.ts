import type { ConsolaInstance } from "consola";

type LogEntry = {
	level: "info" | "warn" | "error" | "success" | "debug";
	message: string;
};

export interface TestLogger {
	instance: ConsolaInstance;
	entries: LogEntry[];
}

export function createTestLogger(): TestLogger {
	const entries: LogEntry[] = [];

	const instance: Partial<ConsolaInstance> = {
		info(message: unknown) {
			entries.push({ level: "info", message: String(message) });
		},
		warn(message: unknown) {
			entries.push({ level: "warn", message: String(message) });
		},
		error(message: unknown) {
			entries.push({ level: "error", message: String(message) });
		},
		success(message: unknown) {
			entries.push({ level: "success", message: String(message) });
		},
		debug(message: unknown) {
			entries.push({ level: "debug", message: String(message) });
		},
	};

	return {
		instance: instance as ConsolaInstance,
		entries,
	};
}
