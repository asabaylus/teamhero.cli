import { describe, expect, it, spyOn } from "bun:test";
import { AsanaService } from "../../src/services/asana.service.js";

describe("AsanaService", () => {
	it("requests API resources relative to the configured base URL", async () => {
		const service = new AsanaService({
			token: "token",
			baseUrl: "https://app.asana.com/api/1.0",
		});
		const httpGet = spyOn(service as any, "httpGet").mockResolvedValue({
			statusCode: 200,
			body: JSON.stringify({ data: [] }),
			headers: {},
		});

		await (service as any).get("/workspaces");

		expect(httpGet).toHaveBeenCalledTimes(1);
		const [urlArg] = httpGet.mock.calls[0];
		expect(urlArg instanceof URL).toBe(true);
		expect(urlArg.toString()).toBe("https://app.asana.com/api/1.0/workspaces");
	});

	it("summarizes completed tasks with descriptions and recent comments", async () => {
		const service = new AsanaService({ token: "token" });
		const fetchComments = spyOn(
			service as any,
			"fetchTaskComments",
		).mockResolvedValue([
			"Initial QA sign-off",
			"Customer success approved rollout",
		]);

		const tasks = [
			{
				gid: "1",
				name: "Finalize onboarding checklist",
				completed: true,
				completed_at: "2025-09-18T10:00:00Z",
				notes: "Document the revised workflow and confirm partner approval.",
				due_on: null,
				due_at: null,
				permalink_url: "https://app.asana.com/0/123/1",
			},
			{
				gid: "2",
				name: "Out of window",
				completed: true,
				completed_at: "2025-08-01T10:00:00Z",
				notes: "Should not appear",
				due_on: null,
				due_at: null,
				permalink_url: "https://app.asana.com/0/123/2",
			},
			{
				gid: "3",
				name: "Still open",
				completed: false,
				completed_at: null,
				notes: "Ignore",
				due_on: null,
				due_at: null,
				permalink_url: "https://app.asana.com/0/123/3",
			},
		];

		const summary = await (service as any).summarizeTasks(tasks, {
			startISO: "2025-09-15T00:00:00Z",
			endISO: "2025-09-22T00:00:00Z",
		});

		expect(fetchComments).toHaveBeenCalledTimes(1);
		expect(fetchComments).toHaveBeenCalledWith("1");
		expect(summary).toHaveLength(1);
		expect(summary[0]).toMatchObject({
			gid: "1",
			name: "Finalize onboarding checklist",
			description:
				"Document the revised workflow and confirm partner approval.",
			comments: ["Initial QA sign-off", "Customer success approved rollout"],
		});
	});

	describe("fetchFromPath", () => {
		it("returns parsed JSON response for a single resource", async () => {
			const service = new AsanaService({
				token: "token",
				baseUrl: "https://app.asana.com/api/1.0",
			});
			spyOn(service as any, "httpGet").mockResolvedValue({
				statusCode: 200,
				body: JSON.stringify({ data: { gid: "123", name: "My Project" } }),
				headers: {},
			});

			const result = await service.fetchFromPath<{
				data: { gid: string; name: string };
			}>("/projects/123");

			expect(result).toEqual({ data: { gid: "123", name: "My Project" } });
		});

		it("throws when no API token is configured", async () => {
			const service = new AsanaService({});

			await expect(service.fetchFromPath("/projects/123")).rejects.toThrow(
				"Asana API token is not configured.",
			);
		});

		it("throws on error response", async () => {
			const service = new AsanaService({ token: "token" });
			spyOn(service as any, "httpGet").mockResolvedValue({
				statusCode: 500,
				body: "Internal Server Error",
				headers: {},
			});

			await expect(service.fetchFromPath("/projects/123")).rejects.toThrow(
				"Asana request failed (500): Internal Server Error",
			);
		});

		it("follows redirects via httpGet infrastructure", async () => {
			const service = new AsanaService({
				token: "token",
				baseUrl: "https://app.asana.com/api/1.0",
			});
			const httpGet = spyOn(service as any, "httpGet");

			// httpGet is called once by get() — redirect handling is internal to httpGet
			// We verify that fetchFromPath delegates through get() which calls httpGet
			httpGet.mockResolvedValue({
				statusCode: 200,
				body: JSON.stringify({ data: { gid: "456" } }),
				headers: {},
			});

			const result = await service.fetchFromPath<{ data: { gid: string } }>(
				"/projects/456",
			);

			expect(httpGet).toHaveBeenCalledTimes(1);
			const [urlArg] = httpGet.mock.calls[0];
			expect(urlArg.toString()).toBe(
				"https://app.asana.com/api/1.0/projects/456",
			);
			expect(result).toEqual({ data: { gid: "456" } });
		});
	});

	describe("fetchFromPathPaginated", () => {
		it("collects items from multiple pages", async () => {
			const service = new AsanaService({
				token: "token",
				baseUrl: "https://app.asana.com/api/1.0",
			});
			const httpGet = spyOn(service as any, "httpGet");

			httpGet.mockResolvedValueOnce({
				statusCode: 200,
				body: JSON.stringify({
					data: [{ gid: "1", name: "Task A" }],
					next_page: { offset: "page2" },
				}),
				headers: {},
			});

			httpGet.mockResolvedValueOnce({
				statusCode: 200,
				body: JSON.stringify({
					data: [{ gid: "2", name: "Task B" }],
					next_page: null,
				}),
				headers: {},
			});

			const result = await service.fetchFromPathPaginated<{
				gid: string;
				name: string;
			}>("/tasks");

			expect(result).toEqual([
				{ gid: "1", name: "Task A" },
				{ gid: "2", name: "Task B" },
			]);
			expect(httpGet).toHaveBeenCalledTimes(2);

			// Verify offset param is included on the second request
			const secondCallUrl = httpGet.mock.calls[1][0] as URL;
			expect(secondCallUrl.searchParams.get("offset")).toBe("page2");
		});
	});

	describe("fetchSubtasks", () => {
		it("requests notes in opt_fields and surfaces them on returned subtasks", async () => {
			const service = new AsanaService({ token: "token" });
			const paginate = spyOn(service as any, "paginate").mockResolvedValue([
				{
					gid: "sub1",
					name: "Design review",
					completed: false,
					completed_at: null,
					due_on: "2026-04-20",
					notes: "Blocked on legal sign-off; Maria pinged 4/08",
					assignee: { name: "Maria" },
					custom_fields: [],
				},
			]);

			const result = await service.fetchSubtasks("parent-gid", 1);

			expect(paginate).toHaveBeenCalledTimes(1);
			const [path, params] = paginate.mock.calls[0];
			expect(path).toBe("/tasks/parent-gid/subtasks");
			expect(params.opt_fields).toContain("notes");
			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				gid: "sub1",
				name: "Design review",
				notes: "Blocked on legal sign-off; Maria pinged 4/08",
				assigneeName: "Maria",
				dueOn: "2026-04-20",
			});
		});

		it("returns null notes when Asana omits the field", async () => {
			const service = new AsanaService({ token: "token" });
			spyOn(service as any, "paginate").mockResolvedValue([
				{
					gid: "sub1",
					name: "Silent subtask",
					completed: true,
					completed_at: "2026-04-01T10:00:00Z",
					due_on: null,
					assignee: null,
					custom_fields: [],
				},
			]);

			const result = await service.fetchSubtasks("parent-gid", 1);
			expect(result[0].notes).toBeNull();
		});
	});

	describe("fetchTaskByGid", () => {
		it("requests notes in opt_fields and returns parsed task", async () => {
			const service = new AsanaService({ token: "token" });
			const fetchFromPath = spyOn(
				service as any,
				"fetchFromPath",
			).mockResolvedValue({
				data: {
					gid: "task-1",
					name: "GCCW v1.x",
					notes: "UAT complete. Pilot release 4/13.",
					custom_fields: [
						{
							name: "RICE Score",
							display_value: "88",
							number_value: 88,
							type: "number",
						},
						{
							name: "Status",
							display_value: "On Track",
							type: "enum",
						},
					],
				},
			});

			const result = await service.fetchTaskByGid("task-1");

			expect(fetchFromPath).toHaveBeenCalledTimes(1);
			const [path, params] = fetchFromPath.mock.calls[0];
			expect(path).toBe("/tasks/task-1");
			expect(params.opt_fields).toContain("notes");
			expect(result).toMatchObject({
				gid: "task-1",
				name: "GCCW v1.x",
				notes: "UAT complete. Pilot release 4/13.",
				customFields: {
					"RICE Score": 88,
					Status: "On Track",
				},
			});
		});

		it("returns null on fetch error without throwing", async () => {
			const service = new AsanaService({ token: "token" });
			spyOn(service as any, "fetchFromPath").mockRejectedValue(
				new Error("404 Not Found"),
			);

			const result = await service.fetchTaskByGid("missing-gid");
			expect(result).toBeNull();
		});

		it("handles task with no notes field", async () => {
			const service = new AsanaService({ token: "token" });
			spyOn(service as any, "fetchFromPath").mockResolvedValue({
				data: {
					gid: "task-1",
					name: "Silent task",
					custom_fields: [],
				},
			});

			const result = await service.fetchTaskByGid("task-1");
			expect(result).not.toBeNull();
			expect(result!.notes).toBeNull();
			expect(result!.customFields).toEqual({});
		});
	});

	describe("fetchLatestProjectStatus", () => {
		it("requests the project_statuses endpoint with the required opt_fields", async () => {
			const service = new AsanaService({ token: "token" });
			const paginate = spyOn(service as any, "paginate").mockResolvedValue([
				{
					gid: "status-1",
					title: "Weekly update",
					text: "UAT complete. Pilot Apr 13.",
					color: "green",
					created_at: "2026-04-08T14:00:00Z",
					created_by: { name: "Luciano" },
				},
			]);

			const result = await service.fetchLatestProjectStatus("proj-123");

			expect(paginate).toHaveBeenCalledTimes(1);
			const [path, params] = paginate.mock.calls[0];
			expect(path).toBe("/projects/proj-123/project_statuses");
			expect(params.opt_fields).toContain("color");
			expect(params.opt_fields).toContain("created_at");
			expect(result).toEqual({
				title: "Weekly update",
				text: "UAT complete. Pilot Apr 13.",
				color: "green",
				createdAt: "2026-04-08T14:00:00Z",
				createdBy: "Luciano",
			});
		});

		it("returns the most recent status when multiple are present", async () => {
			const service = new AsanaService({ token: "token" });
			spyOn(service as any, "paginate").mockResolvedValue([
				{
					gid: "old",
					title: "Old",
					text: "older",
					color: "yellow",
					created_at: "2026-03-15T10:00:00Z",
				},
				{
					gid: "mid",
					title: "Mid",
					text: "middle",
					color: "yellow",
					created_at: "2026-04-01T10:00:00Z",
				},
				{
					gid: "new",
					title: "New",
					text: "newest",
					color: "green",
					created_at: "2026-04-08T10:00:00Z",
				},
			]);

			const result = await service.fetchLatestProjectStatus("proj-123");
			expect(result?.title).toBe("New");
			expect(result?.color).toBe("green");
			expect(result?.text).toBe("newest");
		});

		it("returns null when the project has no status updates", async () => {
			const service = new AsanaService({ token: "token" });
			spyOn(service as any, "paginate").mockResolvedValue([]);
			const result = await service.fetchLatestProjectStatus("proj-empty");
			expect(result).toBeNull();
		});

		it("returns null on 404 (task GID instead of project GID) without throwing", async () => {
			const service = new AsanaService({ token: "token" });
			spyOn(service as any, "paginate").mockRejectedValue(
				new Error("404 Not Found"),
			);
			const result = await service.fetchLatestProjectStatus("task-1");
			expect(result).toBeNull();
		});

		it("handles missing optional fields gracefully", async () => {
			const service = new AsanaService({ token: "token" });
			spyOn(service as any, "paginate").mockResolvedValue([
				{
					gid: "status-1",
					created_at: "2026-04-08T14:00:00Z",
				},
			]);
			const result = await service.fetchLatestProjectStatus("proj-1");
			expect(result).toEqual({
				title: "",
				text: "",
				color: "",
				createdAt: "2026-04-08T14:00:00Z",
				createdBy: undefined,
			});
		});
	});
});
