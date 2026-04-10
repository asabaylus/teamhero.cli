import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type ConsolaInstance, consola } from "consola";
import { FileSystemCacheStore } from "../adapters/cache/fs-cache-store.js";
import type { ReportCommandInput, ReportResult } from "../cli/index.js";
import type {
	CacheOptions,
	DiscrepancyReport,
	MemberTaskSummary,
	MetricsCollectionResult,
	MetricsProvider,
	PeriodDeltas,
	ProgressHandle,
	ProgressReporter,
	ProgressReporterFactory,
	RawPullRequestInfo,
	RoadmapEntry,
	RoadmapSubtaskInfo,
	ScopeOptions,
	ScopeProvider,
	SectionDiscrepancy,
	TaskTrackerProvider,
	VisibleWinsProvider,
	WeeklyWinsResult,
} from "../core/types.js";
import {
	formatDateUTC,
	resolveEndISO,
	resolveStartISO,
} from "../lib/date-utils.js";
import { getEnv } from "../lib/env.js";
import { IndividualSummaryCache } from "../lib/individual-cache.js";
import { cacheDir } from "../lib/paths.js";
import { createDefaultRegistry } from "../lib/renderer-registry.js";
import type {
	ReportMemberMetrics,
	ReportRenderInput,
	ReportTotals,
} from "../lib/report-renderer.js";
import { serializeReportRenderInput } from "../lib/report-serializer.js";
import {
	deriveNextMilestone,
	deriveRoadmapStatus,
	extractRoadmapItems,
} from "../lib/roadmap-extractor.js";
import { RunHistoryStore } from "../lib/run-history.js";
import { appendRunLogEntry } from "../lib/run-log.js";
import { appendUnifiedLog } from "../lib/unified-log.js";
import { enrichMemberDisplayNames } from "../lib/user-map.js";
import { isVisibleWinsEnabled } from "../lib/visible-wins-config.js";
import type {
	CollectLocInput,
	ContributorLocMetrics,
} from "../metrics/loc.rest.js";
import { collectLocMetricsRest } from "../metrics/loc.rest.js";
import type { Member } from "../models/member.js";
import type { Repository } from "../models/repository.js";
import type {
	NormalizedNote,
	ProjectAccomplishment,
	ProjectNoteAssociation,
	ProjectTask,
} from "../models/visible-wins.js";
import type { AIService } from "./ai.service.js";
import {
	buildSectionAuditContexts,
	mapAuditResultToDiscrepancyReport,
	serializeDiscrepancyReport,
	verifyMetricCounts,
} from "./contributor-discrepancy.service.js";
import { buildDeltaReport } from "./delta-report.service.js";
import { logDiscrepancies } from "./discrepancy-reviewer.js";
import { validateFactualClaims } from "./factual-validator.js";
import { IndividualActivityService } from "./individual-activity.service.js";
import { IndividualSummarizerService } from "./individual-summarizer.service.js";
import {
	buildPeriodDeltas,
	buildVelocityContext,
	computePreviousPeriod,
	extractPeriodSummary,
	extractPeriodSummaryFromSnapshot,
} from "./period-deltas.service.js";
import {
	hashWeeklyWinsInput,
	normalizeWeeklyWinsResult,
	resolveWeeklyWinsConfig,
} from "./weekly-wins.service.js";

/**
 * Content-addressable hash for member highlight caching.
 * Includes all fields that influence the AI prompt so the key changes
 * whenever the prompt inputs change.
 */
