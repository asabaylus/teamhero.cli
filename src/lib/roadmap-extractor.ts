import consola from "consola";
import type { RoadmapEntry, RoadmapSubtaskInfo } from "../core/types.js";
import type { ProjectTask } from "../models/visible-wins.js";
import type { BoardConfig } from "./boards-config-loader.js";

export function mapStatusFromCustomFields(
	customFields: Record<string, string | number | null>,
): RoadmapEntry["overallStatus"] {
	// "Project Status" takes precedence over "Rock Status"
	const projectStatus = customFields["Project Status"];
	if (projectStatus === "On Track") return "on-track";
	if (projectStatus === "At Risk") return "at-risk";
	if (projectStatus === "Off Track") return "off-track";

	const rockStatus = customFields["Rock Status"];
	if (rockStatus === "On Track") return "on-track";
	if (rockStatus === "At Risk") return "at-risk";
	if (rockStatus === "Off Track") return "off-track";

	return "unknown";
}

/**
 * Derive overall status for a roadmap item.
 * The parent task's own custom field ("Rock Status" / "Project Status") is the
 * source of truth. Only when the parent has no status field do we fall back to
 * a bottom-up derivation from the subtask tree.
 */
export function deriveRoadmapStatus(
	subtasks: RoadmapSubtaskInfo[],
	parentCustomFields: Record<string, string | number | null>,
): RoadmapEntry["overallStatus"] {
	// Parent's own custom field is the source of truth
	const parentStatus = mapStatusFromCustomFields(parentCustomFields);
	if (parentStatus !== "unknown") return parentStatus;

	// Fallback: derive from subtask tree when parent has no status
	if (subtasks.length === 0) return "unknown";

	const statuses = collectDeepestStatuses(subtasks);
	if (statuses.length === 0) return "unknown";

	if (statuses.includes("off-track")) return "off-track";
	if (statuses.includes("at-risk")) return "at-risk";
	if (statuses.includes("on-track")) return "on-track";
	return "unknown";
}

function collectDeepestStatuses(
	subtasks: RoadmapSubtaskInfo[],
): RoadmapEntry["overallStatus"][] {
	// Try children first (deeper level)
	const childStatuses: RoadmapEntry["overallStatus"][] = [];
	for (const st of subtasks) {
		if (st.children.length > 0) {
			childStatuses.push(...collectDeepestStatuses(st.children));
		}
	}
	if (childStatuses.length > 0) return childStatuses;

	// No children — this is the deepest level. Derive status from these subtasks.
	return subtasks
		.filter((st) => !st.completed)
		.map((st) => {
			// Check custom field status first
			if (st.status) {
				if (st.status === "On Track") return "on-track" as const;
				if (st.status === "At Risk") return "at-risk" as const;
				if (st.status === "Off Track") return "off-track" as const;
			}
			// Derive from due date
			if (st.dueOn) {
				const due = new Date(st.dueOn);
				const now = new Date();
				if (due < now) return "at-risk" as const;
			}
			return "on-track" as const;
		});
}

/**
 * Flatten a subtask tree into a single-level array.
 */
function flattenSubtasks(subtasks: RoadmapSubtaskInfo[]): RoadmapSubtaskInfo[] {
	const result: RoadmapSubtaskInfo[] = [];
	for (const st of subtasks) {
		result.push(st);
		if (st.children.length > 0) {
			result.push(...flattenSubtasks(st.children));
		}
	}
	return result;
}

/**
 * Deterministically derive the next milestone from subtask data.
 * Picks the earliest incomplete subtask with a due date (future first, then overdue).
 * Returns formatted string like "Mar 10 - Pilot Release" or "" if no candidates.
 */
