import type {
	MemberTaskSummary,
	TaskSummary,
	TaskTrackerMemberInput,
} from "../core/types.js";

/**
 * Backward-compatible re-exports.
 * New code should import the generic types from ../core/types.js.
 */
export type AsanaTaskSummary = TaskSummary;
export type MemberAsanaSummary = MemberTaskSummary;
export type AsanaMemberInput = TaskTrackerMemberInput;

export interface AsanaWindow {
	startISO: string;
	endISO: string;
}
