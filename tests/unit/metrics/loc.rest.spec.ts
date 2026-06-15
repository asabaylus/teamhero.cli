/**
 * Tests for src/metrics/loc.rest.ts — input validation + fetch retry policy.
 */
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { consola } from "consola";
import {
	collectLocMetricsRest,
	collectRepoCommits,
} from "../../../src/metrics/loc.rest.js";

describe("collectLocMetricsRest — input validation", () => {
	it("throws when neither org nor repos are provided", async () => {
		await expect(
			collectLocMetricsRest({
				sinceIso: "2026-03-01T00:00:00Z",
				untilIso: "2026-03-08T00:00:00Z",
				token: "ghp_test",
			}),
		).rejects.toThrow("Provide an organization or a list of repositories");
	});

	it("throws when repos is an empty array and no org", async () => {
		await expect(
			collectLocMetricsRest({
				repos: [],
				sinceIso: "2026-03-01T00:00:00Z",
				untilIso: "2026-03-08T00:00:00Z",
				token: "ghp_test",
			}),
		).rejects.toThrow("Provide an organization or a list of repositories");
	});

	it("throws when sinceIso is invalid", async () => {
		await expect(
			collectLocMetricsRest({
				repos: ["org/repo"],
				sinceIso: "not-a-date",
				untilIso: "2026-03-08T00:00:00Z",
				token: "ghp_test",
			}),
		).rejects.toThrow("Invalid ISO date range provided");
	});

	it("throws when untilIso is invalid", async () => {
		await expect(
			collectLocMetricsRest({
				repos: ["org/repo"],
				sinceIso: "2026-03-01T00:00:00Z",
				untilIso: "invalid",
				token: "ghp_test",
			}),
		).rejects.toThrow("Invalid ISO date range provided");
	});
});

describe("fetchWithRetry policy (via collectRepoCommits)", () => {
	const okEmptyCommits = () =>
		new Response(JSON.stringify([]), { status: 200 });

	function mockFetchSequence(responses: Response[]): { calls: () => number } {
		let i = 0;
		const spy = spyOn(global, "fetch").mockImplementation(() =>
			Promise.resolve(responses[Math.min(i++, responses.length - 1)]),
		);
		return { calls: () => spy.mock.calls.length };
	}

	afterEach(() => {
		(global.fetch as unknown as { mockRestore?: () => void }).mockRestore?.();
		(consola.warn as unknown as { mockRestore?: () => void }).mockRestore?.();
		(consola.error as unknown as { mockRestore?: () => void }).mockRestore?.();
	});

	const run = () =>
		collectRepoCommits(
			"the-org",
			"r1",
			"ghp_test",
			"2026-01-01T00:00:00.000Z",
			"2026-02-01T00:00:00.000Z",
		);

	it("retries a 429 and then succeeds", async () => {
		spyOn(consola, "warn").mockImplementation(() => {});
		const { calls } = mockFetchSequence([
			new Response("{}", { status: 429 }),
			okEmptyCommits(),
		]);
		const result = await run();
		expect(result.size).toBe(0); // empty repo window, but the retry recovered
		expect(calls()).toBe(2);
		expect(consola.warn).toHaveBeenCalled();
	});

	it("retries a transient 5xx and then succeeds", async () => {
		spyOn(consola, "warn").mockImplementation(() => {});
		const { calls } = mockFetchSequence([
			new Response("boom", { status: 503 }),
			okEmptyCommits(),
		]);
		await run();
		expect(calls()).toBe(2);
	});

	it("retries a rate-limited 403 (quota exhausted)", async () => {
		spyOn(consola, "warn").mockImplementation(() => {});
		const { calls } = mockFetchSequence([
			new Response("{}", {
				status: 403,
				headers: { "x-ratelimit-remaining": "0" },
			}),
			okEmptyCommits(),
		]);
		await run();
		expect(calls()).toBe(2);
	});

	it("does NOT retry a 403 auth/permission failure (no rate-limit markers)", async () => {
		const { calls } = mockFetchSequence([
			new Response("Forbidden", { status: 403 }),
		]);
		// A plain 403 is a hard failure — surfaced to the caller, never retried.
		await expect(run()).rejects.toThrow(/403/);
		expect(calls()).toBe(1);
	});
});
