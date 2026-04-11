import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { type ConsolaInstance, consola } from "consola";
import type {
	MemberTaskSummary,
	ReportingWindow,
	RoadmapSubtaskInfo,
	TaskSummary,
	TaskTrackerMemberInput,
	TaskTrackerProvider,
} from "../core/types.js";
import { resolveEndEpochMs } from "../lib/date-utils.js";
import { convertToAsanaOverrides } from "../lib/user-map.js";
import type { UserMap } from "../models/user-identity.js";

/** Backward-compatible type aliases. */
type AsanaMemberInput = TaskTrackerMemberInput;
type AsanaTaskSummary = TaskSummary;
type AsanaWindow = ReportingWindow;
type MemberAsanaSummary = MemberTaskSummary;

const DEFAULT_BASE_URL = "https://app.asana.com/api/1.0";
const MAX_RETRIES = 3;
const MAX_REDIRECTS = 5;

interface AsanaWorkspace {
	gid: string;
	name: string;
}

interface AsanaUser {
	gid: string;
	name: string;
	email?: string | null;
}

interface AsanaTaskResponseItem {
	gid: string;
	name: string;
	completed: boolean;
	completed_at?: string | null;
	due_on?: string | null;
	due_at?: string | null;
	permalink_url?: string | null;
	notes?: string | null;
}

interface AsanaStoryResponseItem {
	gid: string;
	type: string;
	resource_subtype?: string | null;
	text?: string | null;
	created_at?: string | null;
}

interface AsanaListResponse<T> {
	data: T[];
	next_page?: {
		offset?: string;
	} | null;
}

interface AsanaSingleResponse<T> {
	data: T;
}

interface WorkspaceUserDirectory {
	users: AsanaUser[];
	byEmail: Map<string, AsanaUser>;
	byName: Map<string, AsanaUser>;
}

export interface AsanaUserOverride {
	email?: string;
	name?: string;
	userGid?: string;
	workspaceGid?: string;
}

export interface AsanaServiceConfig {
	token?: string;
	baseUrl?: string;
	logger?: ConsolaInstance;
	workspaceGids?: string[];
	emailDomain?: string;
	/** @deprecated Use userMap instead */
	userOverrides?: Record<string, AsanaUserOverride>;
	/** General user identity map (preferred over userOverrides) */
	userMap?: UserMap;
	userAgent?: string;
}

interface MatchedUser {
	user: AsanaUser;
	workspace: AsanaWorkspace;
	matchType: "email" | "name" | "override";
}

export class AsanaService implements TaskTrackerProvider {
	private readonly token?: string;
	private readonly baseUrl: string;
	private readonly logger: ConsolaInstance;
	private readonly workspaceGids: string[];
	private readonly emailDomain?: string;
	private readonly userOverrides: Record<string, AsanaUserOverride>;
	private readonly userAgent: string;
	private workspaces: AsanaWorkspace[] | null = null;
	private readonly directories = new Map<string, WorkspaceUserDirectory>();

	constructor(config: AsanaServiceConfig = {}) {
		this.token = this.normalizeToken(config.token);
		this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
		this.logger = config.logger ?? consola.withTag("teamhero:asana");
		this.workspaceGids = config.workspaceGids ?? [];
		this.emailDomain = config.emailDomain;
		// Prefer userMap if provided, otherwise fall back to userOverrides
		this.userOverrides = config.userMap
			? convertToAsanaOverrides(config.userMap)
			: (config.userOverrides ?? {});
		this.userAgent = config.userAgent ?? "teamhero-cli/0.1.0";
	}

	get enabled(): boolean {
		return Boolean(this.token);
	}

	/** Fetch a single Asana API resource by path, returning the parsed JSON response. */
	async fetchFromPath<T>(
		path: string,
		params: Record<string, string> = {},
	): Promise<T> {
		return this.get<T>(path, params);
	}

	/** Fetch all pages from a paginated Asana API endpoint, returning a flat array of items. */
	async fetchFromPathPaginated<T>(
		path: string,
		params: Record<string, string> = {},
	): Promise<T[]> {
		return this.paginate<T>(path, params);
	}