export function deriveNextMilestone(subtasks: RoadmapSubtaskInfo[]): string {
	const candidates = flattenSubtasks(subtasks).filter(
		(st) => !st.completed && st.dueOn,
	);

	if (candidates.length === 0) return "";

	const today = new Date();
	today.setUTCHours(0, 0, 0, 0);

	const future = candidates
		.filter((st) => new Date(st.dueOn!) >= today)
		.sort(
			(a, b) => new Date(a.dueOn!).getTime() - new Date(b.dueOn!).getTime(),
		);

	const overdue = candidates
		.filter((st) => new Date(st.dueOn!) < today)
		.sort(
			(a, b) => new Date(a.dueOn!).getTime() - new Date(b.dueOn!).getTime(),
		);

	const chosen = future[0] ?? overdue[0];
	if (!chosen) return "";

	const date = new Date(chosen.dueOn!);
	const formatted = date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
	return `${formatted} - ${chosen.name}`;
}

/**
 * Identify which projects are roadmap items based on board config.
 * Uses `isRoadmapBoard` if set, otherwise falls back to `roadmapItems`/`rocks` GID list.
 */
export function identifyRoadmapItems(
	projects: ProjectTask[],
	boardConfigs: BoardConfig[],
): ProjectTask[] {
	const projectsByGid = new Map(projects.map((p) => [p.gid, p]));

	// Find board marked as roadmap board
	const roadmapBoard = boardConfigs.find((b) => b.isRoadmapBoard);
	if (roadmapBoard) {
		// All items from this board's section are roadmap items
		// They were already fetched as part of visible-wins. Return all projects
		// that belong to this board (matched by section membership).
		// Since we can't distinguish which projects came from which board here,
		// return all projects from visible-wins — the section filter was already
		// applied during fetch. If roadmapItems are configured, filter to only those.
		const itemOverrides = roadmapBoard.roadmapItems ?? roadmapBoard.rocks;
		if (itemOverrides && itemOverrides.length > 0) {
			const overrideGids = new Set(itemOverrides.map((r) => r.gid));
			return projects.filter((p) => overrideGids.has(p.gid));
		}
		// No specific items configured — return all projects from visible-wins
		return projects;
	}

	// Fallback: use roadmapItems/rocks GID list
	const items: ProjectTask[] = [];
	for (const board of boardConfigs) {
		const roadmapItems = board.roadmapItems ?? board.rocks;
		if (!roadmapItems) continue;
		for (const item of roadmapItems) {
			const project = projectsByGid.get(item.gid);
			if (project) {
				items.push(project);
			}
		}
	}
	return items;
}

/**
 * Build RoadmapEntry[] from board configs and fetched projects.
 * Status is determined from subtask tree (if available) or Asana custom fields.
 * nextMilestone and keyNotes are left empty for AI synthesis.
 */
export function extractRoadmapItems(
	projects: ProjectTask[],
	boardConfigs: BoardConfig[],
	subtasksByGid?: Map<string, RoadmapSubtaskInfo[]>,
): RoadmapEntry[] {
	const projectsByGid = new Map(projects.map((p) => [p.gid, p]));
	const entries: RoadmapEntry[] = [];
	const seen = new Set<string>();

	for (const board of boardConfigs) {
		const roadmapItems = board.roadmapItems ?? board.rocks;
		if (!roadmapItems) continue;

		for (const item of roadmapItems) {
			if (seen.has(item.gid)) continue;
			seen.add(item.gid);

			const project = projectsByGid.get(item.gid);
			if (!project) {
				consola.warn(
					`[roadmap] Item GID ${item.gid} ("${item.displayName}") not found in fetched projects — including with unknown status`,
				);
				entries.push({
					gid: item.gid,
					displayName: item.displayName,
					overallStatus: "unknown",
					nextMilestone: "",
					keyNotes: "",
				});
				continue;
			}

			const subtasks = subtasksByGid?.get(item.gid) ?? [];
			entries.push({
				gid: item.gid,
				displayName: item.displayName,
				overallStatus: deriveRoadmapStatus(subtasks, project.customFields),
				nextMilestone: deriveNextMilestone(subtasks),
				keyNotes: "",
			});
		}
	}

	return entries;
}
