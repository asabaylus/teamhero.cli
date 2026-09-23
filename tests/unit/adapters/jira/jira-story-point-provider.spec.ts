import { describe, expect, it, spyOn } from "bun:test";
import {
	buildJql,
	completionWindowDays,
	firstCompletionDay,
	JiraStoryPointProvider,
} from "../../../../src/adapters/jira/jira-story-point-provider.js";
import type {
	JiraProjectFieldConfig,
	ReportingWindow,
	StoryPointOptions,
} from "../../../../src/core/types.js";

/** June 2026, with the exclusive upper bound the report service passes. */
const WINDOW: ReportingWindow = {
	startISO: "2026-06-01T00:00:00.000Z",
	endISO: "2026-07-01T00:00:00.000Z",
} as ReportingWindow;
const DAYS = completionWindowDays(WINDOW);

const PT_FIELD = "customfield_10617";
const PT_PROJECT: JiraProjectFieldConfig = {
	key: "PT",
	fieldId: PT_FIELD,
	jqlName: "Story point estimate",
};
const OPTIONS: StoryPointOptions = { projects: [PT_PROJECT] };
const DONE = new Set(["Done", "LIVE"]);

const SITE_STATUSES = [
	{ name: "In Progress", statusCategory: { key: "indeterminate" } },
	{ name: "Done", statusCategory: { key: "done" } },
	{ name: "LIVE", statusCategory: { key: "done" } },
];

function provider(
	extra: Partial<ConstructorParameters<typeof JiraStoryPointProvider>[0]> = {},
	siteFields: Array<{ id: string; name: string }> = [
		{ id: PT_FIELD, name: "Story point estimate" },
	],
) {
	const p = new JiraStoryPointProvider({
		baseUrl: "https://example.atlassian.net",
		email: "bot@example.com",
		apiToken: "tok",
		jiraLookup: new Map([["acct-jane", "jane-doe"]]),
		...extra,
	});
	// The site's field and status lists are read before the first search. Stub
	// both so a unit test never reaches the network.
	spyOn(p as never, "fetchFields").mockResolvedValue(siteFields);
	spyOn(p as never, "fetchStatuses").mockResolvedValue(SITE_STATUSES);
	return p;
}

/** One search result whose changelog completes it on `completedAt`. */
function issue(
	key: string,
	accountId: string | null,
	points: number | null,
	options: {
		completedAt?: string;
		completedTo?: string;
		displayName?: string;
		author?: string;
		histories?: unknown[];
		issueType?: string;
		subtask?: boolean;
	} = {},
) {
	const {
		completedAt = "2026-06-10T09:00:00.000-05:00",
		completedTo = "Done",
		displayName,
		author,
	} = options;
	return {
		key,
		fields: {
			assignee: accountId ? { accountId, displayName } : null,
			issuetype: {
				name: options.issueType ?? "Story",
				subtask: options.subtask ?? false,
			},
			[PT_FIELD]: points,
		},
		changelog: {
			histories: options.histories ?? [
				{
					created: completedAt,
					author: author ? { accountId: author } : undefined,
					items: [{ field: "status", toString: completedTo }],
				},
			],
		},
	};
}

const EMPTY_PAGE = { issues: [], isLast: true };

describe("completionWindowDays", () => {
	it("spans whole days up to the day before the exclusive end", () => {
		expect(DAYS).toEqual({ firstDay: "2026-06-01", lastDay: "2026-06-30" });
	});

	it("keeps a single-day window to that one day", () => {
		expect(
			completionWindowDays({
				startISO: "2026-08-01T00:00:00.000Z",
				endISO: "2026-08-02T00:00:00.000Z",
			} as ReportingWindow),
		).toEqual({ firstDay: "2026-08-01", lastDay: "2026-08-01" });
	});
});

