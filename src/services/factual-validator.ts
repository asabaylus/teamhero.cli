import type { FactualValidationContext } from "../core/types.js";
import type {
	Discrepancy,
	NormalizedNote,
	ProjectTask,
} from "../models/visible-wins.js";

/**
 * Build a searchable text corpus from all source notes and project custom fields.
 * Used for substring matching of dates and figures.
 */
function buildSourceCorpus(
	notes: NormalizedNote[],
	projects: ProjectTask[],
): string {
	const parts: string[] = [];

	for (const note of notes) {
		parts.push(note.date);
		for (const item of note.discussionItems) {
			parts.push(item);
		}
		parts.push(note.title);
	}

	for (const project of projects) {
		for (const value of Object.values(project.customFields)) {
			if (value != null) {
				parts.push(String(value));
			}
		}
	}

	return parts.join("\n");
}

/**
 * Cross-check dates and figures from AI-extracted accomplishments against source data.
 * Returns a Discrepancy[] for each unmatched claim.
 */
export function validateFactualClaims(
	context: FactualValidationContext,
): Discrepancy[] {
	const { accomplishments, notes, projects } = context;
	const corpus = buildSourceCorpus(notes, projects);
	const discrepancies: Discrepancy[] = [];

	for (const accomplishment of accomplishments) {
		for (const bullet of accomplishment.bullets) {
			for (const date of bullet.sourceDates) {
				if (!corpus.includes(date)) {
					discrepancies.push({
						projectName: accomplishment.projectName,
						type: "date",
						aiValue: date,
						sourceValue: "not found in source data",
						sourceFile: bullet.sourceNoteFile,
						bulletText: bullet.text,
						rationale: `The AI extracted the date "${date}" from a bullet about "${accomplishment.projectName}", but this date does not appear anywhere in the meeting notes or Asana custom fields. The AI may have inferred or hallucinated this date from surrounding context.`,
					});
				}
			}

			for (const figure of bullet.sourceFigures) {
				if (!corpus.includes(figure)) {
					discrepancies.push({
						projectName: accomplishment.projectName,
						type: "figure",
						aiValue: figure,
						sourceValue: "not found in source data",
						sourceFile: bullet.sourceNoteFile,
						bulletText: bullet.text,
						rationale: `The AI extracted the figure "${figure}" from a bullet about "${accomplishment.projectName}", but this figure does not appear anywhere in the meeting notes or Asana custom fields. The AI may have calculated, rounded, or fabricated this number.`,
					});
				}
			}
		}
	}

	return discrepancies;
}
