import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";

import * as envMod from "../../../src/lib/env.js";

mock.module("../../../src/lib/env.js", () => ({
	...envMod,
	getEnv: mock(() => undefined),
}));

afterAll(() => {
	mock.restore();
});

const { IndividualSummarizerService } = await import(
	"../../../src/services/individual-summarizer.service.js"
);
const { getEnv } = await import("../../../src/lib/env.js");

import type {
	ContributorSummaryPayload,
	ContributorSummaryUsage,
} from "../../../src/models/individual-summary.js";
import type {
	SummarizerDriver,
	SummarizerDriverResult,
} from "../../../src/services/individual-summarizer.service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Type-safe cast for mocked functions */
function mocked<T extends (...args: any[]) => any>(fn: T) {
	return fn as T & ReturnType<typeof mock>;
}

function makePayload(login: string): ContributorSummaryPayload {
	return {
		contributor: { login, displayName: login },
		reportingWindow: {
			startISO: "2026-02-24T00:00:00Z",
			endISO: "2026-02-28T23:59:59Z",
			human: "Feb 24 - Feb 28, 2026",
		},
		metrics: {
			commits: 5,
			prsTotal: 3,
			prsMerged: 2,
			linesAdded: 100,
			linesDeleted: 20,
			reviews: 1,
		},
		pullRequests: [],
		asana: { status: "disabled", tasks: [] },
		highlights: { general: [], prs: [], commits: [] },
	};
}

function makeDriverResult(
	login: string,
	summary = `Summary for ${login}`,
): SummarizerDriverResult {
	return { login, summary };
}