describe("firstCompletionDay", () => {
	const histories = [
		{
			created: "2026-06-20T10:00:00.000-05:00",
			items: [{ field: "status", toString: "Done" }],
		},
		{
			created: "2026-06-05T10:00:00.000-05:00",
			items: [{ field: "status", toString: "LIVE" }],
		},
		{
			created: "2026-06-02T10:00:00.000-05:00",
			items: [{ field: "status", toString: "In Progress" }],
		},
	];

	it("takes the FIRST entry into a completed status, not the last", () => {
		expect(firstCompletionDay(histories, DONE)).toBe("2026-06-05");
	});

	it("ignores transitions into statuses the site does not call done", () => {
		expect(
			firstCompletionDay(
				[
					{
						created: "2026-06-02T10:00:00.000-05:00",
						items: [{ field: "status", toString: "In Progress" }],
					},
				],
				DONE,
			),
		).toBeUndefined();
	});

	it("dates the day in the timezone Jira rendered, not in UTC", () => {
		// 19:30 Central is already the next day in UTC; the week is the local one.
		expect(
			firstCompletionDay(
				[
					{
						created: "2026-06-30T19:30:00.000-05:00",
						items: [{ field: "status", toString: "Done" }],
					},
				],
				DONE,
			),
		).toBe("2026-06-30");
	});

	it("ignores non-status changes that share a history entry", () => {
		expect(
			firstCompletionDay(
				[
					{
						created: "2026-06-03T10:00:00.000-05:00",
						items: [{ field: "assignee", toString: "Done" }],
					},
					{
						created: "2026-06-09T10:00:00.000-05:00",
						items: [{ field: "status", toString: "Done" }],
					},
				],
				DONE,
			),
		).toBe("2026-06-09");
	});
});

describe("buildJql", () => {
	it("asks for completed issues without requiring an estimate", () => {
		const jql = buildJql(PT_PROJECT, ["Story", "Task"], DAYS, DONE);
		expect(jql).toContain('project = "PT"');
		expect(jql).toContain('issuetype in ("Story", "Task")');
		expect(jql).not.toContain("is not EMPTY");
		expect(jql).toContain('status changed to ("Done", "LIVE")');
		// A day of slack each side; the exact week is decided from the changelog.
		expect(jql).toContain('during ("2026-05-31", "2026-07-01")');
	});

	it("omits the issuetype filter when issueTypes is empty (count all types)", () => {
		const jql = buildJql({ ...PT_PROJECT, key: "SPVR" }, [], DAYS, DONE);
		expect(jql).toContain('project = "SPVR"');
		expect(jql).not.toContain("issuetype in");
	});

	it("never bounds statusCategoryChangedDate, which holds only the LAST completion", () => {
		const jql = buildJql(PT_PROJECT, [], DAYS, DONE);
		expect(jql).not.toContain("statusCategoryChangedDate");
		expect(jql).not.toContain("statusCategory = Done");
	});

	it("never filters on resolutiondate, which most completed issues lack", () => {
		expect(buildJql(PT_PROJECT, [], DAYS, DONE)).not.toContain(
			"resolutiondate",
		);
	});

	it("does not filter unpointed completed work even with a resolved field", () => {
		const jql = buildJql(PT_PROJECT, [], DAYS, DONE);
		expect(jql).not.toContain("is not EMPTY");
	});
});

describe("JiraStoryPointProvider — enabled", () => {
	it("is disabled when auth is incomplete", () => {
		expect(new JiraStoryPointProvider({}).enabled).toBe(false);
		expect(
			new JiraStoryPointProvider({ baseUrl: "x", email: "y" }).enabled,
		).toBe(false);
	});

	it("is enabled when baseUrl, email, and token are all set", () => {
		expect(provider().enabled).toBe(true);
	});

	it("returns an empty result without calling Jira when disabled", async () => {
		const p = new JiraStoryPointProvider({});
		const search = spyOn(p as never, "search");
		const result = await p.fetchCompletedStoryPoints([], WINDOW, OPTIONS);
		expect(result.byPerson.size).toBe(0);
		expect(search).not.toHaveBeenCalled();
	});
});

