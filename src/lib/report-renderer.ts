import type {
	ContributorDiscrepancy,
	DiscrepancyReport,
	MemberTaskSummary,
	PeriodDeltas,
	ReportRenderer,
	RoadmapEntry,
} from "../core/types.js";
import type { ContributorSummaryRecord } from "../models/individual-summary.js";
import type {
	AccomplishmentBullet,
	ProjectAccomplishment,
	ProjectTask,
} from "../models/visible-wins.js";
import { formatDelta } from "../services/period-deltas.service.js";

export interface ReportTotals {
	prs: number;
	prsMerged: number;
	repoCount: number;
	contributorCount: number;
}

export interface ReportWindow {
	start: string;
	end: string;
	human: string;
}

export interface ReportMemberMetrics {
	login: string;
	displayName: string;
	commits: number;
	prsOpened: number;
	prsClosed: number;
	prsMerged: number;
	linesAdded: number;
	linesDeleted: number;
	linesAddedInProgress: number;
	linesDeletedInProgress: number;
	reviews: number;
	approvals: number;
	changesRequested: number;
	commented: number;
	reviewComments: number;
	aiSummary: string;
	highlights: string[];
	prHighlights: string[];
	commitHighlights: string[];
	taskTracker: MemberTaskSummary;
	rawPullRequests?: {
		repoName: string;
		number: number;
		title: string;
		url: string;
		mergedAt: string;
		state: "MERGED" | "CLOSED" | "OPEN";
		bodyText?: string;
		additions?: number;
		deletions?: number;
	}[];
	rawCommits?: {
		repoName: string;
		oid: string;
		message: string;
		url: string;
		committedAt: string;
	}[];
}

export interface ReportRenderInput {
	schemaVersion: number;
	orgSlug: string;
	orgName?: string;
	generatedAt: string;
	teamSlug?: string;
	teamName?: string;
	members?: string[];
	filters: {
		includeBots: boolean;
		excludePrivate: boolean;
		includeArchived: boolean;
		repositories?: string[];
	};
	showDetails: boolean;
	window: ReportWindow;
	totals: ReportTotals;
	memberMetrics: ReportMemberMetrics[];
	globalHighlights: string[];
	teamHighlight?: string;
	metricsDefinition: string;
	archivedNote: string;
	sections: ReportSections;
	individualSummaries?: ContributorSummaryRecord[];
	warnings?: string[];
	errors?: string[];
	visibleWins?: ProjectAccomplishment[];
	visibleWinsProjects?: ProjectTask[];
	/** Per-contributor discrepancy report (Epic 5, Stories 5.1 & 5.2). */
	discrepancyReport?: DiscrepancyReport;
	/** Period-over-period deltas for velocity trend display (Epic 5, Story 5.3). */
	periodDeltas?: PeriodDeltas;
	/** Roadmap entries for the "Progress on Roadmap" table. */
	roadmapEntries?: RoadmapEntry[];
	/** Configurable title for the roadmap section. */
	roadmapTitle?: string;
	/** AI-generated narrative summarizing period-over-period changes. */
	deltaNarrative?: string;
}

export interface ReportSections {
	git: boolean;
	taskTracker: boolean;
	visibleWins?: boolean;
	individualContributions?: boolean;
	discrepancyLog?: boolean;
}

function sortMemberMetrics(
	metrics: ReportMemberMetrics[],
): ReportMemberMetrics[] {
	return [...metrics].sort((a, b) => {
		// Sort by merged PRs first, then commits
		if (b.prsMerged !== a.prsMerged) {
			return b.prsMerged - a.prsMerged;
		}
		if (b.commits !== a.commits) {
			return b.commits - a.commits;
		}
		return a.login.localeCompare(b.login);
	});
}

