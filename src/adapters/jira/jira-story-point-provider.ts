import { type ConsolaInstance, consola } from "consola";
import type {
	CompletedWorkFetchResult,
	CompletedWorkItem,
	JiraCompletedWorkProvider,
	JiraProjectFieldConfig,
	ReportingWindow,
	StoryPointFetchResult,
	StoryPointOptions,
	StoryPointProvider,
	StoryPointResult,
	TaskTrackerMemberInput,
} from "../../core/types.js";
import {
	applyFieldOverride,
	type JiraFieldDescriptor,
	resolveProjectField,
} from "./jira-field-resolver.js";
import {
	doneStatusNames,
	type JiraStatusDescriptor,
} from "./jira-status-resolver.js";

/**
 * Issue types that carry points when the operator names none.
 *
 * Empty means every type. A named list was the earlier default, and it silently
 * dropped whole projects: a site that calls its pointed type "User Story",
 * "Bug", or "Technical Design" matched nothing and reported zero for everyone.
 * Narrowing is now an explicit choice, per project in `jira-config.json`,
 * globally in `issueTypes` / `JIRA_ISSUE_TYPES`, or per run with
 * `--jira-issue-types`.
 */
const DEFAULT_ISSUE_TYPES: string[] = [];
const MAX_RETRIES = 3;
const PAGE_SIZE = 100;
const SEARCH_TIMEOUT_MS = 30_000;
/**
 * Days of slack added to each side of the JQL completion window.
 *
 * JQL date literals are read in the searching account's timezone, which is not
 * necessarily the timezone the site renders issue timestamps in, and the two
 * can differ by up to a day at a boundary. The search is therefore asked for a
 * deliberately wide superset and the exact week is decided in
 * {@link firstCompletionDay} from the changelog itself.
 */
const WINDOW_SLACK_DAYS = 1;

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

interface JiraChangeItem {
	field?: string;
	to?: string;
	toString?: string;
}

interface JiraHistory {
	author?: JiraUser;
	created?: string;
	items?: JiraChangeItem[];
}

interface JiraChangelog {
	histories?: JiraHistory[];
	/** Total histories on the issue. Larger than `histories.length` when truncated. */
	total?: number;
}

interface JiraIssue {
	key: string;
	fields: {
		assignee?: JiraUser | null;
		issuetype?: { name?: string; subtask?: boolean };
		[fieldId: string]: unknown;
	};
	changelog?: JiraChangelog;
}

interface JiraSearchPage {
	issues: JiraIssue[];
	nextPageToken?: string;
	isLast?: boolean;
}

/** The completion window, as the whole days it spans. */
export interface CompletionWindowDays {
	/** First day that counts, "YYYY-MM-DD". */
	firstDay: string;
	/** Last day that counts, "YYYY-MM-DD" — inclusive. */
	lastDay: string;
}

/**
 * Fetches story points completed in the window from Jira, keyed by canonical
 * Person id. Read-only. See docs/teamhero-storypoints-plan.md.
 */
