/**
 * Tests for period delta calculation and velocity trends (Epic 5, Story 5.3).
 */

import { describe, expect, it } from "bun:test";
import type { ReportMemberMetrics } from "../../../src/lib/report-renderer.js";
import {
	buildPeriodDeltas,
	buildVelocityContext,
	computeMetricDelta,
	computePreviousPeriod,
	extractPeriodSummary,
	extractPeriodSummaryFromSnapshot,
	formatDelta,
	type PeriodSummary,
} from "../../../src/services/period-deltas.service.js";

describe("computePreviousPeriod", () => {
	it("computes correct previous period for a 7-day window", () => {
		const result = computePreviousPeriod(
			"2026-02-18T00:00:00.000Z",
			"2026-02-25T00:00:00.000Z",
		);

		const prevStart = new Date(result.prevStartISO);
		const prevEnd = new Date(result.prevEndISO);

		expect(prevStart.toISOString()).toBe("2026-02-11T00:00:00.000Z");
		expect(prevEnd.toISOString()).toBe("2026-02-18T00:00:00.000Z");
	});

	it("handles 14-day periods", () => {
		const result = computePreviousPeriod(
			"2026-02-11T00:00:00.000Z",
			"2026-02-25T00:00:00.000Z",
		);

		const prevStart = new Date(result.prevStartISO);
		const prevEnd = new Date(result.prevEndISO);

		expect(prevStart.toISOString()).toBe("2026-01-28T00:00:00.000Z");
		expect(prevEnd.toISOString()).toBe("2026-02-11T00:00:00.000Z");
	});
});

describe("computeMetricDelta", () => {
	it("computes positive delta correctly", () => {
		const delta = computeMetricDelta(23, 18);
		expect(delta.current).toBe(23);
		expect(delta.previous).toBe(18);
		expect(delta.absoluteChange).toBe(5);
		expect(delta.percentageChange).toBe(28); // 5/18*100 = 27.7... rounded to 28
	});

	it("computes negative delta correctly", () => {
		const delta = computeMetricDelta(18, 21);
		expect(delta.current).toBe(18);
		expect(delta.previous).toBe(21);
		expect(delta.absoluteChange).toBe(-3);
		expect(delta.percentageChange).toBe(-14); // -3/21*100 = -14.28... rounded to -14
	});

	it("computes zero delta correctly", () => {
		const delta = computeMetricDelta(10, 10);
		expect(delta.absoluteChange).toBe(0);
		expect(delta.percentageChange).toBe(0);
	});

	it("handles divide-by-zero when previous is 0 and current is non-zero", () => {
		const delta = computeMetricDelta(5, 0);
		expect(delta.absoluteChange).toBe(5);
		expect(delta.percentageChange).toBeUndefined();
	});

	it("handles divide-by-zero when both are 0", () => {
		const delta = computeMetricDelta(0, 0);
		expect(delta.absoluteChange).toBe(0);
		expect(delta.percentageChange).toBe(0);
	});

	it("returns only current when previous is undefined", () => {
		const delta = computeMetricDelta(10, undefined);
		expect(delta.current).toBe(10);
		expect(delta.previous).toBeUndefined();
		expect(delta.absoluteChange).toBeUndefined();
		expect(delta.percentageChange).toBeUndefined();
	});
});

describe("formatDelta", () => {
	it("formats positive delta with percentage", () => {
		const result = formatDelta({
			current: 23,
			previous: 18,
			absoluteChange: 5,
			percentageChange: 28,
		});
		expect(result).toBe("23 (+5, +28%)");
	});

	it("formats negative delta with percentage", () => {
		const result = formatDelta({
			current: 18,
			previous: 21,
			absoluteChange: -3,
			percentageChange: -14,
		});
		expect(result).toBe("18 (-3, -14%)");
	});

	it("formats delta without previous period as plain number", () => {
		const result = formatDelta({ current: 10 });
		expect(result).toBe("10");
	});

	it("formats 'new' when percentage is undefined (prev was 0)", () => {
		const result = formatDelta({
			current: 5,
			previous: 0,
			absoluteChange: 5,
			percentageChange: undefined,
		});
		expect(result).toBe("5 (+5, new)");
	});

	it("formats zero change", () => {
		const result = formatDelta({
			current: 10,
			previous: 10,
			absoluteChange: 0,
			percentageChange: 0,
		});
		expect(result).toBe("10 (+0, +0%)");
	});
});

describe("extractPeriodSummary", () => {
	it("aggregates metrics across members", () => {
		const members: ReportMemberMetrics[] = [
			{
				login: "alice",
				displayName: "Alice",
				commits: 10,
				prsOpened: 3,
				prsClosed: 0,
				prsMerged: 2,
				linesAdded: 500,
				linesDeleted: 200,
				linesAddedInProgress: 0,
				linesDeletedInProgress: 0,
				reviews: 5,
				approvals: 2,
				changesRequested: 1,
				commented: 2,
				reviewComments: 1,
				highlights: [],
				prHighlights: [],
				commitHighlights: [],
				aiSummary: "",
				taskTracker: {
					status: "matched",
					tasks: [
						{
							gid: "1",
							name: "Task A",
							status: "completed",
							completedAt: "2026-02-20",
						},
						{ gid: "2", name: "Task B", status: "incomplete" },
					],
				},
			},
			{
				login: "bob",
				displayName: "Bob",
				commits: 5,
				prsOpened: 1,
				prsClosed: 1,
				prsMerged: 1,
				linesAdded: 200,
				linesDeleted: 100,
				linesAddedInProgress: 0,
				linesDeletedInProgress: 0,
				reviews: 3,
				approvals: 1,
				changesRequested: 0,
				commented: 2,
				reviewComments: 0,
				highlights: [],
				prHighlights: [],
				commitHighlights: [],
				aiSummary: "",
				taskTracker: {
					status: "matched",
					tasks: [
						{
							gid: "3",
							name: "Task C",
							status: "completed",
							completedAt: "2026-02-21",
						},
					],
				},
			},
		];

		const summary = extractPeriodSummary(members);
		expect(summary.prsMerged).toBe(3);
		expect(summary.prsOpened).toBe(4);
		expect(summary.commits).toBe(15);
		expect(summary.linesChanged).toBe(1000); // 500+200+200+100
		expect(summary.tasksCompleted).toBe(2);
	});
});

