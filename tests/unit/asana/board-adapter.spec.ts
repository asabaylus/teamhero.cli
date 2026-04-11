import { describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AsanaBoardAdapter } from "../../../src/adapters/asana/board-adapter.js";
import type { AsanaService } from "../../../src/services/asana.service.js";
import { mocked } from "../../helpers/mocked.js";

const fixturesDir = resolve(__dirname, "../../fixtures/asana-responses");

function loadFixture<T>(name: string): T {
	return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf8")) as T;
}

function createMockAsanaService() {
	return {
		fetchFromPath: mock(),
		fetchFromPathPaginated: mock(),
	} as unknown as AsanaService;
}

describe("AsanaBoardAdapter", () => {
	describe("section resolution", () => {
		it("uses sectionGid directly when provided", async () => {
			const mockService = createMockAsanaService();
			mocked(mockService.fetchFromPathPaginated).mockResolvedValue(
				loadFixture("section-tasks.json"),
			);

			const adapter = new AsanaBoardAdapter({
				asanaService: mockService,
				projectGid: "proj-1",
				sectionGid: "1002",
				priorityFieldName: "RICE Score",
			});

			await adapter.fetchProjects();

			expect(mockService.fetchFromPath).not.toHaveBeenCalled();
			expect(mockService.fetchFromPathPaginated).toHaveBeenCalledWith(
				"/sections/1002/tasks",
				expect.objectContaining({ opt_fields: expect.any(String) }),
			);
		});

		it("resolves section by name when sectionGid is not provided", async () => {
			const mockService = createMockAsanaService();
			mocked(mockService.fetchFromPath).mockResolvedValue(
				loadFixture("sections-list.json"),
			);
			mocked(mockService.fetchFromPathPaginated).mockResolvedValue(
				loadFixture("section-tasks.json"),
			);

			const adapter = new AsanaBoardAdapter({
				asanaService: mockService,
				projectGid: "proj-1",
				sectionName: "Now",
				priorityFieldName: "RICE Score",
			});

			await adapter.fetchProjects();

			expect(mockService.fetchFromPath).toHaveBeenCalledWith(
				"/projects/proj-1/sections",
			);
			expect(mockService.fetchFromPathPaginated).toHaveBeenCalledWith(
				"/sections/1002/tasks",
				expect.objectContaining({ opt_fields: expect.any(String) }),
			);
		});

		it("throws when section name is not found", async () => {
			const mockService = createMockAsanaService();
			mocked(mockService.fetchFromPath).mockResolvedValue(
				loadFixture("sections-list.json"),
			);

			const adapter = new AsanaBoardAdapter({
				asanaService: mockService,
				projectGid: "proj-1",
				sectionName: "NonExistent",
			});

			await expect(adapter.fetchProjects()).rejects.toThrow(
				"Section 'NonExistent' not found in project proj-1. Available sections: Backlog, Now, Next",
			);
		});

		it("fetches all project tasks when neither sectionGid nor sectionName is provided", async () => {
			const mockService = createMockAsanaService();
			mocked(mockService.fetchFromPathPaginated).mockResolvedValue(
				loadFixture("section-tasks.json"),
			);

			const adapter = new AsanaBoardAdapter({
				asanaService: mockService,
				projectGid: "proj-1",
			});

			const projects = await adapter.fetchProjects();
			expect(projects.length).toBeGreaterThan(0);
			expect(mockService.fetchFromPathPaginated).toHaveBeenCalledWith(
				"/projects/proj-1/tasks",
				expect.objectContaining({ opt_fields: expect.any(String) }),
			);
		});

		it("matches section name case-insensitively", async () => {
			const mockService = createMockAsanaService();
			mocked(mockService.fetchFromPath).mockResolvedValue(
				loadFixture("sections-list.json"),
			);
			mocked(mockService.fetchFromPathPaginated).mockResolvedValue(
				loadFixture("section-tasks.json"),
			);

			const adapter = new AsanaBoardAdapter({
				asanaService: mockService,
				projectGid: "proj-1",
				sectionName: "  now  ",
				priorityFieldName: "RICE Score",
			});

			const projects = await adapter.fetchProjects();

			expect(projects).toHaveLength(3);
			expect(mockService.fetchFromPathPaginated).toHaveBeenCalledWith(
				"/sections/1002/tasks",
				expect.objectContaining({ opt_fields: expect.any(String) }),
			);
		});

		it("throws when projectGid is empty", async () => {
			const mockService = createMockAsanaService();

			const adapter = new AsanaBoardAdapter({
				asanaService: mockService,
				projectGid: "",
				sectionGid: "1002",
			});

			await expect(adapter.fetchProjects()).rejects.toThrow(
				"projectGid is required but was empty",
			);
		});
	});

	describe("custom field extraction", () => {
		it("maps custom fields to Record<string, string | number | null>", async () => {
			const mockService = createMockAsanaService();
			mocked(mockService.fetchFromPathPaginated).mockResolvedValue(
				loadFixture("section-tasks.json"),
			);

			const adapter = new AsanaBoardAdapter({
				asanaService: mockService,
				projectGid: "proj-1",
				sectionGid: "1002",
				priorityFieldName: "RICE Score",
			});

			const projects = await adapter.fetchProjects();

			expect(projects[0].customFields).toEqual({
				"RICE Score": 95,
				Status: "On Track",
			});
		});

		it("extracts priority score from named field", async () => {
			const mockService = createMockAsanaService();
			mocked(mockService.fetchFromPathPaginated).mockResolvedValue(
				loadFixture("section-tasks.json"),
			);

			const adapter = new AsanaBoardAdapter({
				asanaService: mockService,
				projectGid: "proj-1",
				sectionGid: "1002",
				priorityFieldName: "RICE Score",
			});

			const projects = await adapter.fetchProjects();

			expect(projects.map((p) => p.priorityScore)).toEqual([95, 85, 42]);
		});

		it("falls back to display_value for number fields when number_value is null", async () => {
			const mockService = createMockAsanaService();
			mocked(mockService.fetchFromPathPaginated).mockResolvedValue([
				{
					gid: "4001",
					name: "Project Fallback",
					custom_fields: [
						{
							gid: "cf1",
							name: "RICE Score",
							display_value: "70",
							number_value: null,
							type: "number",
						},
					],
				},
			]);

			const adapter = new AsanaBoardAdapter({
				asanaService: mockService,
				projectGid: "proj-1",
				sectionGid: "1002",
				priorityFieldName: "RICE Score",
			});

			const projects = await adapter.fetchProjects();

			expect(projects[0].customFields["RICE Score"]).toBe("70");
			// display_value is a string, not a number — so priorityScore stays 0
			expect(projects[0].priorityScore).toBe(0);
		});

		it("defaults priority score to 0 when priority field is missing", async () => {
			const mockService = createMockAsanaService();
			mocked(mockService.fetchFromPathPaginated).mockResolvedValue(
				loadFixture("section-tasks-no-priority.json"),
			);

			const adapter = new AsanaBoardAdapter({
				asanaService: mockService,
				projectGid: "proj-1",
				sectionGid: "1002",
				priorityFieldName: "RICE Score",
			});

			const projects = await adapter.fetchProjects();

			expect(projects[0].priorityScore).toBe(0);
			expect(projects[1].priorityScore).toBe(0);
		});
	});

	describe("sorting", () => {
		it("maps parentGid and parentName when task has parent in API response", async () => {
			const mockService = createMockAsanaService();
			mocked(mockService.fetchFromPathPaginated).mockResolvedValue([
				{
					gid: "subtask-1",
					name: "Phase 1: Prioritize",
					custom_fields: [],
					parent: {
						gid: "parent-123",
						name: "Enrollment Lead Routing Recalibration",
					},
				},
			]);

			const adapter = new AsanaBoardAdapter({
				asanaService: mockService,
				projectGid: "proj-1",
				sectionGid: "1002",
			});

			const projects = await adapter.fetchProjects();

			expect(projects).toHaveLength(1);
			expect(projects[0].parentGid).toBe("parent-123");
			expect(projects[0].parentName).toBe(
				"Enrollment Lead Routing Recalibration",
			);
		});

		it("returns projects sorted by priority score descending", async () => {
			const mockService = createMockAsanaService();
			mocked(mockService.fetchFromPathPaginated).mockResolvedValue(
				loadFixture("section-tasks.json"),
			);

			const adapter = new AsanaBoardAdapter({
				asanaService: mockService,
				projectGid: "proj-1",
				sectionGid: "1002",
				priorityFieldName: "RICE Score",
			});

			const projects = await adapter.fetchProjects();

			expect(projects.map((p) => p.name)).toEqual([
				"Project Gamma",
				"Project Alpha",
				"Project Beta",
			]);
		});
	});

	describe("project aliases", () => {
		it("applies display name alias when projectAliases contains the task GID", async () => {
			const mockService = createMockAsanaService();
			mocked(mockService.fetchFromPathPaginated).mockResolvedValue([
				{
					gid: "2001",
					name: "Invalid Inbound call Deployment & Pilot Release",
					custom_fields: [],
				},
			]);

			const adapter = new AsanaBoardAdapter({
				asanaService: mockService,
				projectGid: "proj-1",
				sectionGid: "1002",
				projectAliases: { "2001": "Inbound Call Routing" },
			});

			const projects = await adapter.fetchProjects();

			expect(projects[0].name).toBe("Inbound Call Routing");
			expect(projects[0].originalName).toBe(
				"Invalid Inbound call Deployment & Pilot Release",
			);
		});

		it("preserves original name when no alias matches", async () => {
			const mockService = createMockAsanaService();
			mocked(mockService.fetchFromPathPaginated).mockResolvedValue([
				{
					gid: "2001",
					name: "Project Alpha",
					custom_fields: [],
				},
			]);

			const adapter = new AsanaBoardAdapter({
				asanaService: mockService,
				projectGid: "proj-1",
				sectionGid: "1002",
				projectAliases: { "9999": "Something Else" },
			});

			const projects = await adapter.fetchProjects();

			expect(projects[0].name).toBe("Project Alpha");
			expect(projects[0].originalName).toBeUndefined();
		});

		it("works without projectAliases config", async () => {
			const mockService = createMockAsanaService();
			mocked(mockService.fetchFromPathPaginated).mockResolvedValue([
				{
					gid: "2001",
					name: "Project Alpha",
					custom_fields: [],
				},
			]);

			const adapter = new AsanaBoardAdapter({
				asanaService: mockService,
				projectGid: "proj-1",
				sectionGid: "1002",
			});

			const projects = await adapter.fetchProjects();

			expect(projects[0].name).toBe("Project Alpha");
			expect(projects[0].originalName).toBeUndefined();
		});

		it("filters to only aliased tasks when aliasesOnly is true", async () => {
			const mockService = createMockAsanaService();
			mocked(mockService.fetchFromPathPaginated).mockResolvedValue([
				{ gid: "2001", name: "Wanted Task", custom_fields: [] },
				{ gid: "2002", name: "Unwanted Task", custom_fields: [] },
				{ gid: "2003", name: "Also Wanted", custom_fields: [] },
			]);

			const adapter = new AsanaBoardAdapter({
				asanaService: mockService,
				projectGid: "proj-1",
				sectionGid: "1002",
				projectAliases: { "2001": "CI/CD", "2003": "MassMail Tool" },
				aliasesOnly: true,
			});

			const projects = await adapter.fetchProjects();

			expect(projects).toHaveLength(2);
			expect(projects.map((p) => p.name)).toEqual(["CI/CD", "MassMail Tool"]);
		});
	});

	describe("task notes", () => {
		it("requests notes in opt_fields and surfaces them on ProjectTask", async () => {
			const mockService = createMockAsanaService();
			mocked(mockService.fetchFromPathPaginated).mockResolvedValue([
				{
					gid: "2001",
					name: "GCCW v1.x",
					notes:
						"UAT complete; pilot release overdue. Rollout tracking for Apr 13.",
					custom_fields: [],
				},
			]);

			const adapter = new AsanaBoardAdapter({
				asanaService: mockService,
				projectGid: "proj-1",
				sectionGid: "1002",
			});

			const projects = await adapter.fetchProjects();

			expect(mockService.fetchFromPathPaginated).toHaveBeenCalledWith(
				"/sections/1002/tasks",
				expect.objectContaining({
					opt_fields: expect.stringContaining("notes"),
				}),
			);
			expect(projects).toHaveLength(1);
			expect(projects[0].notes).toBe(
				"UAT complete; pilot release overdue. Rollout tracking for Apr 13.",
			);
		});

		it("returns null notes when Asana omits the field", async () => {
			const mockService = createMockAsanaService();
			mocked(mockService.fetchFromPathPaginated).mockResolvedValue([
				{
					gid: "2001",
					name: "Quiet task",
					custom_fields: [],
				},
			]);

			const adapter = new AsanaBoardAdapter({
				asanaService: mockService,
				projectGid: "proj-1",
				sectionGid: "1002",
			});

			const projects = await adapter.fetchProjects();
			expect(projects[0].notes).toBeNull();
		});
	});

	describe("error propagation", () => {
		it("propagates auth error from AsanaService", async () => {
			const mockService = createMockAsanaService();
			mocked(mockService.fetchFromPathPaginated).mockRejectedValue(
				new Error("Asana API token is not configured."),
			);

			const adapter = new AsanaBoardAdapter({
				asanaService: mockService,
				projectGid: "proj-1",
				sectionGid: "1002",
			});

			await expect(adapter.fetchProjects()).rejects.toThrow(
				"Asana API token is not configured.",
			);
		});
	});
});