export class JiraStoryPointProvider
	implements StoryPointProvider, JiraCompletedWorkProvider
{
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
		const completed = await this.fetchCompletedWork(window, options);
		const byPerson = new Map<string, StoryPointResult>();
		for (const item of completed.items) {
			if (!item.personId || !item.countsForStoryPoints) continue;
			const existing =
				byPerson.get(item.personId) ??
				({
					status: "matched",
					totalPoints: 0,
					byProject: {},
					issueCount: 0,
				} satisfies StoryPointResult);
			existing.totalPoints += item.points ?? 0;
			existing.byProject[item.project] =
				(existing.byProject[item.project] ?? 0) + (item.points ?? 0);
			existing.issueCount += 1;
			byPerson.set(item.personId, existing);
		}
		return {
			byPerson,
			unmatchedAssignees: completed.unmatchedAssignees,
		};
	}

	async fetchCompletedWork(
		window: ReportingWindow,
		options: StoryPointOptions,
	): Promise<CompletedWorkFetchResult> {
		const items: CompletedWorkItem[] = [];
		const unmatched = new Set<string>();
		const warnings: string[] = [];
		let complete = true;
		if (!this.enabled) {
			return { items, unmatchedAssignees: [], warnings, complete: false };
		}
		const projects = await this.resolveProjectFields(
			options.projects,
			options.storyPointField,
		);
		const doneStatuses = await this.resolveDoneStatuses();
		const days = completionWindowDays(window);
		for (const project of projects) {
			const storyPointTypes =
				project.issueTypes ?? options.issueTypes ?? DEFAULT_ISSUE_TYPES;
			const completedWorkTypes =
				project.completedWork?.issueTypes ?? storyPointTypes;
			// One Jira fetch must support both projections. An empty policy means
			// every type, otherwise query the union and filter each projection below.
			const issueTypes =
				storyPointTypes.length === 0 || completedWorkTypes.length === 0
					? []
					: [...new Set([...storyPointTypes, ...completedWorkTypes])];
			try {
				const issues = await this.searchProject(
					project,
					issueTypes,
					days,
					doneStatuses,
				);
				for (const issue of issues) {
					const histories = await this.completeHistories(issue);
					const event = completionEvent(histories, doneStatuses);
					const completedDay = event?.created?.slice(0, 10);
					if (
						!event?.created ||
						!completedDay ||
						completedDay < days.firstDay ||
						completedDay > days.lastDay
					)
						continue;
					const creditee =
						(options.creditBy ?? "assignee") === "resolver"
							? (event.author ?? issue.fields.assignee)
							: issue.fields.assignee;
					const accountId = creditee?.accountId;
					const personId = accountId
						? this.jiraLookup.get(accountId)
						: undefined;
					if (!personId) {
						unmatched.add(
							creditee?.displayName ?? accountId ?? `${issue.key} (unassigned)`,
						);
					}
					const rawPoints = issue.fields[project.fieldId];
					const issueType = issue.fields.issuetype?.name ?? "Unknown";
					items.push({
						key: issue.key,
						project: project.key,
						issueType,
						isSubtask: issue.fields.issuetype?.subtask === true,
						countsForStoryPoints:
							storyPointTypes.length === 0 ||
							storyPointTypes.includes(issueType),
						countsForCompletedWork:
							completedWorkTypes.length === 0 ||
							completedWorkTypes.includes(issueType),
						firstCompletedAt: event.created,
						assigneeAccountId: accountId,
						assigneeDisplayName: creditee?.displayName,
						personId,
						points: typeof rawPoints === "number" ? rawPoints : 0,
						category: project.completedWork?.category ?? "delivery",
					});
				}
			} catch (err) {
				if (!this.warnProjectFailure(project.key, err)) throw err;
				complete = false;
				warnings.push(
					`Jira completed-work collection skipped project ${project.key}: ${(err as Error).message}`,
				);
			}
		}
		return {
			items,
			unmatchedAssignees: [...unmatched],
			warnings,
			complete,
		};
	}

	private resolvedProjects?: JiraProjectFieldConfig[];
	private resolvedDoneStatuses?: Set<string>;

	/**
	 * Pin each project to a story-point field that this Jira site actually has.
	 *
	 * A configured id that the site does not define is not an error to Jira: the
	 * search succeeds and every issue simply carries no value, so the report
	 * prints zero for the whole team and nothing explains why. Reading the site's
	 * field list first turns that silent zero into either a repaired id or a
	 * warning. The list is fetched once per provider and reused for every week.
	 */
	private async resolveProjectFields(
		projects: JiraProjectFieldConfig[],
		override?: string,
	): Promise<JiraProjectFieldConfig[]> {
		if (this.resolvedProjects) {
			return this.resolvedProjects;
		}
		const requested = override
			? projects.map((project) => applyFieldOverride(project, override))
			: projects;

		let fields: JiraFieldDescriptor[];
		try {
			fields = await this.fetchFields();
		} catch (err) {
			// The field list is a repair aid, not a dependency: keep the configured
			// ids and let the search report whatever it finds.
			this.logger.warn(
				`[jira] could not read the field list; using the configured field ids. (${(err as Error).message})`,
			);
			this.resolvedProjects = requested;
			return requested;
		}

		const resolved = requested.map((project) => {
			const resolution = resolveProjectField(project, fields);
			if (resolution.outcome === "repaired") {
				this.logger.warn(
					`[jira] project ${project.key}: story-point field ${resolution.previousFieldId || "(unset)"} is not on this Jira site; using ${resolution.config.fieldId} ("${resolution.config.jqlName}") instead.`,
				);
			}
			if (resolution.outcome === "unresolved") {
				this.logger.warn(
					`[jira] project ${project.key}: no story-point field named "${project.jqlName}" on this Jira site; points will read 0. Set "storyPointField" in jira-config.json or JIRA_STORY_POINT_FIELD.`,
				);
			}
			return resolution.config;
		});
		this.resolvedProjects = resolved;
		return resolved;
	}

	/**
	 * The names of every status this site files under the Done category.
	 *
	 * Which words a site uses for "finished" is a per-site fact — this one has
	 * four (Done, LIVE, Closed, Review/Accept) and a hard-coded pair would have
	 * mis-dated every issue that finished under the other two. Read once per
	 * provider and reused for every week.
	 */
	private async resolveDoneStatuses(): Promise<Set<string>> {
		if (this.resolvedDoneStatuses) {
			return this.resolvedDoneStatuses;
		}
		let names: Set<string>;
		try {
			names = doneStatusNames(await this.fetchStatuses());
		} catch (err) {
			this.logger.warn(
				`[jira] could not read the status list; falling back to the well-known done statuses. (${(err as Error).message})`,
			);
			names = doneStatusNames([]);
		}
		if (names.size === 0) {
			this.logger.warn(
				"[jira] this site reports no status in the Done category; falling back to the well-known done statuses.",
			);
			names = doneStatusNames([]);
		}
		this.resolvedDoneStatuses = names;
		return names;
	}

	/** Read the site's field list. Overridable seam for tests. */
	protected async fetchFields(): Promise<JiraFieldDescriptor[]> {
		const body = await this.get<Array<{ id?: string; name?: string }>>(
			"/rest/api/3/field",
			"field list",
		);
		return body.flatMap((field) =>
			typeof field.id === "string" && typeof field.name === "string"
				? [{ id: field.id, name: field.name }]
				: [],
		);
	}

	/** Read the site's status list. Overridable seam for tests. */
	protected async fetchStatuses(): Promise<JiraStatusDescriptor[]> {
		return this.get<JiraStatusDescriptor[]>(
			"/rest/api/3/status",
			"status list",
		);
	}

	/**
	 * Read one issue's full changelog.
	 *
	 * A search only ever embeds the first page of histories, so an issue that has
	 * been dragged around the board more than a hundred times would otherwise
	 * lose its earliest transitions — exactly the ones that date the completion.
	 * Overridable seam for tests.
	 */
	protected async fetchIssueChangelog(key: string): Promise<JiraHistory[]> {
		const histories: JiraHistory[] = [];
		let startAt = 0;
		for (;;) {
			const page = await this.get<{
				values?: JiraHistory[];
				total?: number;
				isLast?: boolean;
			}>(
				`/rest/api/3/issue/${encodeURIComponent(key)}/changelog?startAt=${startAt}&maxResults=100`,
				`changelog for ${key}`,
			);
			const values = page.values ?? [];
			histories.push(...values);
			if (page.isLast || values.length === 0) break;
			if (typeof page.total === "number" && histories.length >= page.total) {
				break;
			}
			startAt += values.length;
		}
		return histories;
	}

	/** Authenticated GET returning parsed JSON. */
	private async get<T>(path: string, what: string): Promise<T> {
		const auth = Buffer.from(`${this.email}:${this.apiToken}`).toString(
			"base64",
		);
		const res = await fetch(`${this.baseUrl}${path}`, {
			headers: {
				authorization: `Basic ${auth}`,
				accept: "application/json",
				"user-agent": this.userAgent,
			},
		});
		if (!res.ok) {
			throw new Error(`Jira ${what} ${res.status}`);
		}
		return (await res.json()) as T;
	}

	/**
	 * The day this issue first entered a completed status, or undefined when it
	 * never did. Refetches the changelog when the search embedded only part of it.
	 */
	private async completeHistories(issue: JiraIssue): Promise<JiraHistory[]> {
		let histories = issue.changelog?.histories ?? [];
		const total = issue.changelog?.total;
		if (typeof total === "number" && total > histories.length) {
			histories = await this.fetchIssueChangelog(issue.key);
		}
		return histories;
	}

	/** Build per-project JQL and page through all matching issues. */
	private async searchProject(
		project: JiraProjectFieldConfig,
		issueTypes: string[],
		days: CompletionWindowDays,
		doneStatuses: ReadonlySet<string>,
	): Promise<JiraIssue[]> {
		const jql = buildJql(project, issueTypes, days, doneStatuses);
		const fields = ["assignee", project.fieldId, "issuetype", "status"];
		const all: JiraIssue[] = [];
		let pageToken: string | undefined;
		do {
			const page = await this.search(jql, fields, pageToken, "changelog");
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
		expand?: string,
	): Promise<JiraSearchPage> {
		const url = new URL(`${this.baseUrl}/rest/api/3/search/jql`);
		const body: Record<string, unknown> = {
			jql,
			fields,
			maxResults: PAGE_SIZE,
		};
		// `/search/jql` takes `expand` as a comma-separated STRING; an array is
		// rejected with a 400 that reads like a JQL problem.
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
			const error = new Error(`Jira search ${res.status}: ${text} — ${jql}`);
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
		// The failing JQL rides along in the message so the other cause — a query
		// this tool built wrong — is diagnosable rather than a silent zero.
		if (status === 400) {
			if (!this.warnedFieldAbsent.has(key)) {
				this.warnedFieldAbsent.add(key);
				this.logger.warn(
					`[jira] story-point search rejected for project ${key}; contributing 0. (${(err as Error).message})`,
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
 * The whole days a reporting window covers.
 *
 * `window.endISO` is an EXCLUSIVE upper bound (start of the day after `until`,
 * via `resolveExclusiveEndISO`), so the last day that counts is the one a
 * millisecond earlier.
 */
export function completionWindowDays(
	window: ReportingWindow,
): CompletionWindowDays {
	const start = new Date(window.startISO);
	const lastMoment = new Date(new Date(window.endISO).getTime() - 1);
	return { firstDay: utcDay(start), lastDay: utcDay(lastMoment) };
}

/**
 * Pure JQL builder — exported for unit assertions.
 *
 * The query asks for issues that carry an estimate and moved into one of this
 * site's completed statuses anywhere near the window. It is a candidate filter,
 * not the answer: `statusCategoryChangedDate` — the bound this used to
 * carry — holds only the issue's LAST category change, so an issue finished in
 * April and shipped in August was dated August, and an issue finished and then
 * reopened dropped out of every week. Reading the transition history instead
 * dates each issue by the moment it FIRST completed, which is a property of the
 * issue alone: it lands in exactly one week however many weeks are queried, so
 * no cross-week bookkeeping is needed to stop it being counted twice.
 *
 * The bounds carry a day of slack on each side because JQL reads a bare date in
 * the searching account's timezone; {@link firstCompletionDay} then picks the
 * exact week out of the result.
 */
export function buildJql(
	project: JiraProjectFieldConfig,
	issueTypes: string[],
	days: CompletionWindowDays,
	doneStatuses: ReadonlySet<string>,
): string {
	const clauses = [`project = "${project.key}"`];
	// Empty issueTypes => count every type (no issuetype filter).
	if (issueTypes.length > 0) {
		clauses.push(`issuetype in (${issueTypes.map(quoteJql).join(", ")})`);
	}
	// Addressed by id, so a site with two similarly named fields stays unambiguous.
	const fieldId = /^customfield_(\d+)$/.exec(project.fieldId);
	if (fieldId) {
		clauses.push(`cf[${fieldId[1]}] is not EMPTY`);
	}
	const statuses = [...doneStatuses].sort();
	clauses.push(
		`status changed to (${statuses.map(quoteJql).join(", ")}) ` +
			`during ("${shiftDay(days.firstDay, -WINDOW_SLACK_DAYS)}", ` +
			`"${shiftDay(days.lastDay, WINDOW_SLACK_DAYS)}")`,
	);
	return clauses.join(" AND ");
}

/**
 * The day an issue first entered a completed status, as Jira renders it.
 *
 * The date prefix of the timestamp is the calendar day in the timezone the site
 * renders its timestamps in, which is the timezone the team's week is drawn in.
 * Comparing instants in UTC instead would move work finished after 7pm Central
 * into the following day, and with it into the following week.
 */
export function firstCompletionDay(
	histories: JiraHistory[],
	doneStatuses: ReadonlySet<string>,
): string | undefined {
	return completionEvent(histories, doneStatuses)?.created?.slice(0, 10);
}

/** The history entry that first moved the issue into a completed status. */
function completionEvent(
	histories: JiraHistory[],
	doneStatuses: ReadonlySet<string>,
): JiraHistory | undefined {
	return histories
		.filter((history) =>
			(history.items ?? []).some(
				(item) =>
					item.field === "status" &&
					typeof item.toString === "string" &&
					doneStatuses.has(item.toString),
			),
		)
		.sort((a, b) => (a.created ?? "").localeCompare(b.created ?? ""))[0];
}

/** Quote and escape a JQL string literal (backslashes and double quotes). */
function quoteJql(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** "YYYY-MM-DD" for a Date, in UTC. */
function utcDay(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/** Move a "YYYY-MM-DD" day by whole days. */
function shiftDay(day: string, offset: number): string {
	const date = new Date(`${day}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + offset);
	return utcDay(date);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
