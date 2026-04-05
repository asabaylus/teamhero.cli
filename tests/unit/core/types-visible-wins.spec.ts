import { describe, expect, it } from "bun:test";
import type {
	MeetingNotesProvider,
	ProjectBoardProvider,
	ReportingWindow,
} from "../../../src/core/types.js";
import type {
	NormalizedNote,
	ProjectTask,
} from "../../../src/models/visible-wins.js";

describe("Visible Wins port interfaces", () => {
	it("ReportingWindow has startISO and endISO fields", () => {
		const window: ReportingWindow = {
			startISO: "2026-01-20T00:00:00.000Z",
			endISO: "2026-01-27T23:59:59.000Z",
		};
		expect(window.startISO).toBe("2026-01-20T00:00:00.000Z");
		expect(window.endISO).toBe("2026-01-27T23:59:59.000Z");
	});

	it("ReportingWindow is structurally compatible with AsanaWindow shape", () => {
		const asanaWindowShape = {
			startISO: "2026-01-20T00:00:00.000Z",
			endISO: "2026-01-27T23:59:59.000Z",
		};
		const reportingWindow: ReportingWindow = asanaWindowShape;
		expect(reportingWindow.startISO).toBe(asanaWindowShape.startISO);
		expect(reportingWindow.endISO).toBe(asanaWindowShape.endISO);
	});

	it("ProjectBoardProvider can be implemented with fetchProjects", () => {
		const provider: ProjectBoardProvider = {
			fetchProjects: async (): Promise<ProjectTask[]> => [],
		};
		expect(provider.fetchProjects).toBeDefined();
		expect(typeof provider.fetchProjects).toBe("function");
	});

	it("MeetingNotesProvider can be implemented with fetchNotes", () => {
		const window: ReportingWindow = {
			startISO: "2026-01-20T00:00:00.000Z",
			endISO: "2026-01-27T23:59:59.000Z",
		};
		const provider: MeetingNotesProvider = {
			fetchNotes: async (
				_window: ReportingWindow,
			): Promise<NormalizedNote[]> => [],
		};
		expect(provider.fetchNotes).toBeDefined();
		expect(typeof provider.fetchNotes).toBe("function");
	});

	it("ProjectBoardProvider.fetchProjects returns Promise<ProjectTask[]>", async () => {
		const mockTask: ProjectTask = {
			name: "Test Project",
			gid: "12345",
			customFields: { "RICE Score": 85 },
			priorityScore: 85,
		};
		const provider: ProjectBoardProvider = {
			fetchProjects: async () => [mockTask],
		};
		const result = await provider.fetchProjects();
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("Test Project");
		expect(result[0].gid).toBe("12345");
		expect(result[0].priorityScore).toBe(85);
	});

	it("MeetingNotesProvider.fetchNotes returns Promise<NormalizedNote[]>", async () => {
		const mockNote: NormalizedNote = {
			title: "Weekly Standup",
			date: "2026-01-22",
			attendees: ["Alice", "Bob"],
			discussionItems: ["Discussed roadmap"],
			sourceFile: "2026 01 22 Weekly Standup.md",
		};
		const window: ReportingWindow = {
			startISO: "2026-01-20T00:00:00.000Z",
			endISO: "2026-01-27T23:59:59.000Z",
		};
		const provider: MeetingNotesProvider = {
			fetchNotes: async () => [mockNote],
		};
		const result = await provider.fetchNotes(window);
		expect(result).toHaveLength(1);
		expect(result[0].title).toBe("Weekly Standup");
		expect(result[0].sourceFile).toBe("2026 01 22 Weekly Standup.md");
	});
});
