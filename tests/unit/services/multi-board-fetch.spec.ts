import { describe, expect, it, mock } from "bun:test";
import { VisibleWinsAdapter } from "../../../src/adapters/visible-wins/visible-wins-adapter.js";
import type {
	MeetingNotesProvider,
	ProjectBoardProvider,
} from "../../../src/core/types.js";
import type { ProjectTask } from "../../../src/models/visible-wins.js";

function makeProject(gid: string, name: string): ProjectTask {
	return { gid, name, customFields: {}, priorityScore: 0 };
}

function makeBoardProvider(
	projects: ProjectTask[],
	fail = false,
): ProjectBoardProvider {
	return {
		fetchProjects: fail
			? mock().mockRejectedValue(new Error("Board fetch failed"))
			: mock().mockResolvedValue(projects),
	};
}

function makeNotesProvider(): MeetingNotesProvider {
	return {
		fetchNotes: mock().mockResolvedValue([]),
	};
}

const window = { startISO: "2026-01-01", endISO: "2026-01-31" };

describe("VisibleWinsAdapter multi-board fetch", () => {
	it("continues fetching when one board fails", async () => {
		const goodProvider = makeBoardProvider([
			makeProject("t1", "Good Project A"),
			makeProject("t2", "Good Project B"),
		]);
		const badProvider = makeBoardProvider([], true);

		const adapter = new VisibleWinsAdapter({
			boardProviders: [badProvider, goodProvider],
			notesProvider: makeNotesProvider(),
		});

		const result = await adapter.fetchData(window);

		expect(result.projects).toHaveLength(2);
		expect(result.projects[0].name).toBe("Good Project A");
		expect(result.projects[1].name).toBe("Good Project B");
	});

	it("returns empty array when all boards fail", async () => {
		const adapter = new VisibleWinsAdapter({
			boardProviders: [
				makeBoardProvider([], true),
				makeBoardProvider([], true),
			],
			notesProvider: makeNotesProvider(),
		});

		const result = await adapter.fetchData(window);

		expect(result.projects).toHaveLength(0);
	});

	it("deduplicates projects by name across boards", async () => {
		const providerA = makeBoardProvider([
			makeProject("t1", "Shared Project"),
			makeProject("t2", "Board A Only"),
		]);
		const providerB = makeBoardProvider([
			makeProject("t3", "shared project"),
			makeProject("t4", "Board B Only"),
		]);

		const adapter = new VisibleWinsAdapter({
			boardProviders: [providerA, providerB],
			notesProvider: makeNotesProvider(),
		});

		const result = await adapter.fetchData(window);

		expect(result.projects).toHaveLength(3);
		expect(result.projects.map((p) => p.name)).toEqual([
			"Shared Project",
			"Board A Only",
			"Board B Only",
		]);
	});
});
