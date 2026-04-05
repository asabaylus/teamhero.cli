import { type ConsolaInstance, consola } from "consola";
import type {
	MetricsCollectionOptions,
	MetricsCollectionResult,
	MetricsMemberResult,
	MetricsProvider,
	RawPullRequestInfo,
} from "../core/types.js";
import { resolveEndEpochMs, resolveStartISO } from "../lib/date-utils.js";
import type { OctokitClient } from "../lib/octokit.js";
import type { Member } from "../models/member.js";
import type { ContributionMetricSet } from "../models/metrics.js";
import type { Repository } from "../models/repository.js";

const DEFAULT_MAX_COMMIT_HISTORY_PAGES = Number(
	process.env.TEAMHERO_MAX_COMMIT_PAGES ?? "5",
);
const DEFAULT_MAX_PULL_REQUEST_PAGES = Number(
	process.env.TEAMHERO_MAX_PR_PAGES ?? "5",
);
const MAX_HIGHLIGHTS_PER_MEMBER = Number.POSITIVE_INFINITY;

/** Backward-compatible re-exports — new code should import from core/types.ts. */
export type CollectMetricsOptions = MetricsCollectionOptions;
export type MemberMetricsResult = MetricsMemberResult;
export type MetricsResult = Omit<MetricsCollectionResult, "mergedTotal">;
export type MergedPullRequestInfo = RawPullRequestInfo;

interface PullRequestContributionNode {
	pullRequest: {
		number: number;
		title: string;
		merged: boolean;
		mergedAt: string | null;
		closedAt: string | null;
		state: "OPEN" | "CLOSED" | "MERGED";
		additions: number;
		deletions: number;
		url: string;
		bodyText: string | null;
		repository: {
			name: string;
			owner: {
				login: string;
			} | null;
		} | null;
		commits: {
			totalCount: number;
			nodes: Array<{
				commit: {
					oid: string;
					messageHeadline: string | null;
					message: string;
					committedDate: string;
					additions: number;
					deletions: number;
					url: string;
				} | null;
			}>;
		} | null;
	} | null;
}

interface PullRequestReviewNode {
	pullRequestReview: {
		state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED";
		comments: {
			totalCount: number;
		};
	} | null;
}

interface CommitAggregate {
	commits: number;
	additions: number;
	deletions: number;
	highlights: CommitContributionInfo[];
}

interface PullRequestAggregate {
	opened: number;
	closed: number;
	merged: number;
	commits: number;
	additions: number;
	deletions: number;
	highlights: MergedPullRequestInfo[];
}

interface CommitContributionInfo {
	repoName: string;
	oid: string;
	message: string;
	additions: number;
	deletions: number;
	committedAt: string;
	url: string;
}

export class MetricsService implements MetricsProvider {
	private readonly defaultMaxCommitPages: number;
	private readonly defaultMaxPullRequestPages: number;

	constructor(
		private readonly octokit: OctokitClient,
		private readonly logger: ConsolaInstance = consola.withTag(
			"teamhero:metrics",
		),
		defaults?: { maxCommitPages?: number; maxPullRequestPages?: number },
	) {
		this.defaultMaxCommitPages =
			defaults?.maxCommitPages ?? DEFAULT_MAX_COMMIT_HISTORY_PAGES;
		this.defaultMaxPullRequestPages =
			defaults?.maxPullRequestPages ?? DEFAULT_MAX_PULL_REQUEST_PAGES;
	}