export function renderReport(input: ReportRenderInput): string {
	const parts: string[] = [];
	const members = sortMemberMetrics(input.memberMetrics).filter(
		(member) => !isAggregatedMember(member),
	);
	// Visible Wins section — rendered first, before metrics
	if (input.visibleWins && input.visibleWins.length > 0) {
		parts.push("");
		parts.push(
			renderVisibleWinsSection(
				input.visibleWins,
				input.visibleWinsProjects ?? [],
			),
		);
		parts.push("");
	}

	if (input.roadmapEntries && input.roadmapEntries.length > 0) {
		parts.push(renderRoadmapSection(input.roadmapEntries, input.roadmapTitle));
		parts.push("");
	}

	parts.push(
		`# Weekly Engineering Summary (${input.window.start} – ${input.window.end})`,
	);
	parts.push("");
	parts.push(`${buildOverviewSentence(input)}  `);
	parts.push("");

	if (input.sections.individualContributions !== false) {
		parts.push("---");
		parts.push("");
		parts.push("## **At-a-Glance Summary**");
		const hasInProgress = members.some(
			(m) =>
				(m.linesAddedInProgress ?? 0) > 0 ||
				(m.linesDeletedInProgress ?? 0) > 0,
		);
		if (hasInProgress) {
			parts.push(
				"| Developer        | Commits | PRs Opened | PRs Closed | PRs Merged | Lines Added | Lines Deleted | In-Progress + | In-Progress - | Reviews |",
			);
			parts.push(
				"|------------------|--------:|-----------:|-----------:|-----------:|------------:|--------------:|--------------:|--------------:|--------:|",
			);
			for (const member of members) {
				parts.push(
					`| ${member.displayName} | ${member.commits} | ${member.prsOpened} | ${member.prsClosed} | ${member.prsMerged} | ${member.linesAdded} | ${member.linesDeleted} | ${member.linesAddedInProgress ?? 0} | ${member.linesDeletedInProgress ?? 0} | ${member.reviews} |`,
				);
			}
		} else {
			parts.push(
				"| Developer        | Commits | PRs Opened | PRs Closed | PRs Merged | Lines Added | Lines Deleted | Reviews |",
			);
			parts.push(
				"|------------------|--------:|-----------:|-----------:|-----------:|------------:|--------------:|--------:|",
			);
			for (const member of members) {
				parts.push(
					`| ${member.displayName} | ${member.commits} | ${member.prsOpened} | ${member.prsClosed} | ${member.prsMerged} | ${member.linesAdded} | ${member.linesDeleted} | ${member.reviews} |`,
				);
			}
		}
		parts.push("");
		parts.push(
			"> *Note: This table provides a quick view of activity across the team. Reviews are counted as approved, changes requested, or commented.*",
		);
		parts.push("");
		parts.push("---");
		parts.push("");
		parts.push("## **Individual Updates**");
		parts.push("");
		for (const member of members) {
			parts.push(`### ${member.displayName} (@${member.login})`);
			const summary = formatIndividualSummary(member, input.showDetails);
			parts.push("");
			parts.push(summary);
			if (input.showDetails) {
				const detailLines = buildMemberDetails(member);
				if (detailLines.length > 0) {
					parts.push("");
					for (const line of detailLines) {
						parts.push(line);
					}
				}
			}
			parts.push("");
		}
	}

	// Period deltas summary (Story 5.3)
	if (input.periodDeltas?.hasPreviousPeriod) {
		parts.push("---");
		parts.push("");
		parts.push("## **Velocity Trends (vs. Previous Period)**");
		parts.push("");
		parts.push("| Metric | This Period | Change |");
		parts.push("|--------|----------:|-------:|");
		const deltas = input.periodDeltas;
		parts.push(
			`| PRs Merged | ${formatDelta(deltas.prsMerged)} | ${formatDeltaCompact(deltas.prsMerged)} |`,
		);
		parts.push(
			`| PRs Opened | ${formatDelta(deltas.prsOpened)} | ${formatDeltaCompact(deltas.prsOpened)} |`,
		);
		parts.push(
			`| Tasks Completed | ${formatDelta(deltas.tasksCompleted)} | ${formatDeltaCompact(deltas.tasksCompleted)} |`,
		);
		parts.push(
			`| Lines Changed | ${formatDelta(deltas.linesChanged)} | ${formatDeltaCompact(deltas.linesChanged)} |`,
		);
		parts.push(
			`| Commits | ${formatDelta(deltas.commits)} | ${formatDeltaCompact(deltas.commits)} |`,
		);
		parts.push("");
	}

	// Per-contributor discrepancy log (Stories 5.1 & 5.2)
	// Only included in report markdown when explicitly opted in via sections.discrepancyLog.
	// The TUI Discrepancy Log tab always receives this data via IPC regardless.
	if (
		input.sections.discrepancyLog &&
		input.discrepancyReport &&
		input.discrepancyReport.totalFilteredCount > 0
	) {
		parts.push("---");
		parts.push("");
		parts.push(
			renderDiscrepancySection(
				input.discrepancyReport,
				input.window,
				input.generatedAt,
			),
		);
		parts.push("");
	}

	// Add warnings section at the end if there are any repository-related warnings
	if (input.warnings && input.warnings.length > 0) {
		const repoWarnings = input.warnings.filter(
			(w) =>
				w.includes("Skipped") || w.includes("repository") || w.includes("repo"),
		);

		if (repoWarnings.length > 0) {
			parts.push("---");
			parts.push("");
			parts.push("## **Repositories Unable to Collect Data**");
			parts.push("");
			parts.push("The following repositories could not be processed:");
			parts.push("");
			for (const warning of repoWarnings) {
				// Extract repository name from warning message (format: "owner/repo" or "Skipped empty repository: owner/repo")
				const repoMatch = warning.match(/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/);
				if (repoMatch) {
					parts.push(`- \`${repoMatch[1]}\``);
				} else {
					// Fallback: show the warning message itself
					const cleanWarning = warning
						.replace(/^Skipped (empty )?repository:?\s*/i, "")
						.trim();
					parts.push(`- ${cleanWarning}`);
				}
			}
			parts.push("");
		}
	}

	if (input.errors && input.errors.length > 0) {
		parts.push("---");
		parts.push("");
		parts.push("## **Errors Encountered**");
		parts.push("");
		parts.push("The following errors occurred while generating this report:");
		parts.push("");
		for (const error of input.errors) {
			parts.push(`- ${error}`);
		}
		parts.push("");
	}

	return parts.join("\n");
}

