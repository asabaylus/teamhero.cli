import { describe, expect, it } from "bun:test";
import type {
	LatestProjectStatus,
	RoadmapSubtaskInfo,
} from "../../../src/core/types.js";
import type { BoardConfig } from "../../../src/lib/boards-config-loader.js";
import {
	deriveNextMilestone,
	deriveRoadmapStatus,
	deriveRoadmapStatusWithLatest,
	extractRoadmapItems,
	identifyRoadmapItems,
	mapAsanaColorToStatus,
	mapStatusFromCustomFields,
} from "../../../src/lib/roadmap-extractor.js";
import type { ProjectTask } from "../../../src/models/visible-wins.js";

function makeLatest(
	color: string,
	overrides: Partial<LatestProjectStatus> = {},
): LatestProjectStatus {
	return {
		title: "Weekly Update",
		text: "All clear.",
		color,
		createdAt: "2026-04-08T14:00:00Z",
		...overrides,
	};
}

function makeProject(
	gid: string,
	name: string,
	customFields: Record<string, string | number | null> = {},
): ProjectTask {
	return { gid, name, customFields, priorityScore: 0 };
}

function makeSubtask(
	overrides: Partial<RoadmapSubtaskInfo> = {},
): RoadmapSubtaskInfo {
	return {
		gid: "st-1",
		name: "Subtask",
		completed: false,
		completedAt: null,
		dueOn: null,
		status: null,
		assigneeName: null,
		children: [],
		...overrides,
	};
}

describe("mapStatusFromCustomFields", () => {
	it("maps On Track from Rock Status", () => {
		expect(mapStatusFromCustomFields({ "Rock Status": "On Track" })).toBe(
			"on-track",
		);
	});

	it("maps At Risk from Rock Status", () => {
		expect(mapStatusFromCustomFields({ "Rock Status": "At Risk" })).toBe(
			"at-risk",
		);
	});

	it("maps Off Track from Rock Status", () => {
		expect(mapStatusFromCustomFields({ "Rock Status": "Off Track" })).toBe(
			"off-track",
		);
	});

	it("falls back to Project Status when Rock Status absent", () => {
		expect(mapStatusFromCustomFields({ "Project Status": "At Risk" })).toBe(
			"at-risk",
		);
	});

	it("returns unknown when no status fields", () => {
		expect(mapStatusFromCustomFields({})).toBe("unknown");
	});

	it("does not map Completed to off-track", () => {
		expect(mapStatusFromCustomFields({ "Project Status": "Completed" })).toBe(
			"unknown",
		);
	});

	it("Project Status takes precedence over Rock Status", () => {
		expect(
			mapStatusFromCustomFields({
				"Rock Status": "Off Track",
				"Project Status": "At Risk",
			}),
		).toBe("at-risk");
	});
});

