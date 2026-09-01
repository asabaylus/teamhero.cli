import type { JiraProjectFieldConfig } from "../../core/types.js";

/** One entry of Jira's `GET /rest/api/3/field` response. */
export interface JiraFieldDescriptor {
	id: string;
	name: string;
}

/**
 * The names Jira gives a story-point field, most specific first.
 *
 * A team-managed (simplified) project calls it "Story point estimate"; a
 * company-managed project calls it "Story Points". Both names are stable across
 * sites, but the custom-field ids behind them are allocated per site, so an id
 * can never be a safe default.
 */
export const STORY_POINT_FIELD_NAMES = [
	"Story point estimate",
	"Story Points",
] as const;

/** How a project's story-point field was decided. */
export type FieldResolution =
	| { outcome: "configured"; config: JiraProjectFieldConfig }
	| {
			outcome: "repaired";
			config: JiraProjectFieldConfig;
			previousFieldId: string;
			matchedBy: "jqlName" | "wellKnownName";
	  }
	| { outcome: "unresolved"; config: JiraProjectFieldConfig };

function findByName(
	fields: JiraFieldDescriptor[],
	name: string,
): JiraFieldDescriptor | undefined {
	const wanted = name.trim().toLowerCase();
	return fields.find((field) => field.name.trim().toLowerCase() === wanted);
}

/**
 * Decide which custom field holds a project's story points.
 *
 * The configured `fieldId` wins whenever the site actually has that field. When
 * it does not — a hand-written config, a config copied between sites, or a
 * setup default that guessed an id — the field is resolved by name instead:
 * first the configured `jqlName`, then the well-known names. Resolving by name
 * matters because Jira answers a search for an absent field with no value
 * rather than an error, so an unresolved id makes every row read zero points
 * and nothing says so.
 */
export function resolveProjectField(
	project: JiraProjectFieldConfig,
	fields: JiraFieldDescriptor[],
): FieldResolution {
	if (fields.some((field) => field.id === project.fieldId)) {
		return { outcome: "configured", config: project };
	}

	const byJqlName = findByName(fields, project.jqlName);
	if (byJqlName) {
		return {
			outcome: "repaired",
			config: { ...project, fieldId: byJqlName.id, jqlName: byJqlName.name },
			previousFieldId: project.fieldId,
			matchedBy: "jqlName",
		};
	}

	for (const name of STORY_POINT_FIELD_NAMES) {
		const wellKnown = findByName(fields, name);
		if (wellKnown) {
			return {
				outcome: "repaired",
				config: { ...project, fieldId: wellKnown.id, jqlName: wellKnown.name },
				previousFieldId: project.fieldId,
				matchedBy: "wellKnownName",
			};
		}
	}

	return { outcome: "unresolved", config: project };
}

/**
 * Apply an operator override to one project.
 *
 * An override that looks like a custom-field id sets the id directly. Any other
 * value is a display name, so it becomes the `jqlName` and leaves the id for
 * {@link resolveProjectField} to fill in from the site's field list.
 */
export function applyFieldOverride(
	project: JiraProjectFieldConfig,
	override: string,
): JiraProjectFieldConfig {
	const value = override.trim();
	if (!value) {
		return project;
	}
	return /^customfield_\d+$/.test(value)
		? { ...project, fieldId: value }
		: { ...project, fieldId: "", jqlName: value };
}
