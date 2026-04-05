import { describe, expect, it } from "bun:test";
import { associateNotesWithProjects } from "../../../src/adapters/meeting-notes/note-project-associator.js";
import type {
	NormalizedNote,
	ProjectTask,
} from "../../../src/models/visible-wins.js";

function makeNote(
	overrides: Partial<NormalizedNote> & { discussionItems: string[] },
): NormalizedNote {
	return {
		title: "Test Meeting",
		date: "2026-01-29",
		attendees: [],
		sourceFile: "test.md",
		...overrides,
	};
}

function makeProject(name: string, gid: string): ProjectTask {
	return { name, gid, customFields: {}, priorityScore: 0 };
}

describe("associateNotesWithProjects", () => {
	it("matches discussion items to projects by name", () => {
		const notes = [
			makeNote({
				discussionItems: [
					"Sprint progress on Dashboard project",
					"Deployment planning for API Gateway",
				],
			}),
		];
		const projects = [
			makeProject("Dashboard", "gid-1"),
			makeProject("API Gateway", "gid-2"),
		];

		const result = associateNotesWithProjects(notes, projects);

		expect(result).toHaveLength(2);
		expect(result[0].relevantItems).toEqual([
			"Sprint progress on Dashboard project",
		]);
		expect(result[1].relevantItems).toEqual([
			"Deployment planning for API Gateway",
		]);
	});

	it("performs case-insensitive matching", () => {
		const notes = [
			makeNote({
				discussionItems: ["Progress on DASHBOARD feature"],
			}),
		];
		const projects = [makeProject("dashboard", "gid-1")];

		const result = associateNotesWithProjects(notes, projects);

		expect(result[0].relevantItems).toHaveLength(1);
	});

	it("allows single note to match multiple projects", () => {
		const notes = [
			makeNote({
				discussionItems: ["Dashboard and API Gateway integration progress"],
			}),
		];
		const projects = [
			makeProject("Dashboard", "gid-1"),
			makeProject("API Gateway", "gid-2"),
		];

		const result = associateNotesWithProjects(notes, projects);

		expect(result[0].relevantItems).toHaveLength(1);
		expect(result[1].relevantItems).toHaveLength(1);
	});

	it("returns all projects with empty items when no notes match", () => {
		const notes = [
			makeNote({
				discussionItems: ["Unrelated discussion topic"],
			}),
		];
		const projects = [
			makeProject("Dashboard", "gid-1"),
			makeProject("API Gateway", "gid-2"),
		];

		const result = associateNotesWithProjects(notes, projects);

		expect(result).toHaveLength(2);
		expect(result[0].relevantItems).toEqual([]);
		expect(result[1].relevantItems).toEqual([]);
	});

	it("handles partial name matching", () => {
		const notes = [
			makeNote({
				discussionItems: ["The Dashboard redesign is progressing well"],
			}),
		];
		const projects = [makeProject("Dashboard", "gid-1")];

		const result = associateNotesWithProjects(notes, projects);

		expect(result[0].relevantItems).toHaveLength(1);
	});

	it("returns projects with empty items when notes array is empty", () => {
		const projects = [
			makeProject("Dashboard", "gid-1"),
			makeProject("API Gateway", "gid-2"),
		];

		const result = associateNotesWithProjects([], projects);

		expect(result).toHaveLength(2);
		expect(result[0].relevantItems).toEqual([]);
		expect(result[0].sourceNotes).toEqual([]);
	});

	it("tracks source note files for matched items", () => {
		const notes = [
			makeNote({
				sourceFile: "2026 01 29 standup.md",
				discussionItems: ["Dashboard update"],
			}),
			makeNote({
				sourceFile: "2026 01 30 review.md",
				discussionItems: ["Dashboard deployment"],
			}),
		];
		const projects = [makeProject("Dashboard", "gid-1")];

		const result = associateNotesWithProjects(notes, projects);

		expect(result[0].sourceNotes).toEqual([
			"2026 01 29 standup.md",
			"2026 01 30 review.md",
		]);
		expect(result[0].relevantItems).toHaveLength(2);
	});

	it("does not match substring within words", () => {
		const notes = [
			makeNote({
				discussionItems: ["Keyboard update and Whiteboard brainstorming"],
			}),
		];
		const projects = [makeProject("Board", "gid-1")];

		const result = associateNotesWithProjects(notes, projects);

		expect(result[0].relevantItems).toEqual([]);
	});

	it("matches project names with special characters", () => {
		const notes = [
			makeNote({
				discussionItems: ["Update on API-Gateway status"],
			}),
		];
		const projects = [makeProject("API-Gateway", "gid-1")];

		const result = associateNotesWithProjects(notes, projects);

		expect(result[0].relevantItems).toHaveLength(1);
	});

	it("matches against originalName when project has an alias", () => {
		const notes = [
			makeNote({
				discussionItems: [
					"Invalid Inbound call rollout progressing",
					"Inbound Call Routing metrics improved",
				],
			}),
		];
		const projects: ProjectTask[] = [
			{
				name: "Inbound Call Routing",
				gid: "gid-1",
				customFields: {},
				priorityScore: 0,
				originalName: "Invalid Inbound call",
			},
		];

		const result = associateNotesWithProjects(notes, projects);

		expect(result[0].relevantItems).toHaveLength(2);
		expect(result[0].projectName).toBe("Inbound Call Routing");
	});

	it("matches only display name when no originalName is set", () => {
		const notes = [
			makeNote({
				discussionItems: ["Dashboard redesign progress"],
			}),
		];
		const projects: ProjectTask[] = [
			{
				name: "Dashboard",
				gid: "gid-1",
				customFields: {},
				priorityScore: 0,
			},
		];

		const result = associateNotesWithProjects(notes, projects);

		expect(result[0].relevantItems).toHaveLength(1);
	});

	it("deduplicates source note files", () => {
		const notes = [
			makeNote({
				sourceFile: "same-meeting.md",
				discussionItems: ["Dashboard UI updates", "Dashboard API integration"],
			}),
		];
		const projects = [makeProject("Dashboard", "gid-1")];

		const result = associateNotesWithProjects(notes, projects);

		expect(result[0].sourceNotes).toEqual(["same-meeting.md"]);
		expect(result[0].relevantItems).toHaveLength(2);
	});
});
