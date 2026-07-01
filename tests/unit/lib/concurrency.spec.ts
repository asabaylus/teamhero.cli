import { describe, expect, it } from "bun:test";

import { mapWithConcurrency } from "../../../src/lib/concurrency.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mapWithConcurrency", () => {
	it("preserves input order regardless of completion order", async () => {
		const items = [30, 10, 20, 5];
		const results = await mapWithConcurrency(items, 4, async (ms) => {
			await delay(ms);
			return ms * 2;
		});
		expect(results).toEqual([60, 20, 40, 10]);
	});

	it("never exceeds the concurrency limit", async () => {
		let inFlight = 0;
		let peak = 0;
		const items = Array.from({ length: 20 }, (_, i) => i);
		await mapWithConcurrency(items, 5, async (i) => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await delay(2);
			inFlight -= 1;
			return i;
		});
		expect(peak).toBeLessThanOrEqual(5);
		expect(peak).toBeGreaterThan(1);
	});

	it("processes every item exactly once", async () => {
		const items = Array.from({ length: 50 }, (_, i) => i);
		const seen = new Set<number>();
		const results = await mapWithConcurrency(items, 7, async (i) => {
			seen.add(i);
			return i;
		});
		expect(seen.size).toBe(50);
		expect(results).toEqual(items);
	});

	it("handles an empty input list", async () => {
		const results = await mapWithConcurrency([], 4, async () => 1);
		expect(results).toEqual([]);
	});

	it("rejects when a task rejects", async () => {
		await expect(
			mapWithConcurrency([1, 2, 3], 2, async (n) => {
				if (n === 2) throw new Error("boom");
				return n;
			}),
		).rejects.toThrow("boom");
	});

	it("clamps a limit below 1 to a single worker", async () => {
		let inFlight = 0;
		let peak = 0;
		await mapWithConcurrency([1, 2, 3], 0, async (n) => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await delay(1);
			inFlight -= 1;
			return n;
		});
		expect(peak).toBe(1);
	});

	it("clamps a non-finite (NaN) limit to a single worker instead of silently returning undefined", async () => {
		const items = [1, 2, 3];
		let inFlight = 0;
		let peak = 0;
		const results = await mapWithConcurrency(items, Number.NaN, async (n) => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await delay(1);
			inFlight -= 1;
			return n;
		});
		expect(results).toEqual(items);
		expect(peak).toBe(1);
	});
});