describe("deriveRoadmapStatus", () => {
	it("returns parent custom field status when no subtasks", () => {
		const result = deriveRoadmapStatus([], { "Project Status": "On Track" });
		expect(result).toBe("on-track");
	});

	it("uses parent custom field even when subtasks have different status", () => {
		const subtasks = [
			makeSubtask({ status: "Off Track" }),
			makeSubtask({ gid: "st-2", status: "Off Track" }),
		];
		const result = deriveRoadmapStatus(subtasks, {
			"Project Status": "At Risk",
		});
		expect(result).toBe("at-risk");
	});

	it("uses parent custom field even with deep children disagreeing", () => {
		const subtasks = [
			makeSubtask({
				status: "On Track",
				children: [makeSubtask({ gid: "child-1", status: "Off Track" })],
			}),
		];
		const result = deriveRoadmapStatus(subtasks, { "Rock Status": "On Track" });
		expect(result).toBe("on-track");
	});

	it("falls back to subtask-derived status when parent has no custom field", () => {
		const subtasks = [
			makeSubtask({ status: "On Track" }),
			makeSubtask({ gid: "st-2", status: "At Risk" }),
		];
		const result = deriveRoadmapStatus(subtasks, {});
		expect(result).toBe("at-risk");
	});

	it("derives on-track from all on-track subtasks when no parent status", () => {
		const subtasks = [
			makeSubtask({ status: "On Track" }),
			makeSubtask({ gid: "st-2", status: "On Track" }),
		];
		const result = deriveRoadmapStatus(subtasks, {});
		expect(result).toBe("on-track");
	});

	it("derives off-track from subtasks when no parent status", () => {
		const subtasks = [
			makeSubtask({ status: "On Track" }),
			makeSubtask({ gid: "st-2", status: "Off Track" }),
		];
		const result = deriveRoadmapStatus(subtasks, {});
		expect(result).toBe("off-track");
	});

	it("derives at-risk from overdue subtask when no parent status", () => {
		const subtasks = [
			makeSubtask({ dueOn: "2020-01-01" }), // past date = overdue
		];
		const result = deriveRoadmapStatus(subtasks, {});
		expect(result).toBe("at-risk");
	});

	it("uses deepest level for fallback status (children override parents)", () => {
		const subtasks = [
			makeSubtask({
				status: "On Track",
				children: [makeSubtask({ gid: "child-1", status: "Off Track" })],
			}),
		];
		const result = deriveRoadmapStatus(subtasks, {});
		expect(result).toBe("off-track");
	});

	it("skips completed subtasks in status derivation", () => {
		const subtasks = [
			makeSubtask({ completed: true, status: "Off Track" }),
			makeSubtask({ gid: "st-2", status: "On Track" }),
		];
		const result = deriveRoadmapStatus(subtasks, {});
		expect(result).toBe("on-track");
	});

	it("falls back to parent when all subtasks are completed", () => {
		const subtasks = [makeSubtask({ completed: true })];
		const result = deriveRoadmapStatus(subtasks, {
			"Project Status": "At Risk",
		});
		expect(result).toBe("at-risk");
	});

	it("returns unknown when no parent status and no subtasks", () => {
		const result = deriveRoadmapStatus([], {});
		expect(result).toBe("unknown");
	});
});

describe("deriveNextMilestone", () => {
	it("returns empty string for no subtasks", () => {
		expect(deriveNextMilestone([])).toBe("");
	});

	it("returns empty string when all subtasks are completed", () => {
		const subtasks = [makeSubtask({ completed: true, dueOn: "2026-03-10" })];
		expect(deriveNextMilestone(subtasks)).toBe("");
	});

	it("returns empty string when no subtasks have due dates", () => {
		const subtasks = [makeSubtask({ name: "No date task" })];
		expect(deriveNextMilestone(subtasks)).toBe("");
	});

	it("picks the earliest future subtask", () => {
		const subtasks = [
			makeSubtask({ gid: "st-1", name: "Later Task", dueOn: "2099-06-15" }),
			makeSubtask({ gid: "st-2", name: "Sooner Task", dueOn: "2099-03-10" }),
		];
		const result = deriveNextMilestone(subtasks);
		expect(result).toContain("Sooner Task");
		expect(result).toContain("Mar 10");
	});

	it("picks earliest overdue when no future subtasks exist", () => {
		const subtasks = [
			makeSubtask({ gid: "st-1", name: "Very Old", dueOn: "2020-01-15" }),
			makeSubtask({ gid: "st-2", name: "Less Old", dueOn: "2020-06-10" }),
		];
		const result = deriveNextMilestone(subtasks);
		expect(result).toContain("Very Old");
		expect(result).toContain("Jan 15");
	});

	it("prefers future over overdue", () => {
		const subtasks = [
			makeSubtask({ gid: "st-1", name: "Overdue Task", dueOn: "2020-01-15" }),
			makeSubtask({ gid: "st-2", name: "Future Task", dueOn: "2099-06-10" }),
		];
		const result = deriveNextMilestone(subtasks);
		expect(result).toContain("Future Task");
	});

	it("flattens nested children to find milestones", () => {
		const subtasks = [
			makeSubtask({
				gid: "parent",
				name: "Parent",
				children: [
					makeSubtask({
						gid: "child-1",
						name: "Pilot Release",
						dueOn: "2099-03-10",
					}),
				],
			}),
		];
		const result = deriveNextMilestone(subtasks);
		expect(result).toContain("Pilot Release");
		expect(result).toContain("Mar 10");
	});

	it("skips completed subtasks even with due dates", () => {
		const subtasks = [
			makeSubtask({
				gid: "st-1",
				name: "Done",
				completed: true,
				dueOn: "2099-03-01",
			}),
			makeSubtask({ gid: "st-2", name: "Still Open", dueOn: "2099-03-15" }),
		];
		const result = deriveNextMilestone(subtasks);
		expect(result).toContain("Still Open");
	});
});