	/**
	 * Fetch a single task by GID with its notes and custom fields.
	 * Used by the roadmap extractor to enrich rocks that live outside
	 * a section-filtered project slice (e.g. roadmap boards that scope
	 * Visible Wins fetches to one Asana section).
	 */
	async fetchTaskByGid(taskGid: string): Promise<{
		gid: string;
		name: string;
		notes: string | null;
		customFields: Record<string, string | number | null>;
	} | null> {
		const optFields =
			"gid,name,notes,custom_fields,custom_fields.name,custom_fields.display_value,custom_fields.number_value,custom_fields.type";

		interface TaskByGidResponse {
			data: {
				gid: string;
				name: string;
				notes?: string | null;
				custom_fields?: Array<{
					name: string;
					display_value: string | null;
					number_value?: number | null;
					type: string;
				}>;
			};
		}

		try {
			const response = await this.fetchFromPath<TaskByGidResponse>(
				`/tasks/${taskGid}`,
				{ opt_fields: optFields },
			);
			const task = response.data;
			const customFields: Record<string, string | number | null> = {};
			for (const field of task.custom_fields ?? []) {
				customFields[field.name] =
					field.type === "number"
						? (field.number_value ?? field.display_value ?? null)
						: field.display_value;
			}
			return {
				gid: task.gid,
				name: task.name,
				notes: task.notes ?? null,
				customFields,
			};
		} catch (err) {
			this.logger.warn(
				`[asana] fetchTaskByGid(${taskGid}) failed: ${(err as Error).message}`,
			);
			return null;
		}
	}

	/**
	 * Fetch subtasks for a task, recursively up to maxDepth levels.
	 * Returns a tree of RoadmapSubtaskInfo nodes.
	 */
	async fetchSubtasks(
		taskGid: string,
		maxDepth = 2,
	): Promise<RoadmapSubtaskInfo[]> {
		const optFields =
			"name,gid,due_on,completed,completed_at,notes,custom_fields,custom_fields.name,custom_fields.display_value,custom_fields.type,assignee.name";

		interface SubtaskResponse {
			gid: string;
			name: string;
			completed: boolean;
			completed_at?: string | null;
			due_on?: string | null;
			notes?: string | null;
			assignee?: { name?: string } | null;
			custom_fields?: Array<{
				name: string;
				display_value: string | null;
				type: string;
			}>;
		}

		const rawSubtasks = await this.paginate<SubtaskResponse>(
			`/tasks/${taskGid}/subtasks`,
			{ opt_fields: optFields },
		);

		const results: RoadmapSubtaskInfo[] = [];
		for (const st of rawSubtasks) {
			// Extract status from custom fields
			let status: string | null = null;
			for (const field of st.custom_fields ?? []) {
				if (
					(field.name === "Rock Status" || field.name === "Project Status") &&
					field.display_value
				) {
					status = field.display_value;
					break;
				}
			}

			const children =
				maxDepth > 1 ? await this.fetchSubtasks(st.gid, maxDepth - 1) : [];

			results.push({
				gid: st.gid,
				name: st.name,
				completed: st.completed,
				completedAt: st.completed_at ?? null,
				dueOn: st.due_on ?? null,
				status,
				notes: st.notes ?? null,
				assigneeName: st.assignee?.name ?? null,
				children,
			});
		}

		return results;
	}

