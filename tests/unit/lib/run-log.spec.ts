import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

import * as unifiedLogMod from "../../../src/lib/unified-log.js";

// Mock the unified-log dependency
const mockAppendUnifiedLog =
	mock<(entry: Record<string, unknown>) => Promise<void>>();
mock.module("../../../src/lib/unified-log.js", () => ({
	...unifiedLogMod,
	appendUnifiedLog: (...args: Parameters<typeof mockAppendUnifiedLog>) =>
		mockAppendUnifiedLog(...args),
}));

afterAll(() => {
	mock.restore();
});

// Import after mocking
const { appendRunLogEntry } = await import("../../../src/lib/run-log.js");

describe("appendRunLogEntry", () => {
	beforeEach(() => {
		mockAppendUnifiedLog.mockReset();
		mockAppendUnifiedLog.mockResolvedValue(undefined);
	});

	it("calls appendUnifiedLog with category: 'run' injected", async () => {
		const entry = {
			timestamp: "2026-01-01T00:00:00Z",
			event: "start",
			runId: "run-abc",
		};

		await appendRunLogEntry(entry);

		expect(mockAppendUnifiedLog).toHaveBeenCalledOnce();
		expect(mockAppendUnifiedLog).toHaveBeenCalledWith({
			timestamp: "2026-01-01T00:00:00Z",
			event: "start",
			runId: "run-abc",
			category: "run",
		});
	});

	it("spreads all extra fields from the entry", async () => {
		const entry = {
			timestamp: "2026-01-01T00:00:00Z",
			event: "success",
			runId: "run-xyz",
			duration: 1234,
			memberCount: 5,
		};

		await appendRunLogEntry(entry);

		const call = mockAppendUnifiedLog.mock.calls[0][0];
		expect(call).toMatchObject({
			timestamp: "2026-01-01T00:00:00Z",
			event: "success",
			runId: "run-xyz",
			category: "run",
			duration: 1234,
			memberCount: 5,
		});
	});

	it("category 'run' overrides any category in the entry", async () => {
		// RunLogEntry allows [key: string]: unknown, so someone could pass
		// category as an extra field. The spread + override should ensure
		// category is always "run".
		const entry = {
			timestamp: "2026-01-01T00:00:00Z",
			event: "test",
			runId: "run-1",
			category: "ai" as const,
		};

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await appendRunLogEntry(entry as any);

		const call = mockAppendUnifiedLog.mock.calls[0][0];
		expect(call.category).toBe("run");
	});

	it("returns the promise from appendUnifiedLog", async () => {
		const entry = {
			timestamp: "2026-01-01T00:00:00Z",
			event: "failure",
			runId: "run-fail",
		};

		const result = appendRunLogEntry(entry);
		await expect(result).resolves.toBeUndefined();
	});

	it("propagates errors from appendUnifiedLog", async () => {
		mockAppendUnifiedLog.mockRejectedValue(new Error("disk full"));

		const entry = {
			timestamp: "2026-01-01T00:00:00Z",
			event: "failure",
			runId: "run-err",
		};

		await expect(appendRunLogEntry(entry)).rejects.toThrow("disk full");
	});
});
