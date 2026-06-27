import { describe, expect, it, spyOn } from "bun:test";
import {
	buildJql,
	JiraStoryPointProvider,
} from "../../../../src/adapters/jira/jira-story-point-provider.js";
import type {
	ReportingWindow,
	StoryPointOptions,
} from "../../../../src/core/types.js";

const WINDOW: ReportingWindow = {
	startISO: "2026-06-01T00:00:00.000Z",
	endISO: "2026-06-30T23:59:59.999Z",
} as ReportingWindow;

const PT_FIELD = "customfield_10617";
const OPTIONS: StoryPointOptions = {
	projects: [{ key: "PT", fieldId: PT_FIELD, jqlName: "Story point estimate" }],
};

function provider(
	extra: Partial<ConstructorParameters<typeof JiraStoryPointProvider>[0]> = {},
) {
	return new JiraStoryPointProvider({
		baseUrl: "https://example.atlassian.net",
		email: "bot@example.com",
		apiToken: "tok",
		jiraLookup: new Map([["acct-jane", "jane-doe"]]),
		...extra,
	});
}

function issue(
	key: string,
	accountId: string | null,
	points: number | null,
	displayName?: string,
) {
	return {
		key,
		fields: {
			assignee: accountId ? { accountId, displayName } : null,
			[PT_FIELD]: points,
		},
	};
}

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

describe("buildJql", () => {
	it("filters by project, issue types, Done, and the resolution window", () => {
		const jql = buildJql("PT", ["Story", "Task"], WINDOW);
		expect(jql).toContain('project = "PT"');
		expect(jql).toContain("issuetype in (Story, Task)");
		expect(jql).toContain("statusCategory = Done");
		expect(jql).toContain('resolutiondate >= "2026-06-01 00:00"');
		// exclusive upper bound
		expect(jql).toContain('resolutiondate < "2026-06-30 23:59"');
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
			issues: [issue("PT-9", "acct-stranger", 5, "Stranger Danger")],
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
	it("warns once per project on field-absent (400) and continues", async () => {
		const warn = (...args: unknown[]) => warnings.push(String(args[0]));
		const warnings: string[] = [];
		const p = provider({ logger: { warn } as never });
		const err = Object.assign(
			new Error("field 'Story point estimate' does not exist"),
			{
				status: 400,
			},
		);
		spyOn(p as never, "search").mockRejectedValue(err);

		const result = await p.fetchCompletedStoryPoints([], WINDOW, {
			projects: [
				{ key: "PT", fieldId: PT_FIELD, jqlName: "x" },
				{ key: "PT", fieldId: PT_FIELD, jqlName: "x" },
			],
		});

		expect(result.byPerson.size).toBe(0); // never throws
		expect(warnings.filter((w) => w.includes("not present")).length).toBe(1);
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
});

describe("JiraStoryPointProvider — creditBy: resolver", () => {
	it("credits the most recent status-transition author, not the assignee", async () => {
		const p = provider({
			jiraLookup: new Map([
				["acct-jane", "jane-doe"],
				["acct-rob", "rob-roe"],
			]),
		});
		const issueWithChangelog = {
			key: "PT-1",
			fields: { assignee: { accountId: "acct-jane" }, [PT_FIELD]: 5 },
			changelog: {
				histories: [
					{
						author: { accountId: "acct-jane" },
						created: "2026-06-02T10:00:00Z",
						items: [{ field: "status" }],
					},
					{
						author: { accountId: "acct-rob" },
						created: "2026-06-05T10:00:00Z",
						items: [{ field: "status" }],
					},
				],
			},
		};
		spyOn(p as never, "search").mockResolvedValue({
			issues: [issueWithChangelog],
			isLast: true,
		});

		const result = await p.fetchCompletedStoryPoints([], WINDOW, {
			...OPTIONS,
			creditBy: "resolver",
		});

		expect(result.byPerson.get("rob-roe")?.totalPoints).toBe(5);
		expect(result.byPerson.has("jane-doe")).toBe(false);
		// expand: changelog requested
		expect(
			(p as never as { search: { mock: { calls: unknown[][] } } }).search.mock
				.calls[0][3],
		).toEqual(["changelog"]);
	});

	it("falls back to the assignee when no status transition exists", async () => {
		const p = provider();
		spyOn(p as never, "search").mockResolvedValue({
			issues: [
				{
					key: "PT-2",
					fields: { assignee: { accountId: "acct-jane" }, [PT_FIELD]: 3 },
					changelog: { histories: [] },
				},
			],
			isLast: true,
		});
		const result = await p.fetchCompletedStoryPoints([], WINDOW, {
			...OPTIONS,
			creditBy: "resolver",
		});
		expect(result.byPerson.get("jane-doe")?.totalPoints).toBe(3);
	});
});
