/**
 * Period delta calculation for velocity trend reporting.
 *
 * Epic 5 — Story 5.3: Period Deltas and Velocity Trends.
 *
 * Computes deltas between current and previous period metrics,
 * providing absolute change and percentage change for key metrics.
 */

import type { MetricDelta, PeriodDeltas } from "../core/types.js";
import type { ReportMemberMetrics } from "../lib/report-renderer.js";

// ---------------------------------------------------------------------------
// Period date computation
// ---------------------------------------------------------------------------

/**
 * Given a current period defined by start/end ISO strings, compute the
 * previous period of the same length immediately preceding it.
 *
 * Example: current = Feb 18-25 -> previous = Feb 11-18.
 */
export function computePreviousPeriod(
	startISO: string,
	endISO: string,
): { prevStartISO: string; prevEndISO: string } {
	const start = new Date(startISO);
	const end = new Date(endISO);
	const durationMs = end.getTime() - start.getTime();

	const prevEnd = new Date(start.getTime());
	const prevStart = new Date(start.getTime() - durationMs);

	return {
		prevStartISO: prevStart.toISOString(),
		prevEndISO: prevEnd.toISOString(),
	};
}

// ---------------------------------------------------------------------------
// Delta computation
// ---------------------------------------------------------------------------

/**
 * Compute a MetricDelta for a single numeric metric.
 * Handles divide-by-zero for percentage calculation.
 */
export function computeMetricDelta(
	current: number,
	previous: number | undefined,
): MetricDelta {
	if (previous === undefined) {
		return { current };
	}

	const absoluteChange = current - previous;

	let percentageChange: number | undefined;
	if (previous === 0) {
		// Avoid divide-by-zero: if previous was 0 and current is non-zero, show as undefined
		percentageChange = current > 0 ? undefined : 0;
	} else {
		percentageChange = Math.round((absoluteChange / previous) * 100);
	}

	return {
		current,
		previous,
		absoluteChange,
		percentageChange,
	};
}

/** Summary stats extracted from member metrics for delta comparison. */
export interface PeriodSummary {
	prsMerged: number;
	prsOpened: number;
	tasksCompleted: number;
	linesChanged: number;
	commits: number;
}

/**
 * Extract aggregate summary stats from a set of member metrics.
 */
export function extractPeriodSummary(
	members: ReportMemberMetrics[],
): PeriodSummary {
	let prsMerged = 0;
	let prsOpened = 0;
	let tasksCompleted = 0;
	let linesChanged = 0;
	let commits = 0;

	for (const m of members) {
		prsMerged += m.prsMerged;
		prsOpened += m.prsOpened;
		commits += m.commits;
		linesChanged += m.linesAdded + m.linesDeleted;

		if (m.taskTracker?.status === "matched") {
			tasksCompleted += (m.taskTracker.tasks ?? []).filter(
				(t) => t.status === "completed" || Boolean(t.completedAt),
			).length;
		}
	}

	return { prsMerged, prsOpened, tasksCompleted, linesChanged, commits };
}

/**
 * Build PeriodDeltas by comparing current and previous period summaries.
 * Returns deltas with hasPreviousPeriod=false when previousSummary is undefined.
 */
export function buildPeriodDeltas(
	currentSummary: PeriodSummary,
	previousSummary: PeriodSummary | undefined,
): PeriodDeltas {
	if (!previousSummary) {
		return {
			prsMerged: { current: currentSummary.prsMerged },
			prsOpened: { current: currentSummary.prsOpened },
			tasksCompleted: { current: currentSummary.tasksCompleted },
			linesChanged: { current: currentSummary.linesChanged },
			commits: { current: currentSummary.commits },
			hasPreviousPeriod: false,
		};
	}

	return {
		prsMerged: computeMetricDelta(
			currentSummary.prsMerged,
			previousSummary.prsMerged,
		),
		prsOpened: computeMetricDelta(
			currentSummary.prsOpened,
			previousSummary.prsOpened,
		),
		tasksCompleted: computeMetricDelta(
			currentSummary.tasksCompleted,
			previousSummary.tasksCompleted,
		),
		linesChanged: computeMetricDelta(
			currentSummary.linesChanged,
			previousSummary.linesChanged,
		),
		commits: computeMetricDelta(
			currentSummary.commits,
			previousSummary.commits,
		),
		hasPreviousPeriod: true,
	};
}