describe("JiraStoryPointProvider — story-point field resolution", () => {
	it("counts every issue type when the caller names none", async () => {
		const p = provider();
		const search = spyOn(p as never, "search").mockResolvedValue(EMPTY_PAGE);
		await p.fetchCompletedStoryPoints([], WINDOW, OPTIONS);
		expect(search.mock.calls[0][0] as string).not.toContain("issuetype in");
	});

	it("repairs a configured field id the site does not have", async () => {
		const p = provider({}, [
			{ id: "customfield_10016", name: "Story point estimate" },
		]);
		const search = spyOn(p as never, "search").mockResolvedValue(EMPTY_PAGE);

		await p.fetchCompletedStoryPoints([], WINDOW, OPTIONS);

		// The repaired id is the one requested from Jira, so the value arrives.
		expect(search.mock.calls[0][1] as string[]).toContain("customfield_10016");
		expect(search.mock.calls[0][1] as string[]).not.toContain(PT_FIELD);
		expect(search.mock.calls[0][0] as string).not.toContain("cf[10016]");
	});

	it("credits points read from the repaired field", async () => {
		const p = provider({}, [
			{ id: "customfield_10016", name: "Story point estimate" },
		]);
		spyOn(p as never, "search").mockResolvedValue({
			issues: [
				{
					key: "PT-9",
					fields: {
						assignee: { accountId: "acct-jane" },
						customfield_10016: 8,
					},
					changelog: {
						histories: [
							{
								created: "2026-06-10T09:00:00.000-05:00",
								items: [{ field: "status", toString: "Done" }],
							},
						],
					},
				},
			],
			isLast: true,
		});

		const result = await p.fetchCompletedStoryPoints([], WINDOW, OPTIONS);

		expect(result.byPerson.get("jane-doe")?.totalPoints).toBe(8);
	});

	it("honours a storyPointField override given as a display name", async () => {
		const p = provider({}, [
			{ id: "customfield_10036", name: "Story Points" },
			{ id: "customfield_10016", name: "Story point estimate" },
		]);
		const search = spyOn(p as never, "search").mockResolvedValue(EMPTY_PAGE);

		await p.fetchCompletedStoryPoints([], WINDOW, {
			...OPTIONS,
			storyPointField: "Story Points",
		});

		expect(search.mock.calls[0][1] as string[]).toContain("customfield_10036");
	});

	it("reads the field and status lists once and reuses them for later windows", async () => {
		const p = provider();
		const fetchFields = spyOn(p as never, "fetchFields");
		const fetchStatuses = spyOn(p as never, "fetchStatuses");
		spyOn(p as never, "search").mockResolvedValue(EMPTY_PAGE);

		await p.fetchCompletedStoryPoints([], WINDOW, OPTIONS);
		await p.fetchCompletedStoryPoints([], WINDOW, OPTIONS);

		expect(fetchFields).toHaveBeenCalledTimes(1);
		expect(fetchStatuses).toHaveBeenCalledTimes(1);
	});

	it("keeps the configured id when the field list cannot be read", async () => {
		const p = provider();
		spyOn(p as never, "fetchFields").mockRejectedValue(new Error("403"));
		const search = spyOn(p as never, "search").mockResolvedValue(EMPTY_PAGE);

		await p.fetchCompletedStoryPoints([], WINDOW, OPTIONS);

		expect(search.mock.calls[0][1] as string[]).toContain(PT_FIELD);
	});
});

describe("JiraStoryPointProvider — done statuses", () => {
	it("asks for every status this site files under the Done category", async () => {
		const p = provider();
		const search = spyOn(p as never, "search").mockResolvedValue(EMPTY_PAGE);

		await p.fetchCompletedStoryPoints([], WINDOW, OPTIONS);

		const jql = search.mock.calls[0][0] as string;
		expect(jql).toContain('status changed to ("Done", "LIVE")');
		expect(jql).not.toContain("In Progress");
	});

	it("falls back to the well-known names when the status list is unreadable", async () => {
		const p = provider();
		spyOn(p as never, "fetchStatuses").mockRejectedValue(new Error("403"));
		const search = spyOn(p as never, "search").mockResolvedValue(EMPTY_PAGE);

		await p.fetchCompletedStoryPoints([], WINDOW, OPTIONS);

		expect(search.mock.calls[0][0] as string).toContain('"Done"');
	});
});

