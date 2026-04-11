import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testCacheDir: string;

const { appendUnifiedLog, appendAiDebugLog } = await import(
	"../../../src/lib/unified-log.js"
);

describe("appendUnifiedLog", () => {
	beforeEach(async () => {
		testCacheDir = await mkdtemp(join(tmpdir(), "teamhero-log-test-"));
		process.env.XDG_CACHE_HOME = testCacheDir;
	});

	afterEach(async () => {
		await rm(testCacheDir, { recursive: true, force: true });
		delete process.env.XDG_CACHE_HOME;
	});

	it("writes to cacheDir/logs/teamhero.log", async () => {
		await appendUnifiedLog({
			timestamp: "2026-01-01T00:00:00Z",
			runId: "run-1",
			category: "cache",
			event: "cache-hit",
			namespace: "metrics",
		});

		const logPath = join(testCacheDir, "teamhero", "logs", "teamhero.log");
		const content = await readFile(logPath, "utf8");
		const parsed = JSON.parse(content.trim());
		expect(parsed.category).toBe("cache");
		expect(parsed.event).toBe("cache-hit");
		expect(parsed.runId).toBe("run-1");
	});

	it("appends multiple entries as JSONL", async () => {
		await appendUnifiedLog({
			timestamp: "2026-01-01T00:00:00Z",
			runId: "run-1",
			category: "run",
			event: "start",
		});
		await appendUnifiedLog({
			timestamp: "2026-01-01T00:01:00Z",
			runId: "run-1",
			category: "run",
			event: "success",
		});

		const logPath = join(testCacheDir, "teamhero", "logs", "teamhero.log");
		const content = await readFile(logPath, "utf8");
		const lines = content.trim().split("\n");
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[0]).event).toBe("start");
		expect(JSON.parse(lines[1]).event).toBe("success");
	});

	it("does NOT write to process.cwd()", async () => {
		await appendUnifiedLog({
			timestamp: "2026-01-01T00:00:00Z",
			runId: "run-1",
			category: "cache",
			event: "test",
		});

		// Verify the log went to the cache dir, not cwd
		const logPath = join(testCacheDir, "teamhero", "logs", "teamhero.log");
		const content = await readFile(logPath, "utf8");
		expect(content).toContain('"event":"test"');
	});
});

describe("appendAiDebugLog", () => {
	beforeEach(async () => {
		testCacheDir = await mkdtemp(join(tmpdir(), "teamhero-log-test-"));
		process.env.XDG_CACHE_HOME = testCacheDir;
	});

	afterEach(async () => {
		await rm(testCacheDir, { recursive: true, force: true });
		delete process.env.XDG_CACHE_HOME;
	});

	it("writes to cacheDir/logs/ai-debug.log", async () => {
		await appendAiDebugLog("test prompt content\n");

		const logPath = join(testCacheDir, "teamhero", "logs", "ai-debug.log");
		const content = await readFile(logPath, "utf8");
		expect(content).toBe("test prompt content\n");
	});
});
