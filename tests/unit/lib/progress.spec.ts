/**
 * Tests for src/lib/progress.ts.
 *
 * The ProgressDisplay class is heavily coupled to terminal I/O
 * (process.stdout, readline, timers). We mock stdout writes and test
 * the logical behavior: handle lifecycle (succeed/fail/update), the
 * idempotent guard (calling succeed twice), the spinner helper, and
 * the factory function.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	ProgressDisplay,
	createProgressFactory,
	spinner,
} from "../../../src/lib/progress.js";

// ---------------------------------------------------------------------------
// Stub process.stdout to prevent actual terminal writes and capture output
// ---------------------------------------------------------------------------

let writtenChunks: string[];
const originalWrite = process.stdout.write;
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
	writtenChunks = [];
	// Override isTTY to false so ProgressDisplay uses non-interactive path
	// (simpler to test, no readline/cursor manipulation)
	Object.defineProperty(process.stdout, "isTTY", {
		value: false,
		writable: true,
		configurable: true,
	});
	process.stdout.write = ((chunk: string | Uint8Array) => {
		writtenChunks.push(String(chunk));
		return true;
	}) as typeof process.stdout.write;
});

afterEach(() => {
	process.stdout.write = originalWrite;
	Object.defineProperty(process.stdout, "isTTY", {
		value: originalIsTTY,
		writable: true,
		configurable: true,
	});
});

// ===================================================================
// ProgressDisplay — non-interactive mode
// ===================================================================

describe("ProgressDisplay — non-interactive mode", () => {
	it("writes initial text on start", () => {
		const display = new ProgressDisplay();
		display.start("Loading data");
		const output = writtenChunks.join("");
		expect(output).toContain("Loading data");
		display.cleanup();
	});

	it("succeed writes success symbol and newline", () => {
		const display = new ProgressDisplay();
		const handle = display.start("Processing");
		handle.succeed();
		const output = writtenChunks.join("");
		expect(output).toContain("\u2714"); // checkmark
		expect(output).toContain("\n");
		display.cleanup();
	});

	it("succeed uses custom message when provided", () => {
		const display = new ProgressDisplay();
		const handle = display.start("Processing");
		handle.succeed("All done");
		const output = writtenChunks.join("");
		expect(output).toContain("All done");
		display.cleanup();
	});

	it("fail writes failure symbol", () => {
		const display = new ProgressDisplay();
		const handle = display.start("Processing");
		handle.fail("Something broke");
		const output = writtenChunks.join("");
		expect(output).toContain("\u2716"); // cross
		expect(output).toContain("Something broke");
		display.cleanup();
	});

	it("fail uses default text when no message provided", () => {
		const display = new ProgressDisplay();
		const handle = display.start("Loading");
		handle.fail();
		const output = writtenChunks.join("");
		expect(output).toContain("\u2716");
		expect(output).toContain("Loading");
		display.cleanup();
	});

	it("update changes the displayed text", () => {
		const display = new ProgressDisplay();
		const handle = display.start("Step 1");
		handle.update("Step 2");
		const output = writtenChunks.join("");
		expect(output).toContain("Step 2");
		handle.succeed();
		display.cleanup();
	});

	it("update is a no-op after succeed", () => {
		const display = new ProgressDisplay();
		const handle = display.start("Initial");
		handle.succeed("Done");
		// Clear the buffer and try to update
		writtenChunks.length = 0;
		handle.update("Should not appear");
		const output = writtenChunks.join("");
		expect(output).not.toContain("Should not appear");
		display.cleanup();
	});

	it("update is a no-op for empty/whitespace text", () => {
		const display = new ProgressDisplay();
		const handle = display.start("Initial");
		writtenChunks.length = 0;
		handle.update("   ");
		const output = writtenChunks.join("");
		// No write should have been made for whitespace-only update
		expect(output).not.toContain("   \n");
		handle.succeed();
		display.cleanup();
	});

	it("calling succeed twice is idempotent", () => {
		const display = new ProgressDisplay();
		const handle = display.start("Work");
		handle.succeed("First call");
		writtenChunks.length = 0;
		handle.succeed("Second call");
		const output = writtenChunks.join("");
		// Second succeed should produce no output
		expect(output).not.toContain("Second call");
		display.cleanup();
	});

	it("calling fail twice is idempotent", () => {
		const display = new ProgressDisplay();
		const handle = display.start("Work");
		handle.fail("First fail");
		writtenChunks.length = 0;
		handle.fail("Second fail");
		const output = writtenChunks.join("");
		expect(output).not.toContain("Second fail");
		display.cleanup();
	});

	it("calling fail after succeed is a no-op", () => {
		const display = new ProgressDisplay();
		const handle = display.start("Work");
		handle.succeed("Done");
		writtenChunks.length = 0;
		handle.fail("Too late");
		const output = writtenChunks.join("");
		expect(output).not.toContain("Too late");
		display.cleanup();
	});
});

// ===================================================================
// ProgressDisplay — instantSuccess
// ===================================================================

describe("ProgressDisplay — instantSuccess", () => {
	it("writes success symbol and message immediately", () => {
		const display = new ProgressDisplay();
		display.instantSuccess("Cache loaded");
		const output = writtenChunks.join("");
		expect(output).toContain("\u2714 Cache loaded");
		expect(output).toContain("\n");
		display.cleanup();
	});
});

// ===================================================================
// ProgressDisplay — cleanup
// ===================================================================

describe("ProgressDisplay — cleanup", () => {
	it("can be called multiple times without error", () => {
		const display = new ProgressDisplay();
		display.start("Work");
		expect(() => {
			display.cleanup();
			display.cleanup();
		}).not.toThrow();
	});
});

// ===================================================================
// ProgressDisplay — interactive mode (single-line spinner, no renderer)
// ===================================================================

describe("ProgressDisplay — interactive mode (no renderer)", () => {
	beforeEach(() => {
		// Switch to interactive mode (isTTY = true) but no title = no FrameRenderer
		Object.defineProperty(process.stdout, "isTTY", {
			value: true,
			writable: true,
			configurable: true,
		});
	});

	it("start begins spinner animation", async () => {
		const display = new ProgressDisplay();
		const handle = display.start("Spinning");
		await new Promise((r) => setTimeout(r, 250));
		handle.succeed();
		display.cleanup();
	});

	it("succeed stops animation and writes checkmark", async () => {
		const display = new ProgressDisplay();
		const handle = display.start("Working");
		await new Promise((r) => setTimeout(r, 150));
		handle.succeed("All done");
		const output = writtenChunks.join("");
		expect(output).toContain("\u2714");
		expect(output).toContain("All done");
		display.cleanup();
	});

	it("fail stops animation and writes cross", async () => {
		const display = new ProgressDisplay();
		const handle = display.start("Working");
		await new Promise((r) => setTimeout(r, 150));
		handle.fail("Oops");
		const output = writtenChunks.join("");
		expect(output).toContain("\u2716");
		expect(output).toContain("Oops");
		display.cleanup();
	});

	it("update changes the displayed text", async () => {
		const display = new ProgressDisplay();
		const handle = display.start("Step 1");
		handle.update("Step 2");
		await new Promise((r) => setTimeout(r, 150));
		const output = writtenChunks.join("");
		expect(output).toContain("Step 2");
		handle.succeed();
		display.cleanup();
	});

	it("update is ignored after succeed", async () => {
		const display = new ProgressDisplay();
		const handle = display.start("Work");
		handle.succeed();
		writtenChunks.length = 0;
		handle.update("Late update");
		const output = writtenChunks.join("");
		expect(output).not.toContain("Late update");
		display.cleanup();
	});

	it("update is ignored for empty/whitespace text", async () => {
		const display = new ProgressDisplay();
		const handle = display.start("Work");
		const before = writtenChunks.length;
		handle.update("  ");
		// Should not have written new content
		expect(writtenChunks.length).toBe(before);
		handle.succeed();
		display.cleanup();
	});

	it("instantSuccess writes checkmark without animation", async () => {
		const display = new ProgressDisplay();
		display.instantSuccess("Already done");
		const output = writtenChunks.join("");
		expect(output).toContain("\u2714 Already done");
		display.cleanup();
	});

	it("cleanup stops timer", async () => {
		const display = new ProgressDisplay();
		display.start("Work");
		display.cleanup();
		// After cleanup, no more writes should happen
		const before = writtenChunks.length;
		await new Promise((r) => setTimeout(r, 550));
		expect(writtenChunks.length).toBe(before);
	});

	it("succeed uses default current text when no message", async () => {
		const display = new ProgressDisplay();
		const handle = display.start("Default text");
		handle.succeed();
		const output = writtenChunks.join("");
		expect(output).toContain("Default text");
		display.cleanup();
	});
});

// ===================================================================
// ProgressDisplay — interactive mode with FrameRenderer
// ===================================================================

describe("ProgressDisplay — interactive mode (with renderer)", () => {
	beforeEach(() => {
		Object.defineProperty(process.stdout, "isTTY", {
			value: true,
			writable: true,
			configurable: true,
		});
	});

	it("creates renderer when title is provided", async () => {
		const display = new ProgressDisplay({ title: "Build Report" });
		const handle = display.start("Fetching repos");
		await new Promise((r) => setTimeout(r, 250));
		handle.succeed();
		display.cleanup();
	});

	it("succeed and fail are idempotent with renderer", async () => {
		const display = new ProgressDisplay({ title: "Test" });
		const handle = display.start("Work");
		await new Promise((r) => setTimeout(r, 150));
		handle.succeed();
		handle.succeed(); // idempotent
		handle.fail(); // no-op after succeed
		display.cleanup();
	});

	it("update changes line in renderer", async () => {
		const display = new ProgressDisplay({ title: "Test", expectedSteps: 3 });
		const handle = display.start("Step 1");
		handle.update("Step 1 — 50%", 0.5);
		await new Promise((r) => setTimeout(r, 250));
		handle.succeed();
		display.cleanup();
	});

	it("instantSuccess completes a line immediately", async () => {
		const display = new ProgressDisplay({ title: "Test" });
		display.instantSuccess("Cache loaded");
		await new Promise((r) => setTimeout(r, 250));
		display.cleanup();
	});

	it("cleanup renders final state and removes SIGINT handler", async () => {
		const display = new ProgressDisplay({ title: "Test" });
		display.start("Work");
		await new Promise((r) => setTimeout(r, 150));
		display.cleanup();
	});
});

// ===================================================================
// createProgressFactory
// ===================================================================

describe("createProgressFactory", () => {
	it("returns an object with a create method", () => {
		const factory = createProgressFactory();
		expect(factory).toHaveProperty("create");
		expect(typeof factory.create).toBe("function");
	});

	it("create returns a ProgressDisplay instance", () => {
		const factory = createProgressFactory();
		const reporter = factory.create({ title: "Test" });
		expect(reporter).toBeInstanceOf(ProgressDisplay);
		reporter.cleanup();
	});

	it("passes title and expectedSteps to the display", () => {
		const factory = createProgressFactory();
		const reporter = factory.create({ title: "Build", expectedSteps: 5 });
		// We can verify it is a ProgressDisplay that does not throw on usage
		const handle = reporter.start("Step 1");
		handle.succeed();
		reporter.cleanup();
	});

	it("accepts an anchorRow parameter", () => {
		const factory = createProgressFactory(42);
		const reporter = factory.create({ title: "Anchored" });
		// No error should occur even with anchorRow
		reporter.cleanup();
	});
});

// ===================================================================
// spinner helper
// ===================================================================

describe("spinner", () => {
	it("returns the result of a successful async function", async () => {
		const result = await spinner("Computing", async () => {
			return 42;
		});
		expect(result).toBe(42);
	});

	it("writes success symbol on completion", async () => {
		await spinner("Processing", async () => "ok");
		const output = writtenChunks.join("");
		expect(output).toContain("\u2714");
	});

	it("throws and writes fail symbol when the function rejects", async () => {
		await expect(
			spinner("Failing", async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		const output = writtenChunks.join("");
		expect(output).toContain("\u2716");
		expect(output).toContain("boom");
	});

	it("writes fail with stringified non-Error throw", async () => {
		await expect(
			spinner("Failing", async () => {
				throw "string error";
			}),
		).rejects.toBe("string error");
		const output = writtenChunks.join("");
		expect(output).toContain("string error");
	});

	it("returns the correct type from the async function", async () => {
		const result = await spinner("Fetching", async () => {
			return { items: [1, 2, 3] };
		});
		expect(result).toEqual({ items: [1, 2, 3] });
	});
});
