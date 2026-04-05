import { describe, expect, it } from "bun:test";
import {
	DateValidationError,
	getDateRangeDays,
	getDefaultDates,
	isValidDateString,
	MAX_REPORT_DAYS,
	normalizeDate,
	validateDateRange,
} from "../../src/lib/date-utils.js";

describe("date-utils", () => {
	describe("MAX_REPORT_DAYS", () => {
		it("should have a default value of 30 when env var not set", () => {
			// In test context without MAX_REPORT_DAYS env var, default should be 30
			// Note: env var testing requires process restart since it's evaluated at module load
			expect(MAX_REPORT_DAYS).toBe(30);
		});

		it("should be at least 1 (minimum enforced)", () => {
			expect(MAX_REPORT_DAYS).toBeGreaterThanOrEqual(1);
		});
	});

	describe("normalizeDate", () => {
		it("should extract date from YYYY-MM-DD format", () => {
			expect(normalizeDate("2026-01-15")).toBe("2026-01-15");
		});

		it("should strip time components from ISO datetime", () => {
			expect(normalizeDate("2026-01-15T14:30:00")).toBe("2026-01-15");
			expect(normalizeDate("2026-01-15T14:30:00Z")).toBe("2026-01-15");
			expect(normalizeDate("2026-01-15T14:30:00+05:00")).toBe("2026-01-15");
		});

		it("should return original string if no date pattern found", () => {
			expect(normalizeDate("invalid")).toBe("invalid");
		});
	});

	describe("isValidDateString", () => {
		it("should return true for valid YYYY-MM-DD dates", () => {
			expect(isValidDateString("2026-01-15")).toBe(true);
			expect(isValidDateString("2024-02-29")).toBe(true); // leap year
		});

		it("should return true for dates with time components (normalizes first)", () => {
			expect(isValidDateString("2026-01-15T14:30:00")).toBe(true);
		});

		it("should return false for invalid date formats", () => {
			expect(isValidDateString("2026-1-15")).toBe(false); // missing zero padding
			expect(isValidDateString("2026/01/15")).toBe(false); // wrong separator
			expect(isValidDateString("01-15-2026")).toBe(false); // wrong order
			expect(isValidDateString("invalid")).toBe(false);
			expect(isValidDateString("")).toBe(false);
		});

		it("should return false for invalid calendar dates", () => {
			expect(isValidDateString("2026-02-30")).toBe(false); // Feb 30 doesn't exist
			expect(isValidDateString("2026-13-01")).toBe(false); // month 13
		});
	});

	describe("getDateRangeDays", () => {
		it("should return 7 for a 7-day range", () => {
			expect(getDateRangeDays("2026-01-01", "2026-01-08")).toBe(7);
		});

		it("should return 0 for same day", () => {
			expect(getDateRangeDays("2026-01-01", "2026-01-01")).toBe(0);
		});

		it("should return 30 for a 30-day range", () => {
			expect(getDateRangeDays("2026-01-01", "2026-01-31")).toBe(30);
		});

		it("should handle year boundary correctly", () => {
			// Dec 28 to Jan 4 = 7 days
			expect(getDateRangeDays("2025-12-28", "2026-01-04")).toBe(7);
		});

		it("should handle leap year", () => {
			// Feb 28 to Mar 1 in leap year (2024) = 2 days
			expect(getDateRangeDays("2024-02-28", "2024-03-01")).toBe(2);
		});

		it("should return absolute value for reversed ranges (F1 fix)", () => {
			// since > until should still return positive days
			expect(getDateRangeDays("2026-01-10", "2026-01-01")).toBe(9);
		});

		it("should handle dates with time components (F13 fix)", () => {
			expect(
				getDateRangeDays("2026-01-01T10:00:00", "2026-01-08T15:00:00"),
			).toBe(7);
		});
	});

	describe("getDefaultDates", () => {
		it("should return dates in YYYY-MM-DD format", () => {
			const { since, until } = getDefaultDates();
			expect(since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		});

		it("should return dates exactly 7 days apart", () => {
			const { since, until } = getDefaultDates();
			const days = getDateRangeDays(since, until);
			expect(days).toBe(7);
		});
	});

	describe("validateDateRange", () => {
		it("should not throw for valid range within limit", () => {
			expect(() => validateDateRange("2026-01-01", "2026-01-08")).not.toThrow();
		});

		it("should throw DateValidationError for since > until", () => {
			expect(() => validateDateRange("2026-01-20", "2026-01-10")).toThrow(
				DateValidationError,
			);
			expect(() => validateDateRange("2026-01-20", "2026-01-10")).toThrow(
				"Start date must be before or equal to end date",
			);
		});

		it("should throw DateValidationError for range exceeding MAX_REPORT_DAYS", () => {
			// 45-day range should exceed default MAX_REPORT_DAYS of 30
			expect(() => validateDateRange("2026-01-01", "2026-02-15")).toThrow(
				DateValidationError,
			);
			expect(() => validateDateRange("2026-01-01", "2026-02-15")).toThrow(
				/exceeds maximum/,
			);
		});

		it("should allow range exactly equal to MAX_REPORT_DAYS", () => {
			// 30-day range should pass when MAX_REPORT_DAYS is 30
			expect(() => validateDateRange("2026-01-01", "2026-01-31")).not.toThrow();
		});

		it("should throw for range of exactly MAX_REPORT_DAYS + 1 (F11 boundary test)", () => {
			// 31-day range should fail when MAX_REPORT_DAYS is 30
			expect(() => validateDateRange("2026-01-01", "2026-02-01")).toThrow(
				DateValidationError,
			);
		});

		it("should throw DateValidationError for invalid date strings (F3 fix)", () => {
			expect(() => validateDateRange("invalid", "2026-01-10")).toThrow(
				DateValidationError,
			);
			expect(() => validateDateRange("2026-01-01", "not-a-date")).toThrow(
				DateValidationError,
			);
			expect(() => validateDateRange("2026-1-1", "2026-01-10")).toThrow(
				DateValidationError,
			); // loose format
		});

		it("should handle dates with time components (F13 fix)", () => {
			expect(() =>
				validateDateRange("2026-01-01T10:00:00", "2026-01-08T15:00:00"),
			).not.toThrow();
		});
	});

	describe("DateValidationError", () => {
		it("should be an instance of Error", () => {
			const error = new DateValidationError("test message");
			expect(error).toBeInstanceOf(Error);
			expect(error).toBeInstanceOf(DateValidationError);
		});

		it("should have correct name property", () => {
			const error = new DateValidationError("test message");
			expect(error.name).toBe("DateValidationError");
		});

		it("should preserve message", () => {
			const error = new DateValidationError("custom error message");
			expect(error.message).toBe("custom error message");
		});
	});
});
