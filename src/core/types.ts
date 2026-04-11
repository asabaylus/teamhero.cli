/**
 * Core port definitions for report orchestration.
 * Contracts are intentionally lightweight to keep adapters focused.
 *
 * ALL port interfaces live here — never elsewhere, never as type aliases.
 */

import type { Member } from "../models/member.js";
import type { ContributionMetricSet } from "../models/metrics.js";
import type { Organization } from "../models/organization.js";
import type { Repository } from "../models/repository.js";
import type {
	NormalizedNote,
	ProjectAccomplishment,
	ProjectNoteAssociation,
	ProjectTask,
} from "../models/visible-wins.js";

// ---------------------------------------------------------------------------
// Repository discovery
// ---------------------------------------------------------------------------

export interface FetchOptions {
	/** Maximum number of repositories to retrieve (defaults to 100). */
	maxRepos?: number;
	/** Sorting strategy for repositories. */
	sortBy?: "pushed" | "name";
	/** Include private repositories when true (default true). */
	includePrivate?: boolean;
	/** Include archived repositories when true (default false). */
	includeArchived?: boolean;
}

export interface RepoProvider {
	/**
	 * Return repository names for the provided organization respecting the fetch options.
	 * Implementations should avoid console I/O and keep side-effects inside adapters.
	 */
	listRepositories(org: string, options?: FetchOptions): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Interactive selection
// ---------------------------------------------------------------------------

export type SelectionResult =
	| { type: "all" }
	| { type: "specific"; repositories: string[] }
	| { type: "cancelled" };

export interface SelectionUI {
	/** Present a selection experience and return the user's choice. */
	selectRepositories(
		repositories: string[],
		organization: string,
	): Promise<SelectionResult>;
	/** Ask for confirmation before performing an expensive action. */
	confirm(message: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Shared date window
// ---------------------------------------------------------------------------

/**
 * Shared date window for all report sections.
 * Resolved once from user input in report.service.ts and passed to every section.
 * Structurally compatible with AsanaWindow.
 */
export interface ReportingWindow {
	startISO: string;
	endISO: string;
}

// ---------------------------------------------------------------------------
// Scope resolution (org / repos / members)
// ---------------------------------------------------------------------------

export interface ScopeOptions {
	includeBots: boolean;
	includeArchived: boolean;
	excludePrivate: boolean;
	teamSlug?: string;
	memberLogins?: string[];
	repositoryNames?: string[];
}

/** Port for resolving organizations, repositories, and members from a source-control host. */
export interface ScopeProvider {
	getOrganization(org: string): Promise<Organization>;
	getRepositories(org: string, options: ScopeOptions): Promise<Repository[]>;
	getMembers(org: string, options: ScopeOptions): Promise<Member[]>;
}

// ---------------------------------------------------------------------------
// Source-control metrics collection
// ---------------------------------------------------------------------------

export interface MetricsCollectionOptions {
	organization: Organization;
	members: Member[];
	repositories: Repository[];
	since: string;
	until: string;
	maxCommitPages?: number;
	maxPullRequestPages?: number;
	onCommitProgressUpdate?: (text: string, progress?: number) => void;
	onProgressUpdate?: (text: string, progress?: number) => void;
}

export interface RawPullRequestInfo {
	repoName: string;
	number: number;
	title: string;
	bodyText?: string;
	additions: number;
	deletions: number;
	url: string;
	mergedAt: string;
	state: "MERGED" | "CLOSED" | "OPEN";
}

export interface RawCommitInfo {
	repoName: string;
	oid: string;
	message: string;
	url: string;
	committedAt: string;
}

export interface MetricsMemberResult {
	metrics: ContributionMetricSet;
	displayName: string;
	highlights: string[];
	prHighlights: string[];
	commitHighlights: string[];
	rawPullRequests?: RawPullRequestInfo[];
	rawCommits?: RawCommitInfo[];
}

export interface MetricsCollectionResult {
	members: MetricsMemberResult[];
	warnings: string[];
	errors: string[];
	mergedTotal: number;
}

/** Port for collecting source-control metrics (commits, PRs, reviews, LOC). */
export interface MetricsProvider {
	collect(options: MetricsCollectionOptions): Promise<MetricsCollectionResult>;
}

// ---------------------------------------------------------------------------
// Task tracker (Asana, Jira, etc.)
// ---------------------------------------------------------------------------

export interface TaskSummary {
	gid: string;
	name: string;
	status: "completed" | "incomplete";
	completedAt?: string | null;
	dueOn?: string | null;
	dueAt?: string | null;
	permalinkUrl?: string | null;
	description?: string | null;
	comments?: string[];
}

export interface MemberTaskSummary {
	status: "matched" | "no-match" | "disabled";
	matchType?: "email" | "name";
	tasks: TaskSummary[];
	message?: string;
}

export interface TaskTrackerMemberInput {
	login: string;
	displayName: string;
}

/** Port for fetching per-member task summaries from a task tracker. */
export interface TaskTrackerProvider {
	readonly enabled: boolean;
	fetchTasksForMembers(
		members: TaskTrackerMemberInput[],
		window: ReportingWindow,
	): Promise<Map<string, MemberTaskSummary>>;
}

// ---------------------------------------------------------------------------
// Project board & meeting notes (Visible Wins)
// ---------------------------------------------------------------------------

/**
 * Port for fetching active projects from a project board.
 * Implementations return domain-typed ProjectTask[], never raw API data.
 */
export interface ProjectBoardProvider {
	/** Fetch active projects with custom field values from the configured board section. */
	fetchProjects(): Promise<ProjectTask[]>;
}

/**
 * Port for discovering and parsing meeting notes within a date range.
 * Implementations return domain-typed NormalizedNote[], never raw filesystem data.
 */
export interface MeetingNotesProvider {
	/** Fetch parsed meeting notes filtered to the given reporting window. */
	fetchNotes(window: ReportingWindow): Promise<NormalizedNote[]>;
}

/** Aggregated data from the Visible Wins pipeline before AI extraction. */
export interface VisibleWinsDataResult {
	projects: ProjectTask[];
	notes: NormalizedNote[];
	associations: ProjectNoteAssociation[];
	supplementaryNotes?: string;
}

/**
 * Latest Asana project status update for a rock's sibling project.
 * Populated via `GET /projects/{gid}/project_statuses` and passed to the
 * roadmap extractor + synthesis prompt as a canonical status source.
 */
export interface LatestProjectStatus {
	title: string;
	text: string;
	/** Raw Asana color string: "green" | "yellow" | "red" | "blue" | other. */
	color: string;
	createdAt: string;
	createdBy?: string;
}

/**
 * Source of the value in a roadmap entry's nextMilestone / overallStatus field.
 * Used to determine whether the AI overrode the pre-computed value with a
 * clearer signal from transcripts or project status updates (and therefore
 * owes a citation), or kept the deterministic pre-computation as-is.
 */
export type RoadmapFieldSource =
	| "asana-subtask"
	| "status-update"
	| "meeting-note"
	| "ai-inferred";

/** A roadmap initiative for the "Progress on Roadmap" table. */
export interface RoadmapEntry {
	gid: string;
	displayName: string;
	overallStatus: "on-track" | "at-risk" | "off-track" | "unknown";
	nextMilestone: string;
	keyNotes: string;
	/**
	 * Most recent Asana project status update for this rock's sibling project,
	 * when one could be resolved. The renderer prefers this for color emoji
	 * so 🔵 ("on hold") can surface without expanding the overallStatus union.
	 */
	latestStatusUpdate?: LatestProjectStatus;
	/**
	 * Provenance of nextMilestone. When "asana-subtask" the value is the
	 * deterministic pre-computation; any other value indicates the AI overrode
	 * the pre-computation based on transcripts or status updates and MUST be
	 * accompanied by a nextMilestoneCitation.
	 */
	nextMilestoneSource?: RoadmapFieldSource;
	/**
	 * Citation for an overridden nextMilestone (e.g. "Eng sync 2026-04-08" or
	 * "Status update 2026-04-08"). Empty when the pre-computed value was kept.
	 */
	nextMilestoneCitation?: string;
	/** Provenance of overallStatus. Same taxonomy as nextMilestoneSource. */
	overallStatusSource?: RoadmapFieldSource;
	/** Citation for an overridden overallStatus. Same rules as nextMilestoneCitation. */
	overallStatusCitation?: string;
}

/** Subtask info used for status derivation and milestone synthesis. */
export interface RoadmapSubtaskInfo {
	gid: string;
	name: string;
	completed: boolean;
	completedAt?: string | null;
	dueOn?: string | null;
	status?: string | null;
	notes?: string | null;
	assigneeName?: string | null;
	children: RoadmapSubtaskInfo[];
}

/** @deprecated Use RoadmapEntry instead */
export type RockEntry = RoadmapEntry;

/** Port for collecting project-board and meeting-notes data for the Visible Wins section. */
export interface VisibleWinsProvider {
	fetchData(window: ReportingWindow): Promise<VisibleWinsDataResult>;
}

// ---------------------------------------------------------------------------
// Progress reporting
// ---------------------------------------------------------------------------

/** Handle returned by ProgressReporter.start() to update or complete a step. */
export interface ProgressHandle {
	succeed(message?: string): void;
	fail(message?: string): void;
	update(text: string, progress?: number): void;
}

/** Port for reporting progress during long-running operations. */
export interface ProgressReporter {
	start(text: string): ProgressHandle;
	instantSuccess(message: string): void;
	cleanup(): void;
}

/** Factory for creating a ProgressReporter with run-specific options. */
export interface ProgressReporterFactory {
	create(options: { title: string; expectedSteps: number }): ProgressReporter;
}

// ---------------------------------------------------------------------------
// AI extraction contexts
// ---------------------------------------------------------------------------

/**
 * Context for the Visible Wins AI extraction prompt builder.
 * Groups the three inputs needed to generate an extraction prompt.
 */
export interface VisibleWinsExtractionContext {
	projects: ProjectTask[];
	associations: ProjectNoteAssociation[];
	notes: NormalizedNote[];
	supplementaryNotes?: string;
	/** Reporting window dates used for retrospective framing in the AI prompt. */
	reportingWindow?: { startDate: string; endDate: string };
	onStatus?: (message: string) => void;
}

/**
 * Context for factual validation of AI-extracted accomplishments.
 * Cross-checks dates and figures against source data.
 */
export interface FactualValidationContext {
	accomplishments: ProjectAccomplishment[];
	notes: NormalizedNote[];
	projects: ProjectTask[];
}

// ---------------------------------------------------------------------------
// Per-contributor discrepancy detection (Epic 5 — Stories 5.1 & 5.2)
// ---------------------------------------------------------------------------

/** A single source state observation from one platform (GitHub, Asana, etc.). */
export interface SourceStateEntry {
	/** Human-readable source name (e.g. "GitHub", "Asana"). */
	sourceName: string;
	/** Current state in that source (e.g. "MERGED", "Done", "Open", "In Progress"). */
	state: string;
	/** Optional link to the source item (PR URL, task permalink, etc.). */
	url?: string;
	/** Optional identifier for the item (PR number, task GID, etc.). */
	itemId?: string;
}

/** Confidence score for a discrepancy detection (0–100). */
export type DiscrepancyConfidence = number;

/** A cross-source discrepancy attributed to a specific contributor. */
export interface ContributorDiscrepancy {
	/** GitHub login of the contributor. Empty string for unattributed. */
	contributor: string;
	/** Display name of the contributor. "Unattributed" when no match found. */
	contributorDisplayName: string;
	/** State from source A (e.g. GitHub PR state). */
	sourceA: SourceStateEntry;
	/** State from source B (e.g. Asana task state). */
	sourceB: SourceStateEntry;
	/** Human-readable description of the suggested resolution. */
	suggestedResolution: string;
	/** Confidence level for this discrepancy. */
	confidence: DiscrepancyConfidence;
	/** Human-readable summary message (e.g. "@james: Asana task Done but PR #441 still open"). */
	message: string;
	/** Human-readable description of the rule that flagged this discrepancy. */
	rule: string;
	/** Report section this discrepancy was found in. */
	sectionName?: string;
}

/** Discrepancy report grouped by contributor with an unattributed bucket. */
export interface DiscrepancyReport {
	/** Discrepancies grouped by contributor login. */
	byContributor: Map<string, ContributorDiscrepancy[]>;
	/** Discrepancies that could not be attributed to a specific contributor. */
	unattributed: ContributorDiscrepancy[];
	/** Total number of discrepancies before false-positive filtering. */
	totalRawCount: number;
	/** Total number of discrepancies after false-positive filtering. */
	totalFilteredCount: number;
	/** ALL discrepancies (unfiltered) sorted by confidence ascending. */
	allItems: ContributorDiscrepancy[];
	/** Confidence threshold for report display (log retains all items). */
	discrepancyThreshold: number;
}

// ---------------------------------------------------------------------------
// AI-powered report audit (two-step discrepancy analysis)
// ---------------------------------------------------------------------------

/** Audit section name for AI-powered discrepancy detection. */
export type AuditSectionName =
	| "teamHighlight"
	| "visibleWins"
	| "individualContribution"
	| "roadmap";

/** A single report section's audit context for fact extraction. */
export interface SectionAuditContext {
	sectionName: AuditSectionName;
	claims: string;
	evidence: string;
	contributor?: string;
	contributorDisplayName?: string;
}

/** A discrepancy found in a section (intermediate type before mapping to ContributorDiscrepancy). */
export interface SectionDiscrepancy {
	sectionName: string;
	contributor?: string;
	contributorDisplayName?: string;
	summary: string;
	explanation: string;
	sourceA: SourceStateEntry;
	sourceB: SourceStateEntry;
	suggestedResolution: string;
	confidence: DiscrepancyConfidence;
	rule: string;
}

// ---------------------------------------------------------------------------
// Data caching (Smart Caching)
// ---------------------------------------------------------------------------

export type CacheSourceType =
	| "metrics"
	| "tasks"
	| "notes"
	| "visible-wins"
	| "repos"
	| "loc"
	| "member-highlights"
	| "team-highlight"
	| "audit"
	| "technical-wins"
	| "project-statuses";

// ---------------------------------------------------------------------------
// Technical / Foundational Wins section
// ---------------------------------------------------------------------------

/** A single grouped category of technical/foundational wins. */
export interface TechnicalFoundationalWinsCategory {
	/** Subheading name (e.g. "AI / Engineering", "IT / Centre"). */
	category: string;
	/** Ordered list of win bullets for this category. */
	wins: string[];
}

/** Structured AI output for the Technical / Foundational Wins section. */
export interface TechnicalFoundationalWinsResult {
	categories: TechnicalFoundationalWinsCategory[];
}

export interface CacheOptions {
	/** When true, bypass cache reads entirely (force re-fetch). */
	flush?: boolean;
	/** Selectively flush only specific cache sources. */
	flushSources?: CacheSourceType[];
	/** ISO date — flush entries whose reporting window starts on or after this date. */
	flushSince?: string;
}

// ---------------------------------------------------------------------------
// Run history snapshots
// ---------------------------------------------------------------------------

export interface RunSnapshotMeta {
	runId: string;
	timestamp: string;
	orgSlug: string;
	startDate: string;
	endDate: string;
	memberCount: number;
	repoCount: number;
	blobSchemaVersion: number;
	checksum: string;
}

// ---------------------------------------------------------------------------
// Report rendering (pluggable templates)
// ---------------------------------------------------------------------------

import type { ReportRenderInput } from "../lib/report-renderer.js";

export interface ReportRenderer {
	/** Unique identifier for this renderer (e.g. "detailed", "executive"). */
	readonly name: string;
	/** Human-readable description for --help and template listing. */
	readonly description: string;
	/** Render ReportRenderInput into a formatted string (typically markdown). */
	render(input: ReportRenderInput, options?: Record<string, string>): string;
}

// ---------------------------------------------------------------------------
// Period deltas and velocity trends (Epic 5 — Story 5.3)
// ---------------------------------------------------------------------------

/** Computed delta for a single metric between current and previous period. */
export interface MetricDelta {
	/** Current period value. */
	current: number;
	/** Previous period value (undefined when no previous data). */
	previous?: number;
	/** Absolute change (current - previous). */
	absoluteChange?: number;
	/** Percentage change ((current - previous) / previous * 100). */
	percentageChange?: number;
}

/** Delta collection for key report-level metrics. */
export interface PeriodDeltas {
	prsMerged: MetricDelta;
	prsOpened: MetricDelta;
	tasksCompleted: MetricDelta;
	linesChanged: MetricDelta;
	commits: MetricDelta;
	/** True when previous period data was successfully collected. */
	hasPreviousPeriod: boolean;
}

/**
 * Optional per-section system prompts sent as the `instructions` parameter to the AI API.
 * The `default` key applies to all sections unless a section-specific key overrides it.
 * Known keys: default, teamHighlight, memberHighlights, individualSummaries,
 * visibleWins, technicalWins, discrepancyAnalysis, roadmapSynthesis.
 */
export type SystemPrompts = Record<string, string>;