describe("JiraStoryPointProvider — issue types", () => {
	it("lets a project narrow the types the run-wide list allows", async () => {
		const p = provider();
		const search = spyOn(p as never, "search").mockResolvedValue(EMPTY_PAGE);

		await p.fetchCompletedStoryPoints([], WINDOW, {
			projects: [{ ...PT_PROJECT, issueTypes: ["Bug"] }],
			issueTypes: ["Story"],
		});

		expect(search.mock.calls[0][0] as string).toContain('issuetype in ("Bug")');
	});

	it("lets a project count every type while the run-wide list narrows", async () => {
		const p = provider();
		const search = spyOn(p as never, "search").mockResolvedValue(EMPTY_PAGE);

		await p.fetchCompletedStoryPoints([], WINDOW, {
			projects: [{ ...PT_PROJECT, issueTypes: [] }],
			issueTypes: ["Story"],
		});

		expect(search.mock.calls[0][0] as string).not.toContain("issuetype in");
	});
});

describe("JiraStoryPointProvider — the week an issue counts in", () => {
	it("counts an issue whose first completion falls inside the window", async () => {
		const p = provider();
		spyOn(p as never, "search").mockResolvedValue({
			issues: [issue("PT-1", "acct-jane", 5)],
			isLast: true,
		});

		const result = await p.fetchCompletedStoryPoints([], WINDOW, OPTIONS);

		expect(result.byPerson.get("jane-doe")?.totalPoints).toBe(5);
	});

	it("drops an issue the padded search reached whose first completion is earlier", async () => {
		const p = provider();
		spyOn(p as never, "search").mockResolvedValue({
			issues: [
				issue("PT-1", "acct-jane", 5, {
					histories: [
						// Finished in April, shipped again in June: April's week owns it.
						{
							created: "2026-04-02T10:00:00.000-05:00",
							items: [{ field: "status", toString: "LIVE" }],
						},
						{
							created: "2026-06-10T10:00:00.000-05:00",
							items: [{ field: "status", toString: "Done" }],
						},
					],
				}),
			],
			isLast: true,
		});

		const result = await p.fetchCompletedStoryPoints([], WINDOW, OPTIONS);

		expect(result.byPerson.size).toBe(0);
	});

	it("drops an issue whose first completion is in the slack day after the window", async () => {
		const p = provider();
		spyOn(p as never, "search").mockResolvedValue({
			issues: [
				issue("PT-1", "acct-jane", 5, {
					completedAt: "2026-07-01T09:00:00.000-05:00",
				}),
			],
			isLast: true,
		});

		const result = await p.fetchCompletedStoryPoints([], WINDOW, OPTIONS);

		expect(result.byPerson.size).toBe(0);
	});

	it("counts an issue that was completed and then reopened", async () => {
		const p = provider();
		spyOn(p as never, "search").mockResolvedValue({
			issues: [
				issue("PT-1", "acct-jane", 3, {
					histories: [
						{
							created: "2026-06-11T09:00:00.000-05:00",
							items: [{ field: "status", toString: "LIVE" }],
						},
						{
							created: "2026-06-11T09:00:12.000-05:00",
							items: [{ field: "status", toString: "In Progress" }],
						},
					],
				}),
			],
			isLast: true,
		});

		const result = await p.fetchCompletedStoryPoints([], WINDOW, OPTIONS);

		expect(result.byPerson.get("jane-doe")?.totalPoints).toBe(3);
	});

	it("refetches a changelog the search only partly embedded", async () => {
		const p = provider();
		spyOn(p as never, "search").mockResolvedValue({
			issues: [
				{
					key: "PT-1",
					fields: { assignee: { accountId: "acct-jane" }, [PT_FIELD]: 2 },
					changelog: {
						total: 120,
						histories: [
							{
								created: "2026-06-25T10:00:00.000-05:00",
								items: [{ field: "status", toString: "Done" }],
							},
						],
					},
				},
			],
			isLast: true,
		});
		const full = spyOn(p as never, "fetchIssueChangelog").mockResolvedValue([
			{
				created: "2026-05-02T10:00:00.000-05:00",
				items: [{ field: "status", toString: "LIVE" }],
			},
			{
				created: "2026-06-25T10:00:00.000-05:00",
				items: [{ field: "status", toString: "Done" }],
			},
		]);

		const result = await p.fetchCompletedStoryPoints([], WINDOW, OPTIONS);

		expect(full).toHaveBeenCalledWith("PT-1");
		// The truncated page said June; the full history says May, another week.
		expect(result.byPerson.size).toBe(0);
	});
});

