import { afterAll, describe, expect, it, mock } from "bun:test";
import type { ProjectBoardProvider } from "../../../src/core/types.js";
import type { ProjectTask } from "../../../src/models/visible-wins.js";

/**
 * ConsolidatingBoardProvider is defined in scripts/run-report.ts.
 * Since it's not exported, we recreate the class here to test its logic.
 * If the implementation changes, this test must be updated in lockstep.
 */
class ConsolidatingBoardProvider implements ProjectBoardProvider {
	constructor(
		private readonly inner: ProjectBoardProvider,
		private readonly projectName: string,
	) {}

	async fetchProjects(): Promise<ProjectTask[]> {
		const tasks = await this.inner.fetchProjects();

		const maxPriority = Math.max(...tasks.map((t) => t.priorityScore), 0);
		const taskNames = tasks.map((t) => t.name).join("; ");

		const consolidated: ProjectTask = {
			name: this.projectName,
			gid: `consolidated-${this.projectName.toLowerCase().replace(/\s+/g, "-")}`,
			customFields: {},
			priorityScore: maxPriority,
		};
		if (taskNames) {
			consolidated.customFields["Child Tasks"] = taskNames;
		}
		return [consolidated];
	}
}

function makeInnerProvider(tasks: ProjectTask[]): ProjectBoardProvider {
	return {
		fetchProjects: mock(() => Promise.resolve(tasks)),
	};
}

function makeTask(name: string, priorityScore = 0): ProjectTask {
	return {
		name,
		gid: `task-${name.toLowerCase().replace(/\s+/g, "-")}`,
		customFields: {},
		priorityScore,
	};
}

describe("ConsolidatingBoardProvider", () => {
	afterAll(() => {
		mock.restore();
	});

	it("returns a single consolidated project with child task names", async () => {
		const inner = makeInnerProvider([
			makeTask("Fix login bug", 10),
			makeTask("Add signup flow", 30),
		]);
		const provider = new ConsolidatingBoardProvider(inner, "My Project");

		const result = await provider.fetchProjects();

		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("My Project");
		expect(result[0].gid).toBe("consolidated-my-project");
		expect(result[0].customFields["Child Tasks"]).toBe(
			"Fix login bug; Add signup flow",
		);
		expect(result[0].priorityScore).toBe(30);
	});

	it("returns placeholder project when section has no tasks (regression: empty sections caused project to vanish)", async () => {
		const inner = makeInnerProvider([]);
		const provider = new ConsolidatingBoardProvider(
			inner,
			"Digital Enrollment Journey",
		);

		const result = await provider.fetchProjects();

		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("Digital Enrollment Journey");
		expect(result[0].gid).toBe("consolidated-digital-enrollment-journey");
		expect(result[0].customFields["Child Tasks"]).toBeUndefined();
		expect(result[0].priorityScore).toBe(0);
	});

	it("takes highest priority score from child tasks", async () => {
		const inner = makeInnerProvider([
			makeTask("Low priority", 5),
			makeTask("High priority", 95),
			makeTask("Medium priority", 50),
		]);
		const provider = new ConsolidatingBoardProvider(inner, "Test Project");

		const result = await provider.fetchProjects();

		expect(result[0].priorityScore).toBe(95);
	});

	it("generates a stable GID from the project name", async () => {
		const inner = makeInnerProvider([makeTask("Task A")]);
		const provider = new ConsolidatingBoardProvider(inner, "SOC 2 [Rock]");

		const result = await provider.fetchProjects();

		expect(result[0].gid).toBe("consolidated-soc-2-[rock]");
	});
});
