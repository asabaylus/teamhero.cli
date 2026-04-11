/**
 * AI-powered report audit: discrepancy detection via two-step pipeline.
 *
 * Replaces the old rules-based engine with:
 * - buildSectionAuditContexts() — prepares claim+evidence pairs per section
 * - verifyMetricCounts() — programmatic metric count verification (no AI)
 * - mapAuditResultToDiscrepancyReport() — converts AI output to renderer contract
 * - serializeDiscrepancyReport() — IPC serialization (unchanged)
 */

import { associateNotesWithProjects } from "../adapters/meeting-notes/note-project-associator.js";
import type {
	ContributorDiscrepancy,
	DiscrepancyReport,
	RoadmapEntry,
	SectionAuditContext,
	SectionDiscrepancy,
} from "../core/types.js";
import { getEnv } from "../lib/env.js";
import type { ReportRenderInput } from "../lib/report-renderer.js";
import type { NormalizedNote, ProjectTask } from "../models/visible-wins.js";

// ---------------------------------------------------------------------------
// Evidence truncation helpers
// ---------------------------------------------------------------------------

const MAX_EVIDENCE_CHARS = 8000;
const MAX_BODY_TEXT_CHARS = 200;
const MAX_COMMIT_MESSAGE_CHARS = 120;

function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Section audit context builders
// ---------------------------------------------------------------------------

/**
 * Build audit contexts for each AI-auditable section of the report.
 * Each context pairs claims (from the report) with evidence (from raw data).
 */
