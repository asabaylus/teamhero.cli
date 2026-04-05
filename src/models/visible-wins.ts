export interface ProjectTask {
	name: string;
	gid: string;
	customFields: Record<string, string | number | null>;
	priorityScore: number;
	/** Original Asana task name before alias was applied. Set only when a display alias overrides the name. */
	originalName?: string;
	/** GID of parent task when this is a subtask. Used to group children under parents in the wins section. */
	parentGid?: string;
	/** Name of parent task. Used for display when grouping. */
	parentName?: string;
}

export interface NormalizedNote {
	title: string;
	date: string;
	attendees: string[];
	discussionItems: string[];
	sourceFile: string;
}

export interface AccomplishmentBullet {
	text: string;
	subBullets: string[];
	sourceDates: string[];
	sourceFigures: string[];
	sourceNoteFile: string;
}

export interface ProjectAccomplishment {
	projectName: string;
	projectGid: string;
	bullets: AccomplishmentBullet[];
}

export interface Discrepancy {
	projectName: string;
	type: "date" | "figure";
	aiValue: string;
	sourceValue: string;
	sourceFile: string;
	bulletText: string;
	rationale: string;
}

export interface ProjectNoteAssociation {
	projectGid: string;
	projectName: string;
	relevantItems: string[];
	sourceNotes: string[];
}
