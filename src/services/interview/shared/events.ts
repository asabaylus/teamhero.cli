/**
 * JSON-lines protocol for IPC between the Go TUI and the TypeScript
 * interview service. Each event is a single JSON object terminated by a
 * newline. Wire format:
 *
 *   {"type":"progress","step":"...","status":"start"}
 *   {"type":"progress","step":"...","status":"done","message":"..."}
 *
 * Future slices extend this union (observation, measurement, audit,
 * result, error) — keep new event types additive and discriminated by
 * the `type` field.
 */

export interface InterviewProgressEvent {
	readonly type: "progress";
	readonly step: string;
	readonly status: "start" | "update" | "done" | "error";
	readonly message?: string;
	readonly progress?: number;
}

export type InterviewEvent = InterviewProgressEvent;

const KNOWN_EVENT_TYPES: readonly InterviewEvent["type"][] = ["progress"];

export function serializeInterviewEvent(event: InterviewEvent): string {
	return `${JSON.stringify(event)}\n`;
}

export function parseInterviewEvent(line: string): InterviewEvent | null {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return null;
	}
	if (!value || typeof value !== "object") return null;
	const type = (value as { type?: unknown }).type;
	if (typeof type !== "string") return null;
	if (!KNOWN_EVENT_TYPES.includes(type as InterviewEvent["type"])) return null;
	return value as InterviewEvent;
}
