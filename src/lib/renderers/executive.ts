import type { MetricDelta } from "../../core/types.js";
import type { ReportRenderer } from "../../core/types.js";
import type { ReportRenderInput } from "../report-renderer.js";

// ---------------------------------------------------------------------------
// Delta formatting helpers (compact, executive-friendly)
// ---------------------------------------------------------------------------

/**
 * Format the current value of a metric delta as a plain number string.
 */
function formatDelta(delta: MetricDelta): string {
	return String(delta.current);
}

/**
 * Format the absolute change of a metric delta.
 * Returns "+N", "-N", or "—" (em dash) for zero / undefined change.
 */
function formatDeltaChange(delta: MetricDelta): string {
	if (delta.absoluteChange === undefined) {
		return "—";
	}
	if (delta.absoluteChange === 0) {
		return "—";
	}
	const sign = delta.absoluteChange > 0 ? "+" : "";
	return `${sign}${delta.absoluteChange}`;
}

// ---------------------------------------------------------------------------
// Executive renderer
// ---------------------------------------------------------------------------

export const executiveRenderer: ReportRenderer = {
	name: "executive",
	description:
		"Board-ready 1-page executive summary with team highlights and velocity trends",
	render(input: ReportRenderInput): string {
		const parts: string[] = [];

		// 1. Title
		parts.push(
			`# Executive Summary (${input.window.start} – ${input.window.end})`,
		);
		parts.push("");

		// 2. Team Highlight
		if (input.teamHighlight) {
			parts.push(input.teamHighlight);
		} else {
			const { prsMerged, repoCount, contributorCount } = input.totals;
			parts.push(
				`${prsMerged} PRs merged across ${repoCount} repositories by ${contributorCount} engineers.`,
			);
		}
		parts.push("");

		// 3. Key Metrics
		const { prsMerged, repoCount, contributorCount } = input.totals;
		parts.push(
			`**Key Metrics:** ${prsMerged} PRs merged across ${repoCount} repos by ${contributorCount} engineers`,
		);
		parts.push("");

		// 4. Velocity Trends
		if (input.periodDeltas?.hasPreviousPeriod) {
			parts.push("## Velocity Trends");
			parts.push("");
			parts.push("| Metric | This Period | Change |");
			parts.push("|--------|----------:|-------:|");
			const deltas = input.periodDeltas;
			parts.push(
				`| PRs Merged | ${formatDelta(deltas.prsMerged)} | ${formatDeltaChange(deltas.prsMerged)} |`,
			);
			parts.push(
				`| PRs Opened | ${formatDelta(deltas.prsOpened)} | ${formatDeltaChange(deltas.prsOpened)} |`,
			);
			parts.push(
				`| Tasks Completed | ${formatDelta(deltas.tasksCompleted)} | ${formatDeltaChange(deltas.tasksCompleted)} |`,
			);
			parts.push(
				`| Lines Changed | ${formatDelta(deltas.linesChanged)} | ${formatDeltaChange(deltas.linesChanged)} |`,
			);
			parts.push(
				`| Commits | ${formatDelta(deltas.commits)} | ${formatDeltaChange(deltas.commits)} |`,
			);
			parts.push("");
		}

		// 5. Top Visible Wins (up to 5)
		if (input.visibleWins && input.visibleWins.length > 0) {
			parts.push("## Top Accomplishments");
			parts.push("");
			const topWins = input.visibleWins.slice(0, 5);
			for (const win of topWins) {
				const summary =
					win.bullets.length > 0 ? win.bullets[0].text : "(no detail)";
				parts.push(`- **${win.projectName}**: ${summary}`);
			}
			parts.push("");
		}

		// 6. Roadmap Status
		if (input.roadmapEntries && input.roadmapEntries.length > 0) {
			parts.push("## Roadmap Status");
			parts.push("");
			parts.push("| Item | Status | Progress |");
			parts.push("|------|--------|----------|");
			for (const entry of input.roadmapEntries) {
				const title = entry.displayName.replace(/\|/g, "\\|");
				const status = entry.overallStatus;
				const progress = entry.keyNotes.replace(/\|/g, "\\|");
				parts.push(`| ${title} | ${status} | ${progress} |`);
			}
			parts.push("");
		}

		// 7. Key Risks
		if (
			input.discrepancyReport &&
			input.discrepancyReport.totalFilteredCount > 0
		) {
			parts.push("## Risks & Discrepancies");
			parts.push("");
			parts.push(
				`${input.discrepancyReport.totalFilteredCount} cross-source discrepancies detected (threshold: ${input.discrepancyReport.discrepancyThreshold}%).`,
			);
			parts.push("");
		}

		return parts.join("\n");
	},
};
