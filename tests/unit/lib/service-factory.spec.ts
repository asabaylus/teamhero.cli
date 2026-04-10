/**
 * Tests for service-factory.ts.
 *
 * Strategy: mock all external dependencies (octokit, services, dotenv)
 * and verify that createReportService returns a ReportService instance
 * with the correct wiring.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { mocked } from "../../helpers/mocked.js";

// ---------------------------------------------------------------------------
// Static imports for spreading into mock.module factories
// ---------------------------------------------------------------------------

import * as dotenvMod from "dotenv";
import * as envMod from "../../../src/lib/env.js";
import * as octokitMod from "../../../src/lib/octokit.js";
import * as metricsServiceMod from "../../../src/services/metrics.service.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

mock.module("dotenv", () => ({
	...dotenvMod,
	config: mock(),
}));

mock.module("../../../src/lib/octokit.js", () => ({
	...octokitMod,
	loadOctokitFromEnv: mock().mockResolvedValue({}),
}));

mock.module("../../../src/lib/env.js", () => ({
	...envMod,
	getEnv: mock().mockReturnValue(undefined),
	loadDotenv: mock().mockReturnValue({}),
}));

mock.module("../../../src/services/metrics.service.js", () => ({
	...metricsServiceMod,
	MetricsService: mock().mockImplementation(() => ({
		_type: "MetricsService",
	})),
}));

afterAll(() => {
	mock.restore();
});

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { CachedLocCollector } from "../../../src/adapters/cache/cached-loc-collector.js";
import { CachedMetricsProvider } from "../../../src/adapters/cache/cached-metrics-provider.js";
import { CachedTaskTrackerProvider } from "../../../src/adapters/cache/cached-task-tracker.js";
import { getEnv } from "../../../src/lib/env.js";
import { loadOctokitFromEnv } from "../../../src/lib/octokit.js";
import { createReportService } from "../../../src/lib/service-factory.js";
import { AIService } from "../../../src/services/ai.service.js";
import { AsanaService } from "../../../src/services/asana.service.js";
import { MetricsService } from "../../../src/services/metrics.service.js";
import { ReportService } from "../../../src/services/report.service.js";
import { ScopeService } from "../../../src/services/scope.service.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createReportService", () => {
	const mockOctokit = {} as any;

	beforeEach(() => {
		(loadOctokitFromEnv as any).mockClear();
		(getEnv as any).mockClear();
		(MetricsService as any).mockClear();
		mocked(loadOctokitFromEnv).mockResolvedValue(mockOctokit);
		mocked(getEnv).mockReturnValue(undefined);
	});

	it("returns a ReportService instance", async () => {
		const result = await createReportService();
		expect(result).toBeInstanceOf(ReportService);
	});

	it("loads octokit from env", async () => {
		await createReportService();
		expect(loadOctokitFromEnv).toHaveBeenCalledOnce();
	});

	it("creates a ScopeService with the octokit client", async () => {
		const result = await createReportService();
		expect((result as any).deps.scope).toBeInstanceOf(ScopeService);
	});

	it("creates a MetricsService with the octokit client and logger", async () => {
		await createReportService();
		expect(MetricsService).toHaveBeenCalledOnce();
		const [firstArg] = mocked(MetricsService).mock.calls[0];
		expect(firstArg).toBe(mockOctokit);
	});

	it("creates an AIService", async () => {
		const result = await createReportService();
		expect((result as any).deps.ai).toBeInstanceOf(AIService);
	});

	it("creates CachedMetricsProvider wrapping MetricsService", async () => {
		const result = await createReportService();
		expect((result as any).deps.metrics).toBeInstanceOf(CachedMetricsProvider);
	});

	it("creates CachedLocCollector", async () => {
		const result = await createReportService();
		expect((result as any).deps.locCollector).toBeInstanceOf(
			CachedLocCollector,
		);
	});

	it("does NOT create AsanaService when ASANA_API_TOKEN is absent", async () => {
		mocked(getEnv).mockReturnValue(undefined);
		const result = await createReportService();
		expect((result as any).deps.asanaService).toBeUndefined();
		expect((result as any).deps.taskTracker).toBeUndefined();
	});

	it("creates AsanaService and CachedTaskTrackerProvider when ASANA_API_TOKEN is set", async () => {
		mocked(getEnv).mockImplementation((key) =>
			key === "ASANA_API_TOKEN" ? "fake-token" : undefined,
		);
		const result = await createReportService();
		expect((result as any).deps.asanaService).toBeInstanceOf(AsanaService);
		expect((result as any).deps.taskTracker).toBeInstanceOf(
			CachedTaskTrackerProvider,
		);
	});

	it("passes cacheOptions through to CachedMetricsProvider", async () => {
		const cacheOptions = { ttlSeconds: 999 };
		const result = await createReportService({ cacheOptions });
		expect((result as any).deps.metrics.cacheOptions).toEqual(cacheOptions);
	});

	it("passes cacheOptions through to CachedLocCollector", async () => {
		const cacheOptions = { ttlSeconds: 42 };
		const result = await createReportService({ cacheOptions });
		expect((result as any).deps.locCollector.cacheOptions).toEqual(
			cacheOptions,
		);
	});

	it("wires the ReportService with scope, metrics, ai, and locCollector", async () => {
		const result = await createReportService();
		expect((result as any).deps).toEqual(
			expect.objectContaining({
				scope: expect.anything(),
				metrics: expect.anything(),
				ai: expect.anything(),
				locCollector: expect.anything(),
			}),
		);
	});

	it("accepts a custom logger option", async () => {
		const customLogger = { withTag: mock().mockReturnThis() } as any;
		await createReportService({ logger: customLogger });
		expect(customLogger.withTag).toHaveBeenCalled();
	});
});