describe("identifyRoadmapItems", () => {
	it("returns projects matching roadmapItems GIDs", () => {
		const projects = [
			makeProject("r1", "GCCW"),
			makeProject("r2", "SOC2"),
			makeProject("r3", "Other"),
		];
		const boards: BoardConfig[] = [
			{
				projectGid: "p1",
				roadmapItems: [
					{ gid: "r1", displayName: "GCCW" },
					{ gid: "r2", displayName: "SOC2" },
				],
			},
		];

		const result = identifyRoadmapItems(projects, boards);
		expect(result).toHaveLength(2);
		expect(result.map((p) => p.gid)).toEqual(["r1", "r2"]);
	});

	it("returns all projects when isRoadmapBoard is set with no roadmapItems", () => {
		const projects = [makeProject("r1", "GCCW"), makeProject("r2", "SOC2")];
		const boards: BoardConfig[] = [{ projectGid: "p1", isRoadmapBoard: true }];

		const result = identifyRoadmapItems(projects, boards);
		expect(result).toHaveLength(2);
	});

	it("filters to roadmapItems when isRoadmapBoard and roadmapItems are both set", () => {
		const projects = [
			makeProject("r1", "GCCW"),
			makeProject("r2", "SOC2"),
			makeProject("r3", "Other"),
		];
		const boards: BoardConfig[] = [
			{
				projectGid: "p1",
				isRoadmapBoard: true,
				roadmapItems: [{ gid: "r1", displayName: "GCCW" }],
			},
		];

		const result = identifyRoadmapItems(projects, boards);
		expect(result).toHaveLength(1);
		expect(result[0].gid).toBe("r1");
	});
});

describe("extractRoadmapItems", () => {
	it("extracts items with status from custom fields", () => {
		const projects = [makeProject("r1", "GCCW", { "Rock Status": "On Track" })];
		const boards: BoardConfig[] = [
			{
				projectGid: "p1",
				roadmapItems: [{ gid: "r1", displayName: "GCCW Rock" }],
			},
		];

		const result = extractRoadmapItems(projects, boards);
		expect(result).toHaveLength(1);
		expect(result[0].displayName).toBe("GCCW Rock");
		expect(result[0].overallStatus).toBe("on-track");
	});

	it("uses parent custom field status even when subtasks disagree", () => {
		const projects = [makeProject("r1", "GCCW", { "Rock Status": "On Track" })];
		const boards: BoardConfig[] = [
			{
				projectGid: "p1",
				roadmapItems: [{ gid: "r1", displayName: "GCCW" }],
			},
		];
		const subtasksByGid = new Map([
			["r1", [makeSubtask({ status: "Off Track" })]],
		]);

		const result = extractRoadmapItems(projects, boards, subtasksByGid);
		expect(result[0].overallStatus).toBe("on-track");
	});

	it("populates nextMilestone from subtask data", () => {
		const projects = [makeProject("r1", "GCCW", { "Rock Status": "At Risk" })];
		const boards: BoardConfig[] = [
			{
				projectGid: "p1",
				roadmapItems: [{ gid: "r1", displayName: "GCCW" }],
			},
		];
		const subtasksByGid = new Map([
			["r1", [makeSubtask({ name: "Pilot Release", dueOn: "2099-03-10" })]],
		]);

		const result = extractRoadmapItems(projects, boards, subtasksByGid);
		expect(result[0].nextMilestone).toContain("Pilot Release");
		expect(result[0].nextMilestone).toContain("Mar 10");
	});

	it("includes missing GIDs with unknown status", () => {
		const projects = [makeProject("r1", "GCCW", {})];
		const boards: BoardConfig[] = [
			{
				projectGid: "p1",
				roadmapItems: [
					{ gid: "r1", displayName: "GCCW" },
					{ gid: "r999", displayName: "Missing" },
				],
			},
		];

		const result = extractRoadmapItems(projects, boards);
		expect(result).toHaveLength(2);
		expect(result[1].overallStatus).toBe("unknown");
		expect(result[1].displayName).toBe("Missing");
	});

	it("backward compat: reads from rocks[] when roadmapItems absent", () => {
		const projects = [makeProject("r1", "GCCW", {})];
		const boards: BoardConfig[] = [
			{
				projectGid: "p1",
				rocks: [{ gid: "r1", displayName: "GCCW via rocks" }],
			},
		];

		const result = extractRoadmapItems(projects, boards);
		expect(result).toHaveLength(1);
		expect(result[0].displayName).toBe("GCCW via rocks");
	});
});