	async collect(
		options: CollectMetricsOptions,
	): Promise<MetricsCollectionResult> {
		const maxCommitPages = options.maxCommitPages ?? this.defaultMaxCommitPages;
		const maxPullRequestPages =
			options.maxPullRequestPages ?? this.defaultMaxPullRequestPages;

		// Collect commit statistics from all repositories
		let commitTotalsResult;
		try {
			commitTotalsResult = await this.collectCommitTotals(
				options.organization.login,
				options.repositories,
				options.since,
				options.until,
				maxCommitPages,
				options.onCommitProgressUpdate ?? options.onProgressUpdate,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			commitTotalsResult = {
				totals: new Map(),
				warnings: [],
				errors: [`Failed to collect commit statistics from GitHub: ${message}`],
			};
		}

		// Collect pull request statistics from all repositories
		let pullRequestTotalsResult;
		try {
			pullRequestTotalsResult = await this.collectPullRequestTotals(
				options.organization.login,
				options.repositories,
				options.since,
				options.until,
				maxPullRequestPages,
				options.onProgressUpdate,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			pullRequestTotalsResult = {
				totals: new Map(),
				warnings: [],
				errors: [
					`Failed to collect pull request statistics from GitHub: ${message}`,
				],
				totalMergedOverall: 0,
				commitDetailsByLogin: new Map(),
			};
		}

		const commitTotals = commitTotalsResult.totals;
		const pullRequestTotals = pullRequestTotalsResult.totals;
		const commitDetailsByLogin = pullRequestTotalsResult.commitDetailsByLogin;
		const warnings = [
			...commitTotalsResult.warnings,
			...pullRequestTotalsResult.warnings,
		];
		const errors = [
			...commitTotalsResult.errors,
			...pullRequestTotalsResult.errors,
		];

		// Merge per-PR commit details into commit highlights so closed/open PR commits appear in reports
		for (const [login, details] of commitDetailsByLogin.entries()) {
			const normalizedLogin = login.toLowerCase();
			const aggregate = commitTotals.get(normalizedLogin) ?? {
				commits: 0,
				additions: 0,
				deletions: 0,
				highlights: [],
			};
			const seen = new Set<string>(aggregate.highlights.map((h) => h.oid));
			for (const info of details) {
				if (!seen.has(info.oid)) {
					aggregate.highlights.push(info);
					seen.add(info.oid);
				}
			}
			commitTotals.set(normalizedLogin, aggregate);
		}

		// Build metrics for each member
		const members: MemberMetricsResult[] = [];
		for (const member of options.members) {
			const normalizedLogin = member.login.toLowerCase();
			const commitStatsForMember =
				commitTotals.get(member.login) ?? commitTotals.get(normalizedLogin);
			const prStatsForMember =
				pullRequestTotals.get(member.login) ??
				pullRequestTotals.get(normalizedLogin);

			members.push(
				this.toMetricResult(
					member,
					null,
					options,
					commitStatsForMember,
					prStatsForMember,
				),
			);
		}

		if (!options.onProgressUpdate) {
			this.logger.debug(`Computed metrics for ${members.length} members`);
		}

		return {
			members,
			warnings,
			errors,
			mergedTotal: Array.from(pullRequestTotals.values()).reduce(
				(sum, agg) => sum + agg.merged,
				0,
			),
		};
	}

	private toMetricResult(
		member: Member,
		data: null,
		options: CollectMetricsOptions,
		commitStats: CommitAggregate | undefined,
		prStats: PullRequestAggregate | undefined,
	): MemberMetricsResult {
		// All data comes from REST API - commitStats and prStats
		const commitTotals: CommitAggregate = commitStats ?? {
			commits: 0,
			additions: 0,
			deletions: 0,
			highlights: [],
		};
		const prTotals: PullRequestAggregate = prStats
			? { additions: 0, deletions: 0, ...prStats }
			: {
					opened: 0,
					closed: 0,
					merged: 0,
					commits: 0,
					additions: 0,
					deletions: 0,
					highlights: [],
				};
		const lineTotals =
			prTotals.highlights.length > 0
				? this.computeRestApiLineTotals(prTotals.highlights)
				: { additions: prTotals.additions, deletions: prTotals.deletions };

		const metrics: ContributionMetricSet = {
			memberLogin: member.login,
			commitsCount: commitTotals.highlights.length, // Deduplicated across default-branch and PR commits
			prsOpenedCount: prTotals.opened,
			prsClosedCount: prTotals.closed,
			prsMergedCount: prTotals.merged,
			linesAdded: Math.max(
				commitTotals.additions,
				lineTotals.additions,
				prTotals.additions ?? 0,
			),
			linesDeleted: Math.max(
				commitTotals.deletions,
				lineTotals.deletions,
				prTotals.deletions ?? 0,
			),
			linesAddedInProgress: 0,
			linesDeletedInProgress: 0,
			reviewsCount: 0, // Reviews not tracked in current REST API collection
			reviewCommentsCount: 0,
			approvalsCount: 0,
			changesRequestedCount: 0,
			commentedCount: 0,
			windowStart: options.since,
			windowEnd: options.until,
		};

		// Pull highlights from REST API data
		const rawPullRequests: MergedPullRequestInfo[] = prTotals.highlights;
		const prHighlightsDisplay = rawPullRequests
			.slice(0, MAX_HIGHLIGHTS_PER_MEMBER)
			.map((info) => this.formatDisplayPullRequest(info));

		if (prHighlightsDisplay.length === 0) {
			prHighlightsDisplay.push("No PRs found.");
		}

		const prSummaries = rawPullRequests
			.map((info) => this.summarizePullRequest(info))
			.filter((summary) => summary.length > 0)
			.slice(0, MAX_HIGHLIGHTS_PER_MEMBER * 2);

		// Pull commit highlights from REST API data
		const rawCommits = commitTotals.highlights;
		const commitHighlightsDisplay = rawCommits
			.slice(0, MAX_HIGHLIGHTS_PER_MEMBER)
			.map((info) => this.formatDisplayCommit(info));

		const commitSummaries = rawCommits
			.map((info) => this.summarizeCommit(info))
			.filter((summary) => summary.length > 0)
			.slice(0, MAX_HIGHLIGHTS_PER_MEMBER * 2);

		// Combine highlights for AI processing
		const combinedHighlightsForAi = Array.from(
			new Set([...prSummaries, ...commitSummaries]),
		);
		if (combinedHighlightsForAi.length === 0) {
			combinedHighlightsForAi.push(
				"No significant code output recorded in the selected window.",
			);
		}

		return {
			metrics,
			displayName: member.displayName ?? member.login,
			highlights: combinedHighlightsForAi,
			prHighlights: prHighlightsDisplay,
			commitHighlights: commitHighlightsDisplay,
			rawPullRequests,
			rawCommits,
		};
	}

	private computePullRequestLineTotals(
		mergedPullRequests: PullRequestContributionNode[],
		orgLogin: string,
	): { additions: number; deletions: number } {
		let additions = 0;
		let deletions = 0;
		const normalizedOrg = orgLogin.toLowerCase();

		for (const node of mergedPullRequests) {
			const pr = node.pullRequest;
			if (!pr || !pr.repository) {
				continue;
			}
			const ownerLogin = pr.repository.owner?.login?.toLowerCase();
			if (ownerLogin && ownerLogin !== normalizedOrg) {
				continue;
			}
			additions += pr.additions ?? 0;
			deletions += pr.deletions ?? 0;
		}

		return { additions, deletions };
	}

	private async loadPullRequestLineStats(
		ownerLogin: string,
		repoName: string,
		pullNumber: number,
		baseRef: string | undefined,
		headRef: string | undefined,
		seedAdditions: number | undefined,
		seedDeletions: number | undefined,
		hasProgressHandler: boolean,
		errors: string[],
	): Promise<{ additions: number; deletions: number }> {
		let additions = 0;
		let deletions = 0;

		const base = baseRef?.trim();
		const head = headRef?.trim();

		// Method 1: Try compareCommitsWithBasehead API (most accurate)
		if (base && head) {
			try {
				const diff = await this.octokit.rest.repos.compareCommitsWithBasehead({
					owner: ownerLogin,
					repo: repoName,
					basehead: `${base}...${head}`,
				});
				additions = diff.data.stats?.additions ?? 0;
				deletions = diff.data.stats?.deletions ?? 0;

				// If we got valid stats, return early
				if (additions > 0 || deletions > 0) {
					return { additions, deletions };
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const errorMsg = `Unable to compare ${ownerLogin}/${repoName} ${base}...${head} for PR #${pullNumber}: ${message}`;
				errors.push(errorMsg);
				if (!hasProgressHandler) {
					this.logger.debug(errorMsg);
				}
			}
		} else {
			// Log when base/head refs are missing
			if (!hasProgressHandler) {
				this.logger.debug(
					`Missing base/head refs for PR ${ownerLogin}/${repoName}#${pullNumber} (base: ${base ?? "undefined"}, head: ${head ?? "undefined"})`,
				);
			}
		}

		// Method 2: Use seed values from PR list response
		if (additions === 0 && deletions === 0) {
			additions =
				typeof seedAdditions === "number" && seedAdditions > 0
					? seedAdditions
					: 0;
			deletions =
				typeof seedDeletions === "number" && seedDeletions > 0
					? seedDeletions
					: 0;

			// If we got valid stats from seed, return early
			if (additions > 0 || deletions > 0) {
				return { additions, deletions };
			}
		}

		// Method 3: Fetch PR details directly (fallback)
		if (additions === 0 && deletions === 0) {
			try {
				const prDetails = await this.octokit.rest.pulls.get({
					owner: ownerLogin,
					repo: repoName,
					pull_number: pullNumber,
				});
				additions =
					typeof prDetails.data.additions === "number"
						? prDetails.data.additions
						: 0;
				deletions =
					typeof prDetails.data.deletions === "number"
						? prDetails.data.deletions
						: 0;
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				const errorMsg = `Unable to load LOC for PR ${ownerLogin}/${repoName}#${pullNumber}: ${errorMessage}`;
				errors.push(errorMsg);
				if (!hasProgressHandler) {
					this.logger.debug(errorMsg);
				}
			}
		}

		return { additions, deletions };
	}

	private computeRestApiLineTotals(highlights: MergedPullRequestInfo[]): {
		additions: number;
		deletions: number;
	} {
		let additions = 0;
		let deletions = 0;

		for (const highlight of highlights) {
			additions += highlight.additions;
			deletions += highlight.deletions;
		}

		return { additions, deletions };
	}

	private formatPullRequestHighlight(
		pr: NonNullable<PullRequestContributionNode["pullRequest"]>,
	): string {
		const repoName = pr.repository?.name;
		const prefix = repoName ? `${repoName} · ` : "";
		const stateSuffix =
			pr.state && pr.state !== "MERGED" ? ` (${pr.state.toLowerCase()})` : "";
		const titleSegment = `PR #${pr.number} ${pr.title}${stateSuffix}`.trim();
		const impact = this.extractImpactSummary(pr.bodyText ?? "");
		if (impact) {
			return `${prefix}${titleSegment} — ${impact}`;
		}
		const description = pr.bodyText?.replace(/\s+/g, " ").trim() ?? "";
		const truncatedDescription =
			description.length > 180
				? `${description.slice(0, 177).trimEnd()}…`
				: description;
		if (truncatedDescription.length > 0) {
			return `${prefix}${titleSegment}: ${truncatedDescription}`;
		}
		return `${prefix}${titleSegment}`;
	}

	private formatDisplayPullRequest(info: MergedPullRequestInfo): string {
		const prefix = info.repoName ? `${info.repoName} · ` : "";
		const stateSuffix =
			info.state && info.state !== "MERGED"
				? ` (${info.state.toLowerCase()})`
				: "";
		const titleSegment =
			`PR #${info.number} ${info.title}${stateSuffix}`.trim();
		const impact = this.extractImpactSummary(info.bodyText ?? "");
		if (impact) {
			return `${prefix}${titleSegment} — ${impact}`;
		}
		const description = (info.bodyText ?? "").replace(/\s+/g, " ").trim();
		const truncatedDescription =
			description.length > 180
				? `${description.slice(0, 177).trimEnd()}…`
				: description;
		if (truncatedDescription.length > 0) {
			return `${prefix}${titleSegment}: ${truncatedDescription}`;
		}
		return `${prefix}${titleSegment}`;
	}

	private summarizePullRequest(info: MergedPullRequestInfo): string {
		const status = this.describePullRequestState(info.state);
		const titleSegment =
			info.title.trim().length > 0 ? info.title.trim() : `PR #${info.number}`;
		const impact = this.extractImpactSummary(info.bodyText ?? "");
		const repoPrefix = info.repoName ? `${info.repoName} · ` : "";
		if (!impact && titleSegment.length === 0) {
			return "";
		}
		const base = `${repoPrefix}${status} ${titleSegment}`.trim();
		if (impact) {
			return `${base} — ${impact}`;
		}
		const description = (info.bodyText ?? "").replace(/\s+/g, " ").trim();
		const truncatedDescription =
			description.length > 120
				? `${description.slice(0, 117).trimEnd()}…`
				: description;
		if (truncatedDescription.length > 0) {
			return `${base}: ${truncatedDescription}`;
		}
		return base;
	}

	private formatDisplayCommit(info: CommitContributionInfo): string {
		const prefix = info.repoName ? `${info.repoName} · ` : "";
		const sha = info.oid.slice(0, 7);
		const message = this.summarizeCommit(info);
		return `${prefix}commit ${sha}: ${message}`;
	}

	private summarizeCommit(info: CommitContributionInfo): string {
		const message = info.message.replace(/\s+/g, " ").trim();
		if (message.length === 0) {
			return "Updated source";
		}
		const lines = message.split(/(?<=[.!?])\s+/);
		return lines[0].trim();
	}

	private extractImpactSummary(text: string): string | null {
		const normalized = text.replace(/\r/g, "\n");
		const rawLines = normalized.split("\n").map((line) => line.trim());
		if (rawLines.length === 0) {
			return null;
		}
		const impactCandidates: string[] = [];
		let skipSection = false;
		let inCodeBlock = false;
		for (const raw of rawLines) {
			if (raw.length === 0) {
				continue;
			}
			if (/^```/.test(raw)) {
				// Avoid code blocks entirely
				inCodeBlock = !inCodeBlock;
				continue;
			}
			if (inCodeBlock) {
				continue;
			}
			if (/^#+\s*/.test(raw)) {
				const heading = raw.replace(/^#+\s*/, "").toLowerCase();
				skipSection = /testing|test plan|verification|checks/.test(heading);
				continue;
			}
			if (skipSection) {
				continue;
			}
			const cleaned = raw.replace(/^[-*\d+.\)\s]+/, "").trim();
			if (cleaned.length < 20) {
				continue;
			}
			if (/^(testing|tests|review)/i.test(cleaned)) {
				continue;
			}
			impactCandidates.push(cleaned.replace(/\s+/g, " "));
			if (impactCandidates.length >= 1) {
				break;
			}
		}
		if (impactCandidates.length === 0) {
			return null;
		}
		const sentence = impactCandidates[0].replace(/\s+([.,;:])/g, "$1").trim();
		return sentence.length > 0 ? sentence : null;
	}

	private describePullRequestState(state: string | undefined): string {
		if (!state) {
			return "Updated";
		}
		const normalized = state.toUpperCase();
		if (normalized === "MERGED") {
			return "Shipped";
		}
		if (normalized === "OPEN") {
			return "In review";
		}
		if (normalized === "CLOSED") {
			return "Closed";
		}
		return normalized.charAt(0) + normalized.slice(1).toLowerCase();
	}

	private async collectCommitTotals(
		ownerLogin: string,
		repositories: Repository[],
		since: string,
		until: string,
		maxCommitPages: number,
		onProgressUpdate?: (text: string, progress?: number) => void,
	): Promise<{
		totals: Map<string, CommitAggregate>;
		warnings: string[];
		errors: string[];
	}> {
		const totals = new Map<string, CommitAggregate>();
		const warnings: string[] = [];
		const errors: string[] = [];
		const repoCount = repositories.length;

		for (const [index, repo] of repositories.entries()) {
			let page = 1;
			let truncated = false;
			const repoLabel = `${ownerLogin}/${repo.name}`;
			let repoCommitCount = 0;

			if (!onProgressUpdate) {
				this.logger.info(
					`[commits] (${index + 1}/${repositories.length}) ${repoLabel}`,
				);
			}

			try {
				while (page <= maxCommitPages) {
					const response = await this.octokit.rest.repos.listCommits({
						owner: ownerLogin,
						repo: repo.name,
						since,
						until,
						per_page: 100,
						page,
					});

					if (response.data.length === 0) {
						break;
					}

					if (!onProgressUpdate) {
						this.logger.info(`[commits] ${repoLabel} page ${page}`);
					}

					for (const commit of response.data) {
						const login = commit.author?.login?.toLowerCase();
						if (!login) {
							continue;
						}

						const aggregate = totals.get(login) ?? {
							commits: 0,
							additions: 0,
							deletions: 0,
							highlights: [],
						};
						aggregate.commits += 1;
						// Note: Line counts (additions/deletions) not tracked - REST API doesn't provide this efficiently

						if (aggregate.highlights.length < MAX_HIGHLIGHTS_PER_MEMBER) {
							const message = commit.commit.message.split("\n")[0]; // Get first line
							aggregate.highlights.push({
								repoName: repo.name,
								oid: commit.sha,
								message,
								additions: 0, // Not tracked
								deletions: 0, // Not tracked
								committedAt: commit.commit.author?.date ?? "",
								url: commit.html_url,
							});
						}

						repoCommitCount += 1;
						totals.set(login, aggregate);
					}

					// Check if there are more pages
					if (response.data.length < 100) {
						break;
					}

					if (page >= maxCommitPages) {
						truncated = true;
						break;
					}

					if (onProgressUpdate) {
						onProgressUpdate(
							`Commits (${index + 1}/${repoCount}) — ${repoLabel} — ${repoCommitCount} processed, loading next page…`,
							(index + 1) / repoCount,
						);
					}

					page += 1;
				}
			} catch (error) {
				// Skip repos that fail (e.g., empty repos, 404, 403, etc.) and continue with others
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				const isEmptyRepo =
					errorMessage.includes("empty") ||
					errorMessage.includes("Git Repository is empty");

				if (isEmptyRepo) {
					warnings.push(`Skipped empty repository: ${repoLabel}`);
				} else {
					warnings.push(`Skipped ${repoLabel}: ${errorMessage}`);
					errors.push(
						`Failed to collect commits for ${repoLabel}: ${errorMessage}`,
					);
				}

				if (onProgressUpdate) {
					onProgressUpdate(
						`Commits (${index + 1}/${repoCount}) — ${repoLabel} — skipped`,
						(index + 1) / repoCount,
					);
				}
				continue;
			}

			if (onProgressUpdate) {
				const suffix =
					repoCommitCount === 0
						? "no commits in range"
						: `${repoCommitCount} commit${repoCommitCount === 1 ? "" : "s"} processed`;
				onProgressUpdate(
					`Commits (${index + 1}/${repoCount}) — ${repoLabel} — ${suffix}`,
					(index + 1) / repoCount,
				);
			}

			if (truncated) {
				warnings.push(
					`Commit pagination limit (${maxCommitPages}) reached for ${ownerLogin}/${repo.name}. Additional commits were not fetched.`,
				);
			}
		}

		return { totals, warnings, errors };
	}

	private async collectPullRequestTotals(
		ownerLogin: string,
		repositories: Repository[],
		since: string,
		until: string,
		maxPullRequestPages: number,
		onProgressUpdate?: (text: string, progress?: number) => void,
	): Promise<{
		totals: Map<string, PullRequestAggregate>;
		warnings: string[];
		errors: string[];
		totalMergedOverall: number;
		commitDetailsByLogin: Map<string, CommitContributionInfo[]>;
	}> {
		const totals = new Map<string, PullRequestAggregate>();
		const warnings: string[] = [];
		const errors: string[] = [];
		const commitDetailsByLogin = new Map<string, CommitContributionInfo[]>();
		let totalMergedOverall = 0;
		const sinceTime = new Date(resolveStartISO(since)).getTime();
		const untilTime = resolveEndEpochMs(until);
		const repoCount = repositories.length;

		for (const [index, repo] of repositories.entries()) {
			let page = 1;
			let truncated = false;
			const repoLabel = `${ownerLogin}/${repo.name}`;
			let repoMergedCount = 0;

			if (!onProgressUpdate) {
				this.logger.info(
					`[pull-requests] (${index + 1}/${repoCount}) ${repoLabel}`,
				);
			} else {
				onProgressUpdate(
					`Repos (${index + 1}/${repoCount}) — ${repoLabel} processing…`,
					(index + 1) / repoCount,
				);
			}

			try {
				while (page <= maxPullRequestPages) {
					const response = await this.octokit.rest.pulls.list({
						owner: ownerLogin,
						repo: repo.name,
						state: "all",
						sort: "updated",
						direction: "desc",
						per_page: 100,
						page,
					});

					if (response.data.length === 0) {
						break;
					}

					if (!onProgressUpdate) {
						this.logger.info(`[pull-requests] ${repoLabel} page ${page}`);
					}

					let sawRecentUpdate = false;

					for (const pr of response.data) {
						const updatedAtTime = pr.updated_at
							? new Date(pr.updated_at).getTime()
							: Number.NaN;
						if (!Number.isNaN(updatedAtTime) && updatedAtTime >= sinceTime) {
							sawRecentUpdate = true;
						}

						const createdAtTime = pr.created_at
							? new Date(pr.created_at).getTime()
							: Number.NaN;
						const mergedAtTime = pr.merged_at
							? new Date(pr.merged_at).getTime()
							: Number.NaN;
						const closedAtTime = pr.closed_at
							? new Date(pr.closed_at).getTime()
							: Number.NaN;
						const updatedInRange =
							!Number.isNaN(updatedAtTime) &&
							updatedAtTime >= sinceTime &&
							updatedAtTime <= untilTime;

						const createdInRange =
							!Number.isNaN(createdAtTime) &&
							createdAtTime >= sinceTime &&
							createdAtTime <= untilTime;
						const mergedInRange =
							!Number.isNaN(mergedAtTime) &&
							mergedAtTime >= sinceTime &&
							mergedAtTime <= untilTime;
						const closedInRange =
							!Number.isNaN(closedAtTime) &&
							closedAtTime >= sinceTime &&
							closedAtTime <= untilTime;

						// Include PRs that were created, merged, or closed in the date range
						// Additionally, include still-open PRs that were updated in range so they appear in details
						const includeForDetails =
							createdInRange ||
							mergedInRange ||
							closedInRange ||
							(pr.state === "open" && updatedInRange);
						if (!includeForDetails) {
							continue;
						}

						sawRecentUpdate = true;

						const login = pr.user?.login?.toLowerCase();
						if (!login) {
							continue;
						}

						const aggregate = totals.get(login) ?? {
							opened: 0,
							closed: 0,
							merged: 0,
							commits: 0,
							additions: 0,
							deletions: 0,
							highlights: [],
						};

						// Count as "opened" if it was actually created in this date range
						if (createdInRange) {
							aggregate.opened += 1;
						}

						// Count as "closed" if closed (but not merged) in this date range
						if (closedInRange && !mergedInRange) {
							aggregate.closed += 1;
						}

						if (mergedInRange) {
							aggregate.merged += 1;
							repoMergedCount += 1;
						}

						// Extract base and head refs, handling cross-repo PRs
						// For cross-repo PRs, head.repo might be different from base.repo
						let baseRef: string | undefined;
						let headRef: string | undefined;

						if (pr.base) {
							// Prefer SHA if available, otherwise use ref
							baseRef = pr.base.sha ?? pr.base.ref;
							// For cross-repo PRs, we might need owner:ref format, but compareCommitsWithBasehead
							// should handle refs within the same repo correctly
						}

						if (pr.head) {
							// Prefer SHA if available, otherwise use ref
							headRef = pr.head.sha ?? pr.head.ref;
							// For cross-repo PRs where head is in a different repo, we'd need head.repo.owner.login:head.ref
							// but compareCommitsWithBasehead only works within the same repo, so we'll rely on fallbacks
							if (
								pr.head.repo?.owner &&
								pr.head.repo.owner.login !== ownerLogin
							) {
								// Cross-repo PR - compareCommitsWithBasehead won't work, will fall back to other methods
								headRef = undefined;
							}
						}

						const { additions, deletions } =
							await this.loadPullRequestLineStats(
								ownerLogin,
								repo.name,
								pr.number,
								baseRef,
								headRef,
								pr.additions,
								pr.deletions,
								Boolean(onProgressUpdate),
								errors,
							);

						if (aggregate.highlights.length < MAX_HIGHLIGHTS_PER_MEMBER) {
							// Determine state
							let state: "MERGED" | "CLOSED" | "OPEN" = "OPEN";
							if (pr.merged_at) {
								state = "MERGED";
							} else if (pr.closed_at) {
								state = "CLOSED";
							}

							aggregate.highlights.push({
								repoName: repo.name,
								number: pr.number,
								title: pr.title,
								bodyText: pr.body ?? "",
								additions,
								deletions,
								url: pr.html_url,
								mergedAt: mergedInRange
									? (pr.merged_at ?? pr.closed_at ?? pr.updated_at ?? "")
									: (pr.closed_at ?? pr.updated_at ?? ""),
								state,
							});
						}

						aggregate.additions += additions;
						aggregate.deletions += deletions;
						totals.set(login, aggregate);

						// Attempt to capture commit details for this PR to populate raw commits in reports
						// This enables commits to show up even if they haven't landed on the default branch yet
						try {
							const commitsResponse = await this.octokit.rest.pulls.listCommits(
								{
									owner: ownerLogin,
									repo: repo.name,
									pull_number: pr.number,
									per_page: 100,
								},
							);
							if (Array.isArray(commitsResponse.data)) {
								// Count commits from this PR toward the PR commit total
								const commitCount = commitsResponse.data.length;
								aggregate.commits += commitCount;
								const existing = commitDetailsByLogin.get(login) ?? [];
								for (const c of commitsResponse.data) {
									const message = c.commit?.message ?? "";
									const committedDate =
										c.commit?.author?.date ?? c.commit?.committer?.date ?? "";
									existing.push({
										repoName: repo.name,
										oid: c.sha,
										message,
										additions: 0,
										deletions: 0,
										committedAt: committedDate,
										url: c.html_url,
									});
								}
								commitDetailsByLogin.set(login, existing);
							}
						} catch (error) {
							// Swallow commit detail errors and continue; failure policy is to surface aggregate failures only
							if (!onProgressUpdate) {
								this.logger.debug(
									`Unable to load commit details for PR ${ownerLogin}/${repo.name}#${pr.number}`,
								);
							}
						}
					}

					// Check if we should continue paginating
					if (!sawRecentUpdate) {
						break;
					}

					if (response.data.length < 100) {
						break;
					}

					if (page >= maxPullRequestPages) {
						truncated = true;
						break;
					}

					if (onProgressUpdate) {
						onProgressUpdate(
							`Repos (${index + 1}/${repoCount}) — ${repoLabel} — ${repoMergedCount} merged so far, loading next page…`,
							(index + 1) / repoCount,
						);
					}

					page += 1;
				}
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				warnings.push(`Skipped ${repoLabel}: ${errorMessage}`);
				errors.push(
					`Failed to collect pull requests for ${repoLabel}: ${errorMessage}`,
				);
				if (onProgressUpdate) {
					onProgressUpdate(
						`Repos (${index + 1}/${repoCount}) — ${repoLabel} — skipped`,
						(index + 1) / repoCount,
					);
				}
				continue;
			}

			totalMergedOverall += repoMergedCount;
			if (onProgressUpdate) {
				const mergedText = `${repoMergedCount} merged PR${repoMergedCount === 1 ? "" : "s"} in range`;
				onProgressUpdate(
					`Repos (${index + 1}/${repoCount}) — ${repoLabel} — ${mergedText}`,
					(index + 1) / repoCount,
				);
			}

			if (truncated) {
				warnings.push(
					`Pull request pagination limit (${maxPullRequestPages}) reached for ${ownerLogin}/${repo.name}. Additional PRs were not fetched.`,
				);
			}
		}

		return {
			totals,
			warnings,
			errors,
			totalMergedOverall,
			commitDetailsByLogin,
		};
	}
}