function hashMemberData(
	member: ReportMemberMetrics,
	windowHuman: string,
): string {
	const payload = JSON.stringify({
		login: member.login,
		displayName: member.displayName,
		commits: member.commits,
		prsOpened: member.prsOpened,
		prsMerged: member.prsMerged,
		prsClosed: member.prsClosed,
		linesAdded: member.linesAdded,
		linesDeleted: member.linesDeleted,
		reviews: member.reviews,
		prHighlights: member.prHighlights,
		commitHighlights: member.commitHighlights,
		taskTracker: member.taskTracker,
		windowHuman,
	});
	return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/**
 * Content-addressable hash for visible-wins extraction caching.
 * Includes all fields that influence the AI prompt so the key changes
 * whenever the prompt inputs change.
 */
function hashVisibleWinsExtractionData(
	projects: ProjectTask[],
	associations: ProjectNoteAssociation[],
	notes: NormalizedNote[],
	supplementaryNotes: string | undefined,
	reportingWindow: { startDate: string; endDate: string },
): string {
	const payload = JSON.stringify({
		startDate: reportingWindow.startDate,
		endDate: reportingWindow.endDate,
		projects: projects.map((p) => ({
			name: p.name,
			gid: p.gid,
			customFields: p.customFields,
			priorityScore: p.priorityScore,
			parentGid: p.parentGid,
			parentName: p.parentName,
		})),
		associations: associations.map((a) => ({
			projectGid: a.projectGid,
			projectName: a.projectName,
			relevantItems: a.relevantItems,
			sourceNotes: a.sourceNotes,
		})),
		notes: notes.map((n) => ({
			title: n.title,
			date: n.date,
			attendees: n.attendees,
			discussionItems: n.discussionItems,
			sourceFile: n.sourceFile,
		})),
		supplementaryNotes,
	});
	return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

const DEFAULT_WINDOW_DAYS = 7;
const METRICS_DEFINITION =
	"Commits reflect default-branch contributions; reviews tally submitted pull-request reviews excluding self-approvals.";

const NOOP_HANDLE: ProgressHandle = {
	succeed() {},
	fail() {},
	update() {},
};

const NOOP_PROGRESS: ProgressReporter = {
	start() {
		return NOOP_HANDLE;
	},
	instantSuccess() {},
	cleanup() {},
};

export interface ReportServiceDependencies {
	scope: ScopeProvider;
	metrics: MetricsProvider;
	ai: AIService;
	outputDir?: () => string;
	logger?: ConsolaInstance;
	taskTracker?: TaskTrackerProvider;
	visibleWins?: VisibleWinsProvider;
	individuals?: {
		activity?: IndividualActivityService;
		summarizer?: IndividualSummarizerService;
		cache?: IndividualSummaryCache;
		cacheDir?: string;
	};
	/** Optional cached LOC collector. When omitted, calls collectLocMetricsRest directly. */
	locCollector?: {
		collect(input: CollectLocInput): Promise<ContributorLocMetrics[]>;
	};
	/** Cache options for AI-generated content (highlights, audit). */
	cacheOptions?: CacheOptions;
	/** Factory for creating progress reporters. When omitted, progress is silently discarded. */
	progressFactory?: ProgressReporterFactory;
	/** Multi-board configuration (used for roadmap extraction). */
	boardConfigs?: import("../lib/boards-config-loader.js").BoardConfig[];
	/** Asana service for fetching subtasks (roadmap section). */
	asanaService?: import("./asana.service.js").AsanaService;
	/** Configurable title for the roadmap section. */
	roadmapTitle?: string;
	/** User identity map for enriching display names from GitHub logins. */
	userMap?: import("../models/user-identity.js").UserMap;
}

export class ReportService {
	private readonly outputDir: () => string;
	private readonly logger: ConsolaInstance;
	private readonly taskTracker?: TaskTrackerProvider;
	private readonly individualsCacheDir: string;

	constructor(private readonly deps: ReportServiceDependencies) {
		this.outputDir = deps.outputDir ?? (() => process.cwd());
		this.logger = deps.logger ?? consola.withTag("teamhero:report");
		this.taskTracker = deps.taskTracker;

		const individualsDeps = deps.individuals ?? {};
		this.individualsCacheDir =
			individualsDeps.cacheDir ?? this.resolveIndividualsCacheDir();
		this.individualCache =
			individualsDeps.cache ??
			new IndividualSummaryCache({ baseDir: this.individualsCacheDir });
		this.individualActivity =
			individualsDeps.activity ?? new IndividualActivityService();
		this.individualSummarizer =
			individualsDeps.summarizer ??
			new IndividualSummarizerService({
				driver: async (batch) =>
					this.deps.ai.generateIndividualSummaries(batch),
			});
	}

	async generateReport(input: ReportCommandInput): Promise<ReportResult> {
		const runId = randomUUID();
		await appendRunLogEntry({
			timestamp: new Date().toISOString(),
			event: "run-start",
			runId,
			mode: input.mode ?? "unknown",
			org: input.org,
			includeGit: input.sections.dataSources.git,
			includeAsana: input.sections.dataSources.asana,
			includeVisibleWins: input.sections.reportSections.visibleWins,
			requestedRepositories: input.repos?.length ?? 0,
			requestedMembers: input.members?.length ?? 0,
		});

		let repositories: Repository[] = [];
		let members: Member[] = [];
		let outputPath: string | undefined;
		let teamHighlight = "";
		let progress: ProgressReporter = NOOP_PROGRESS;
		let metricsResult: MetricsCollectionResult | null = null;

		try {
			const window = this.resolveWindow(input);
			const includeLoc = input.sections.reportSections.loc === true;
			// LOC requires git — auto-enable if LOC is requested
			const includeGit = input.sections.dataSources.git || includeLoc;
			const includeTaskTracker = input.sections.dataSources.asana;
			const includeIndividual =
				input.sections.reportSections.individualContributions !== false;

			// Core steps always present: org + repos/skip + members + metrics/skip + taskTracker/skip + final + write = 7
			let expectedSteps = 7;
			if (includeLoc) expectedSteps += 1;
			if (isVisibleWinsEnabled(input.sections.reportSections))
				expectedSteps += 1;
			if (includeIndividual) expectedSteps += 2; // highlights + team highlight

			progress =
				this.deps.progressFactory?.create({
					title: "Report Progress",
					expectedSteps,
				}) ?? NOOP_PROGRESS;

			const scopeOptions = this.toScopeOptions(input);

			const orgStep = progress.start(
				`Collecting organization details for ${input.org}`,
			);
			let organization;
			try {
				organization = await this.deps.scope.getOrganization(input.org);
				orgStep.succeed(
					`Organization ready: ${organization.name} (${organization.login})`,
				);
			} catch (error) {
				orgStep.fail(`Unable to load organization ${input.org}`);
				throw error;
			}

			if (includeGit) {
				const repoStep = progress.start(
					`Listing repositories for ${organization.login}`,
				);
				let repoCompleted = false;
				try {
					repositories = await this.deps.scope.getRepositories(
						input.org,
						scopeOptions,
					);
					if (repositories.length === 0) {
						repoStep.fail("No repositories matched the selected scope.");
						repoCompleted = true;
						throw new Error("No repositories matched the selected scope.");
					}
					repoStep.succeed(`Repositories queued: ${repositories.length}`);
					repoCompleted = true;
				} catch (error) {
					if (!repoCompleted) {
						repoStep.fail(
							`Unable to list repositories for ${organization.login}`,
						);
					}
					throw error;
				}
			} else {
				progress
					.start(
						"Skipping repository discovery (source-control metrics disabled for this run).",
					)
					.succeed();
			}

			const membersStep = progress.start(
				`Collecting members for ${organization.login}`,
			);
			let membersCompleted = false;
			try {
				members = await this.deps.scope.getMembers(input.org, scopeOptions);
				if (this.deps.userMap) {
					enrichMemberDisplayNames(members, this.deps.userMap);
				}
				if (members.length === 0) {
					membersStep.fail("No members found for the selected scope.");
					membersCompleted = true;
					throw new Error("No members found for the selected scope.");
				}
				membersStep.succeed(`Members queued: ${members.length}`);
				membersCompleted = true;
			} catch (error) {
				if (!membersCompleted) {
					membersStep.fail(`Unable to list members for ${organization.login}`);
				}
				throw error;
			}

			if (includeGit) {
				const metricsStep = progress.start(
					`Calculating repository metrics (${repositories.length} repos)`,
				);
				let metricsCompleted = false;
				try {
					metricsResult = await this.deps.metrics.collect({
						organization,
						members,
						repositories,
						since: window.startISO,
						until: window.endISO,
						maxCommitPages: input.maxCommitPages,
						maxPullRequestPages: input.maxPrPages,
						onCommitProgressUpdate: (message, p) =>
							metricsStep.update(
								message,
								p !== undefined ? p * 0.5 : undefined,
							),
						onProgressUpdate: (message, p) =>
							metricsStep.update(
								message,
								p !== undefined ? 0.5 + p * 0.5 : undefined,
							),
					});
					const mergedTotal = metricsResult.mergedTotal;
					metricsStep.succeed(
						typeof mergedTotal === "number"
							? `Repository metrics calculated — ${mergedTotal} merged PR${mergedTotal === 1 ? "" : "s"} total`
							: "Repository metrics calculated",
					);
					metricsCompleted = true;
				} catch (error) {
					if (!metricsCompleted) {
						metricsStep.fail("Failed to calculate repository metrics");
					}
					throw error;
				}

				// Warnings/errors are deferred to after progress cleanup to avoid breaking the frame
			} else {
				progress.start("Skipping source-control metric collection.").succeed();
			}

			let memberMetrics = metricsResult
				? await this.toReportMemberMetrics(metricsResult, window.humanReadable)
				: await this.buildMemberSkeleton(members, window.humanReadable);

			// Ensure all selected members are represented even if they had no activity
			// Union in skeleton entries for any selected member missing from metrics
			if (members.length > 0) {
				const present = new Set(
					memberMetrics.map((m) => m.login.toLowerCase()),
				);
				const missingMembers = members.filter(
					(m) => !present.has(m.login.toLowerCase()),
				);
				if (missingMembers.length > 0) {
					const skeletons = await this.buildMemberSkeleton(
						missingMembers,
						window.humanReadable,
					);
					memberMetrics = [...memberMetrics, ...skeletons];
				}
			}

			// Collect task-tracker tasks BEFORE generating highlights so tasks are incorporated into the AI summaries
			if (includeTaskTracker) {
				if (!this.taskTracker?.enabled) {
					throw new Error(
						"Task tracker integration is required for this report but is not configured. Set the required API token.",
					);
				}
				const trackerStep = progress.start("Collecting task summaries");
				let trackerCompleted = false;
				try {
					memberMetrics = await this.attachTaskTrackerData(memberMetrics, {
						startISO: window.startISO,
						endISO: window.endISO,
					});
					const message = this.taskTracker?.enabled
						? `Tasks collected for ${memberMetrics.length} members`
						: "Task tracker integration disabled.";
					trackerStep.succeed(message);
					trackerCompleted = true;
				} catch (error) {
					if (!trackerCompleted) {
						trackerStep.fail("Failed to collect task data");
					}
					throw error;
				}
			} else {
				memberMetrics = this.markTaskTrackerSkipped(memberMetrics);
				progress.start("Skipping task tracker integration.").succeed();
			}

			// Collect LOC metrics if requested (report section — auto-enables git)
			if (includeLoc && repositories.length > 0) {
				const locStep = progress.start(
					`Collecting LOC metrics for ${repositories.length} repositories`,
				);
				let locCompleted = false;
				try {
					const token = getEnv("GITHUB_PERSONAL_ACCESS_TOKEN");
					if (!token) {
						throw new Error(
							"GitHub token required for LOC metrics. Set GITHUB_PERSONAL_ACCESS_TOKEN or run `teamhero setup`.",
						);
					}

					const repoDefaultBranches: Record<string, string> = {};
					for (const r of repositories) {
						const fullName = `${input.org}/${r.name}`;
						if (r.defaultBranch) {
							repoDefaultBranches[fullName] = r.defaultBranch;
						}
					}

					const locCollectInput: CollectLocInput = {
						org: input.org,
						repos: repositories.map((r) => `${input.org}/${r.name}`),
						sinceIso: window.startISO,
						untilIso: window.endISO,
						token,
						maxCommitPages: input.maxCommitPages,
						repoDefaultBranches,
						onRepoProgress: ({ repoFullName, index, total, phase }) => {
							locStep.update(
								phase === "done"
									? `LOC (${index}/${total}) — ${repoFullName} ✓`
									: `LOC (${index}/${total}) — ${repoFullName}`,
								index / total,
							);
						},
					};
					const locMetrics = this.deps.locCollector
						? await this.deps.locCollector.collect(locCollectInput)
						: await collectLocMetricsRest(locCollectInput);

					// Merge LOC data into memberMetrics
					const locMap = new Map(
						locMetrics.map((m) => [m.login.toLowerCase(), m]),
					);
					let processedCount = 0;
					for (const member of memberMetrics) {
						const locData = locMap.get(member.login.toLowerCase());
						if (locData) {
							processedCount++;
							// Completed: use max of default-branch LOC and existing PR-based metrics
							const completedAdd =
								locData.completed?.additions ?? locData.additions;
							const completedDel =
								locData.completed?.deletions ?? locData.deletions;
							const finalAdditions = Math.max(member.linesAdded, completedAdd);
							const finalDeletions = Math.max(
								member.linesDeleted,
								completedDel,
							);
							member.linesAdded = finalAdditions;
							member.linesDeleted = finalDeletions;
						}

						// In-progress: sum lines from open PRs (not branch-based LOC)
						const openPrs = (member.rawPullRequests ?? []).filter(
							(pr) => pr.state === "OPEN",
						);
						member.linesAddedInProgress = openPrs.reduce(
							(sum, pr) => sum + (pr.additions ?? 0),
							0,
						);
						member.linesDeletedInProgress = openPrs.reduce(
							(sum, pr) => sum + (pr.deletions ?? 0),
							0,
						);

						if (locData) {
							locStep.update(
								`LOC — ${member.displayName} — +${member.linesAdded} / -${member.linesDeleted} (in-progress: +${member.linesAddedInProgress} / -${member.linesDeletedInProgress})`,
							);
						}
					}

					locStep.succeed(
						`LOC metrics collected for ${processedCount} of ${memberMetrics.length} contributors`,
					);
					locCompleted = true;
				} catch (error) {
					if (!locCompleted) {
						locStep.fail("Failed to collect LOC metrics");
					}
					throw error;
				}
			}

			// Visible Wins + Member Highlights — run concurrently (no shared data dependency)
			// Hoisted for use by AI audit pipeline later
			let vwRawNotes: NormalizedNote[] | undefined;
			let vwSupplementaryNotes: string | undefined;
			let visibleWinsAccomplishments: ProjectAccomplishment[] | undefined;
			let visibleWinsProjects: ProjectTask[] | undefined;
			const visibleWinsErrors: string[] = [];

			const includeIndividualContributions =
				input.sections.reportSections.individualContributions !== false;

			const vwPromise = (async () => {
				if (!isVisibleWinsEnabled(input.sections.reportSections)) return;
				const vwStep = progress.start("Collecting Visible Wins data");
				if (!this.deps.visibleWins) {
					this.logger.warn(
						"Visible Wins section skipped: provider not configured.",
					);
					vwStep.fail("Visible Wins skipped — not configured");
				} else {
					try {
						const vwData = await this.deps.visibleWins.fetchData({
							startISO: window.startISO,
							endISO: window.endISO,
						});
						visibleWinsProjects = vwData.projects;
						vwRawNotes = vwData.notes;
						vwSupplementaryNotes = vwData.supplementaryNotes;

						if (vwData.notes.length === 0) {
							this.logger.info(
								"No meeting notes in date range — all projects will show 'No Change'.",
							);
							visibleWinsAccomplishments = vwData.projects.map((p) => ({
								projectName: p.name,
								projectGid: p.gid,
								bullets: [],
							}));
							vwStep.succeed("Visible Wins data collected (no meeting notes)");
						} else {
							vwStep.update(
								`Extracting accomplishments via AI — ${vwData.projects.length} projects, ${vwData.notes.length} meeting notes`,
							);

							const cacheOpts = this.deps.cacheOptions ?? {};
							const vwSourceMatch =
								cacheOpts.flush ||
								cacheOpts.flushSources?.includes("visible-wins");
							const shouldFlushVw =
								vwSourceMatch &&
								(!cacheOpts.flushSince ||
									window.startISO >= cacheOpts.flushSince);
							const vwCache = new FileSystemCacheStore<ProjectAccomplishment[]>(
								{
									namespace: "visible-wins-extraction",
									defaultTtlSeconds: 0,
								},
							);
							const isTestModeVw = !!getEnv("TEAMHERO_TEST_MODE");
							const vwHash = hashVisibleWinsExtractionData(
								vwData.projects,
								vwData.associations,
								vwData.notes,
								vwData.supplementaryNotes,
								{
									startDate: window.startDate,
									endDate: window.endDate,
								},
							);

							let accomplishments: ProjectAccomplishment[] | null = null;
							if (!isTestModeVw && !shouldFlushVw) {
								accomplishments = await vwCache.get(vwHash, {
									permanent: true,
								});
								if (accomplishments) {
									vwStep.update(
										`Loaded ${accomplishments.length} project results from cache`,
									);
									await appendUnifiedLog({
										timestamp: new Date().toISOString(),
										runId: "",
										category: "cache",
										event: "cache-hit",
										namespace: "visible-wins-extraction",
										inputHash: vwHash,
										org: input.org,
									});
								}
							}

							if (accomplishments === null) {
								accomplishments =
									await this.deps.ai.extractProjectAccomplishments({
										projects: vwData.projects,
										associations: vwData.associations,
										notes: vwData.notes,
										supplementaryNotes: vwData.supplementaryNotes,
										reportingWindow: {
											startDate: window.startDate,
											endDate: window.endDate,
										},
										onStatus: (msg) => vwStep.update(msg),
									});
								await vwCache.set(vwHash, accomplishments);
								await appendUnifiedLog({
									timestamp: new Date().toISOString(),
									runId: "",
									category: "cache",
									event: "cache-miss",
									namespace: "visible-wins-extraction",
									inputHash: vwHash,
									org: input.org,
								});
							}

							vwStep.update("Validating factual claims");

							const discrepancies = validateFactualClaims({
								accomplishments,
								notes: vwData.notes,
								projects: vwData.projects,
							});

							await logDiscrepancies(discrepancies, {
								onStatus: (msg) => vwStep.update(msg),
							});

							visibleWinsAccomplishments = accomplishments;
							vwStep.succeed("Visible Wins data collected");
						}
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						this.logger.error(`Visible Wins pipeline failed: ${message}`);
						vwStep.fail("Visible Wins section skipped due to error");
						visibleWinsErrors.push(`Visible Wins: ${message}`);
					}
				}
			})();

			const highlightsPromise = (async () => {
				if (!includeIndividualContributions || memberMetrics.length === 0)
					return;
				const highlightsStep = progress.start(
					`Summarizing individual contributions (${memberMetrics.length} members)`,
				);
				try {
					const cacheOpts = this.deps.cacheOptions ?? {};
					const hlSourceMatch =
						cacheOpts.flush ||
						cacheOpts.flushSources?.includes("member-highlights");
					const shouldFlushHighlights =
						hlSourceMatch &&
						(!cacheOpts.flushSince || window.startISO >= cacheOpts.flushSince);
					const highlightCache = new FileSystemCacheStore<string>({
						namespace: "member-highlights",
						defaultTtlSeconds: 0,
					});
					const isTestMode = !!getEnv("TEAMHERO_TEST_MODE");

					// Check cache for each member, collect misses
					const uncachedMembers: typeof memberMetrics = [];
					for (const member of memberMetrics) {
						if (!isTestMode && !shouldFlushHighlights) {
							const hash = hashMemberData(member, window.humanReadable);
							const cached = await highlightCache.get(hash, {
								permanent: true,
							});
							if (cached) {
								member.aiSummary = cached;
								await appendUnifiedLog({
									timestamp: new Date().toISOString(),
									runId: "",
									category: "cache",
									event: "cache-hit",
									namespace: "member-highlights",
									inputHash: hash,
									org: input.org,
								});
								continue;
							}
						}
						uncachedMembers.push(member);
					}

					const cachedCount = memberMetrics.length - uncachedMembers.length;
					if (cachedCount > 0) {
						highlightsStep.update(
							`Generating highlights for ${uncachedMembers.length} of ${memberMetrics.length} members`,
						);
					}

					// Batch generate all uncached highlights in one API call
					if (uncachedMembers.length > 0) {
						const results = await this.deps.ai.generateMemberHighlights({
							members: uncachedMembers,
							windowHuman: window.humanReadable,
							onStatus: (msg) => highlightsStep.update(msg),
						});
						for (const member of uncachedMembers) {
							const highlight = results.get(member.login);
							if (highlight) {
								member.aiSummary = highlight;
								if (!isTestMode) {
									const hash = hashMemberData(member, window.humanReadable);
									await highlightCache.set(hash, highlight);
									await appendUnifiedLog({
										timestamp: new Date().toISOString(),
										runId: "",
										category: "cache",
										event: shouldFlushHighlights
											? "cache-flush-and-set"
											: "cache-miss-and-set",
										namespace: "member-highlights",
										inputHash: hash,
										org: input.org,
									});
								}
							}
						}
					}
					highlightsStep.succeed(
						`Individual contributions summarized for ${memberMetrics.length} members`,
					);
				} catch (error) {
					highlightsStep.fail("Failed to summarize individual contributions");
					throw error;
				}
			})();

			if (input.sequential !== true) {
				await Promise.all([vwPromise, highlightsPromise]);
			} else {
				await vwPromise;
				await highlightsPromise;
			}

			const totals = this.computeTotals(
				includeGit ? repositories.length : 0,
				memberMetrics,
			);
			const globalHighlights = metricsResult
				? this.buildGlobalHighlights(metricsResult)
				: [];

			// Per-contributor discrepancy detection placeholder —
			// actual audit runs after reportData assembly (feature-gated below).
			let discrepancyReport: DiscrepancyReport | undefined;

			// Period deltas / velocity trends (Epic 5, Story 5.3)
			// Computed before the AI team highlight so velocity context can be injected.
			let periodDeltas: PeriodDeltas | undefined;
			let deltaNarrative: string | undefined;
			if (includeGit && metricsResult) {
				const currentSummary = extractPeriodSummary(memberMetrics);
				// Previous period collection is opt-in because it doubles API calls.
				// Enable via TEAMHERO_ENABLE_PERIOD_DELTAS=1 environment variable.
				const enableDeltas = getEnv("TEAMHERO_ENABLE_PERIOD_DELTAS") === "1";
				if (enableDeltas) {
					try {
						const { prevStartISO, prevEndISO } = computePreviousPeriod(
							window.startISO,
							window.endISO,
						);

						// Try snapshot-based deltas first (zero API calls)
						let usedSnapshot = false;
						try {
							const runHistory = new RunHistoryStore();
							const prevSnapshot = await runHistory.findForPreviousPeriod(
								organization.login,
								prevStartISO.split("T")[0],
								prevEndISO.split("T")[0],
							);
							if (prevSnapshot) {
								const prevSummary =
									extractPeriodSummaryFromSnapshot(prevSnapshot);
								if (prevSummary) {
									periodDeltas = buildPeriodDeltas(currentSummary, prevSummary);
									const deltaResult = buildDeltaReport(
										memberMetrics,
										prevSnapshot,
									);
									if (deltaResult) {
										deltaNarrative = deltaResult.narrative;
									}
									usedSnapshot = true;
									this.logger.info(
										"Period deltas computed from cached snapshot (zero API calls)",
									);
								}
							}
						} catch {
							// Snapshot lookup failed — fall back to API re-fetch
						}

						// Fall back to API re-fetch if no snapshot found
						if (!usedSnapshot) {
							const prevMetricsResult = await this.deps.metrics.collect({
								organization,
								members,
								repositories,
								since: prevStartISO,
								until: prevEndISO,
								maxCommitPages: input.maxCommitPages,
								maxPullRequestPages: input.maxPrPages,
							});
							const prevMemberMetrics = await this.toReportMemberMetrics(
								prevMetricsResult,
								window.humanReadable,
							);
							// Attach task tracker data for the previous period too
							let prevWithTasks = prevMemberMetrics;
							if (includeTaskTracker && this.taskTracker?.enabled) {
								prevWithTasks = await this.attachTaskTrackerData(
									prevMemberMetrics,
									{ startISO: prevStartISO, endISO: prevEndISO },
								);
							}
							const prevSummary = extractPeriodSummary(prevWithTasks);
							periodDeltas = buildPeriodDeltas(currentSummary, prevSummary);
						}
					} catch (error) {
						const msg = error instanceof Error ? error.message : String(error);
						this.logger.warn(
							`Previous period collection failed — deltas omitted: ${msg}`,
						);
						periodDeltas = buildPeriodDeltas(currentSummary, undefined);
					}
				} else {
					periodDeltas = buildPeriodDeltas(currentSummary, undefined);
				}
			}

			if (includeIndividualContributions) {
				const teamStep = progress.start("Generating team highlight");
				try {
					const individualUpdates = memberMetrics
						.filter((member) => member.aiSummary?.trim())
						.map(
							(member) =>
								`${member.displayName} (@${member.login}): ${member.aiSummary}`,
						);

					let teamCacheHit = false;
					if (metricsResult) {
						const teamContext = {
							organization: organization.name,
							windowHuman: window.humanReadable,
							windowStart: window.startDate,
							windowEnd: window.endDate,
							totals,
							highlights: globalHighlights,
							individualUpdates,
							velocityContext: periodDeltas?.hasPreviousPeriod
								? buildVelocityContext(periodDeltas)
								: undefined,
							onStatus: (message: string) => teamStep.update(message),
						};

						// Content-addressed team highlight cache
						const teamCacheOpts = this.deps.cacheOptions ?? {};
						const teamSourceMatch =
							teamCacheOpts.flush ||
							teamCacheOpts.flushSources?.includes("team-highlight");
						const shouldFlushTeam =
							teamSourceMatch &&
							(!teamCacheOpts.flushSince ||
								window.startISO >= teamCacheOpts.flushSince);
						const teamHighlightCache = new FileSystemCacheStore<string>({
							namespace: "team-highlight",
							defaultTtlSeconds: 0,
						});
						const isTestMode = !!getEnv("TEAMHERO_TEST_MODE");
						const { onStatus: _onStatus, ...teamHashInput } = teamContext;
						const teamHash = createHash("sha256")
							.update(JSON.stringify(teamHashInput))
							.digest("hex")
							.slice(0, 16);

						if (!isTestMode && !shouldFlushTeam) {
							const cached = await teamHighlightCache.get(teamHash, {
								permanent: true,
							});
							if (cached) {
								teamHighlight = cached;
								teamCacheHit = true;
								await appendUnifiedLog({
									timestamp: new Date().toISOString(),
									runId: "",
									category: "cache",
									event: "cache-hit",
									namespace: "team-highlight",
									inputHash: teamHash,
									org: input.org,
								});
							}
						}

						if (!teamCacheHit) {
							teamHighlight =
								await this.deps.ai.generateTeamHighlight(teamContext);
							if (!isTestMode) {
								await teamHighlightCache.set(teamHash, teamHighlight);
								await appendUnifiedLog({
									timestamp: new Date().toISOString(),
									runId: "",
									category: "cache",
									event: shouldFlushTeam
										? "cache-flush-and-set"
										: "cache-miss-and-set",
									namespace: "team-highlight",
									inputHash: teamHash,
									org: input.org,
								});
							}
						}
					} else {
						teamHighlight =
							"Source-control metrics were skipped for this report.";
					}
					teamStep.succeed("Team highlight ready");
				} catch (error) {
					teamStep.fail("Failed to generate team highlight");
					throw error;
				}
			}

			// Roadmap extraction — synthesize roadmap progress table
			let roadmapEntries: RoadmapEntry[] | undefined;
			if (visibleWinsAccomplishments) {
				const roadmapStep = progress.start("Synthesizing roadmap table");
				try {
					const hasConfiguredSection = this.deps.boardConfigs?.some(
						(b) => b.isRoadmapBoard,
					);
					const hasRoadmapItems = this.deps.boardConfigs?.some(
						(b) =>
							(b.roadmapItems && b.roadmapItems.length > 0) ||
							(b.rocks && b.rocks.length > 0),
					);

					if (
						(hasConfiguredSection || hasRoadmapItems) &&
						visibleWinsProjects
					) {
						// Mode A: configured — items from designated section + subtask data
						const items = extractRoadmapItems(
							visibleWinsProjects,
							this.deps.boardConfigs!,
						);

						// Fetch subtasks for each roadmap item
						let subtasksByGid: Map<string, RoadmapSubtaskInfo[]> | undefined;
						if (this.deps.asanaService && items.length > 0) {
							subtasksByGid = new Map();
							for (const item of items) {
								try {
									const subtasks = await this.deps.asanaService.fetchSubtasks(
										item.gid,
									);
									subtasksByGid.set(item.gid, subtasks);
									roadmapStep.update(
										`Fetched subtasks for ${item.displayName}`,
									);
								} catch {
									this.logger.warn(
										`[roadmap] Failed to fetch subtasks for ${item.gid}`,
									);
								}
							}
						}

						// Re-derive status and milestone now that subtask data is available
						if (subtasksByGid) {
							for (const item of items) {
								const subtasks = subtasksByGid.get(item.gid) ?? [];
								const project = visibleWinsProjects.find(
									(p) => p.gid === item.gid,
								);
								if (project) {
									item.overallStatus = deriveRoadmapStatus(
										subtasks,
										project.customFields,
									);
								}
								item.nextMilestone = deriveNextMilestone(subtasks);
							}
						}

						if (items.length > 0) {
							const synthesized = await this.deps.ai.synthesizeRoadmapTable({
								roadmapItems: items,
								accomplishments: visibleWinsAccomplishments,
								notes: vwRawNotes ?? [],
								projects: visibleWinsProjects,
								subtasksByGid,
								mode: "configured",
							});
							for (const entry of synthesized) {
								const item = items.find((r) => r.gid === entry.gid);
								if (item) {
									// Only copy keyNotes — status and milestone are deterministic
									item.keyNotes = entry.keyNotes;
								}
							}
							roadmapEntries = items;
						}
					} else {
						// Mode B: AI-derived — no config, derive from accomplishments + notes
						const synthesized = await this.deps.ai.synthesizeRoadmapTable({
							roadmapItems: [],
							accomplishments: visibleWinsAccomplishments,
							notes: vwRawNotes ?? [],
							projects: visibleWinsProjects ?? [],
							mode: "ai-derived",
						});
						roadmapEntries = synthesized.map((entry) => ({
							gid: entry.gid,
							displayName: entry.displayName,
							overallStatus: ([
								"on-track",
								"at-risk",
								"off-track",
								"unknown",
							].includes(entry.overallStatus)
								? entry.overallStatus
								: "unknown") as RoadmapEntry["overallStatus"],
							nextMilestone: entry.nextMilestone,
							keyNotes: entry.keyNotes,
						}));
					}

					roadmapStep.succeed(
						`Roadmap table ready (${roadmapEntries?.length ?? 0} entries)`,
					);
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					this.logger.error(`Roadmap synthesis failed: ${message}`);
					roadmapStep.fail("Roadmap table skipped due to error");
				}
			}

			// Weekly Wins section — runs after visible wins + member highlights
			// so it can use accomplishments and individual summaries as input data.
			let weeklyWinsResult: WeeklyWinsResult | undefined;
			const includeWeeklyWins =
				input.sections.reportSections.weeklyWins === true;
			if (includeWeeklyWins) {
				const wwStep = progress.start("Generating weekly wins section");
				try {
					const wwConfig = resolveWeeklyWinsConfig();

					// Build current week data from available sources
					const currentWeekParts: string[] = [];
					if (visibleWinsAccomplishments) {
						for (const acc of visibleWinsAccomplishments) {
							if (acc.bullets.length > 0) {
								currentWeekParts.push(`Project: ${acc.projectName}`);
								for (const b of acc.bullets) {
									currentWeekParts.push(`- ${b.text}`);
								}
							}
						}
					}
					if (memberMetrics.length > 0) {
						for (const member of memberMetrics) {
							if (member.aiSummary?.trim()) {
								currentWeekParts.push(
									`${member.displayName}: ${member.aiSummary.trim()}`,
								);
							}
						}
					}
					if (teamHighlight) {
						currentWeekParts.push(`Team Summary: ${teamHighlight}`);
					}

					const currentWeekData = currentWeekParts.join("\n");
					if (currentWeekData.trim().length === 0) {
						wwStep.fail("Weekly wins skipped — no input data available");
					} else {
						// Content-addressed cache
						const wwCacheOpts = this.deps.cacheOptions ?? {};
						const wwSourceMatch =
							wwCacheOpts.flush ||
							wwCacheOpts.flushSources?.includes("weekly-wins");
						const shouldFlushWw =
							wwSourceMatch &&
							(!wwCacheOpts.flushSince ||
								window.startISO >= wwCacheOpts.flushSince);
						const wwCache = new FileSystemCacheStore<WeeklyWinsResult>({
							namespace: "weekly-wins",
							defaultTtlSeconds: 0,
						});
						const isTestMode = !!getEnv("TEAMHERO_TEST_MODE");
						const wwHash = hashWeeklyWinsInput(
							currentWeekData,
							undefined,
							wwConfig,
						);

						let cached: WeeklyWinsResult | null = null;
						if (!isTestMode && !shouldFlushWw) {
							cached = await wwCache.get(wwHash, { permanent: true });
							if (cached) {
								await appendUnifiedLog({
									timestamp: new Date().toISOString(),
									runId: "",
									category: "cache",
									event: "cache-hit",
									namespace: "weekly-wins",
									inputHash: wwHash,
									org: input.org,
								});
							}
						}

						if (cached) {
							weeklyWinsResult = normalizeWeeklyWinsResult(cached);
						} else {
							const rawResult = await this.deps.ai.generateWeeklyWins({
								currentWeekData,
								config: wwConfig,
								onStatus: (msg) => wwStep.update(msg),
							});
							weeklyWinsResult = normalizeWeeklyWinsResult(rawResult);
							if (!isTestMode) {
								await wwCache.set(wwHash, weeklyWinsResult);
								await appendUnifiedLog({
									timestamp: new Date().toISOString(),
									runId: "",
									category: "cache",
									event: shouldFlushWw
										? "cache-flush-and-set"
										: "cache-miss-and-set",
									namespace: "weekly-wins",
									inputHash: wwHash,
									org: input.org,
								});
							}
						}

						const catCount = weeklyWinsResult.categories.length;
						const winCount = weeklyWinsResult.categories.reduce(
							(sum, c) => sum + c.wins.length,
							0,
						);
						wwStep.succeed(
							`Weekly wins ready (${catCount} categories, ${winCount} wins)`,
						);
					}
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					this.logger.error(`Weekly wins pipeline failed: ${message}`);
					wwStep.fail("Weekly wins section skipped due to error");
				}
			}

			const archivedNote = this.buildArchivedNote(
				repositories,
				scopeOptions.includeArchived,
			);

			const reportData: ReportRenderInput = {
				schemaVersion: 1,
				orgSlug: organization.login,
				orgName: organization.name,
				generatedAt: window.generatedAt,
				teamSlug: input.team,
				teamName: input.team,
				members: input.members,
				filters: {
					includeBots: input.includeBots,
					excludePrivate: input.excludePrivate,
					includeArchived: input.includeArchived,
					repositories: scopeOptions.repositoryNames,
				},
				showDetails: input.detailed,
				window: {
					start: window.startDate,
					end: window.endDate,
					human: window.humanReadable,
				},
				totals,
				memberMetrics,
				globalHighlights,
				teamHighlight,
				metricsDefinition: METRICS_DEFINITION,
				archivedNote,
				sections: {
					git: input.sections.dataSources.git,
					taskTracker: input.sections.dataSources.asana,
					visibleWins: input.sections.reportSections.visibleWins,
					individualContributions:
						input.sections.reportSections.individualContributions,
					discrepancyLog: input.sections.reportSections.discrepancyLog,
					weeklyWins: input.sections.reportSections.weeklyWins,
				},
				warnings: metricsResult?.warnings,
				errors: [...(metricsResult?.errors ?? []), ...visibleWinsErrors],
				visibleWins: visibleWinsAccomplishments,
				visibleWinsProjects,
				roadmapEntries,
				roadmapTitle: this.deps.roadmapTitle,
				discrepancyReport,
				periodDeltas,
				deltaNarrative,
				weeklyWins: weeklyWinsResult,
			} satisfies ReportRenderInput;

			// AI audit — runs when the user selects the Discrepancy Log section.
			// Can be force-disabled via TEAMHERO_DISABLE_AI_AUDIT=1 for cost control.
			const discrepancyLogEnabled =
				input.sections.reportSections.discrepancyLog === true;
			const auditDisabled = getEnv("TEAMHERO_DISABLE_AI_AUDIT") === "1";

			if (discrepancyLogEnabled && !auditDisabled) {
				const auditStep = progress.start("Auditing report for discrepancies");
				try {
					// Programmatic metric verification (no AI) — always recomputed (cheap)
					const metricDiscrepancies = verifyMetricCounts(reportData);

					// Content-addressed audit cache
					const auditCacheOpts = this.deps.cacheOptions ?? {};
					const auditSourceMatch =
						auditCacheOpts.flush ||
						auditCacheOpts.flushSources?.includes("audit");
					const shouldFlushAudit =
						auditSourceMatch &&
						(!auditCacheOpts.flushSince ||
							window.startISO >= auditCacheOpts.flushSince);
					const auditCache = new FileSystemCacheStore<SectionDiscrepancy[]>({
						namespace: "audit",
						defaultTtlSeconds: 0,
					});
					const isTestMode = !!getEnv("TEAMHERO_TEST_MODE");

					// Hash audit-relevant fields (excludes generatedAt and other run-specific data)
					const auditHashPayload = JSON.stringify({
						members: reportData.memberMetrics.map((m) => ({
							login: m.login,
							aiSummary: m.aiSummary,
							commits: m.commits,
							prsMerged: m.prsMerged,
							prsOpened: m.prsOpened,
							prsClosed: m.prsClosed,
							linesAdded: m.linesAdded,
							linesDeleted: m.linesDeleted,
							reviews: m.reviews,
							prHighlights: m.prHighlights,
							commitHighlights: m.commitHighlights,
							taskTracker: m.taskTracker,
							rawPullRequests: m.rawPullRequests,
						})),
						teamHighlight: reportData.teamHighlight,
						totals: reportData.totals,
						visibleWins: reportData.visibleWins,
						vwRawNotes,
						vwSupplementaryNotes,
					});
					const auditHash = createHash("sha256")
						.update(auditHashPayload)
						.digest("hex")
						.slice(0, 16);

					let aiDiscrepancies: SectionDiscrepancy[] | null = null;
					if (!isTestMode && !shouldFlushAudit) {
						aiDiscrepancies = await auditCache.get(auditHash, {
							permanent: true,
						});
						if (aiDiscrepancies) {
							await appendUnifiedLog({
								timestamp: new Date().toISOString(),
								runId: "",
								category: "cache",
								event: "cache-hit",
								namespace: "audit",
								inputHash: auditHash,
								org: input.org,
							});
						}
					}

					if (aiDiscrepancies === null) {
						// Build AI audit contexts
						const contexts = buildSectionAuditContexts(
							reportData,
							vwRawNotes,
							vwSupplementaryNotes,
						);

						// Analyze discrepancies (parallel — report per-section as each completes)
						auditStep.update(
							`Analyzing ${contexts.length} sections for discrepancies`,
						);
						let completed = 0;
						const inFlight = new Set<string>();
						const updateAuditProgress = (action?: string) => {
							const parts: string[] = [];
							if (action) parts.push(action);
							if (inFlight.size > 0)
								parts.push(`auditing ${[...inFlight].join(", ")}`);
							parts.push(`(${completed}/${contexts.length})`);
							auditStep.update(parts.join(" — "));
						};
						const results = await Promise.allSettled(
							contexts.map((ctx) => {
								const label =
									ctx.contributorDisplayName ??
									ctx.contributor ??
									ctx.sectionName;
								inFlight.add(label);
								updateAuditProgress();
								return this.deps.ai.analyzeSectionDiscrepancies(ctx).then(
									(value) => {
										inFlight.delete(label);
										completed++;
										updateAuditProgress(`Audited ${label}`);
										return value;
									},
									(err) => {
										inFlight.delete(label);
										completed++;
										updateAuditProgress(`Failed ${label}`);
										throw err;
									},
								);
							}),
						);

						aiDiscrepancies = [];
						let fulfilledCount = 0;
						for (let i = 0; i < results.length; i++) {
							const result = results[i];
							if (result.status === "fulfilled") {
								aiDiscrepancies.push(...result.value);
								fulfilledCount++;
							} else {
								const ctx = contexts[i];
								this.logger.warn(
									`Discrepancy analysis failed for ${ctx.sectionName}${ctx.contributor ? ` (${ctx.contributor})` : ""}: ${result.reason}`,
								);
							}
						}

						// Only cache if at least one analysis succeeded — a fully-failed
						// run would cache an empty result, poisoning subsequent runs.
						if (!isTestMode && fulfilledCount > 0) {
							await auditCache.set(auditHash, aiDiscrepancies);
							await appendUnifiedLog({
								timestamp: new Date().toISOString(),
								runId: "",
								category: "cache",
								event: shouldFlushAudit
									? "cache-flush-and-set"
									: "cache-miss-and-set",
								namespace: "audit",
								inputHash: auditHash,
								org: input.org,
							});
						}
					}

					discrepancyReport = mapAuditResultToDiscrepancyReport(
						aiDiscrepancies,
						metricDiscrepancies,
						input.discrepancyThreshold ?? 30,
					);
					reportData.discrepancyReport = discrepancyReport;
					auditStep.succeed(
						`Found ${discrepancyReport.totalFilteredCount} discrepancies${aiDiscrepancies === null ? "" : ""}`,
					);
				} catch (error) {
					auditStep.fail("Discrepancy audit skipped");
					this.logger.warn(`Report audit failed: ${error}`);
					// Entire pipeline failed — render report without discrepancies
				}
			}

			const outputFormat = input.outputFormat ?? "markdown";

			// Serialize report data for JSON output mode
			let serializedReportData: Record<string, unknown> | undefined;
			let jsonOutputPath: string | undefined;
			if (outputFormat === "json" || outputFormat === "both") {
				const jsonStep = progress.start("Serializing report data");
				try {
					serializedReportData = serializeReportRenderInput(reportData);
					jsonOutputPath = await this.writeJsonReportFile(
						input.org,
						serializedReportData,
						window.endDate,
						input.outputPath,
					);
					jsonStep.succeed("Report data serialized");
				} catch (error) {
					jsonStep.fail("Failed to serialize report data");
					throw error;
				}
			}

			// Skip AI summary generation when only JSON is requested —
			// saves ~30s and API cost per run.
			if (outputFormat !== "json") {
				const finalStep = progress.start("Generating final report");
				const registry = createDefaultRegistry();
				const templateName = input.template || "detailed";
				// Validate template name early — throws if unknown
				registry.getOrThrow(templateName);

				let markdown: string;
				if (templateName === "detailed") {
					// Use the AI service path for the detailed renderer (includes contributor presence check)
					markdown = await this.deps.ai.generateFinalReport({
						report: reportData,
						onStatus: (message) => finalStep.update(message),
					});
				} else {
					// Non-default renderers bypass AI post-processing
					const renderer = registry.getOrThrow(templateName);
					markdown = renderer.render(reportData);
				}
				finalStep.succeed("Final report generated");

				const writeStep = progress.start("Writing report to disk");
				try {
					outputPath = await this.writeReportFile(
						input.org,
						markdown,
						window.endDate,
						input.outputPath,
					);
					writeStep.succeed("Report written to disk");
				} catch (error) {
					writeStep.fail("Failed to write report file");
					throw error;
				}
			}

			if (!outputPath && !jsonOutputPath) {
				throw new Error("Report output path was not resolved");
			}

			// Always serialize report data for the TUI JSON Data tab,
			// even when outputFormat is "markdown" (the default).
			const reportDataForTui =
				serializedReportData ?? serializeReportRenderInput(reportData);

			// Serialize discrepancy data for TUI and headless output.
			let serializedDiscrepancy: ReportResult["serializedDiscrepancy"];
			if (discrepancyReport && discrepancyReport.totalRawCount > 0) {
				const sd = serializeDiscrepancyReport(discrepancyReport);
				// Build a flat sorted array (confidence descending = highest first)
				const items = [
					...Object.values(sd.byContributor).flat(),
					...sd.unattributed,
				].sort((a, b) => b.confidence - a.confidence);
				serializedDiscrepancy = {
					totalCount: sd.totalFilteredCount,
					byContributor: sd.byContributor,
					unattributed: sd.unattributed,
					items,
					allItems: sd.allItems,
					discrepancyThreshold: sd.discrepancyThreshold,
				};
			}

			const result: ReportResult = {
				outputPath: outputPath ?? jsonOutputPath!,
				jsonOutputPath,
				summary: teamHighlight,
				reportData: reportDataForTui,
				serializedDiscrepancy,
			} satisfies ReportResult;

			// Persist snapshot for future period-delta comparisons
			try {
				const runHistory = new RunHistoryStore();
				const serializedJson = JSON.stringify(reportDataForTui);
				const checksum = createHash("sha256")
					.update(serializedJson)
					.digest("hex");
				await runHistory.save({
					runId,
					timestamp: new Date().toISOString(),
					orgSlug: organization.login,
					startDate: window.startDate,
					endDate: window.endDate,
					memberCount: members.length,
					repoCount: repositories.length,
					blobSchemaVersion: 1,
					checksum,
					reportData: reportDataForTui,
				});
			} catch (snapshotError) {
				this.logger.warn(`Snapshot save failed: ${snapshotError}`);
			}

			await appendRunLogEntry({
				timestamp: new Date().toISOString(),
				event: "run-success",
				runId,
				org: input.org,
				outputPath: outputPath ?? jsonOutputPath,
				repositoryCount: repositories.length,
				memberCount: members.length,
				includeGit,
				includeAsana: includeTaskTracker,
			});

			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const stack =
				error instanceof Error && error.stack ? error.stack : undefined;
			await appendRunLogEntry({
				timestamp: new Date().toISOString(),
				event: "run-failure",
				runId,
				org: input.org,
				error: message,
				stack,
			});
			throw error;
		} finally {
			progress.cleanup();

			// Log warnings/errors after frame cleanup so they don't break the TUI
			if (metricsResult) {
				for (const warning of metricsResult.warnings ?? []) {
					this.logger.warn(warning);
				}
				for (const error of metricsResult.errors ?? []) {
					this.logger.error(error);
				}
			}
		}
	}

	private toScopeOptions(input: ReportCommandInput): ScopeOptions {
		const repositoryNames =
			input.repos && input.repos.length > 0 ? input.repos : undefined;
		return {
			includeBots: input.includeBots,
			includeArchived: input.includeArchived,
			excludePrivate: input.excludePrivate,
			teamSlug: input.team,
			memberLogins: input.members,
			repositoryNames,
		};
	}

	private resolveWindow(input: ReportCommandInput) {
		const now = new Date();

		const endISO = input.until ? resolveEndISO(input.until) : now.toISOString();
		const end = new Date(endISO);

		const startISO = input.since
			? resolveStartISO(input.since)
			: new Date(
					end.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
				).toISOString();
		const start = new Date(startISO);

		if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
			throw new Error("Unable to resolve reporting window");
		}

		// Display date: the user-facing end date (what the user typed, not the
		// padded API boundary).
		const displayEnd = input.until
			? new Date(`${input.until.slice(0, 10)}T00:00:00Z`)
			: end;

		const humanReadable = `${formatDateUTC(start)} – ${formatDateUTC(displayEnd)}`;

		return {
			startISO,
			endISO,
			startDate: startISO.slice(0, 10),
			endDate: input.until?.slice(0, 10) ?? endISO.slice(0, 10),
			humanReadable,
			generatedAt: now.toISOString(),
		};
	}

	private async toReportMemberMetrics(
		metricsResult: MetricsCollectionResult,
		_windowHuman: string,
	): Promise<ReportMemberMetrics[]> {
		const entries: ReportMemberMetrics[] = [];
		for (const member of metricsResult.members) {
			const memberMetrics: ReportMemberMetrics = {
				login: member.metrics.memberLogin,
				displayName: member.displayName,
				commits: member.metrics.commitsCount,
				prsOpened: member.metrics.prsOpenedCount,
				prsClosed: member.metrics.prsClosedCount,
				prsMerged: member.metrics.prsMergedCount,
				linesAdded: member.metrics.linesAdded,
				linesDeleted: member.metrics.linesDeleted,
				linesAddedInProgress: member.metrics.linesAddedInProgress ?? 0,
				linesDeletedInProgress: member.metrics.linesDeletedInProgress ?? 0,
				reviews: member.metrics.reviewsCount,
				approvals: member.metrics.approvalsCount,
				changesRequested: member.metrics.changesRequestedCount,
				commented: member.metrics.commentedCount,
				reviewComments: member.metrics.reviewCommentsCount,
				highlights: member.highlights,
				prHighlights: member.prHighlights,
				commitHighlights: member.commitHighlights,
				rawPullRequests: (member.rawPullRequests as RawPullRequestInfo[])?.map(
					(pr) => ({
						repoName: pr.repoName,
						number: pr.number,
						title: pr.title,
						url: pr.url,
						mergedAt: pr.mergedAt,
						state: pr.state,
						bodyText: pr.bodyText,
						additions: pr.additions,
						deletions: pr.deletions,
					}),
				),
				rawCommits: member.rawCommits?.map((c) => ({
					repoName: c.repoName,
					oid: c.oid,
					message: c.message,
					url: c.url,
					committedAt: c.committedAt,
				})),
				taskTracker: this.buildTaskTrackerPlaceholder(),
				aiSummary: "",
			};
			entries.push(memberMetrics);
		}
		return entries;
	}

	private async buildMemberSkeleton(
		members: Member[],
		_windowHuman: string,
	): Promise<ReportMemberMetrics[]> {
		const results: ReportMemberMetrics[] = [];
		for (const member of members) {
			const skeleton: ReportMemberMetrics = {
				login: member.login,
				displayName: member.displayName,
				commits: 0,
				prsOpened: 0,
				prsClosed: 0,
				prsMerged: 0,
				linesAdded: 0,
				linesDeleted: 0,
				linesAddedInProgress: 0,
				linesDeletedInProgress: 0,
				reviews: 0,
				approvals: 0,
				changesRequested: 0,
				commented: 0,
				reviewComments: 0,
				highlights: [],
				prHighlights: [],
				commitHighlights: [],
				taskTracker: this.buildTaskTrackerPlaceholder(),
				aiSummary: "",
			} satisfies ReportMemberMetrics;
			results.push(skeleton);
		}
		return results;
	}

	private markTaskTrackerSkipped(
		members: ReportMemberMetrics[],
	): ReportMemberMetrics[] {
		const summary = this.buildTaskTrackerDisabledSummary(
			"Task tracker integration skipped. Use the default report to include tasks.",
		);
		return members.map((member) => ({
			...member,
			taskTracker: summary,
		}));
	}

	private async attachTaskTrackerData(
		members: ReportMemberMetrics[],
		window: { startISO: string; endISO: string },
	): Promise<ReportMemberMetrics[]> {
		if (!this.taskTracker) {
			return members.map((member) => ({
				...member,
				taskTracker: this.buildTaskTrackerDisabledSummary(),
			}));
		}

		const inputs = members.map((member) => ({
			login: member.login,
			displayName: member.displayName,
		}));

		const summaries = await this.taskTracker.fetchTasksForMembers(
			inputs,
			window,
		);

		return members.map((member) => {
			const summary = summaries.get(member.login);
			if (!summary) {
				return {
					...member,
					taskTracker: this.taskTracker?.enabled
						? this.buildTaskTrackerNoMatchSummary()
						: this.buildTaskTrackerDisabledSummary(),
				} as ReportMemberMetrics;
			}
			return {
				...member,
				taskTracker: summary,
			} as ReportMemberMetrics;
		});
	}

	private buildTaskTrackerPlaceholder(): MemberTaskSummary {
		if (this.taskTracker?.enabled) {
			return this.buildTaskTrackerNoMatchSummary();
		}
		return this.buildTaskTrackerDisabledSummary();
	}

	private buildTaskTrackerDisabledSummary(
		message = "Integration disabled.",
	): MemberTaskSummary {
		return {
			status: "disabled",
			tasks: [],
			message,
		};
	}

	private buildTaskTrackerNoMatchSummary(
		message = "No match found.",
	): MemberTaskSummary {
		return {
			status: "no-match",
			tasks: [],
			message,
		};
	}

	private computeTotals(
		repoCount: number,
		members: ReportMemberMetrics[],
	): ReportTotals {
		return {
			prs: members.reduce(
				(sum, metric) =>
					sum + metric.prsOpened + metric.prsClosed + metric.prsMerged,
				0,
			),
			prsMerged: members.reduce((sum, metric) => sum + metric.prsMerged, 0),
			repoCount,
			contributorCount: members.length,
		} satisfies ReportTotals;
	}

	private buildGlobalHighlights(
		metricsResult: MetricsCollectionResult,
	): string[] {
		const phrases = new Set<string>();
		for (const member of metricsResult.members) {
			member.highlights.slice(0, 2).forEach((highlight) => {
				const cleaned = highlight.replace(/^merged\s+/i, "").trim();
				if (cleaned.length > 0) {
					phrases.add(cleaned);
				}
			});
		}
		return Array.from(phrases).slice(0, 3);
	}

	private resolveIndividualsCacheDir(): string {
		return join(cacheDir(), "individuals");
	}

	private buildArchivedNote(
		repositories: Repository[],
		includeArchived: boolean,
	): string {
		if (!includeArchived) {
			return "No repositories were archived or transferred during the reporting window.";
		}
		const archived = repositories.filter((repo) => repo.isArchived);
		if (archived.length === 0) {
			return "No repositories were archived or transferred during the reporting window.";
		}
		const names = archived.map((repo) => repo.name).join(", ");
		return `Archived repositories included in scope: ${names}.`;
	}

	private async writeReportFile(
		org: string,
		markdown: string,
		endDateLabel: string,
		customOutputPath?: string,
	): Promise<string> {
		if (customOutputPath) {
			await writeFile(customOutputPath, markdown, "utf8");
			return customOutputPath;
		}
		const safeOrg = org.replace(/[^a-zA-Z0-9-_]/g, "-");
		const fileName = `teamhero-report-${safeOrg}-${endDateLabel}.md`;
		const outputPath = join(this.outputDir(), fileName);
		await writeFile(outputPath, markdown, "utf8");
		return outputPath;
	}

	private async writeJsonReportFile(
		org: string,
		data: Record<string, unknown>,
		endDateLabel: string,
		customOutputPath?: string,
	): Promise<string> {
		const jsonContent = JSON.stringify(data, null, 2);
		if (customOutputPath) {
			const jsonPath = `${customOutputPath.replace(/\.md$/, "")}.json`;
			await writeFile(jsonPath, jsonContent, "utf8");
			return jsonPath;
		}
		const safeOrg = org.replace(/[^a-zA-Z0-9-_]/g, "-");
		const fileName = `teamhero-report-${safeOrg}-${endDateLabel}.json`;
		const outputPath = join(this.outputDir(), fileName);
		await writeFile(outputPath, jsonContent, "utf8");
		return outputPath;
	}
}
