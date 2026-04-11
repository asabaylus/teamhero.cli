import { describe, expect, it, mock } from "bun:test";
import { VisibleWinsAdapter } from "../../../src/adapters/visible-wins/visible-wins-adapter.js";
import type {
	MeetingNotesProvider,
	ProjectBoardProvider,
	ReportingWindow,
} from "../../../src/core/types.js";
import type { ProjectTask } from "../../../src/models/visible-wins.js";

function makeBoardProvider(projects: ProjectTask[]): ProjectBoardProvider {
	return { fetchProjects: mock().mockResolvedValue(projects) };
}

function makeNotesProvider(): MeetingNotesProvider {
	return { fetchNotes: mock().mockResolvedValue([]) };
}

const window: ReportingWindow = {
	startISO: "2026-03-01T00:00:00Z",
	endISO: "2026-03-07T23:59:59Z",
	endEpochMs: Date.now(),
};

describe("VisibleWinsAdapter", () => {
	it("merges same-name projects instead of dropping duplicates", async () => {
		const provider1 = makeBoardProvider([
			{
				name: "OmniChannel",
				gid: "consolidated-omnichannel",
				customFields: { "Child Tasks": "Task A; Task B" },
				priorityScore: 10,
			},
		]);
		const provider2 = makeBoardProvider([
			{
				name: "OmniChannel",
				gid: "consolidated-omnichannel",
				customFields: { "Child Tasks": "Task C; Task D" },
				priorityScore: 20,
			},
		]);

		const adapter = new VisibleWinsAdapter({
			boardProviders: [provider1, provider2],
			notesProvider: makeNotesProvider(),
		});

		const result = await adapter.fetchData(window);

		expect(result.projects).toHaveLength(1);
		expect(result.projects[0].name).toBe("OmniChannel");
		expect(result.projects[0].customFields["Child Tasks"]).toBe(
			"Task A; Task B; Task C; Task D",
		);
		expect(result.projects[0].priorityScore).toBe(20);
	});

	it("filters to allowlisted projects when includeInVisibleWins is set", async () => {
		const provider = makeBoardProvider([
			{ name: "OmniChannel", gid: "g1", customFields: {}, priorityScore: 10 },
			{ name: "Costs", gid: "g2", customFields: {}, priorityScore: 5 },
			{
				name: "Excluded Project",
				gid: "g3",
				customFields: {},
				priorityScore: 20,
			},
		]);

		const adapter = new VisibleWinsAdapter({
			boardProviders: [provider],
			notesProvider: makeNotesProvider(),
			includeInVisibleWins: ["OmniChannel", "Costs"],
		});

		const result = await adapter.fetchData(window);

		expect(result.projects).toHaveLength(2);
		expect(result.projects.map((p) => p.name)).toEqual([
			"OmniChannel",
			"Costs",
		]);
	});

	it("allowlist matching is case-insensitive", async () => {
		const provider = makeBoardProvider([
			{ name: "OmniChannel", gid: "g1", customFields: {}, priorityScore: 10 },
		]);

		const adapter = new VisibleWinsAdapter({
			boardProviders: [provider],
			notesProvider: makeNotesProvider(),
			includeInVisibleWins: ["omnichannel"],
		});

		const result = await adapter.fetchData(window);

		expect(result.projects).toHaveLength(1);
	});

	it("passes all projects through when includeInVisibleWins is absent", async () => {
		const provider = makeBoardProvider([
			{ name: "OmniChannel", gid: "g1", customFields: {}, priorityScore: 10 },
			{ name: "Anything", gid: "g2", customFields: {}, priorityScore: 5 },
		]);

		const adapter = new VisibleWinsAdapter({
			boardProviders: [provider],
			notesProvider: makeNotesProvider(),
		});

		const result = await adapter.fetchData(window);

		expect(result.projects).toHaveLength(2);
	});

	it("keeps different-name projects separate", async () => {
		const provider1 = makeBoardProvider([
			{
				name: "OmniChannel",
				gid: "consolidated-omnichannel",
				customFields: {},
				priorityScore: 10,
			},
		]);
		const provider2 = makeBoardProvider([
			{
				name: "Costs",
				gid: "consolidated-costs",
				customFields: {},
				priorityScore: 5,
			},
		]);

		const adapter = new VisibleWinsAdapter({
			boardProviders: [provider1, provider2],
			notesProvider: makeNotesProvider(),
		});

		const result = await adapter.fetchData(window);

		expect(result.projects).toHaveLength(2);
		expect(result.projects.map((p) => p.name)).toEqual([
			"OmniChannel",
			"Costs",
		]);
	});
});
