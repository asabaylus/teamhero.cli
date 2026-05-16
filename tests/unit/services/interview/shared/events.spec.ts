import { describe, expect, it } from "bun:test";
import {
	type InterviewEvent,
	parseInterviewEvent,
	serializeInterviewEvent,
} from "../../../../../src/services/interview/shared/events.js";

describe("interview events protocol", () => {
	it("round-trips a progress event through serialize/parse", () => {
		const event: InterviewEvent = {
			type: "progress",
			step: "collect-evidence",
			status: "start",
		};
		const line = serializeInterviewEvent(event);
		expect(parseInterviewEvent(line)).toEqual(event);
	});

	it("serializes one event per line (no embedded newlines)", () => {
		const line = serializeInterviewEvent({
			type: "progress",
			step: "x",
			status: "done",
			message: "ok",
		});
		expect(line.endsWith("\n")).toBe(true);
		expect(line.slice(0, -1).includes("\n")).toBe(false);
	});

	it("parseInterviewEvent returns null on invalid JSON", () => {
		expect(parseInterviewEvent("not-json")).toBeNull();
	});

	it("parseInterviewEvent returns null on JSON missing a known event type", () => {
		expect(parseInterviewEvent(JSON.stringify({ foo: "bar" }))).toBeNull();
	});

	it("parseInterviewEvent returns null on unknown event type", () => {
		expect(
			parseInterviewEvent(JSON.stringify({ type: "no-such-event" })),
		).toBeNull();
	});
});
