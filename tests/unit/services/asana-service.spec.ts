import { describe, expect, it, mock, spyOn } from "bun:test";
import { AsanaService } from "../../../src/services/asana.service.js";

/**
 * Additional coverage for AsanaService beyond the tests in asana.service.spec.ts.
 *
 * Covers: constructor config, enabled property, normalizeToken, fetchTasksForMembers
 * (disabled, workspace error, empty workspaces, member matching, error branches),
 * toTimestamp edge cases, normalizeName, buildUrl, retry on 429, and matchMember logic.
 */

describe("AsanaService — additional coverage", () => {
	describe("constructor / config", () => {
		it("enabled is false when no token is provided", () => {
			const service = new AsanaService({});
			expect(service.enabled).toBe(false);
		});

		it("enabled is true when token is provided", () => {
			const service = new AsanaService({ token: "xoxp-1234" });
			expect(service.enabled).toBe(true);
		});

		it("strips 'Bearer ' prefix from token", () => {
			const service = new AsanaService({ token: "Bearer xoxp-1234" });
			expect(service.enabled).toBe(true);
		});

		it("strips 'bearer ' prefix (case-insensitive) from token", () => {
			const service = new AsanaService({ token: "bearer  xoxp-1234" });
			expect(service.enabled).toBe(true);
		});

		it("uses default base URL when none provided", () => {
			const service = new AsanaService({ token: "t" });
			// Verify via a request URL
			const url = (service as any).buildUrl("/workspaces", {});
			expect(url.toString()).toBe("https://app.asana.com/api/1.0/workspaces");
		});

		it("uses provided base URL", () => {
			const service = new AsanaService({
				token: "t",
				baseUrl: "https://custom.asana.com/api/2.0",
			});
			const url = (service as any).buildUrl("/tasks", {});
			expect(url.toString()).toBe("https://custom.asana.com/api/2.0/tasks");
		});

		it("handles base URL with trailing slash", () => {
			const service = new AsanaService({
				token: "t",
				baseUrl: "https://app.asana.com/api/1.0/",
			});
			const url = (service as any).buildUrl("/workspaces", {});
			expect(url.toString()).toBe("https://app.asana.com/api/1.0/workspaces");
		});

		it("converts userMap to Asana overrides", () => {
			const service = new AsanaService({
				token: "t",
				userMap: {
					alice: { asanaEmail: "alice@company.com" },
				},
			});
			// Verify userOverrides were populated via userMap
			expect((service as any).userOverrides).toBeDefined();
		});
	});

	describe("buildUrl", () => {
		it("appends query parameters", () => {
			const service = new AsanaService({ token: "t" });
			const url = (service as any).buildUrl("/tasks", {
				assignee: "123",
				workspace: "456",
			});
			expect(url.searchParams.get("assignee")).toBe("123");
			expect(url.searchParams.get("workspace")).toBe("456");
		});

		it("handles absolute URLs (https://...)", () => {
			const service = new AsanaService({ token: "t" });
			const url = (service as any).buildUrl(
				"https://other.api.com/v1/resource",
				{},
			);
			expect(url.toString()).toBe("https://other.api.com/v1/resource");
		});
	});

	describe("fetchTasksForMembers", () => {
		it("returns disabled status for all members when service is disabled", async () => {
			const service = new AsanaService({});
			const members = [
				{ login: "alice", displayName: "Alice" },
				{ login: "bob", displayName: "Bob" },
			];
			const window = {
				startISO: "2026-02-01T00:00:00Z",
				endISO: "2026-02-08T00:00:00Z",
			};

			const result = await service.fetchTasksForMembers(members, window);

			expect(result.size).toBe(2);
			expect(result.get("alice")?.status).toBe("disabled");
			expect(result.get("alice")?.message).toContain("set ASANA_API_TOKEN");
			expect(result.get("bob")?.status).toBe("disabled");
		});

		it("returns disabled status when workspace loading fails", async () => {
			const service = new AsanaService({ token: "bad-token" });
			spyOn(service as any, "loadWorkspaces").mockRejectedValue(
				new Error("401 Unauthorized"),
			);

			const result = await service.fetchTasksForMembers(
				[{ login: "alice", displayName: "Alice" }],
				{
					startISO: "2026-02-01T00:00:00Z",
					endISO: "2026-02-08T00:00:00Z",
				},
			);

			expect(result.get("alice")?.status).toBe("disabled");
			expect(result.get("alice")?.message).toContain("see logs");
		});

		it("returns disabled status when no workspaces are accessible", async () => {
			const service = new AsanaService({ token: "t" });
			spyOn(service as any, "loadWorkspaces").mockResolvedValue([]);

			const result = await service.fetchTasksForMembers(
				[{ login: "alice", displayName: "Alice" }],
				{
					startISO: "2026-02-01T00:00:00Z",
					endISO: "2026-02-08T00:00:00Z",
				},
			);

			expect(result.get("alice")?.status).toBe("disabled");
			expect(result.get("alice")?.message).toContain("no accessible");
		});

		it("returns no-match status when member is not found in workspaces", async () => {
			const service = new AsanaService({ token: "t" });
			spyOn(service as any, "loadWorkspaces").mockResolvedValue([
				{ gid: "ws1", name: "Acme" },
			]);
			spyOn(service as any, "matchMember").mockResolvedValue(null);

			const result = await service.fetchTasksForMembers(
				[{ login: "ghost", displayName: "Ghost User" }],
				{
					startISO: "2026-02-01T00:00:00Z",
					endISO: "2026-02-08T00:00:00Z",
				},
			);

			expect(result.get("ghost")?.status).toBe("no-match");
			expect(result.get("ghost")?.message).toContain("No match found");
		});

		it("returns matched status with tasks when member is found", async () => {
			const service = new AsanaService({ token: "t" });
			spyOn(service as any, "loadWorkspaces").mockResolvedValue([
				{ gid: "ws1", name: "Acme" },
			]);
			spyOn(service as any, "matchMember").mockResolvedValue({
				user: { gid: "u1", name: "Alice" },
				workspace: { gid: "ws1", name: "Acme" },
				matchType: "email",
			});
			spyOn(service as any, "fetchTasksForAssignee").mockResolvedValue([]);
			spyOn(service as any, "summarizeTasks").mockResolvedValue([
				{
					gid: "t1",
					name: "Feature done",
					status: "completed",
					completedAt: "2026-02-03T10:00:00Z",
				},
			]);

			const result = await service.fetchTasksForMembers(
				[{ login: "alice", displayName: "Alice" }],
				{
					startISO: "2026-02-01T00:00:00Z",
					endISO: "2026-02-08T00:00:00Z",
				},
			);

			expect(result.get("alice")?.status).toBe("matched");
			expect(result.get("alice")?.matchType).toBe("email");
			expect(result.get("alice")?.tasks).toHaveLength(1);
		});

		it("returns message when no completed tasks found within window", async () => {
			const service = new AsanaService({ token: "t" });
			spyOn(service as any, "loadWorkspaces").mockResolvedValue([
				{ gid: "ws1", name: "Acme" },
			]);
			spyOn(service as any, "matchMember").mockResolvedValue({
				user: { gid: "u1", name: "Alice" },
				workspace: { gid: "ws1", name: "Acme" },
				matchType: "email",
			});
			spyOn(service as any, "fetchTasksForAssignee").mockResolvedValue([]);
			spyOn(service as any, "summarizeTasks").mockResolvedValue([]);

			const result = await service.fetchTasksForMembers(
				[{ login: "alice", displayName: "Alice" }],
				{
					startISO: "2026-02-01T00:00:00Z",
					endISO: "2026-02-08T00:00:00Z",
				},
			);

			expect(result.get("alice")?.message).toContain(
				"No completed tasks found",
			);
		});

		it("catches per-member errors and returns fallback", async () => {
			const service = new AsanaService({ token: "t" });
			spyOn(service as any, "loadWorkspaces").mockResolvedValue([
				{ gid: "ws1", name: "Acme" },
			]);
			spyOn(service as any, "matchMember").mockRejectedValue(
				new Error("network timeout"),
			);

			const result = await service.fetchTasksForMembers(
				[{ login: "alice", displayName: "Alice" }],
				{
					startISO: "2026-02-01T00:00:00Z",
					endISO: "2026-02-08T00:00:00Z",
				},
			);

			expect(result.get("alice")?.status).toBe("matched");
			expect(result.get("alice")?.message).toContain(
				"Unable to fetch Asana tasks",
			);
		});

		it("omits matchType when match is an override", async () => {
			const service = new AsanaService({ token: "t" });
			spyOn(service as any, "loadWorkspaces").mockResolvedValue([
				{ gid: "ws1", name: "Acme" },
			]);
			spyOn(service as any, "matchMember").mockResolvedValue({
				user: { gid: "u1", name: "Alice" },
				workspace: { gid: "ws1", name: "Acme" },
				matchType: "override",
			});
			spyOn(service as any, "fetchTasksForAssignee").mockResolvedValue([]);
			spyOn(service as any, "summarizeTasks").mockResolvedValue([
				{
					gid: "t1",
					name: "Done",
					status: "completed",
				},
			]);

			const result = await service.fetchTasksForMembers(
				[{ login: "alice", displayName: "Alice" }],
				{
					startISO: "2026-02-01T00:00:00Z",
					endISO: "2026-02-08T00:00:00Z",
				},
			);

			expect(result.get("alice")?.matchType).toBeUndefined();
		});
	});

	describe("toTimestamp", () => {
		it("returns null for null/undefined/empty values", () => {
			const service = new AsanaService({ token: "t" });
			const toTs = (service as any).toTimestamp.bind(service);
			expect(toTs(null)).toBeNull();
			expect(toTs(undefined)).toBeNull();
			expect(toTs("")).toBeNull();
		});

		it("parses YYYY-MM-DD using resolveEndEpochMs (+2 day buffer)", () => {
			const service = new AsanaService({ token: "t" });
			const result = (service as any).toTimestamp("2026-02-05");
			expect(result).toBe(Date.parse("2026-02-07T00:00:00Z"));
		});

		it("parses ISO datetime strings", () => {
			const service = new AsanaService({ token: "t" });
			const result = (service as any).toTimestamp("2026-02-05T12:30:00Z");
			expect(result).toBe(Date.parse("2026-02-05T12:30:00Z"));
		});

		it("returns null for invalid date strings", () => {
			const service = new AsanaService({ token: "t" });
			const result = (service as any).toTimestamp("not-a-date");
			expect(result).toBeNull();
		});
	});

	describe("normalizeName", () => {
		it("lowercases and trims", () => {
			const service = new AsanaService({ token: "t" });
			const result = (service as any).normalizeName("  Alice Smith  ");
			expect(result).toBe("alice smith");
		});

		it("removes non-alphanumeric characters", () => {
			const service = new AsanaService({ token: "t" });
			const result = (service as any).normalizeName("O'Brien-Jones");
			expect(result).toBe("obrienjones");
		});

		it("collapses multiple spaces", () => {
			const service = new AsanaService({ token: "t" });
			const result = (service as any).normalizeName("Alice   B   Smith");
			expect(result).toBe("alice b smith");
		});
	});

	describe("isTaskWithinWindow", () => {
		it("returns false for incomplete tasks", () => {
			const service = new AsanaService({ token: "t" });
			const result = (service as any).isTaskWithinWindow(
				{ completed: false, completed_at: null },
				{
					startISO: "2026-02-01T00:00:00Z",
					endISO: "2026-02-08T00:00:00Z",
				},
			);
			expect(result).toBe(false);
		});

		it("returns false when completed_at is outside window", () => {
			const service = new AsanaService({ token: "t" });
			const result = (service as any).isTaskWithinWindow(
				{
					completed: true,
					completed_at: "2026-01-15T10:00:00Z",
				},
				{
					startISO: "2026-02-01T00:00:00Z",
					endISO: "2026-02-08T00:00:00Z",
				},
			);
			expect(result).toBe(false);
		});

		it("returns true when completed_at is within window", () => {
			const service = new AsanaService({ token: "t" });
			const result = (service as any).isTaskWithinWindow(
				{
					completed: true,
					completed_at: "2026-02-03T10:00:00Z",
				},
				{
					startISO: "2026-02-01T00:00:00Z",
					endISO: "2026-02-08T00:00:00Z",
				},
			);
			expect(result).toBe(true);
		});

		it("returns false when completed_at is null", () => {
			const service = new AsanaService({ token: "t" });
			const result = (service as any).isTaskWithinWindow(
				{ completed: true, completed_at: null },
				{
					startISO: "2026-02-01T00:00:00Z",
					endISO: "2026-02-08T00:00:00Z",
				},
			);
			expect(result).toBe(false);
		});
	});

	describe("compareTaskSummaries", () => {
		it("sorts by completed timestamp descending", () => {
			const service = new AsanaService({ token: "t" });
			const compare = (service as any).compareTaskSummaries.bind(service);

			const a = {
				name: "Task A",
				completedAt: "2026-02-05T10:00:00Z",
				dueAt: null,
				dueOn: null,
			};
			const b = {
				name: "Task B",
				completedAt: "2026-02-03T10:00:00Z",
				dueAt: null,
				dueOn: null,
			};

			// More recent first (descending)
			expect(compare(a, b)).toBeLessThan(0);
		});

		it("falls back to name when timestamps are equal", () => {
			const service = new AsanaService({ token: "t" });
			const compare = (service as any).compareTaskSummaries.bind(service);

			const a = {
				name: "Alpha",
				completedAt: "2026-02-05T10:00:00Z",
				dueAt: null,
				dueOn: null,
			};
			const b = {
				name: "Beta",
				completedAt: "2026-02-05T10:00:00Z",
				dueAt: null,
				dueOn: null,
			};

			expect(compare(a, b)).toBeLessThan(0); // "Alpha" < "Beta"
		});

		it("sorts tasks with no timestamp last", () => {
			const service = new AsanaService({ token: "t" });
			const compare = (service as any).compareTaskSummaries.bind(service);

			const withTs = {
				name: "Done",
				completedAt: "2026-02-05T10:00:00Z",
				dueAt: null,
				dueOn: null,
			};
			const noTs = {
				name: "No dates",
				completedAt: null,
				dueAt: null,
				dueOn: null,
			};

			expect(compare(noTs, withTs)).toBeGreaterThan(0);
			expect(compare(withTs, noTs)).toBeLessThan(0);
		});
	});

	describe("resolveTaskTimestamp", () => {
		it("prefers completedAt over dueAt/dueOn", () => {
			const service = new AsanaService({ token: "t" });
			const resolve = (service as any).resolveTaskTimestamp.bind(service);

			const task = {
				completedAt: "2026-02-05T10:00:00Z",
				dueAt: "2026-02-01T10:00:00Z",
				dueOn: "2026-02-01",
			};
			expect(resolve(task)).toBe(Date.parse("2026-02-05T10:00:00Z"));
		});

		it("falls back to dueAt when completedAt is null", () => {
			const service = new AsanaService({ token: "t" });
			const resolve = (service as any).resolveTaskTimestamp.bind(service);

			const task = {
				completedAt: null,
				dueAt: "2026-02-01T10:00:00Z",
				dueOn: null,
			};
			expect(resolve(task)).toBe(Date.parse("2026-02-01T10:00:00Z"));
		});

		it("falls back to dueOn when both completedAt and dueAt are null", () => {
			const service = new AsanaService({ token: "t" });
			const resolve = (service as any).resolveTaskTimestamp.bind(service);

			const task = {
				completedAt: null,
				dueAt: null,
				dueOn: "2026-02-01",
			};
			expect(resolve(task)).toBe(Date.parse("2026-02-03T00:00:00Z"));
		});
	});

	describe("retry on 429", () => {
		it("retries once on 429 and succeeds", async () => {
			const service = new AsanaService({ token: "t" });
			const httpGet = spyOn(service as any, "httpGet");

			httpGet.mockResolvedValueOnce({
				statusCode: 429,
				body: "Rate limited",
				headers: { "retry-after": "0" },
			});
			httpGet.mockResolvedValueOnce({
				statusCode: 200,
				body: JSON.stringify({ data: [] }),
				headers: {},
			});

			const result = await (service as any).get("/tasks");
			expect(result).toEqual({ data: [] });
			expect(httpGet).toHaveBeenCalledTimes(2);
		});

		it("throws after exhausting retries on 429", async () => {
			const service = new AsanaService({ token: "t" });
			const httpGet = spyOn(service as any, "httpGet");

			// All 3 attempts return 429
			httpGet.mockResolvedValue({
				statusCode: 429,
				body: "Rate limited",
				headers: { "retry-after": "0" },
			});

			// On the final attempt, it throws the 429 status error (not "after retries")
			// because the last 429 response falls through to the status check
			await expect((service as any).get("/tasks")).rejects.toThrow(
				"Asana request failed (429)",
			);
			expect(httpGet).toHaveBeenCalledTimes(3);
		});
	});

	describe("loadWorkspaces", () => {
		it("caches workspace list after first load", async () => {
			const service = new AsanaService({ token: "t" });
			const httpGet = spyOn(service as any, "httpGet").mockResolvedValue({
				statusCode: 200,
				body: JSON.stringify({
					data: [{ gid: "ws1", name: "Acme" }],
					next_page: null,
				}),
				headers: {},
			});

			const ws1 = await (service as any).loadWorkspaces();
			const ws2 = await (service as any).loadWorkspaces();

			expect(ws1).toEqual([{ gid: "ws1", name: "Acme" }]);
			expect(ws2).toEqual([{ gid: "ws1", name: "Acme" }]);
			// Only fetched once
			expect(httpGet).toHaveBeenCalledTimes(1);
		});

		it("returns empty array when service is disabled", async () => {
			const service = new AsanaService({});
			const result = await (service as any).loadWorkspaces();
			expect(result).toEqual([]);
		});

		it("fetches specific workspace GIDs when configured", async () => {
			const service = new AsanaService({
				token: "t",
				workspaceGids: ["ws1", "ws2"],
			});
			const httpGet = spyOn(service as any, "httpGet");

			httpGet.mockResolvedValueOnce({
				statusCode: 200,
				body: JSON.stringify({
					data: { gid: "ws1", name: "First Workspace" },
				}),
				headers: {},
			});
			httpGet.mockResolvedValueOnce({
				statusCode: 200,
				body: JSON.stringify({
					data: { gid: "ws2", name: "Second Workspace" },
				}),
				headers: {},
			});

			const result = await (service as any).loadWorkspaces();

			expect(result).toHaveLength(2);
			expect(result[0].name).toBe("First Workspace");
			expect(result[1].name).toBe("Second Workspace");
		});

		it("uses GID as fallback name when workspace fetch fails", async () => {
			const service = new AsanaService({
				token: "t",
				workspaceGids: ["ws-bad"],
			});
			spyOn(service as any, "httpGet").mockRejectedValue(
				new Error("Not Found"),
			);

			const result = await (service as any).loadWorkspaces();

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({ gid: "ws-bad", name: "ws-bad" });
		});
	});

	describe("fetchTaskComments", () => {
		it("returns empty array on error", async () => {
			const service = new AsanaService({ token: "t" });
			spyOn(service as any, "paginate").mockRejectedValue(
				new Error("forbidden"),
			);

			const result = await (service as any).fetchTaskComments("task-123");
			expect(result).toEqual([]);
		});

		it("filters and limits to last 5 comments", async () => {
			const service = new AsanaService({ token: "t" });
			const stories = Array.from({ length: 8 }, (_, i) => ({
				gid: `s${i}`,
				type: "comment",
				text: `Comment ${i}`,
			}));
			spyOn(service as any, "paginate").mockResolvedValue(stories);

			const result = await (service as any).fetchTaskComments("task-123");
			expect(result).toHaveLength(5);
			expect(result[0]).toBe("Comment 3");
			expect(result[4]).toBe("Comment 7");
		});

		it("filters out non-comment stories", async () => {
			const service = new AsanaService({ token: "t" });
			spyOn(service as any, "paginate").mockResolvedValue([
				{ gid: "s1", type: "system", text: "Task created" },
				{ gid: "s2", type: "comment", text: "Looks good" },
				{
					gid: "s3",
					type: "system",
					resource_subtype: "comment_added",
					text: "Also a comment",
				},
			]);

			const result = await (service as any).fetchTaskComments("task-123");
			expect(result).toEqual(["Looks good", "Also a comment"]);
		});

		it("strips excessive whitespace from comment text", async () => {
			const service = new AsanaService({ token: "t" });
			spyOn(service as any, "paginate").mockResolvedValue([
				{
					gid: "s1",
					type: "comment",
					text: "  Hello   world\n  foo  ",
				},
			]);

			const result = await (service as any).fetchTaskComments("task-123");
			expect(result).toEqual(["Hello world foo"]);
		});
	});

	describe("get — error response handling", () => {
		it("throws on invalid JSON response", async () => {
			const service = new AsanaService({ token: "t" });
			spyOn(service as any, "httpGet").mockResolvedValue({
				statusCode: 200,
				body: "not json",
				headers: {},
			});

			await expect((service as any).get("/workspaces")).rejects.toThrow(
				"Unable to parse Asana response",
			);
		});

		it("throws on null/undefined status code", async () => {
			const service = new AsanaService({ token: "t" });
			spyOn(service as any, "httpGet").mockResolvedValue({
				statusCode: undefined,
				body: "",
				headers: {},
			});

			await expect((service as any).get("/workspaces")).rejects.toThrow(
				"Asana request failed",
			);
		});
	});
});