describe("buildPeriodDeltas", () => {
	it("builds deltas when previous period data is available", () => {
		const current: PeriodSummary = {
			prsMerged: 23,
			prsOpened: 15,
			tasksCompleted: 10,
			linesChanged: 5000,
			commits: 30,
		};
		const previous: PeriodSummary = {
			prsMerged: 18,
			prsOpened: 12,
			tasksCompleted: 8,
			linesChanged: 4000,
			commits: 25,
		};

		const deltas = buildPeriodDeltas(current, previous);
		expect(deltas.hasPreviousPeriod).toBe(true);
		expect(deltas.prsMerged.absoluteChange).toBe(5);
		expect(deltas.prsOpened.absoluteChange).toBe(3);
		expect(deltas.tasksCompleted.absoluteChange).toBe(2);
	});

	it("returns deltas without previous period gracefully", () => {
		const current: PeriodSummary = {
			prsMerged: 23,
			prsOpened: 15,
			tasksCompleted: 10,
			linesChanged: 5000,
			commits: 30,
		};

		const deltas = buildPeriodDeltas(current, undefined);
		expect(deltas.hasPreviousPeriod).toBe(false);
		expect(deltas.prsMerged.current).toBe(23);
		expect(deltas.prsMerged.absoluteChange).toBeUndefined();
	});
});

describe("buildVelocityContext", () => {
	it("returns no-data message when no previous period", () => {
		const deltas = buildPeriodDeltas(
			{
				prsMerged: 10,
				prsOpened: 5,
				tasksCompleted: 3,
				linesChanged: 1000,
				commits: 20,
			},
			undefined,
		);
		const context = buildVelocityContext(deltas);
		expect(context).toContain("No previous period data available");
	});

	it("includes notable changes above 20% threshold", () => {
		const deltas = buildPeriodDeltas(
			{
				prsMerged: 30,
				prsOpened: 5,
				tasksCompleted: 3,
				linesChanged: 1000,
				commits: 20,
			},
			{
				prsMerged: 10,
				prsOpened: 5,
				tasksCompleted: 3,
				linesChanged: 1000,
				commits: 20,
			},
		);
		const context = buildVelocityContext(deltas);
		expect(context).toContain("PRs merged increased by 200%");
		expect(context).toContain("Notable changes");
	});

	it("does not flag small changes as notable", () => {
		const deltas = buildPeriodDeltas(
			{
				prsMerged: 11,
				prsOpened: 5,
				tasksCompleted: 3,
				linesChanged: 1000,
				commits: 20,
			},
			{
				prsMerged: 10,
				prsOpened: 5,
				tasksCompleted: 3,
				linesChanged: 1000,
				commits: 20,
			},
		);
		const context = buildVelocityContext(deltas);
		expect(context).not.toContain("Notable changes");
	});
});

describe("extractPeriodSummaryFromSnapshot", () => {
	it("extracts summary from valid snapshot data", () => {
		const snapshot = {
			memberMetrics: [
				{
					login: "alice",
					prsMerged: 5,
					prsOpened: 3,
					commits: 10,
					linesAdded: 500,
					linesDeleted: 200,
				},
				{
					login: "bob",
					prsMerged: 3,
					prsOpened: 2,
					commits: 8,
					linesAdded: 300,
					linesDeleted: 100,
				},
			],
		};

		const summary = extractPeriodSummaryFromSnapshot(snapshot);
		expect(summary).not.toBeNull();
		expect(summary!.prsMerged).toBe(8);
		expect(summary!.prsOpened).toBe(5);
		expect(summary!.commits).toBe(18);
		expect(summary!.linesChanged).toBe(1100); // 500+200+300+100
	});

	it("returns null for empty snapshot", () => {
		expect(extractPeriodSummaryFromSnapshot({})).toBeNull();
	});

	it("returns null for empty memberMetrics array", () => {
		expect(extractPeriodSummaryFromSnapshot({ memberMetrics: [] })).toBeNull();
	});

	it("counts completed tasks from snapshot", () => {
		const snapshot = {
			memberMetrics: [
				{
					login: "alice",
					prsMerged: 1,
					prsOpened: 1,
					commits: 5,
					linesAdded: 100,
					linesDeleted: 50,
					taskTracker: {
						status: "matched",
						tasks: [
							{
								name: "Task A",
								status: "completed",
								completedAt: "2026-02-20",
							},
							{ name: "Task B", status: "incomplete" },
						],
					},
				},
			],
		};

		const summary = extractPeriodSummaryFromSnapshot(snapshot);
		expect(summary!.tasksCompleted).toBe(1);
	});
});
