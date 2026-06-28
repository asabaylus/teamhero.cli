import { type ConsolaInstance, consola } from "consola";
import type {
	JiraProjectFieldConfig,
	ReportingWindow,
	StoryPointFetchResult,
	StoryPointOptions,
	StoryPointProvider,
	StoryPointResult,
	TaskTrackerMemberInput,
} from "../../core/types.js";

const DEFAULT_ISSUE_TYPES = ["Story", "Task"];
const MAX_RETRIES = 3;
const PAGE_SIZE = 100;
const SEARCH_TIMEOUT_MS = 30_000;

export interface JiraStoryPointProviderConfig {
	baseUrl?: string;
	email?: string;
	apiToken?: string;
	/** Maps Jira accountId → canonical Person id. Built by the identity bridge (#21). */
	jiraLookup?: Map<string, string>;
	logger?: ConsolaInstance;
	userAgent?: string;
}

interface JiraUser {
	accountId?: string;
	displayName?: string;
	emailAddress?: string | null;
}

interface JiraChangelog {
	histories?: Array<{
		author?: JiraUser;
		created?: string;
		items?: Array<{ field?: string; to?: string; toString?: string }>;
	}>;
}

interface JiraIssue {
	key: string;
	fields: {
		assignee?: JiraUser | null;
		[fieldId: string]: unknown;
	};
	changelog?: JiraChangelog;
}

interface JiraSearchPage {
	issues: JiraIssue[];
	nextPageToken?: string;
	isLast?: boolean;
}

/**
 * Fetches story points completed in the window from Jira, keyed by canonical
 * Person id. Read-only. See docs/teamhero-storypoints-plan.md.
 */
export class JiraStoryPointProvider implements StoryPointProvider {
	private readonly baseUrl?: string;
	private readonly email?: string;
	private readonly apiToken?: string;
	private readonly jiraLookup: Map<string, string>;
	private readonly logger: ConsolaInstance;
	private readonly userAgent: string;

	constructor(config: JiraStoryPointProviderConfig = {}) {
		this.baseUrl = config.baseUrl?.replace(/\/+$/, "");
		this.email = config.email;
		this.apiToken = config.apiToken;
		this.jiraLookup = config.jiraLookup ?? new Map();
		this.logger = config.logger ?? consola.withTag("teamhero:jira");
		this.userAgent = config.userAgent ?? "teamhero-cli/0.1.0";
	}

	get enabled(): boolean {
		return Boolean(this.baseUrl && this.email && this.apiToken);
	}

	async fetchCompletedStoryPoints(
		_members: TaskTrackerMemberInput[],
		window: ReportingWindow,
		options: StoryPointOptions,
	): Promise<StoryPointFetchResult> {
		const byPerson = new Map<string, StoryPointResult>();
		const unmatched = new Set<string>();

		if (!this.enabled) {
			return { byPerson, unmatchedAssignees: [] };
		}

		const issueTypes = options.issueTypes ?? DEFAULT_ISSUE_TYPES;
		const creditBy = options.creditBy ?? "assignee";

		for (const project of options.projects) {
			try {
				const issues = await this.searchProject(
					project,
					issueTypes,
					window,
					creditBy,
				);
				for (const issue of issues) {
					this.creditIssue(issue, project, byPerson, unmatched, creditBy);
				}
			} catch (err) {
				// Only genuine not-found / field-absent cases are downgraded to a
				// warning; auth (401/403), rate-limit/transient (429/5xx), and
				// network errors rethrow so they surface accurately (the report-time
				// guard catches them and never aborts a git/Asana report).
				if (!this.warnProjectFailure(project.key, err)) throw err;
			}
		}

		return { byPerson, unmatchedAssignees: [...unmatched] };
	}

	/** Sum one issue's points onto the credited Person (or record an unmatched assignee). */
	private creditIssue(
		issue: JiraIssue,
		project: JiraProjectFieldConfig,
		byPerson: Map<string, StoryPointResult>,
		unmatched: Set<string>,
		creditBy: "assignee" | "resolver",
	): void {
		const rawPoints = issue.fields[project.fieldId];
		const points = typeof rawPoints === "number" ? rawPoints : 0;

		const creditee =
			creditBy === "resolver"
				? (resolveTransitionAuthor(issue) ?? issue.fields.assignee)
				: issue.fields.assignee;
		// Deterministic mapping: credit by Jira accountId only, no email fallback.
		const accountId = creditee?.accountId;
		const canonicalId = accountId ? this.jiraLookup.get(accountId) : undefined;

		if (!canonicalId) {
			unmatched.add(
				creditee?.displayName ?? accountId ?? `${issue.key} (unassigned)`,
			);
			return;
		}

		const existing =
			byPerson.get(canonicalId) ??
			({
				status: "matched",
				totalPoints: 0,
				byProject: {},
				issueCount: 0,
			} satisfies StoryPointResult);
		existing.totalPoints += points;
		existing.byProject[project.key] =
			(existing.byProject[project.key] ?? 0) + points;
		existing.issueCount += 1;
		byPerson.set(canonicalId, existing);
	}

