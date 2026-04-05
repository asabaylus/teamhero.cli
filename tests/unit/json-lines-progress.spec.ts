import { beforeEach, describe, expect, it } from "bun:test";
import { Writable } from "node:stream";
import { JsonLinesProgressDisplay } from "../../src/lib/json-lines-progress.js";
import type { JsonLinesEvent } from "../../src/lib/json-lines-progress.js";

function createCapture(): {
	stream: NodeJS.WritableStream;
	events: () => JsonLinesEvent[];
} {
	const chunks: string[] = [];
	const stream = new Writable({
		write(chunk, _encoding, callback) {
			chunks.push(chunk.toString());
			callback();
		},
	}) as unknown as NodeJS.WritableStream;

	return {
		stream,
		events: () =>
			chunks
				.join("")
				.split("\n")
				.filter((l) => l.length > 0)
				.map((l) => JSON.parse(l) as JsonLinesEvent),
	};
}

describe("JsonLinesProgressDisplay", () => {
	let capture: ReturnType<typeof createCapture>;
	let display: JsonLinesProgressDisplay;

	beforeEach(() => {
		capture = createCapture();
		display = new JsonLinesProgressDisplay(capture.stream);
	});

	describe("start", () => {
		it("should emit a start event", () => {
			display.start("Loading data");
			const events = capture.events();
			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "progress",
				step: "Loading data",
				status: "start",
			});
		});
	});

	describe("succeed", () => {
		it("should emit start + done events", () => {
			const handle = display.start("Fetching repos");
			handle.succeed("Fetched 25 repos");

			const events = capture.events();
			expect(events).toHaveLength(2);
			expect(events[1]).toEqual({
				type: "progress",
				step: "Fetching repos",
				status: "done",
				message: "Fetched 25 repos",
			});
		});

		it("should use step text as default message", () => {
			const handle = display.start("Task");
			handle.succeed();

			const events = capture.events();
			expect(events[1]).toMatchObject({ status: "done", message: "Task" });
		});

		it("should not emit after already finished", () => {
			const handle = display.start("Task");
			handle.succeed("Done");
			handle.succeed("Again");

			expect(capture.events()).toHaveLength(2);
		});
	});

	describe("fail", () => {
		it("should emit start + error events", () => {
			const handle = display.start("Connecting");
			handle.fail("Timeout");

			const events = capture.events();
			expect(events).toHaveLength(2);
			expect(events[1]).toEqual({
				type: "progress",
				step: "Connecting",
				status: "error",
				message: "Timeout",
			});
		});
	});

	describe("update", () => {
		it("should emit update events with progress", () => {
			const handle = display.start("Processing");
			handle.update("Item 5/10", 0.5);

			const events = capture.events();
			expect(events).toHaveLength(2);
			expect(events[1]).toEqual({
				type: "progress",
				step: "Processing",
				status: "update",
				message: "Item 5/10",
				progress: 0.5,
			});
		});

		it("should not emit update after finished", () => {
			const handle = display.start("Work");
			handle.succeed();
			handle.update("More work");

			expect(capture.events()).toHaveLength(2);
		});

		it("should ignore empty updates", () => {
			const handle = display.start("Work");
			handle.update("  ");

			expect(capture.events()).toHaveLength(1);
		});
	});

	describe("instantSuccess", () => {
		it("should emit start + done pair", () => {
			display.instantSuccess("Cache hit");

			const events = capture.events();
			expect(events).toHaveLength(2);
			expect(events[0]).toMatchObject({ status: "start", step: "Cache hit" });
			expect(events[1]).toMatchObject({ status: "done", step: "Cache hit" });
		});
	});

	describe("emitResult", () => {
		it("should emit a result event", () => {
			display.emitResult("/path/to/report.md");

			const events = capture.events();
			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "result",
				outputPath: "/path/to/report.md",
			});
		});
	});

	describe("emitError", () => {
		it("should emit an error event", () => {
			display.emitError("Token expired");

			const events = capture.events();
			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "error",
				message: "Token expired",
			});
		});
	});

	describe("emitDiscrepancy", () => {
		it("should emit a discrepancy event", () => {
			display.emitDiscrepancy({
				contributor: "jdoe",
				contributorDisplayName: "Jane Doe",
				message: "PR count mismatch",
				confidence: 85,
				sourceA: { sourceName: "Report", state: "3 PRs", url: "", itemId: "" },
				sourceB: { sourceName: "GitHub", state: "2 PRs", url: "", itemId: "" },
			});

			const events = capture.events();
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				type: "discrepancy",
				contributor: "jdoe",
				message: "PR count mismatch",
			});
		});
	});

	describe("emitReportData", () => {
		it("should emit a report-data event", () => {
			display.emitReportData({ sections: ["loc", "individual"] });

			const events = capture.events();
			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "report-data",
				data: { sections: ["loc", "individual"] },
			});
		});
	});

	describe("cleanup", () => {
		it("should be a no-op (does not write)", () => {
			display.cleanup();
			expect(capture.events()).toHaveLength(0);
		});
	});
});
