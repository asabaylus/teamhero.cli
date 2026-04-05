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
import * as cachedLocMod from "../../../src/adapters/cache/cached-loc-collector.js";
import * as cachedMetricsMod from "../../../src/adapters/cache/cached-metrics-provider.js";
import * as cachedTaskTrackerMod from "../../../src/adapters/cache/cached-task-tracker.js";
import * as envMod from "../../../src/lib/env.js";
import * as octokitMod from "../../../src/lib/octokit.js";
import * as pathsMod from "../../../src/lib/paths.js";
import * as aiServiceMod from "../../../src/services/ai.service.js";
import * as asanaServiceMod from "../../../src/services/asana.service.js";
import * as metricsServiceMod from "../../../src/services/metrics.service.js";
import * as reportServiceMod from "../../../src/services/report.service.js";
import * as scopeServiceMod from "../../../src/services/scope.service.js";

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

mock.module("../../../src/lib/paths.js", () => ({
	...pathsMod,
	configDir: mock().mockReturnValue("/fake/config"),
}));

mock.module("../../../src/lib/env.js", () => ({
	...envMod,
	getEnv: mock().mockReturnValue(undefined),
	loadDotenv: mock().mockReturnValue({}),
}));

mock.module("../../../src/services/scope.service.js", () => ({
	...scopeServiceMod,
	ScopeService: mock().mockImplementation(() => ({ _type: "ScopeService" })),
}));

mock.module("../../../src/services/metrics.service.js", () => ({
	...metricsServiceMod,
	MetricsService: mock().mockImplementation(() => ({
		_type: "MetricsService",
	})),
}));

mock.module("../../../src/services/ai.service.js", () => ({
	...aiServiceMod,
	AIService: mock().mockImplementation(() => ({ _type: "AIService" })),
}));

mock.module("../../../src/services/asana.service.js", () => ({
	...asanaServiceMod,
	AsanaService: mock().mockImplementation(() => ({ _type: "AsanaService" })),
}));

const mockReportServiceInstance = { _type: "ReportService" };
mock.module("../../../src/services/report.service.js", () => ({
	...reportServiceMod,
	ReportService: mock().mockImplementation(() => mockReportServiceInstance),
}));

mock.module("../../../src/adapters/cache/cached-metrics-provider.js", () => ({
	...cachedMetricsMod,
	CachedMetricsProvider: mock().mockImplementation(() => ({
		_type: "CachedMetricsProvider",
	})),
}));

mock.module("../../../src/adapters/cache/cached-task-tracker.js", () => ({
	...cachedTaskTrackerMod,
	CachedTaskTrackerProvider: mock().mockImplementation(() => ({
		_type: "CachedTaskTrackerProvider",
	})),
}));

mock.module("../../../src/adapters/cache/cached-loc-collector.js", () => ({
	...cachedLocMod,
	CachedLocCollector: mock().mockImplementation(() => ({
		_type: "CachedLocCollector",
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
		(ScopeService as any).mockClear();
		(MetricsService as any).mockClear();
		(AIService as any).mockClear();
		(AsanaService as any).mockClear();
		(ReportService as any).mockClear();
		(CachedMetricsProvider as any).mockClear();
		(CachedTaskTrackerProvider as any).mockClear();
		(CachedLocCollector as any).mockClear();
		mocked(loadOctokitFromEnv).mockResolvedValue(mockOctokit);
		mocked(getEnv).mockReturnValue(undefined);
	});

	it("returns a ReportService instance", async () => {
		const result = await createReportService();
		expect(result).toBe(mockReportServiceInstance);
	});

	it("loads octokit from env", async () => {
		await createReportService();
		expect(loadOctokitFromEnv).toHaveBeenCalledOnce();
	});

	it("creates a ScopeService with the octokit client", async () => {
		await createReportService();
		expect(ScopeService).toHaveBeenCalledWith(mockOctokit);
	});

	it("creates a MetricsService with the octokit client and logger", async () => {
		await createReportService();
		expect(MetricsService).toHaveBeenCalledOnce();
		const [firstArg] = mocked(MetricsService).mock.calls[0];
		expect(firstArg).toBe(mockOctokit);
	});

	it("creates an AIService", async () => {
		await createReportService();
		expect(AIService).toHaveBeenCalledOnce();
	});

	it("creates CachedMetricsProvider wrapping MetricsService", async () => {
		await createReportService();
		expect(CachedMetricsProvider).toHaveBeenCalledOnce();
	});

	it("creates CachedLocCollector", async () => {
		await createReportService();
		expect(CachedLocCollector).toHaveBeenCalledOnce();
	});

	it("does NOT create AsanaService when ASANA_API_TOKEN is absent", async () => {
		mocked(getEnv).mockReturnValue(undefined);
		await createReportService();
		expect(AsanaService).not.toHaveBeenCalled();
		expect(CachedTaskTrackerProvider).not.toHaveBeenCalled();
	});

	it("creates AsanaService and CachedTaskTrackerProvider when ASANA_API_TOKEN is set", async () => {
		mocked(getEnv).mockImplementation((key) =>
			key === "ASANA_API_TOKEN" ? "fake-token" : undefined,
		);
		await createReportService();
		expect(AsanaService).toHaveBeenCalledOnce();
		expect(CachedTaskTrackerProvider).toHaveBeenCalledOnce();
	});

	it("passes cacheOptions through to CachedMetricsProvider", async () => {
		const cacheOptions = { ttlSeconds: 999 };
		await createReportService({ cacheOptions });
		expect(CachedMetricsProvider).toHaveBeenCalledWith(
			expect.anything(),
			cacheOptions,
		);
	});

	it("passes cacheOptions through to CachedLocCollector", async () => {
		const cacheOptions = { ttlSeconds: 42 };
		await createReportService({ cacheOptions });
		expect(CachedLocCollector).toHaveBeenCalledWith(cacheOptions);
	});

	it("wires the ReportService with scope, metrics, ai, and locCollector", async () => {
		await createReportService();
		expect(ReportService).toHaveBeenCalledWith(
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