	/** Build per-project JQL and page through all matching issues. */
	private async searchProject(
		project: JiraProjectFieldConfig,
		issueTypes: string[],
		window: ReportingWindow,
		creditBy: "assignee" | "resolver",
	): Promise<JiraIssue[]> {
		const jql = buildJql(project.key, issueTypes, window);
		const fields = ["assignee", project.fieldId, "resolutiondate", "issuetype"];
		// Resolver credit needs the status-transition history.
		const expand = creditBy === "resolver" ? ["changelog"] : undefined;
		const all: JiraIssue[] = [];
		let pageToken: string | undefined;
		do {
			const page = await this.search(jql, fields, pageToken, expand);
			all.push(...page.issues);
			pageToken = page.isLast ? undefined : page.nextPageToken;
		} while (pageToken);
		return all;
	}

	/** Low-level Jira JQL search. Overridable seam for tests. */
	protected async search(
		jql: string,
		fields: string[],
		pageToken?: string,
		expand?: string[],
	): Promise<JiraSearchPage> {
		const url = new URL(`${this.baseUrl}/rest/api/3/search/jql`);
		const body: Record<string, unknown> = {
			jql,
			fields,
			maxResults: PAGE_SIZE,
		};
		if (expand) body.expand = expand;
		if (pageToken) body.nextPageToken = pageToken;

		const auth = Buffer.from(`${this.email}:${this.apiToken}`).toString(
			"base64",
		);
		let lastErr: unknown;
		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
			let res: Response;
			try {
				res = await fetch(url, {
					method: "POST",
					headers: {
						authorization: `Basic ${auth}`,
						"content-type": "application/json",
						accept: "application/json",
						"user-agent": this.userAgent,
					},
					body: JSON.stringify(body),
					signal: controller.signal,
				});
			} catch (err) {
				// Timeout/network error: retry a few times, then surface.
				lastErr = err;
				if (attempt < MAX_RETRIES) {
					await delay(2 ** attempt * 250);
					continue;
				}
				throw err;
			} finally {
				clearTimeout(timer);
			}
			if (res.ok) {
				return (await res.json()) as JiraSearchPage;
			}
			if (res.status === 429 || res.status >= 500) {
				lastErr = new Error(`Jira search ${res.status}`);
				await delay(2 ** attempt * 250);
				continue;
			}
			const text = await res.text().catch(() => "");
			const error = new Error(`Jira search ${res.status}: ${text}`);
			(error as { status?: number }).status = res.status;
			throw error;
		}
		throw lastErr ?? new Error("Jira search failed");
	}

	private warnedProjectNotFound = new Set<string>();
	private warnedFieldAbsent = new Set<string>();

	/**
	 * Returns true when the error is a benign per-project case (field absent or
	 * project not found) that should be warned-and-skipped; false for auth,
	 * rate-limit, transient, or network errors that the caller must rethrow.
	 */
	private warnProjectFailure(key: string, err: unknown): boolean {
		const status = (err as { status?: number }).status;
		// 400 from a JQL search on this instance almost always means the
		// story-point field name/id isn't on the project (estimation disabled).
		if (status === 400) {
			if (!this.warnedFieldAbsent.has(key)) {
				this.warnedFieldAbsent.add(key);
				this.logger.warn(
					`[jira] story-point field not present on project ${key}; contributing 0. (${(err as Error).message})`,
				);
			}
			return true;
		}
		if (status === 404) {
			if (!this.warnedProjectNotFound.has(key)) {
				this.warnedProjectNotFound.add(key);
				this.logger.warn(
					`[jira] project ${key} not found or unreadable; skipping. (${(err as Error).message})`,
				);
			}
			return true;
		}
		// 401/403/429/5xx/network → not a per-project skip; let the caller rethrow.
		return false;
	}
}

/**
 * Pure JQL builder — exported for unit assertions.
 *
 * `window.endISO` is treated as an EXCLUSIVE upper bound (start of the day after
 * `until`, via `resolveExclusiveEndISO`) so `resolutiondate < end` is exact at
 * the day boundary and free of the +2-day GitHub buffer.
 */
export function buildJql(
	projectKey: string,
	issueTypes: string[],
	window: ReportingWindow,
): string {
	const start = toJqlDate(window.startISO);
	const end = toJqlDate(window.endISO);
	// Empty issueTypes => count every type (no issuetype filter).
	const typeClause =
		issueTypes.length > 0
			? `issuetype in (${issueTypes.map(quoteJql).join(", ")}) AND `
			: "";
	return (
		`project = "${projectKey}" AND ${typeClause}` +
		`statusCategory = Done ` +
		`AND resolutiondate >= "${start}" AND resolutiondate < "${end}"`
	);
}

/**
 * Find who performed the most recent status transition (the person who moved
 * the issue into its final/Done state). Used for `creditBy: "resolver"`.
 */
function resolveTransitionAuthor(issue: JiraIssue): JiraUser | undefined {
	const histories = (issue.changelog?.histories ?? [])
		.filter((h) => (h.items ?? []).some((i) => i.field === "status"))
		.sort((a, b) => (a.created ?? "").localeCompare(b.created ?? ""));
	return histories[histories.length - 1]?.author;
}

/** Quote and escape a JQL string literal (backslashes and double quotes). */
function quoteJql(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Jira JQL dates use "YYYY-MM-DD HH:mm" (no seconds, no TZ). */
function toJqlDate(iso: string): string {
	const d = new Date(iso);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