function buildOverviewSentence(input: ReportRenderInput): string {
	const pieces: string[] = [];
	if (input.sections.git) {
		pieces.push(
			`Processed ${input.totals.prs} PRs across ${input.totals.repoCount} repositories`,
		);
	} else {
		pieces.push("GitHub metrics were skipped for this run");
	}
	pieces.push(
		`with contributions from ${input.totals.contributorCount} engineers`,
	);
	if (input.totals.prsMerged > 0 && input.totals.prsMerged < input.totals.prs) {
		pieces.push(`${input.totals.prsMerged} merged during the window`);
	}
	const sentence = `${pieces.join(", ")}.`;
	return sentence.replace(",.", ".").trim();
}

function _buildHighlightList(highlights: string[]): string[] {
	const normalized = highlights
		.map((highlight) => highlight.trim())
		.filter(Boolean);
	const unique = Array.from(new Set(normalized));
	if (unique.length > 0) {
		return unique;
	}
	return [
		"Steady delivery across active workstreams and ongoing initiatives.",
		"No additional strategic milestones were logged this week.",
	];
}

function isAggregatedMember(member: ReportMemberMetrics): boolean {
	const login = member.login.trim().toLowerCase();
	const cleanedName = member.displayName
		.replace(/[*_`]/g, "")
		.trim()
		.toLowerCase();
	if (login === "others" || login === "other" || login === "aggregate") {
		return true;
	}
	if (
		cleanedName === "others" ||
		cleanedName === "other contributors" ||
		cleanedName === "remaining contributors"
	) {
		return true;
	}
	return false;
}

function _deriveNextSteps(input: ReportRenderInput): string[] {
	const taskNames = new Set<string>();
	for (const member of input.memberMetrics) {
		if (member.taskTracker.status === "matched") {
			for (const task of member.taskTracker.tasks) {
				taskNames.add(task.name);
			}
		}
	}

	const steps = Array.from(taskNames).slice(0, 3);
	if (steps.length === 0) {
		return [
			"Maintain momentum on active initiatives and prepare updates for next week's review.",
			"Surface blockers early so the leadership team can assist.",
		];
	}
	return steps.map((task) => `Follow through on ${task}.`);
}

function formatIndividualSummary(
	member: ReportMemberMetrics,
	_showDetails: boolean,
): string {
	const summaryText = (member.aiSummary?.trim() || "").replace(
		/\n\+\n/g,
		"\n\n",
	);

	if (!summaryText) {
		throw new Error(
			`Missing summary content for ${member.displayName} (@${member.login}). Ensure AI summaries ran successfully or provide narrative text.`,
		);
	}

	if (
		summaryText.includes(member.displayName) &&
		summaryText.includes(`@${member.login}`)
	) {
		return summaryText;
	}

	return summaryText;
}

function buildMemberDetails(member: ReportMemberMetrics): string[] {
	const lines: string[] = [];
	const openPullRequests = (member.rawPullRequests ?? []).filter(
		(pr) => pr.state === "OPEN",
	);
	const mergedPullRequests = (member.rawPullRequests ?? []).filter(
		(pr) => pr.state === "MERGED",
	);
	const closedPullRequests = (member.rawPullRequests ?? []).filter(
		(pr) => pr.state === "CLOSED",
	);
	const commits = member.rawCommits ?? [];
	const completedTasks = (member.taskTracker.tasks ?? []).filter((task) =>
		Boolean(task.completedAt),
	);

	const sections: Array<{ title: string; items: string[] }> = [
		{
			title: "- **Open pull requests**",
			items:
				openPullRequests.length > 0
					? openPullRequests.map((pr) => {
							const scope = pr.repoName ? `${pr.repoName} · ` : "";
							return `${scope}PR #${pr.number} ${pr.title} — ${pr.url}`;
						})
					: ["None"],
		},
		{
			title: "- **Merged pull requests**",
			items:
				mergedPullRequests.length > 0
					? mergedPullRequests.map((pr) => {
							const scope = pr.repoName ? `${pr.repoName} · ` : "";
							const mergedDate = pr.mergedAt
								? ` (merged ${pr.mergedAt.slice(0, 10)})`
								: "";
							return `${scope}PR #${pr.number} ${pr.title}${mergedDate} — ${pr.url}`;
						})
					: ["None"],
		},
		{
			title: "- **Closed pull requests**",
			items:
				closedPullRequests.length > 0
					? closedPullRequests.map((pr) => {
							const scope = pr.repoName ? `${pr.repoName} · ` : "";
							const closedDate = pr.mergedAt
								? ` (closed ${pr.mergedAt.slice(0, 10)})`
								: "";
							return `${scope}PR #${pr.number} ${pr.title}${closedDate} — ${pr.url}`;
						})
					: ["None"],
		},
		{
			title: "- **Commits**",
			items:
				commits.length > 0
					? commits.map((commit) => {
							const scope = commit.repoName ? `${commit.repoName} · ` : "";
							const message = commit.message.replace(/\s+/g, " ").trim();
							return `${scope}commit ${commit.oid.slice(0, 7)}: ${message} — ${commit.url}`;
						})
					: ["None"],
		},
		{
			title: "- **Completed tasks**",
			items:
				completedTasks.length > 0
					? completedTasks.map((task) => {
							const when = task.completedAt
								? ` (completed ${task.completedAt.slice(0, 10)})`
								: "";
							const link = task.permalinkUrl ? ` — ${task.permalinkUrl}` : "";
							return `${task.name}${when}${link}`;
						})
					: ["None"],
		},
	];

	for (const section of sections) {
		if (lines.length > 0) {
			lines.push("");
		}
		lines.push(section.title);
		for (const item of section.items) {
			lines.push(`  - ${item}`);
		}
	}

	return lines;
}

