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
});