export function buildSectionAuditContexts(
	reportData: ReportRenderInput,
	vwNotes?: NormalizedNote[],
	vwSupplementaryNotes?: string,
): SectionAuditContext[] {
	const contexts: SectionAuditContext[] = [];

	// Team Highlight (1 context)
	if (reportData.teamHighlight) {
		const memberEvidenceLines = reportData.memberMetrics
			.filter((m) => m.aiSummary?.trim())
			.map((m) => `${m.displayName}: ${m.aiSummary}`);

		const metricTotals = [
			`Total PRs: ${reportData.totals.prs}`,
			`Merged: ${reportData.totals.prsMerged}`,
			`Repos: ${reportData.totals.repoCount}`,
			`Contributors: ${reportData.totals.contributorCount}`,
		].join(", ");

		const evidence = truncate(
			[metricTotals, "", ...memberEvidenceLines].join("\n"),
			MAX_EVIDENCE_CHARS,
		);

		contexts.push({
			sectionName: "teamHighlight",
			claims: reportData.teamHighlight,
			evidence,
		});
	}

	// Visible Wins (1 context per project with bullets)
	if (reportData.visibleWins && reportData.visibleWins.length > 0) {
		const projectClaims = reportData.visibleWins
			.filter((acc) => acc.bullets.length > 0)
			.map((acc) => {
				const bulletTexts = acc.bullets.map((b) => `  - ${b.text}`).join("\n");
				return `${acc.projectName}:\n${bulletTexts}`;
			})
			.join("\n\n");

		if (projectClaims.length > 0) {
			const evidenceParts: string[] = [];
			if (vwNotes && vwNotes.length > 0) {
				for (const note of vwNotes) {
					evidenceParts.push(
						`Meeting: ${note.title} (${note.date})`,
						...note.discussionItems.map(
							(item) => `  - ${truncate(item, MAX_BODY_TEXT_CHARS)}`,
						),
					);
				}
			}
			if (vwSupplementaryNotes) {
				evidenceParts.push(
					"Supplementary notes:",
					truncate(vwSupplementaryNotes, MAX_BODY_TEXT_CHARS * 4),
				);
			}
			if (reportData.visibleWinsProjects) {
				evidenceParts.push("", "Asana projects:");
				for (const proj of reportData.visibleWinsProjects) {
					evidenceParts.push(
						`  - ${proj.name} (GID: ${proj.gid}, priority: ${proj.priorityScore})`,
					);
				}
			}

			contexts.push({
				sectionName: "visibleWins",
				claims: projectClaims,
				evidence: truncate(evidenceParts.join("\n"), MAX_EVIDENCE_CHARS),
			});
		}
	}

	// Roadmap (1 context per rock, auditing rendered row vs. transcripts + Asana state)
	const roadmapAuditEnabled = getEnv("TEAMHERO_ROADMAP_AUDIT_ENABLED") !== "0";
	if (
		roadmapAuditEnabled &&
		reportData.roadmapEntries &&
		reportData.roadmapEntries.length > 0
	) {
		// Build pseudo ProjectTask[] from roadmap entries so we can reuse the
		// existing per-project transcript associator for excerpt scoping.
		const pseudoProjects: ProjectTask[] = reportData.roadmapEntries.map(
			(r: RoadmapEntry) => ({
				gid: r.gid,
				name: r.displayName,
				customFields: {},
				priorityScore: 0,
			}),
		);
		const associations = vwNotes
			? associateNotesWithProjects(vwNotes, pseudoProjects)
			: [];

		for (const rock of reportData.roadmapEntries) {
			const claimParts = [
				`Rock: ${rock.displayName}`,
				`  status=${rock.overallStatus}`,
				`  milestone=${rock.nextMilestone || "(empty)"}`,
				`  keyNotes=${rock.keyNotes || "(empty)"}`,
			];
			if (rock.nextMilestoneCitation?.trim()) {
				claimParts.push(
					`  milestoneCitation=${rock.nextMilestoneCitation} (source=${rock.nextMilestoneSource ?? "ai-inferred"})`,
				);
			}
			if (rock.overallStatusCitation?.trim()) {
				claimParts.push(
					`  statusCitation=${rock.overallStatusCitation} (source=${rock.overallStatusSource ?? "ai-inferred"})`,
				);
			}
			const claims = claimParts.join("\n");

			const evidenceParts: string[] = [];

			// (a) Latest Asana project status update (Phase 2 output)
			if (rock.latestStatusUpdate) {
				evidenceParts.push(
					"Latest Asana Project Status Update:",
					`  color: ${rock.latestStatusUpdate.color || "unknown"}`,
					`  title: ${rock.latestStatusUpdate.title || "(no title)"}`,
					`  text: ${truncate(rock.latestStatusUpdate.text || "", MAX_BODY_TEXT_CHARS * 2)}`,
					`  posted by ${rock.latestStatusUpdate.createdBy ?? "unknown"} on ${rock.latestStatusUpdate.createdAt.slice(0, 10)}`,
					"",
				);
			}

			// (b) Per-rock transcript excerpts via the project-note associator
			const association = associations.find((a) => a.projectGid === rock.gid);
			if (association && association.relevantItems.length > 0) {
				evidenceParts.push(
					`Meeting transcript excerpts (${association.sourceNotes.length} source file(s)):`,
				);
				for (const item of association.relevantItems) {
					evidenceParts.push(`  - ${truncate(item, MAX_BODY_TEXT_CHARS)}`);
				}
				evidenceParts.push("");
			} else {
				evidenceParts.push(
					"Meeting transcripts: no discussion items mention this rock by name.",
					"",
				);
			}

			// (c) Asana board signal — what the board structurally contains.
			// This is what produced the rendered claim; we include it so the
			// AI can contrast "board says X" vs. "transcripts say Y".
			evidenceParts.push(
				"Asana board state (deterministic from task + subtasks):",
				`  overallStatus (pre-synthesis): ${rock.overallStatusSource === "asana-subtask" || !rock.overallStatusSource ? rock.overallStatus : "(overridden by AI — see claims)"}`,
				`  nextMilestone (pre-synthesis): ${rock.nextMilestoneSource === "asana-subtask" || !rock.nextMilestoneSource ? rock.nextMilestone || "(empty)" : "(overridden by AI — see claims)"}`,
			);

			contexts.push({
				sectionName: "roadmap",
				claims,
				evidence: truncate(evidenceParts.join("\n"), MAX_EVIDENCE_CHARS),
			});
		}
	}

	// Individual Contributions (1 per member)
	for (const member of reportData.memberMetrics) {
		if (!member.aiSummary?.trim()) continue;

		const claims = [
			member.aiSummary,
			`Metrics: commits=${member.commits}, prsMerged=${member.prsMerged}, reviews=${member.reviews}`,
		].join("\n");

		const evidenceParts: string[] = [];

		// PRs
		if (member.rawPullRequests && member.rawPullRequests.length > 0) {
			evidenceParts.push(
				`Pull Requests (${member.rawPullRequests.length} total):`,
			);
			for (const pr of member.rawPullRequests) {
				const body = pr.bodyText
					? ` — ${truncate(pr.bodyText, MAX_BODY_TEXT_CHARS)}`
					: "";
				evidenceParts.push(
					`  - PR #${pr.number} "${pr.title}" [${pr.state}]${body}`,
				);
			}
		}

		// Commits
		if (member.rawCommits && member.rawCommits.length > 0) {
			evidenceParts.push(`Commits (${member.rawCommits.length} total):`);
			for (const commit of member.rawCommits) {
				evidenceParts.push(
					`  - ${commit.oid.slice(0, 7)}: ${truncate(commit.message.replace(/\s+/g, " "), MAX_COMMIT_MESSAGE_CHARS)}`,
				);
			}
		}

		// Confirm data-source coverage so the AI knows what was collected
		if (reportData.sections.git) {
			const hasPRs =
				member.rawPullRequests && member.rawPullRequests.length > 0;
			const hasCommits = member.rawCommits && member.rawCommits.length > 0;
			if (!hasPRs && !hasCommits) {
				evidenceParts.push(
					"GitHub: No commits or pull requests found for this contributor in the reporting period.",
				);
			}
			evidenceParts.push(
				"Note: Review counts are not tracked via the REST API (reviews=0 is expected and should not be flagged).",
			);
		}

		// Tasks
		if (
			member.taskTracker.status === "matched" &&
			member.taskTracker.tasks.length > 0
		) {
			evidenceParts.push("Asana tasks:");
			for (const task of member.taskTracker.tasks) {
				const desc = task.description
					? ` — ${truncate(task.description, MAX_BODY_TEXT_CHARS)}`
					: "";
				evidenceParts.push(
					`  - "${task.name}" [${task.status}${task.completedAt ? `, completed ${task.completedAt.slice(0, 10)}` : ""}]${desc}`,
				);
			}
		}

		contexts.push({
			sectionName: "individualContribution",
			claims,
			evidence: truncate(evidenceParts.join("\n"), MAX_EVIDENCE_CHARS),
			contributor: member.login,
			contributorDisplayName: member.displayName,
		});
	}

	return contexts;
}

