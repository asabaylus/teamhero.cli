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

const VALID_STATUSES: readonly InterviewProgressEvent["status"][] = [
	"start",
	"update",
	"done",
	"error",
];

export function parseInterviewEvent(line: string): InterviewEvent | null {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return null;
	}
	if (!value || typeof value !== "object") return null;
	const obj = value as Record<string, unknown>;
	const type = obj.type;
	if (typeof type !== "string") return null;
	if (!KNOWN_EVENT_TYPES.includes(type as InterviewEvent["type"])) return null;

	if (type === "progress") {
		if (typeof obj.step !== "string" || obj.step.length === 0) return null;
		if (
			typeof obj.status !== "string" ||
			!VALID_STATUSES.includes(obj.status as InterviewProgressEvent["status"])
		) {
			return null;
		}
		if (obj.message !== undefined && typeof obj.message !== "string") {
			return null;
		}
		if (obj.progress !== undefined && typeof obj.progress !== "number") {
			return null;
		}
	}

	return value as InterviewEvent;
}
