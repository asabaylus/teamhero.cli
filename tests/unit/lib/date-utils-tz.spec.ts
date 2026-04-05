import { describe, expect, it } from "bun:test";
import {
	formatDateUTC,
	resolveEndEpochMs,
	resolveEndISO,
	resolveStartISO,
} from "../../../src/lib/date-utils.js";

describe("resolveStartISO", () => {
	it("converts bare date to UTC midnight", () => {
		expect(resolveStartISO("2026-02-22")).toBe("2026-02-22T00:00:00.000Z");
	});

	it("passes through full ISO strings unchanged", () => {
		expect(resolveStartISO("2026-02-22T14:30:00Z")).toBe(
			"2026-02-22T14:30:00.000Z",
		);
	});
});

describe("resolveEndISO", () => {
	it("adds 2-day buffer for bare dates to cover all timezones", () => {
		// "until Feb 28" should include commits authored on Feb 28 in any timezone.
		// A developer at UTC-12 authoring at 23:59 local = Mar 1 11:59 UTC.
		// +2 days from Feb 28 = Mar 2 00:00 UTC, which covers UTC-12.
		expect(resolveEndISO("2026-02-28")).toBe("2026-03-02T00:00:00.000Z");
	});

	it("handles month boundaries correctly", () => {
		expect(resolveEndISO("2026-01-31")).toBe("2026-02-02T00:00:00.000Z");
	});

	it("handles year boundaries correctly", () => {
		expect(resolveEndISO("2025-12-31")).toBe("2026-01-02T00:00:00.000Z");
	});

	it("passes through full ISO strings unchanged (no padding)", () => {
		const iso = "2026-02-28T15:00:00.000Z";
		expect(resolveEndISO(iso)).toBe(iso);
	});

	it("captures UTC-3 developer authoring at 23:29 local on Feb 28", () => {
		// Author date = 2026-03-01T02:29:00Z — must be < resolveEndISO("2026-02-28")
		const authorDateUTC = new Date("2026-03-01T02:29:00Z").getTime();
		const boundary = new Date(resolveEndISO("2026-02-28")).getTime();
		expect(authorDateUTC).toBeLessThan(boundary);
	});

	it("captures UTC-12 developer authoring at 23:59 local on Feb 28", () => {
		// Author date = 2026-03-01T11:59:00Z — must be < resolveEndISO("2026-02-28")
		const authorDateUTC = new Date("2026-03-01T11:59:00Z").getTime();
		const boundary = new Date(resolveEndISO("2026-02-28")).getTime();
		expect(authorDateUTC).toBeLessThan(boundary);
	});
});

describe("resolveEndEpochMs", () => {
	it("returns epoch ms matching resolveEndISO", () => {
		const ms = resolveEndEpochMs("2026-02-28");
		expect(ms).toBe(new Date("2026-03-02T00:00:00.000Z").getTime());
	});
});

describe("formatDateUTC", () => {
	it("formats UTC midnight dates without timezone shift", () => {
		// This was the bug: new Date("2026-02-22T00:00:00Z") formatted in local
		// timezone (UTC-3) would show "Feb 21". formatDateUTC must show "Feb 22".
		const date = new Date("2026-02-22T00:00:00Z");
		const formatted = formatDateUTC(date);
		expect(formatted).toContain("Feb");
		expect(formatted).toContain("22");
		expect(formatted).toContain("2026");
	});

	it("formats end-of-month dates correctly", () => {
		const date = new Date("2026-02-28T00:00:00Z");
		const formatted = formatDateUTC(date);
		expect(formatted).toContain("28");
	});
});
