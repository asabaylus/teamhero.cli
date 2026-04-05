/**
 * Delta report service — computes "What Changed" between current and historical runs.
 *
 * When a previous period's snapshot exists in RunHistoryStore:
 *   - Per-metric deltas (existing PeriodDeltas)
 *   - Per-member velocity changes (who gained/lost activity)
 *   - Narrative summary for AI team highlight injection
 */

import type { PeriodDeltas } from "../core/types.js";
import type { ReportMemberMetrics } from "../lib/report-renderer.js";
import {
	type PeriodSummary,
	buildPeriodDeltas,
	extractPeriodSummary,
	extractPeriodSummaryFromSnapshot,
} from "./period-deltas.service.js";

export interface MemberDelta {
	login: string;
	displayName: string;
	currentPrsMerged: number;
	previousPrsMerged: number;
	currentCommits: number;
	previousCommits: number;
	changeDirection: "up" | "down" | "stable";
}

export interface DeltaReportResult {
	periodDeltas: PeriodDeltas;
	memberDeltas: MemberDelta[];
	narrative: string;
}

/**
 * Build a delta report by comparing current member metrics with a historical snapshot.
 */
export function buildDeltaReport(
	currentMembers: ReportMemberMetrics[],
	previousSnapshot: Record<string, unknown>,
): DeltaReportResult | null {
	const currentSummary = extractPeriodSummary(currentMembers);
	const previousSummary = extractPeriodSummaryFromSnapshot(previousSnapshot);

	if (!previousSummary) {
		return null;
	}

	const periodDeltas = buildPeriodDeltas(currentSummary, previousSummary);

	// Per-member deltas
	const prevMembers = previousSnapshot.memberMetrics as
		| Array<Record<string, unknown>>
		| undefined;
	const prevByLogin = new Map<string, Record<string, unknown>>();
	if (Array.isArray(prevMembers)) {
		for (const m of prevMembers) {
			const login = m.login as string;
			if (login) prevByLogin.set(login.toLowerCase(), m);
		}
	}

	const memberDeltas: MemberDelta[] = [];
	for (const current of currentMembers) {
		const prev = prevByLogin.get(current.login.toLowerCase());
		const prevMerged = (prev?.prsMerged as number) ?? 0;
		const prevCommits = (prev?.commits as number) ?? 0;

		let direction: "up" | "down" | "stable" = "stable";
		const totalCurrent = current.prsMerged + current.commits;
		const totalPrev = prevMerged + prevCommits;
		if (totalCurrent > totalPrev * 1.2) direction = "up";
		else if (totalCurrent < totalPrev * 0.8) direction = "down";

		memberDeltas.push({
			login: current.login,
			displayName: current.displayName,
			currentPrsMerged: current.prsMerged,
			previousPrsMerged: prevMerged,
			currentCommits: current.commits,
			previousCommits: prevCommits,
			changeDirection: direction,
		});
	}

	// Build narrative
	const narrative = buildDeltaNarrative(
		currentSummary,
		previousSummary,
		memberDeltas,
	);

	return { periodDeltas, memberDeltas, narrative };
}

function buildDeltaNarrative(
	current: PeriodSummary,
	previous: PeriodSummary,
	memberDeltas: MemberDelta[],
): string {
	const lines: string[] = [];

	// Overall direction
	const overallCurrent = current.prsMerged + current.commits;
	const overallPrevious = previous.prsMerged + previous.commits;
	if (overallPrevious > 0) {
		const pctChange = Math.round(
			((overallCurrent - overallPrevious) / overallPrevious) * 100,
		);
		if (Math.abs(pctChange) > 10) {
			const direction = pctChange > 0 ? "increased" : "decreased";
			lines.push(
				`Overall team velocity ${direction} by ${Math.abs(pctChange)}% compared to the previous period.`,
			);
		} else {
			lines.push(
				"Team velocity remained stable compared to the previous period.",
			);
		}
	}

	// Notable member changes
	const moversUp = memberDeltas.filter((m) => m.changeDirection === "up");
	const moversDown = memberDeltas.filter((m) => m.changeDirection === "down");

	if (moversUp.length > 0) {
		const names = moversUp
			.slice(0, 3)
			.map((m) => m.displayName)
			.join(", ");
		lines.push(`Increased activity from: ${names}.`);
	}
	if (moversDown.length > 0) {
		const names = moversDown
			.slice(0, 3)
			.map((m) => m.displayName)
			.join(", ");
		lines.push(`Decreased activity from: ${names}.`);
	}

	return lines.join(" ");
}