describe("JiraStoryPointProvider — fetch & credit", () => {
	it("sums points per Person and requests the configured field", async () => {
		const p = provider();
		const search = spyOn(p as never, "search").mockResolvedValue({
			issues: [issue("PT-1", "acct-jane", 3), issue("PT-2", "acct-jane", 5)],
			isLast: true,
		});

		const result = await p.fetchCompletedStoryPoints([], WINDOW, OPTIONS);

		expect(result.byPerson.get("jane-doe")).toEqual({
			status: "matched",
			totalPoints: 8,
			byProject: { PT: 8 },
			issueCount: 2,
		});
		// field requested via the search `fields` argument
		expect(search.mock.calls[0][1] as string[]).toContain(PT_FIELD);
	});

	it("expands the changelog as a string, which is the only shape /search/jql takes", async () => {
		const p = provider();
		const search = spyOn(p as never, "search").mockResolvedValue(EMPTY_PAGE);

		await p.fetchCompletedStoryPoints([], WINDOW, OPTIONS);

		expect(search.mock.calls[0][3]).toBe("changelog");
	});

	it("follows nextPageToken until the last page", async () => {
		const p = provider();
		const search = spyOn(p as never, "search")
			.mockResolvedValueOnce({
				issues: [issue("PT-1", "acct-jane", 2)],
				nextPageToken: "tok2",
				isLast: false,
			})
			.mockResolvedValueOnce({
				issues: [issue("PT-2", "acct-jane", 3)],
				isLast: true,
			});

		const result = await p.fetchCompletedStoryPoints([], WINDOW, OPTIONS);

		expect(search).toHaveBeenCalledTimes(2);
		expect(result.byPerson.get("jane-doe")?.totalPoints).toBe(5);
	});

	it("records assignees that match no Person as unmatched", async () => {
		const p = provider();
		spyOn(p as never, "search").mockResolvedValue({
			issues: [
				issue("PT-9", "acct-stranger", 5, { displayName: "Stranger Danger" }),
			],
			isLast: true,
		});

		const result = await p.fetchCompletedStoryPoints([], WINDOW, OPTIONS);

		expect(result.byPerson.size).toBe(0);
		expect(result.unmatchedAssignees).toEqual(["Stranger Danger"]);
	});

	it("treats a missing point value as 0", async () => {
		const p = provider();
		spyOn(p as never, "search").mockResolvedValue({
			issues: [issue("PT-1", "acct-jane", null)],
			isLast: true,
		});
		const result = await p.fetchCompletedStoryPoints([], WINDOW, OPTIONS);
		expect(result.byPerson.get("jane-doe")?.totalPoints).toBe(0);
		expect(result.byPerson.get("jane-doe")?.issueCount).toBe(1);
	});
});