/**
 * Merge duplicate project entries and deduplicate bullets.
 * The AI sometimes returns multiple accomplishment entries for the same project
 * or includes duplicate bullet text. This function normalizes the data.
 */
function normalizeAccomplishments(
	accomplishments: ProjectAccomplishment[],
): ProjectAccomplishment[] {
	// Merge entries that share the same projectGid
	const merged = new Map<string, ProjectAccomplishment>();
	for (const acc of accomplishments) {
		const existing = merged.get(acc.projectGid);
		if (existing) {
			existing.bullets.push(...acc.bullets);
		} else {
			merged.set(acc.projectGid, {
				projectName: acc.projectName,
				projectGid: acc.projectGid,
				bullets: [...acc.bullets],
			});
		}
	}

	// For each project: clean bullet text, promote subBullets, flatten, deduplicate
	for (const acc of merged.values()) {
		const projectName = acc.projectName;
		const flatBullets: AccomplishmentBullet[] = [];

		for (const bullet of acc.bullets) {
			// Strip project name prefix (e.g. "Omni-Channel — ..." or "Omni-Channel: ...")
			let text = bullet.text.trim();
			const prefixPattern = new RegExp(
				`^${escapeRegExp(projectName)}\\s*[—–:\\-]\\s*`,
				"i",
			);
			text = text.replace(prefixPattern, "");

			// Split multi-line text into separate bullets
			const lines = text
				.split("\n")
				.map((line) => line.replace(/^\s*[*\-•]\s*/, "").trim())
				.filter((line) => line.length > 0);

			for (const line of lines) {
				flatBullets.push({ ...bullet, text: line, subBullets: [] });
			}

			// Promote subBullets to top-level bullets
			for (const sub of bullet.subBullets) {
				const subText = sub.trim();
				if (subText.length > 0) {
					flatBullets.push({
						text: subText,
						subBullets: [],
						sourceDates: bullet.sourceDates,
						sourceFigures: bullet.sourceFigures,
						sourceNoteFile: bullet.sourceNoteFile,
					});
				}
			}
		}

		// Deduplicate by normalized text (case-insensitive, trimmed)
		const seen = new Set<string>();
		acc.bullets = flatBullets.filter((bullet) => {
			const key = bullet.text.toLowerCase().trim();
			if (seen.has(key)) {
				return false;
			}
			seen.add(key);
			return true;
		});
	}

	return Array.from(merged.values());
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Render the Visible Wins section in flat, executive plain-text format.
 * All projects rendered at same level, sorted by priority score descending.
 * Projects without accomplishments show "No Change".
 */
export function renderVisibleWinsSection(
	accomplishments: ProjectAccomplishment[],
	projects: ProjectTask[],
): string {
	const parts: string[] = [];

	parts.push("## **This Week's Visible Wins & Delivered Outcomes**");
	parts.push("");

	const normalized = normalizeAccomplishments(accomplishments);
	const accomplishmentsByGid = new Map<string, ProjectAccomplishment>();
	for (const acc of normalized) {
		accomplishmentsByGid.set(acc.projectGid, acc);
	}

	// Collect all leaf-level projects (no children in the board) sorted by priority
	const leafProjects = collectLeafProjects(projects, accomplishmentsByGid);

	for (let i = 0; i < leafProjects.length; i++) {
		if (i > 0) {
			parts.push("");
		}
		const entry = leafProjects[i];
		parts.push(entry.name);
		for (const bullet of entry.bullets) {
			parts.push(`* ${bullet}`);
		}
	}

	return parts.join("\n");
}

const ROADMAP_STATUS_EMOJI: Record<string, string> = {
	"on-track": "🟢",
	"at-risk": "🟡",
	"off-track": "🔴",
	unknown: "⚪",
};

const DEFAULT_ROADMAP_TITLE = "Progress on Quarterly Roadmap (Rocks)";

export function renderRoadmapSection(
	items: RoadmapEntry[],
	title?: string,
): string {
	const parts: string[] = [];
	parts.push(`## **${title ?? DEFAULT_ROADMAP_TITLE}**`);
	parts.push("");
	parts.push(
		"| Initiative / Epic | Next Delivery Milestone & Date | Overall Status | Key Notes |",
	);
	parts.push("| :---- | :---- | :---- | :---- |");
	for (const item of items) {
		const emoji = ROADMAP_STATUS_EMOJI[item.overallStatus] ?? "⚪";
		const name = item.displayName.replace(/\|/g, "\\|");
		const milestone = item.nextMilestone.replace(/\|/g, "\\|");
		const notes = item.keyNotes.replace(/\|/g, "\\|");
		parts.push(`| **${name}** | ${milestone} | ${emoji} | ${notes} |`);
	}
	return parts.join("\n");
}

interface FlatProjectEntry {
	gid: string;
	name: string;
	priority: number;
	bullets: string[];
}

/**
 * Collect projects with actual accomplishments as flat entries sorted by priority descending.
 * Projects without AI-extracted bullets are suppressed from the output.
 */
function collectLeafProjects(
	projects: ProjectTask[],
	accomplishmentsByGid: Map<string, ProjectAccomplishment>,
): FlatProjectEntry[] {
	const entries: FlatProjectEntry[] = [];
	const seen = new Set<string>();

	// First pass: include board projects that have accomplishments
	for (const project of projects) {
		if (seen.has(project.gid)) continue;
		seen.add(project.gid);
		const acc = accomplishmentsByGid.get(project.gid);
		const bullets = acc?.bullets.map((b) => b.text) ?? [];
		if (bullets.length === 0) continue;
		entries.push({
			gid: project.gid,
			name: project.name,
			priority: project.priorityScore,
			bullets,
		});
	}

	// Second pass: include accomplishments for projects not in the board (e.g. from supplements)
	for (const [gid, acc] of accomplishmentsByGid) {
		if (seen.has(gid)) continue;
		seen.add(gid);
		if (acc.bullets.length === 0) continue;
		entries.push({
			gid,
			name: acc.projectName,
			priority: 0,
			bullets: acc.bullets.map((b) => b.text),
		});
	}

	// Sort by priority descending, then name alphabetically
	entries.sort((a, b) => {
		if (b.priority !== a.priority) return b.priority - a.priority;
		return a.name.localeCompare(b.name);
	});

	return entries;
}

// ---------------------------------------------------------------------------
// Per-contributor discrepancy rendering (Epic 5, Stories 5.1 & 5.2)
// ---------------------------------------------------------------------------

/**
 * Render the discrepancy report as a flat list sorted by confidence (ascending).
 * Includes a summary table with anchor links followed by detailed cards.
 */
function renderDiscrepancySection(
	report: DiscrepancyReport,
	window: ReportWindow,
	generatedAt: string,
): string {
	const parts: string[] = [];

	// Collect all discrepancies into a flat list
	const allItems: ContributorDiscrepancy[] = [];
	for (const items of report.byContributor.values()) {
		allItems.push(...items);
	}
	allItems.push(...report.unattributed);

	// Sort descending by confidence (highest confidence first)
	allItems.sort((a, b) => b.confidence - a.confidence);

	// Header
	const generatedAtHuman = new Intl.DateTimeFormat("en", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date(generatedAt));
	parts.push("## Discrepancy Report");
	parts.push(
		`**Period:** ${window.human} | **Generated:** ${generatedAtHuman}`,
	);
	parts.push("");

	// Summary table
	parts.push("| # | Issue | Contributor | Confidence |");
	parts.push("|---|-------|-------------|------------|");
	for (let i = 0; i < allItems.length; i++) {
		const d = allItems[i];
		const num = i + 1;
		const summary = extractSummary(d.message);
		const contributor = d.contributor
			? d.contributorDisplayName
			: "Unattributed";
		parts.push(
			`| [${num}](#discrepancy-${num}) | ${summary} | ${contributor} | ${d.confidence}% |`,
		);
	}
	parts.push("");

	// Discrepancy cards
	for (let i = 0; i < allItems.length; i++) {
		const d = allItems[i];
		const num = i + 1;
		const summary = extractSummary(d.message);
		const explanation = extractExplanation(d.message);

		parts.push("---");
		parts.push("");
		parts.push(`### <a id="discrepancy-${num}"></a>${num}. ${summary}`);

		// Contributor line
		if (d.contributor) {
			parts.push(
				`**Contributor:** ${d.contributorDisplayName} (@${d.contributor}) | **Confidence: ${d.confidence}%**`,
			);
		} else {
			parts.push(
				`**Contributor:** Unattributed | **Confidence: ${d.confidence}%**`,
			);
		}
		parts.push("");

		if (explanation) {
			parts.push(explanation);
			parts.push("");
		}

		// Evidence bullets
		parts.push("**Evidence:**");
		parts.push(formatEvidenceBullet(d.sourceA));
		parts.push(formatEvidenceBullet(d.sourceB));
		parts.push("");

		// Gap (from rule description)
		const gap = extractRuleDescription(d.rule);
		if (gap) {
			parts.push(`**Gap:** ${gap}`);
			parts.push("");
		}

		// Action
		parts.push(`**Action:** ${d.suggestedResolution}`);
		parts.push("");
	}

	return parts.join("\n");
}

/** Extract the summary (first line) from a discrepancy message. */
function extractSummary(message: string): string {
	const newlineIdx = message.indexOf("\n");
	return newlineIdx >= 0 ? message.slice(0, newlineIdx).trim() : message.trim();
}

/** Extract the explanation (everything after the first line) from a discrepancy message. */
function extractExplanation(message: string): string {
	const newlineIdx = message.indexOf("\n");
	return newlineIdx >= 0 ? message.slice(newlineIdx + 1).trim() : "";
}

/** Extract the description portion after " — " from a rule string. */
function extractRuleDescription(rule: string): string {
	const separatorIdx = rule.indexOf(" — ");
	return separatorIdx >= 0
		? rule.slice(separatorIdx + " — ".length).trim()
		: "";
}

/** Format a single evidence bullet with optional hyperlink. */
function formatEvidenceBullet(source: {
	sourceName: string;
	state: string;
	url?: string;
	itemId?: string;
}): string {
	const url = source.url?.trim() ?? "";
	const itemId = source.itemId?.trim() ?? "";

	if (url) {
		const label = itemId
			? `${source.sourceName}: ${itemId}`
			: source.sourceName;
		return `- [${label}](${url}) — ${source.state}`;
	}
	const label = itemId ? `${source.sourceName}: ${itemId}` : source.sourceName;
	return `- ${label} — ${source.state}`;
}

// ---------------------------------------------------------------------------
// Period delta formatting helpers (Epic 5, Story 5.3)
// ---------------------------------------------------------------------------

/**
 * Format a compact delta string for the "Change" column: "+5 (+28%)" or "new".
 */
function formatDeltaCompact(
	delta: import("../core/types.js").MetricDelta,
): string {
	if (delta.previous === undefined || delta.absoluteChange === undefined) {
		return "-";
	}
	const sign = delta.absoluteChange >= 0 ? "+" : "";
	if (delta.percentageChange === undefined) {
		return `${sign}${delta.absoluteChange} (new)`;
	}
	const pctSign = delta.percentageChange >= 0 ? "+" : "";
	return `${sign}${delta.absoluteChange} (${pctSign}${delta.percentageChange}%)`;
}

export const detailedRenderer: ReportRenderer = {
	name: "detailed",
	description:
		"Full CTO-style report with per-member metrics, individual updates, and appendices",
	render: renderReport,
};
