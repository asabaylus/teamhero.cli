/**
 * Tests for src/metrics/loc.rest.ts — input validation error paths.
 */
import { describe, expect, it } from "bun:test";
import { collectLocMetricsRest } from "../../../src/metrics/loc.rest.js";

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