	async fetchTasksForMembers(
		members: AsanaMemberInput[],
		window: AsanaWindow,
	): Promise<Map<string, MemberAsanaSummary>> {
		const results = new Map<string, MemberAsanaSummary>();

		if (!this.enabled) {
			for (const member of members) {
				results.set(member.login, {
					status: "disabled",
					tasks: [],
					message: "Integration disabled (set ASANA_API_TOKEN).",
				});
			}
			return results;
		}

		let workspaces: AsanaWorkspace[];
		try {
			workspaces = await this.loadWorkspaces();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.logger.warn(`Unable to load Asana workspaces: ${message}`);
			const fallbackMessage = "Unable to query Asana (see logs for details).";
			for (const member of members) {
				results.set(member.login, {
					status: "disabled",
					tasks: [],
					message: fallbackMessage,
				});
			}
			return results;
		}
		if (workspaces.length === 0) {
			this.logger.warn(
				"No Asana workspaces are accessible with the configured token.",
			);
			for (const member of members) {
				results.set(member.login, {
					status: "disabled",
					tasks: [],
					message: "Asana token has no accessible workspaces.",
				});
			}
			return results;
		}

		for (const member of members) {
			try {
				const match = await this.matchMember(member, workspaces);
				if (!match) {
					results.set(member.login, {
						status: "no-match",
						tasks: [],
						message: "No match found.",
					});
					continue;
				}

				const rawTasks = await this.fetchTasksForAssignee(
					match.workspace,
					match.user,
					window,
				);
				const summaries = await this.summarizeTasks(rawTasks, window);
				results.set(member.login, {
					status: "matched",
					matchType:
						match.matchType === "override" ? undefined : match.matchType,
					tasks: summaries,
					message:
						summaries.length === 0
							? "No completed tasks found within this window."
							: undefined,
				});
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "Unknown error";
				this.logger.warn(
					`Failed to collect Asana tasks for ${member.displayName}: ${message}`,
				);
				results.set(member.login, {
					status: "matched",
					tasks: [],
					message: "Unable to fetch Asana tasks for this member.",
				});
			}
		}

		return results;
	}

	private async loadWorkspaces(): Promise<AsanaWorkspace[]> {
		if (this.workspaces) {
			return this.workspaces;
		}
		if (!this.enabled) {
			this.workspaces = [];
			return this.workspaces;
		}

		if (this.workspaceGids.length > 0) {
			const results: AsanaWorkspace[] = [];
			for (const gid of this.workspaceGids) {
				try {
					const response = await this.get<AsanaSingleResponse<AsanaWorkspace>>(
						`/workspaces/${gid}`,
					);
					results.push({ gid: response.data.gid, name: response.data.name });
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					this.logger.warn(`Unable to load Asana workspace ${gid}: ${message}`);
					results.push({ gid, name: gid });
				}
			}
			this.workspaces = results;
			return this.workspaces;
		}

		const response = await this.paginate<AsanaWorkspace>("/workspaces");
		this.workspaces = response.map((workspace) => ({
			gid: workspace.gid,
			name: workspace.name,
		}));
		return this.workspaces;
	}

	private async matchMember(
		member: AsanaMemberInput,
		workspaces: AsanaWorkspace[],
	): Promise<MatchedUser | null> {
		const normalizedLogin = member.login.toLowerCase();
		const override = this.userOverrides[normalizedLogin];
		const candidateEmails = new Set<string>();

		if (override?.email) {
			candidateEmails.add(override.email.toLowerCase());
		}
		if (member.login.includes("@")) {
			candidateEmails.add(member.login.toLowerCase());
		} else if (this.emailDomain) {
			candidateEmails.add(
				`${member.login.toLowerCase()}@${this.emailDomain.toLowerCase()}`,
			);
		}

		const candidateNames = new Set<string>();
		if (override?.name) {
			candidateNames.add(this.normalizeName(override.name));
		}
		if (member.displayName) {
			candidateNames.add(this.normalizeName(member.displayName));
		}

		const searchWorkspaces = override?.workspaceGid
			? workspaces.filter((ws) => ws.gid === override.workspaceGid)
			: workspaces;

		if (override?.userGid) {
			for (const workspace of searchWorkspaces) {
				const directory = await this.loadDirectory(workspace.gid);
				const matched = directory.users.find(
					(user) => user.gid === override.userGid,
				);
				if (matched) {
					return { user: matched, workspace, matchType: "override" };
				}
			}
		}

		for (const workspace of searchWorkspaces) {
			const directory = await this.loadDirectory(workspace.gid);
			for (const email of candidateEmails) {
				const matched = directory.byEmail.get(email);
				if (matched) {
					return { user: matched, workspace, matchType: "email" };
				}
			}
			for (const name of candidateNames) {
				const matched = directory.byName.get(name);
				if (matched) {
					return { user: matched, workspace, matchType: "name" };
				}
			}
		}

		return null;
	}

