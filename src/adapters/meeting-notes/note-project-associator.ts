import type {
	NormalizedNote,
	ProjectNoteAssociation,
	ProjectTask,
} from "../../models/visible-wins.js";

export type { ProjectNoteAssociation };

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function associateNotesWithProjects(
	notes: NormalizedNote[],
	projects: ProjectTask[],
): ProjectNoteAssociation[] {
	return projects.map((project) => {
		const patterns: RegExp[] = [
			new RegExp(`\\b${escapeRegex(project.name.trim())}\\b`, "i"),
		];
		if (project.originalName) {
			patterns.push(
				new RegExp(`\\b${escapeRegex(project.originalName.trim())}\\b`, "i"),
			);
		}
		const relevantItems: string[] = [];
		const sourceNotes = new Set<string>();

		for (const note of notes) {
			for (const item of note.discussionItems) {
				if (patterns.some((p) => p.test(item))) {
					relevantItems.push(item);
					sourceNotes.add(note.sourceFile);
				}
			}
		}

		return {
			projectGid: project.gid,
			projectName: project.name,
			relevantItems,
			sourceNotes: [...sourceNotes],
		};
	});
}