// ---------------------------------------------------------------------------
// Programmatic metric count verification (no AI)
// ---------------------------------------------------------------------------

/**
 * Compare reported metric counts against raw data counts.
 * Returns discrepancies for any mismatches.
 */
export function verifyMetricCounts(
	reportData: ReportRenderInput,
): ContributorDiscrepancy[] {
	const discrepancies: ContributorDiscrepancy[] = [];

	for (const member of reportData.memberMetrics) {
		// Verify merged PR count
		if (member.rawPullRequests) {
			const actualMerged = member.rawPullRequests.filter(
				(pr) => pr.state === "MERGED",
			).length;
			if (member.prsMerged !== actualMerged) {
				discrepancies.push({
					contributor: member.login,
					contributorDisplayName: member.displayName,
					sourceA: {
						sourceName: "Report metrics",
						state: `prsMerged = ${member.prsMerged}`,
					},
					sourceB: {
						sourceName: "GitHub raw data",
						state: `${actualMerged} MERGED PRs`,
					},
					suggestedResolution: "Investigate the metric aggregation logic",
					confidence: 5,
					message: `Metric mismatch — report says ${member.prsMerged} merged PRs but raw data has ${actualMerged}.\nThe prsMerged count does not match the actual MERGED PR records.`,
					rule: "Metric mismatch — Report merged PR count differs from raw PR data.",
					sectionName: "metrics",
				});
			}
		}

		// Verify commit count
		if (member.rawCommits) {
			const actualCommits = member.rawCommits.length;
			if (member.commits !== actualCommits) {
				discrepancies.push({
					contributor: member.login,
					contributorDisplayName: member.displayName,
					sourceA: {
						sourceName: "Report metrics",
						state: `commits = ${member.commits}`,
					},
					sourceB: {
						sourceName: "GitHub raw data",
						state: `${actualCommits} commits`,
					},
					suggestedResolution: "Investigate the metric aggregation logic",
					confidence: 5,
					message: `Metric mismatch — report says ${member.commits} commits but raw data has ${actualCommits}.\nThe commit count does not match the actual commit records.`,
					rule: "Metric mismatch — Report commit count differs from raw commit data.",
					sectionName: "metrics",
				});
			}
		}

		// Verify completed tasks count
		if (
			member.taskTracker.status === "matched" &&
			member.taskTracker.tasks.length > 0
		) {
			const _actualCompleted = member.taskTracker.tasks.filter(
				(t) => t.status === "completed" || Boolean(t.completedAt),
			).length;
			// Only flag if there's a meaningful mismatch indicator in the aiSummary metrics
			// (tasks completed is not a direct field on memberMetrics, so this is informational)
		}
	}

	return discrepancies;
}