	private async fetchTasksForAssignee(
		workspace: AsanaWorkspace,
		user: AsanaUser,
		window: AsanaWindow,
	): Promise<AsanaTaskResponseItem[]> {
		const params: Record<string, string> = {
			assignee: user.gid,
			workspace: workspace.gid,
			limit: "100",
			opt_fields:
				"name,completed,completed_at,due_on,due_at,permalink_url,notes",
			completed_since: window.startISO,
		};

		const tasks = await this.paginate<AsanaTaskResponseItem>("/tasks", params);
		return tasks;
	}

	private async summarizeTasks(
		tasks: AsanaTaskResponseItem[],
		window: AsanaWindow,
	): Promise<AsanaTaskSummary[]> {
		const filtered = tasks
			.filter((task) => task.completed)
			.filter((task) => this.isTaskWithinWindow(task, window));

		const summaries: AsanaTaskSummary[] = [];
		for (const task of filtered) {
			const comments = await this.fetchTaskComments(task.gid);
			summaries.push({
				gid: task.gid,
				name: task.name,
				status: "completed",
				completedAt: task.completed_at ?? null,
				dueOn: task.due_on ?? null,
				dueAt: task.due_at ?? null,
				permalinkUrl: task.permalink_url ?? null,
				description: task.notes ?? null,
				comments: comments.length > 0 ? comments : undefined,
			});
		}

		summaries.sort((a, b) => this.compareTaskSummaries(a, b));
		return summaries;
	}

	private async fetchTaskComments(taskGid: string): Promise<string[]> {
		try {
			const stories = await this.paginate<AsanaStoryResponseItem>(
				`/tasks/${taskGid}/stories`,
				{
					opt_fields: "type,resource_subtype,text,created_at",
				},
			);
			return stories
				.filter(
					(story) =>
						story.type === "comment" ||
						story.resource_subtype === "comment_added",
				)
				.map((story) => story.text?.replace(/\s+/g, " ").trim())
				.filter((text): text is string => Boolean(text))
				.slice(-5);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.logger.debug(
				`Unable to fetch Asana comments for task ${taskGid}: ${message}`,
			);
			return [];
		}
	}

	private compareTaskSummaries(
		first: AsanaTaskSummary,
		second: AsanaTaskSummary,
	): number {
		const firstTimestamp = this.resolveTaskTimestamp(first);
		const secondTimestamp = this.resolveTaskTimestamp(second);
		if (firstTimestamp === secondTimestamp) {
			return first.name.localeCompare(second.name);
		}
		if (firstTimestamp === null) {
			return 1;
		}
		if (secondTimestamp === null) {
			return -1;
		}
		return secondTimestamp - firstTimestamp;
	}

	private resolveTaskTimestamp(task: AsanaTaskSummary): number | null {
		const completed = this.toTimestamp(task.completedAt);
		if (completed !== null) {
			return completed;
		}
		const due = this.toTimestamp(task.dueAt ?? task.dueOn);
		return due;
	}

	private isTaskWithinWindow(
		task: AsanaTaskResponseItem,
		window: AsanaWindow,
	): boolean {
		const start = this.toTimestamp(window.startISO);
		const end = this.toTimestamp(window.endISO);
		if (
			start === null ||
			end === null ||
			!task.completed ||
			!task.completed_at
		) {
			return false;
		}

		const completedAt = this.toTimestamp(task.completed_at);
		return completedAt !== null && completedAt >= start && completedAt <= end;
	}