function makeSuccessDriver(
	results?: SummarizerDriverResult[],
): SummarizerDriver {
	return mock(async (payloads) => {
		if (results) return results;
		return payloads.map((p) => makeDriverResult(p.contributor.login));
	}) as SummarizerDriver;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IndividualSummarizerService", () => {
	beforeEach(() => {
		mocked(getEnv).mockReturnValue(undefined);
	});

	// ---------------------------------------------------------------------------
	// process — empty payloads
	// ---------------------------------------------------------------------------

	describe("process with empty payloads", () => {
		it("returns empty map", async () => {
			const driver = makeSuccessDriver();
			const service = new IndividualSummarizerService({ driver });
			const result = await service.process([]);

			expect(result.size).toBe(0);
			expect(driver).not.toHaveBeenCalled();
		});
	});

	// ---------------------------------------------------------------------------
	// process — single batch
	// ---------------------------------------------------------------------------

	describe("process with single batch", () => {
		it("returns completed results for all payloads", async () => {
			const driver = makeSuccessDriver();
			const service = new IndividualSummarizerService({
				driver,
				batchSize: 10,
			});
			const payloads = [makePayload("alice"), makePayload("bob")];

			const result = await service.process(payloads);

			expect(result.size).toBe(2);
			expect(result.get("alice")).toEqual(
				expect.objectContaining({
					login: "alice",
					status: "completed",
					summary: "Summary for alice",
				}),
			);
			expect(result.get("bob")).toEqual(
				expect.objectContaining({
					login: "bob",
					status: "completed",
					summary: "Summary for bob",
				}),
			);
		});

		it("calls driver exactly once for a single batch", async () => {
			const driver = makeSuccessDriver();
			const service = new IndividualSummarizerService({
				driver,
				batchSize: 10,
			});
			await service.process([makePayload("alice")]);

			expect(driver).toHaveBeenCalledTimes(1);
		});

		it("includes usage from driver result", async () => {
			const usage: ContributorSummaryUsage = {
				promptTokens: 100,
				completionTokens: 50,
				costUsd: 0.01,
			};
			const driver = mock(async () => [
				{ login: "alice", summary: "Done", usage },
			]);
			const service = new IndividualSummarizerService({
				driver,
				batchSize: 10,
			});

			const result = await service.process([makePayload("alice")]);
			expect(result.get("alice")?.usage).toEqual(usage);
		});
	});

	// ---------------------------------------------------------------------------
	// process — multiple batches
	// ---------------------------------------------------------------------------

	describe("process with multiple batches", () => {
		it("splits payloads into correct number of batches", async () => {
			const driver = makeSuccessDriver();
			const service = new IndividualSummarizerService({ driver, batchSize: 2 });
			const payloads = [
				makePayload("a"),
				makePayload("b"),
				makePayload("c"),
				makePayload("d"),
				makePayload("e"),
			];

			const result = await service.process(payloads);

			// 5 items / batch size 2 = 3 batches
			expect(driver).toHaveBeenCalledTimes(3);
			expect(result.size).toBe(5);
		});

		it("processes all payloads across batches", async () => {
			const driver = makeSuccessDriver();
			const service = new IndividualSummarizerService({ driver, batchSize: 1 });
			const payloads = [
				makePayload("alice"),
				makePayload("bob"),
				makePayload("charlie"),
			];

			const result = await service.process(payloads);

			expect(result.size).toBe(3);
			for (const login of ["alice", "bob", "charlie"]) {
				expect(result.get(login)?.status).toBe("completed");
			}
		});
	});

	// ---------------------------------------------------------------------------
	// process — retry on 429
	// ---------------------------------------------------------------------------

	describe("retry on 429 status", () => {
		it("retries and succeeds on second attempt", async () => {
			const error429 = Object.assign(new Error("Too Many Requests"), {
				status: 429,
			});
			const driver = mock()
				.mockRejectedValueOnce(error429)
				.mockResolvedValueOnce([makeDriverResult("alice")]);

			const service = new IndividualSummarizerService({
				driver,
				batchSize: 10,
				maxRetries: 2,
				retryDelayMs: 1,
			});

			const result = await service.process([makePayload("alice")]);

			expect(driver).toHaveBeenCalledTimes(2);
			expect(result.get("alice")?.status).toBe("completed");
		});
	});

	// ---------------------------------------------------------------------------
	// process — retry on 5xx
	// ---------------------------------------------------------------------------

	describe("retry on 5xx status", () => {
		it("retries on 500 Internal Server Error", async () => {
			const error500 = Object.assign(new Error("Internal Server Error"), {
				status: 500,
			});
			const driver = mock()
				.mockRejectedValueOnce(error500)
				.mockResolvedValueOnce([makeDriverResult("alice")]);

			const service = new IndividualSummarizerService({
				driver,
				batchSize: 10,
				maxRetries: 2,
				retryDelayMs: 1,
			});

			const result = await service.process([makePayload("alice")]);

			expect(result.get("alice")?.status).toBe("completed");
		});

		it("retries on 503 Service Unavailable", async () => {
			const error503 = Object.assign(new Error("Service Unavailable"), {
				status: 503,
			});
			const driver = mock()
				.mockRejectedValueOnce(error503)
				.mockResolvedValueOnce([makeDriverResult("alice")]);

			const service = new IndividualSummarizerService({
				driver,
				batchSize: 10,
				maxRetries: 2,
				retryDelayMs: 1,
			});

			const result = await service.process([makePayload("alice")]);

			expect(result.get("alice")?.status).toBe("completed");
		});
	});

	// ---------------------------------------------------------------------------
	// process — retry on rate limit message
	// ---------------------------------------------------------------------------

	describe("retry on rate limit message", () => {
		it("retries when error message contains 'rate limit'", async () => {
			const rateLimitError = new Error("API rate limit exceeded");
			const driver = mock()
				.mockRejectedValueOnce(rateLimitError)
				.mockResolvedValueOnce([makeDriverResult("alice")]);

			const service = new IndividualSummarizerService({
				driver,
				batchSize: 10,
				maxRetries: 2,
				retryDelayMs: 1,
			});

			const result = await service.process([makePayload("alice")]);

			expect(result.get("alice")?.status).toBe("completed");
		});

		it("retries when error message contains 'too many requests'", async () => {
			const tooManyError = new Error("too many requests - please slow down");
			const driver = mock()
				.mockRejectedValueOnce(tooManyError)
				.mockResolvedValueOnce([makeDriverResult("alice")]);

			const service = new IndividualSummarizerService({
				driver,
				batchSize: 10,
				maxRetries: 2,
				retryDelayMs: 1,
			});

			const result = await service.process([makePayload("alice")]);

			expect(result.get("alice")?.status).toBe("completed");
		});

		it("retries case-insensitively for rate limit", async () => {
			const uppercaseError = new Error("RATE LIMIT hit");
			const driver = mock()
				.mockRejectedValueOnce(uppercaseError)
				.mockResolvedValueOnce([makeDriverResult("alice")]);

			const service = new IndividualSummarizerService({
				driver,
				batchSize: 10,
				maxRetries: 2,
				retryDelayMs: 1,
			});

			const result = await service.process([makePayload("alice")]);

			expect(result.get("alice")?.status).toBe("completed");
		});
	});

	// ---------------------------------------------------------------------------
	// process — max retries exceeded
	// ---------------------------------------------------------------------------

	describe("max retries exceeded", () => {
		it("fails the batch when retries exhausted", async () => {
			const error429 = Object.assign(new Error("Rate limited"), {
				status: 429,
			});
			const driver = mock().mockRejectedValue(error429);

			const service = new IndividualSummarizerService({
				driver,
				batchSize: 10,
				maxRetries: 2,
				retryDelayMs: 1,
			});

			const result = await service.process([
				makePayload("alice"),
				makePayload("bob"),
			]);

			// 1 initial + 2 retries = 3 calls
			expect(driver).toHaveBeenCalledTimes(3);
			expect(result.get("alice")?.status).toBe("failed");
			expect(result.get("alice")?.error).toBe("Rate limited");
			expect(result.get("bob")?.status).toBe("failed");
		});

		it("does not retry non-retryable errors", async () => {
			const error400 = Object.assign(new Error("Bad Request"), { status: 400 });
			const driver = mock().mockRejectedValue(error400);

			const service = new IndividualSummarizerService({
				driver,
				batchSize: 10,
				maxRetries: 5,
				retryDelayMs: 1,
			});

			const result = await service.process([makePayload("alice")]);

			expect(driver).toHaveBeenCalledTimes(1);
			expect(result.get("alice")?.status).toBe("failed");
		});

		it("does not retry errors without status or rate limit message", async () => {
			const genericError = new Error("Something went wrong");
			const driver = mock().mockRejectedValue(genericError);

			const service = new IndividualSummarizerService({
				driver,
				batchSize: 10,
				maxRetries: 5,
				retryDelayMs: 1,
			});

			const result = await service.process([makePayload("alice")]);

			expect(driver).toHaveBeenCalledTimes(1);
			expect(result.get("alice")?.status).toBe("failed");
		});

		it("converts non-Error thrown value to string in failure", async () => {
			const driver = mock().mockRejectedValue("raw string error");

			const service = new IndividualSummarizerService({
				driver,
				batchSize: 10,
				maxRetries: 0,
				retryDelayMs: 0,
			});

			const result = await service.process([makePayload("alice")]);

			expect(result.get("alice")?.error).toBe("raw string error");
		});
	});

	// ---------------------------------------------------------------------------
	// process — partial results with missing login
	// ---------------------------------------------------------------------------

	describe("partial results with missing login", () => {
		it("marks payloads without matching driver result as failed", async () => {
			// Driver returns result for alice but not bob
			const driver = mock(async () => [makeDriverResult("alice")]);

			const service = new IndividualSummarizerService({
				driver,
				batchSize: 10,
			});
			const result = await service.process([
				makePayload("alice"),
				makePayload("bob"),
			]);

			expect(result.get("alice")?.status).toBe("completed");
			expect(result.get("bob")?.status).toBe("failed");
			expect(result.get("bob")?.error).toBe(
				"Summarizer did not return a result.",
			);
		});

		it("marks all payloads as failed when driver returns empty", async () => {
			const driver = mock(async () => []);

			const service = new IndividualSummarizerService({
				driver,
				batchSize: 10,
			});
			const result = await service.process([makePayload("alice")]);

			expect(result.get("alice")?.status).toBe("failed");
			expect(result.get("alice")?.error).toBe(
				"Summarizer did not return a result.",
			);
		});
	});

	// ---------------------------------------------------------------------------
	// batch delay increases per attempt
	// ---------------------------------------------------------------------------

	describe("batch delay increases per attempt", () => {
		it("delays by retryDelayMs * attempt number", async () => {
			const error429 = Object.assign(new Error("Rate limited"), {
				status: 429,
			});
			const driver = mock()
				.mockRejectedValueOnce(error429) // attempt 1 -> delay 1*1=1ms
				.mockRejectedValueOnce(error429) // attempt 2 -> delay 2*1=2ms
				.mockResolvedValueOnce([makeDriverResult("alice")]);

			const setTimeoutSpy = spyOn(globalThis, "setTimeout");

			const service = new IndividualSummarizerService({
				driver,
				batchSize: 10,
				maxRetries: 3,
				retryDelayMs: 1,
			});

			const result = await service.process([makePayload("alice")]);

			expect(driver).toHaveBeenCalledTimes(3);
			expect(result.get("alice")?.status).toBe("completed");

			// Verify setTimeout was called with increasing delays
			const timeoutCalls = setTimeoutSpy.mock.calls
				.map(([, ms]) => ms)
				.filter((ms): ms is number => typeof ms === "number" && ms > 0);

			expect(timeoutCalls).toContain(1); // first retry
			expect(timeoutCalls).toContain(2); // second retry

			setTimeoutSpy.mockRestore();
		});
	});

	// ---------------------------------------------------------------------------
	// batchSize configuration
	// ---------------------------------------------------------------------------

	describe("batchSize configuration", () => {
		it("defaults to 5 when env var not set", async () => {
			const driver = makeSuccessDriver();
			const service = new IndividualSummarizerService({ driver });

			const payloads = Array.from({ length: 12 }, (_, i) =>
				makePayload(`user-${i}`),
			);
			await service.process(payloads);

			// 12 items / batch size 5 = 3 batches
			expect(driver).toHaveBeenCalledTimes(3);
		});

		it("uses TEAMHERO_INDIVIDUAL_BATCH_SIZE env var", async () => {
			mocked(getEnv).mockReturnValue("3");

			// Re-mock env to return "3"
			mock.module("../../../src/lib/env.js", () => ({
				...envMod,
				getEnv: mock(() => "3"),
			}));

			const { IndividualSummarizerService: FreshService } = await import(
				"../../../src/services/individual-summarizer.service.js"
			);

			const driver = makeSuccessDriver();
			const service = new FreshService({ driver });

			const payloads = Array.from({ length: 7 }, (_, i) =>
				makePayload(`user-${i}`),
			);
			await service.process(payloads);

			// 7 items / batch size 3 = 3 batches
			expect(driver).toHaveBeenCalledTimes(3);
		});

		it("clamps batchSize to minimum 1", async () => {
			const driver = makeSuccessDriver();
			const service = new IndividualSummarizerService({ driver, batchSize: 0 });

			await service.process([makePayload("alice")]);

			expect(driver).toHaveBeenCalledTimes(1);
		});
	});

	// ---------------------------------------------------------------------------
	// maxRetries = 0 means no retries
	// ---------------------------------------------------------------------------

	describe("maxRetries = 0", () => {
		it("fails immediately without retrying", async () => {
			const error429 = Object.assign(new Error("Rate limited"), {
				status: 429,
			});
			const driver = mock().mockRejectedValue(error429);

			const service = new IndividualSummarizerService({
				driver,
				batchSize: 10,
				maxRetries: 0,
				retryDelayMs: 1,
			});

			const result = await service.process([makePayload("alice")]);

			expect(driver).toHaveBeenCalledTimes(1);
			expect(result.get("alice")?.status).toBe("failed");
		});
	});

	// ---------------------------------------------------------------------------
	// Error continues to next batch
	// ---------------------------------------------------------------------------

	describe("failed batch does not prevent other batches", () => {
		it("continues processing subsequent batches after failure", async () => {
			const error400 = Object.assign(new Error("Bad Request"), { status: 400 });
			const driver = mock()
				.mockRejectedValueOnce(error400)
				.mockResolvedValueOnce([makeDriverResult("bob")]);

			const service = new IndividualSummarizerService({
				driver,
				batchSize: 1,
				maxRetries: 0,
			});

			const result = await service.process([
				makePayload("alice"),
				makePayload("bob"),
			]);

			expect(result.get("alice")?.status).toBe("failed");
			expect(result.get("bob")?.status).toBe("completed");
		});
	});
});