// ---------------------------------------------------------------------------
// Rule normalization
// ---------------------------------------------------------------------------

/**
 * Ensure a rule string follows the "Category — Third-person description." format.
 * If missing the " — " separator, prepend "Audit — ".
 */
export function normalizeRule(rule: string): string {
	const trimmed = rule.trim();
	if (trimmed.includes(" — ")) {
		return trimmed;
	}
	return `Audit — ${trimmed}`;
}

// ---------------------------------------------------------------------------
// AI result → DiscrepancyReport mapping
// ---------------------------------------------------------------------------

/**
 * Convert AI-detected SectionDiscrepancy[] and programmatic metric discrepancies
 * into the DiscrepancyReport shape used by the renderer and TUI.
 */
export function mapAuditResultToDiscrepancyReport(
	aiDiscrepancies: SectionDiscrepancy[],
	metricDiscrepancies: ContributorDiscrepancy[],
	discrepancyThreshold = 30,
): DiscrepancyReport {
	const allItems: ContributorDiscrepancy[] = [];

	// Convert each SectionDiscrepancy → ContributorDiscrepancy
	for (const sd of aiDiscrepancies) {
		allItems.push({
			contributor: sd.contributor ?? "",
			contributorDisplayName: sd.contributorDisplayName ?? "Unattributed",
			sourceA: sd.sourceA,
			sourceB: sd.sourceB,
			suggestedResolution: sd.suggestedResolution,
			confidence: sd.confidence,
			message: `${sd.summary}\n${sd.explanation}`,
			rule: normalizeRule(sd.rule),
			sectionName: sd.sectionName,
		});
	}

	// Add programmatic metric discrepancies
	allItems.push(...metricDiscrepancies);

	const totalRawCount = allItems.length;

	// Sort all items by confidence descending (highest confidence first)
	allItems.sort((a, b) => b.confidence - a.confidence);

	// Apply confidence threshold filter
	const filtered = allItems.filter(
		(item) => item.confidence >= discrepancyThreshold,
	);

	// Group by contributor
	const byContributor = new Map<string, ContributorDiscrepancy[]>();
	const unattributed: ContributorDiscrepancy[] = [];

	for (const item of filtered) {
		if (item.contributor) {
			const existing = byContributor.get(item.contributor) ?? [];
			existing.push(item);
			byContributor.set(item.contributor, existing);
		} else {
			unattributed.push(item);
		}
	}

	const totalFilteredCount = filtered.length;

	return {
		byContributor,
		unattributed,
		totalRawCount,
		totalFilteredCount,
		allItems,
		discrepancyThreshold,
	};
}

// ---------------------------------------------------------------------------
// Serialization (unchanged from original)
// ---------------------------------------------------------------------------

/**
 * Serialize a DiscrepancyReport to a plain JSON-safe object
 * suitable for IPC over the JSON-lines protocol.
 */
export function serializeDiscrepancyReport(report: DiscrepancyReport): {
	byContributor: Record<string, ContributorDiscrepancy[]>;
	unattributed: ContributorDiscrepancy[];
	totalRawCount: number;
	totalFilteredCount: number;
	allItems: ContributorDiscrepancy[];
	discrepancyThreshold: number;
} {
	const byContributor: Record<string, ContributorDiscrepancy[]> = {};
	for (const [key, value] of report.byContributor) {
		byContributor[key] = value;
	}
	return {
		byContributor,
		unattributed: report.unattributed,
		totalRawCount: report.totalRawCount,
		totalFilteredCount: report.totalFilteredCount,
		allItems: report.allItems,
		discrepancyThreshold: report.discrepancyThreshold,
	};
}