	private toTimestamp(value?: string | null): number | null {
		if (!value) {
			return null;
		}
		if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
			return resolveEndEpochMs(value);
		}
		const date = Date.parse(value);
		if (Number.isNaN(date)) {
			return null;
		}
		return date;
	}

	private normalizeName(value: string): string {
		return value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9\s]/gi, "")
			.replace(/\s+/g, " ");
	}

	private async loadDirectory(
		workspaceGid: string,
	): Promise<WorkspaceUserDirectory> {
		const existing = this.directories.get(workspaceGid);
		if (existing) {
			return existing;
		}

		const users = await this.paginate<AsanaUser>("/users", {
			workspace: workspaceGid,
			opt_fields: "name,email",
		});

		const byEmail = new Map<string, AsanaUser>();
		const byName = new Map<string, AsanaUser>();

		for (const user of users) {
			if (user.email) {
				byEmail.set(user.email.toLowerCase(), user);
			}
			const normalizedName = this.normalizeName(user.name);
			if (normalizedName.length > 0 && !byName.has(normalizedName)) {
				byName.set(normalizedName, user);
			}
		}

		const directory: WorkspaceUserDirectory = { users, byEmail, byName };
		this.directories.set(workspaceGid, directory);
		return directory;
	}

	private async paginate<T>(
		path: string,
		params: Record<string, string> = {},
	): Promise<T[]> {
		const items: T[] = [];
		let offset: string | undefined;
		do {
			const response = await this.get<AsanaListResponse<T>>(path, {
				...params,
				...(offset ? { offset } : {}),
			});
			items.push(...response.data);
			offset = response.next_page?.offset ?? undefined;
		} while (offset);
		return items;
	}

	private async get<T>(
		path: string,
		params: Record<string, string> = {},
	): Promise<T> {
		if (!this.token) {
			throw new Error("Asana API token is not configured.");
		}

		const url = this.buildUrl(path, params);

		for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
			const { statusCode, body, headers } = await this.httpGet(url);

			if (statusCode === 429 && attempt + 1 < MAX_RETRIES) {
				const retryAfterHeader = headers["retry-after"];
				const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : 1;
				await this.delay((Number.isNaN(retryAfter) ? 1 : retryAfter) * 1000);
				continue;
			}

			if (!statusCode || statusCode < 200 || statusCode >= 300) {
				throw new Error(`Asana request failed (${statusCode ?? 0}): ${body}`);
			}

			try {
				return JSON.parse(body) as T;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`Unable to parse Asana response: ${message}`);
			}
		}

		throw new Error("Asana request failed after retries.");
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => {
			setTimeout(resolve, ms);
		});
	}

	private buildUrl(path: string, params: Record<string, string>): URL {
		const isAbsolute = /^https?:\/\//i.test(path);
		const base = this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`;
		const normalizedPath = path.replace(/^\/+/, "");
		const url = isAbsolute ? new URL(path) : new URL(normalizedPath, base);
		for (const [key, value] of Object.entries(params)) {
			url.searchParams.append(key, value);
		}
		return url;
	}

	private httpGet(
		url: URL,
		redirectCount = 0,
	): Promise<{
		statusCode: number | undefined;
		body: string;
		headers: IncomingHttpHeaders;
	}> {
		return new Promise((resolve, reject) => {
			const request = httpsRequest(
				url,
				{
					method: "GET",
					headers: {
						Authorization: `Bearer ${this.token}`,
						Accept: "application/json",
						"Accept-Encoding": "identity",
						"User-Agent": this.userAgent,
					},
				},
				(response) => {
					const status = response.statusCode ?? 0;
					const location = response.headers.location;

					// Handle redirects manually since Node's https does not follow them automatically.
					if ([301, 302, 303, 307, 308].includes(status) && location) {
						response.resume();
						if (redirectCount >= MAX_REDIRECTS) {
							reject(
								new Error(
									`Asana request exceeded redirect limit (last location: ${location}).`,
								),
							);
							return;
						}
						try {
							const nextUrl = new URL(location, url);
							this.httpGet(nextUrl, redirectCount + 1)
								.then(resolve)
								.catch(reject);
						} catch (error) {
							reject(error);
						}
						return;
					}

					const chunks: Buffer[] = [];
					response.on("data", (chunk) => {
						chunks.push(Buffer.from(chunk));
					});
					response.on("end", () => {
						const body = Buffer.concat(chunks).toString("utf8");
						resolve({
							statusCode: response.statusCode,
							body,
							headers: response.headers,
						});
					});
				},
			);

			request.on("error", reject);
			request.end();
		});
	}

	private normalizeToken(raw?: string): string | undefined {
		if (!raw) {
			return undefined;
		}
		const trimmed = raw.trim();
		if (trimmed.toLowerCase().startsWith("bearer ")) {
			return trimmed.slice(7).trimStart();
		}
		return trimmed;
	}
}