/**
 * Extract a PeriodSummary from a serialized ReportRenderInput snapshot.
 * Mirrors extractPeriodSummary() but reads from stored JSON data instead of live objects.
 *
 * Returns null if the snapshot doesn't contain the expected shape.
 */
export function extractPeriodSummaryFromSnapshot(
	data: Record<string, unknown>,
): PeriodSummary | null {
	const memberMetrics = data.memberMetrics as
		| Array<Record<string, unknown>>
		| undefined;
	if (!Array.isArray(memberMetrics) || memberMetrics.length === 0) {
		return null;
	}

	let prsMerged = 0;
	let prsOpened = 0;
	let tasksCompleted = 0;
	let linesChanged = 0;
	let commits = 0;

	for (const m of memberMetrics) {
		prsMerged += (m.prsMerged as number) ?? 0;
		prsOpened += (m.prsOpened as number) ?? 0;
		commits += (m.commits as number) ?? 0;
		linesChanged +=
			((m.linesAdded as number) ?? 0) + ((m.linesDeleted as number) ?? 0);

		const taskTracker = m.taskTracker as Record<string, unknown> | undefined;
		if (taskTracker?.status === "matched") {
			const tasks = taskTracker.tasks as
				| Array<Record<string, unknown>>
				| undefined;
			if (Array.isArray(tasks)) {
				tasksCompleted += tasks.filter(
					(t) => t.status === "completed" || Boolean(t.completedAt),
				).length;
			}
		}
	}

	return { prsMerged, prsOpened, tasksCompleted, linesChanged, commits };
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

/**
 * Format a metric delta as "value (+delta, +percent%)" for report display.
 * Omits delta info when no previous period data is available.
 *
 * Examples:
 *   - formatDelta({ current: 23, previous: 18, absoluteChange: 5, percentageChange: 28 })
 *     -> "23 (+5, +28%)"
 *   - formatDelta({ current: 18, previous: 21, absoluteChange: -3, percentageChange: -14 })
 *     -> "18 (-3, -14%)"
 *   - formatDelta({ current: 10 })
 *     -> "10"
 *   - formatDelta({ current: 5, previous: 0, absoluteChange: 5, percentageChange: undefined })
 *     -> "5 (+5, new)"
 */
export function formatDelta(delta: MetricDelta): string {
	if (delta.previous === undefined || delta.absoluteChange === undefined) {
		return String(delta.current);
	}

	const sign = delta.absoluteChange >= 0 ? "+" : "";
	const changeStr = `${sign}${delta.absoluteChange}`;

	let pctStr: string;
	if (delta.percentageChange === undefined) {
		pctStr = "new";
	} else {
		const pctSign = delta.percentageChange >= 0 ? "+" : "";
		pctStr = `${pctSign}${delta.percentageChange}%`;
	}

	return `${delta.current} (${changeStr}, ${pctStr})`;
}

/**
 * Build a velocity context string for AI prompt injection.
 * Highlights notable changes (>20% delta) for AI narrative.
 */
export function buildVelocityContext(deltas: PeriodDeltas): string {
	if (!deltas.hasPreviousPeriod) {
		return "No previous period data available for velocity comparison.";
	}

	const lines: string[] = ["Velocity trends compared to previous period:"];
	const metrics: Array<{ label: string; delta: MetricDelta }> = [
		{ label: "PRs merged", delta: deltas.prsMerged },
		{ label: "PRs opened", delta: deltas.prsOpened },
		{ label: "Tasks completed", delta: deltas.tasksCompleted },
		{ label: "Lines changed", delta: deltas.linesChanged },
		{ label: "Commits", delta: deltas.commits },
	];

	const notable: string[] = [];

	for (const { label, delta } of metrics) {
		lines.push(`  ${label}: ${formatDelta(delta)}`);
		if (
			delta.percentageChange !== undefined &&
			Math.abs(delta.percentageChange) > 20
		) {
			const direction = delta.percentageChange > 0 ? "increased" : "decreased";
			notable.push(
				`${label} ${direction} by ${Math.abs(delta.percentageChange)}%`,
			);
		}
	}

	if (notable.length > 0) {
		lines.push("");
		lines.push(`Notable changes (>20% delta): ${notable.join("; ")}.`);
		lines.push(
			"The AI should reference these velocity changes in the executive summary narrative.",
		);
	}

	return lines.join("\n");
}