describe("mapAsanaColorToStatus", () => {
	it("maps green to on-track", () => {
		expect(mapAsanaColorToStatus("green")).toBe("on-track");
	});
	it("maps yellow to at-risk", () => {
		expect(mapAsanaColorToStatus("yellow")).toBe("at-risk");
	});
	it("maps red to off-track", () => {
		expect(mapAsanaColorToStatus("red")).toBe("off-track");
	});
	it("collapses blue to unknown (renderer handles 🔵 from raw color field)", () => {
		expect(mapAsanaColorToStatus("blue")).toBe("unknown");
	});
	it("returns unknown for unexpected color strings", () => {
		expect(mapAsanaColorToStatus("purple")).toBe("unknown");
	});
	it("returns unknown for null / undefined / empty string", () => {
		expect(mapAsanaColorToStatus(null)).toBe("unknown");
		expect(mapAsanaColorToStatus(undefined)).toBe("unknown");
		expect(mapAsanaColorToStatus("")).toBe("unknown");
	});
	it("is case-insensitive", () => {
		expect(mapAsanaColorToStatus("GREEN")).toBe("on-track");
		expect(mapAsanaColorToStatus("Red")).toBe("off-track");
	});
});

describe("deriveRoadmapStatusWithLatest", () => {
	it("uses the latest project status color when one is present", () => {
		const subtasks: RoadmapSubtaskInfo[] = [];
		const customFields = { "Project Status": "Off Track" };
		const latest = makeLatest("green");
		// Latest wins over stale custom field
		expect(deriveRoadmapStatusWithLatest(subtasks, customFields, latest)).toBe(
			"on-track",
		);
	});

	it("falls through to custom-field derivation when latest color is blue", () => {
		const subtasks: RoadmapSubtaskInfo[] = [];
		const customFields = { "Rock Status": "At Risk" };
		const latest = makeLatest("blue");
		expect(deriveRoadmapStatusWithLatest(subtasks, customFields, latest)).toBe(
			"at-risk",
		);
	});

	it("falls through to subtask derivation when latest and custom fields are both missing", () => {
		const subtasks: RoadmapSubtaskInfo[] = [
			{
				gid: "st-1",
				name: "Overdue thing",
				completed: false,
				dueOn: "2020-01-01",
				children: [],
			},
		];
		expect(deriveRoadmapStatusWithLatest(subtasks, {}, null)).toBe("at-risk");
	});

	it("returns unknown when nothing resolvable is present", () => {
		expect(deriveRoadmapStatusWithLatest([], {}, null)).toBe("unknown");
	});

	it("ignores an empty latest.color and falls through", () => {
		const customFields = { "Rock Status": "On Track" };
		const latest = makeLatest("");
		expect(deriveRoadmapStatusWithLatest([], customFields, latest)).toBe(
			"on-track",
		);
	});
});
