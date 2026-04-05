/**
 * Date utilities for report date range validation.
 *
 * Environment Variables:
 * - MAX_REPORT_DAYS=N - Maximum allowed date range in days (default: 30, minimum: 1)
 */

/**
 * Custom error class for date validation errors.
 * Allows reliable error detection without brittle string matching.
 */
export class DateValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DateValidationError";
	}
}

/**
 * Maximum allowed date range in days.
 * Configurable via MAX_REPORT_DAYS environment variable.
 * Default: 30, Minimum: 1
 */
export const MAX_REPORT_DAYS = Math.max(
	1,
	Number.parseInt(process.env.MAX_REPORT_DAYS || "", 10) || 30,
);

/**
 * Extract just the date portion (YYYY-MM-DD) from a date string.
 * Handles inputs with time components like "2026-01-15T14:30:00".
 */
export function normalizeDate(dateStr: string): string {
	const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
	return match ? match[1] : dateStr;
}

/**
 * Validate that a string is a valid ISO 8601 date (YYYY-MM-DD).
 * Returns true if valid, false otherwise.
 * Also validates that the date is a real calendar date (e.g., rejects Feb 30).
 */
export function isValidDateString(dateStr: string): boolean {
	const normalized = normalizeDate(dateStr);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
		return false;
	}
	const date = new Date(`${normalized}T00:00:00Z`);
	if (Number.isNaN(date.getTime())) {
		return false;
	}
	// Verify the parsed date matches the input (catches invalid dates like Feb 30)
	const [year, month, day] = normalized.split("-").map(Number);
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() + 1 === month &&
		date.getUTCDate() === day
	);
}

/**
 * Calculate the number of days between two dates.
 * Uses UTC to avoid DST issues - counts calendar days, not milliseconds.
 * Always returns absolute (non-negative) value.
 */
export function getDateRangeDays(since: string, until: string): number {
	const start = new Date(`${normalizeDate(since)}T00:00:00Z`);
	const end = new Date(`${normalizeDate(until)}T00:00:00Z`);
	const msPerDay = 24 * 60 * 60 * 1000;
	return Math.abs(Math.floor((end.getTime() - start.getTime()) / msPerDay));
}

/**
 * Get default date range (last 7 days).
 * Uses local timezone for user-friendly defaults.
 */
export function getDefaultDates(): { since: string; until: string } {
	const now = new Date();
	// Use local date components to respect user's timezone
	const until = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
	const since = `${sevenDaysAgo.getFullYear()}-${String(sevenDaysAgo.getMonth() + 1).padStart(2, "0")}-${String(sevenDaysAgo.getDate()).padStart(2, "0")}`;
	return { since, until };
}

/**
 * Resolve a user-supplied "since" value to a UTC ISO timestamp suitable for
 * API calls. Bare dates (YYYY-MM-DD) are interpreted as midnight UTC on that
 * day. Full ISO strings are returned unchanged.
 *
 * Example: "2026-02-22" → "2026-02-22T00:00:00.000Z"
 */
export function resolveStartISO(since: string): string {
	if (/^\d{4}-\d{2}-\d{2}$/.test(since)) {
		return new Date(`${since}T00:00:00Z`).toISOString();
	}
	return new Date(since).toISOString();
}

/**
 * Resolve a user-supplied "until" value to a UTC ISO timestamp suitable for
 * API calls. The GitHub Commits API `until` parameter is exclusive and
 * filters by **author date**. A contributor in a negative-UTC timezone
 * (e.g. UTC-3 or UTC-12) can author a commit late on Feb 28 local time
 * whose author date in UTC falls on Mar 1. To ensure the entire calendar
 * day is captured worldwide we add a 2-day buffer:
 *
 *   "2026-02-28" → "2026-03-02T00:00:00.000Z"
 *
 * The buffer is safe because the API is exclusive (`until` is a strict
 * upper bound) and commits outside the intended range simply don't exist
 * on the branch.
 *
 * Full ISO strings are returned unchanged — callers who already computed
 * a precise boundary can bypass the padding.
 */
export function resolveEndISO(until: string): string {
	if (/^\d{4}-\d{2}-\d{2}$/.test(until)) {
		const padded = new Date(`${until}T00:00:00Z`);
		padded.setUTCDate(padded.getUTCDate() + 2);
		return padded.toISOString();
	}
	return new Date(until).toISOString();
}

/**
 * Resolve a user-supplied "until" value to an epoch-millisecond upper bound
 * suitable for client-side timestamp comparisons (inclusive). Uses the same
 * +2 day buffer as resolveEndISO so that PR/task date filtering matches the
 * API window.
 *
 * Example: "2026-02-28" → epoch ms for 2026-03-02T00:00:00Z
 */
export function resolveEndEpochMs(until: string): number {
	return new Date(resolveEndISO(until)).getTime();
}

/**
 * Format a Date in UTC as a human-readable string ("Feb 22, 2026").
 * Always uses UTC to avoid local-timezone display shifts.
 */
export function formatDateUTC(date: Date): string {
	return new Intl.DateTimeFormat("en", {
		month: "short",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	}).format(date);
}

/**
 * Validate that a date range is within allowed limits.
 * Throws DateValidationError if dates are invalid, since > until, or range exceeds MAX_REPORT_DAYS.
 */
export function validateDateRange(since: string, until: string): void {
	if (!isValidDateString(since)) {
		throw new DateValidationError(
			`Invalid start date: "${since}". Use YYYY-MM-DD format.`,
		);
	}
	if (!isValidDateString(until)) {
		throw new DateValidationError(
			`Invalid end date: "${until}". Use YYYY-MM-DD format.`,
		);
	}

	const sinceDate = new Date(`${normalizeDate(since)}T00:00:00Z`);
	const untilDate = new Date(`${normalizeDate(until)}T00:00:00Z`);

	if (sinceDate > untilDate) {
		throw new DateValidationError(
			"Start date must be before or equal to end date.",
		);
	}

	const days = getDateRangeDays(since, until);
	if (days > MAX_REPORT_DAYS) {
		throw new DateValidationError(
			`Date range exceeds maximum of ${MAX_REPORT_DAYS} days. Please select a shorter range.`,
		);
	}
}