describe("JiraStoryPointProvider — warnings (deduped, never fatal)", () => {
	it("warns once per project on a rejected search (400) and continues", async () => {
		const warnings: string[] = [];
		const warn = (...args: unknown[]) => warnings.push(String(args[0]));
		const p = provider({ logger: { warn } as never });
		const err = Object.assign(
			new Error("field 'Story point estimate' does not exist"),
			{ status: 400 },
		);
		spyOn(p as never, "search").mockRejectedValue(err);

		const result = await p.fetchCompletedStoryPoints([], WINDOW, {
			projects: [PT_PROJECT, PT_PROJECT],
		});

		expect(result.byPerson.size).toBe(0); // never throws
		expect(warnings.filter((w) => w.includes("rejected")).length).toBe(1);
	});

	it("warns once per project on project-not-found (404) and continues", async () => {
		const warnings: string[] = [];
		const p = provider({
			logger: { warn: (m: unknown) => warnings.push(String(m)) } as never,
		});
		const err = Object.assign(new Error("No project could be found"), {
			status: 404,
		});
		spyOn(p as never, "search").mockRejectedValue(err);

		await p.fetchCompletedStoryPoints([], WINDOW, OPTIONS);
		await p.fetchCompletedStoryPoints([], WINDOW, OPTIONS);

		expect(warnings.filter((w) => w.includes("not found")).length).toBe(1);
	});

	it("rethrows auth/transient failures instead of masking them as not-found", async () => {
		const p = provider();
		const err = Object.assign(new Error("Unauthorized"), { status: 401 });
		spyOn(p as never, "search").mockRejectedValue(err);
		await expect(
			p.fetchCompletedStoryPoints([], WINDOW, OPTIONS),
		).rejects.toThrow(/Unauthorized/);
	});
});

describe("JiraStoryPointProvider — creditBy: resolver", () => {
	it("credits whoever first completed the issue, not the assignee", async () => {
		const p = provider({
			jiraLookup: new Map([
				["acct-jane", "jane-doe"],
				["acct-rob", "rob-roe"],
			]),
		});
		spyOn(p as never, "search").mockResolvedValue({
			issues: [
				issue("PT-1", "acct-jane", 5, {
					histories: [
						{
							created: "2026-06-05T10:00:00.000-05:00",
							author: { accountId: "acct-rob" },
							items: [{ field: "status", toString: "LIVE" }],
						},
						{
							created: "2026-06-20T10:00:00.000-05:00",
							author: { accountId: "acct-jane" },
							items: [{ field: "status", toString: "Done" }],
						},
					],
				}),
			],
			isLast: true,
		});

		const result = await p.fetchCompletedStoryPoints([], WINDOW, {
			...OPTIONS,
			creditBy: "resolver",
		});

		expect(result.byPerson.get("rob-roe")?.totalPoints).toBe(5);
		expect(result.byPerson.has("jane-doe")).toBe(false);
	});

	it("falls back to the assignee when the completion has no author", async () => {
		const p = provider();
		spyOn(p as never, "search").mockResolvedValue({
			issues: [issue("PT-2", "acct-jane", 3)],
			isLast: true,
		});
		const result = await p.fetchCompletedStoryPoints([], WINDOW, {
			...OPTIONS,
			creditBy: "resolver",
		});
		expect(result.byPerson.get("jane-doe")?.totalPoints).toBe(3);
	});
});

describe("JiraStoryPointProvider — shared completed-work model", () => {
	it("returns stable completion facts and the project's exclusive category", async () => {
		const p = provider();
		spyOn(p as never, "search").mockResolvedValue({
			issues: [
				issue("PT-42", "acct-jane", 8, {
					issueType: "Support",
					completedAt: "2026-06-10T09:00:00.000-05:00",
				}),
			],
			isLast: true,
		});
		const result = await p.fetchCompletedWork(WINDOW, {
			projects: [
				{
					...PT_PROJECT,
					completedWork: { category: "support", issueTypes: ["Support"] },
				},
			],
		});
		expect(result.complete).toBe(true);
		expect(result.items).toEqual([
			{
				key: "PT-42",
				project: "PT",
				issueType: "Support",
				isSubtask: false,
				countsForStoryPoints: true,
				countsForCompletedWork: true,
				firstCompletedAt: "2026-06-10T09:00:00.000-05:00",
				assigneeAccountId: "acct-jane",
				assigneeDisplayName: undefined,
				personId: "jane-doe",
				points: 8,
				category: "support",
			},
		]);
	});
});
