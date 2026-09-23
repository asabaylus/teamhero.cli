import { readFile } from "node:fs/promises";
import { join } from "node:path";
import consola from "consola";
import type { JiraProjectFieldConfig } from "../core/types.js";
import { getEnv } from "./env.js";
import { configDir } from "./paths.js";

/**
 * Loader for the story-points Jira configuration produced by setup.
 *
 * Mirrors `boards-config-loader.ts`: env-var override → default path under
 * `configDir()` → `null` when the file is absent (so a report that requests the
 * Jira source but was never configured can degrade gracefully — see the
 * report-time guard in §0.2 of docs/teamhero-storypoints-plan.md).
 */

export interface JiraConfig {
	projects: JiraProjectFieldConfig[];
	/** Issue types that carry points. Omitted or empty ⇒ every issue type. */
	issueTypes?: string[];
	/**
	 * Story-point field for every project, as a custom-field id
	 * ("customfield_10016") or a display name ("Story point estimate"). It
	 * overrides each project's own `fieldId`, so one line repairs a whole config
	 * that was written against another Jira site.
	 */
	storyPointField?: string;
	creditBy?: "assignee" | "resolver";
}

/**
 * Field guesses used at setup time, before any Jira site has been read.
 *
 * Jira allocates a custom-field id per site, so these ids are guesses and are
 * wrong on most sites. The `jqlName` beside each one is the reliable half: the
 * provider reads the site's field list and repairs the id by name on first use
 * (see `jira-field-resolver.ts`). Prefer `storyPointField` to state the field
 * outright.
 */
export const COMPANY_MANAGED_FIELD: Omit<JiraProjectFieldConfig, "key"> = {
	fieldId: "customfield_10005",
	jqlName: "Story Points",
};

/** Team-managed guess (simplified: true, e.g. PT). See above: the id is a guess. */
export const TEAM_MANAGED_FIELD: Omit<JiraProjectFieldConfig, "key"> = {
	fieldId: "customfield_10617",
	jqlName: "Story point estimate",
};

/**
 * Auto-detect the likely story-point field for a project from its `simplified`
 * flag. Used at setup time to pre-fill the field the user can override.
 */
export function autoDetectStoryPointField(
	key: string,
	simplified: boolean,
): JiraProjectFieldConfig {
	const base = simplified ? TEAM_MANAGED_FIELD : COMPANY_MANAGED_FIELD;
	return { key, ...base };
}

const DEFAULT_JIRA_CONFIG_PATH = join(configDir(), "jira-config.json");

function coerceProject(
	value: unknown,
	index: number,
	path: string,
): JiraProjectFieldConfig {
	if (!value || typeof value !== "object") {
		throw new Error(
			`Invalid Jira config at ${path}: projects[${index}] is not an object`,
		);
	}
	const raw = value as Record<string, unknown>;
	for (const field of ["key", "fieldId", "jqlName"] as const) {
		if (typeof raw[field] !== "string" || !(raw[field] as string).trim()) {
			throw new Error(
				`Invalid Jira config at ${path}: projects[${index}] missing "${field}"`,
			);
		}
	}
	let completedWork: JiraProjectFieldConfig["completedWork"];
	if (raw.completedWork !== undefined) {
		if (!raw.completedWork || typeof raw.completedWork !== "object") {
			throw new Error(
				`Invalid Jira config at ${path}: projects[${index}].completedWork must be an object`,
			);
		}
		const work = raw.completedWork as Record<string, unknown>;
		if (!["delivery", "support", "excluded"].includes(String(work.category))) {
			throw new Error(
				`Invalid Jira config at ${path}: projects[${index}].completedWork.category must be "delivery", "support", or "excluded"`,
			);
		}
		completedWork = {
			category: work.category as "delivery" | "support" | "excluded",
			...(work.issueTypes === undefined
				? {}
				: {
						issueTypes: coerceIssueTypes(
							work.issueTypes,
							`${path}: projects[${index}].completedWork.issueTypes`,
						),
					}),
		};
	}
	return {
		key: (raw.key as string).trim(),
		fieldId: (raw.fieldId as string).trim(),
		jqlName: (raw.jqlName as string).trim(),
		...(raw.issueTypes === undefined
			? {}
			: {
					issueTypes: coerceIssueTypes(
						raw.issueTypes,
						`${path}: projects[${index}].issueTypes`,
					),
				}),
		...(completedWork ? { completedWork } : {}),
	};
}

/** Validate an `issueTypes` value from disk: an array of non-empty strings. */
function coerceIssueTypes(value: unknown, where: string): string[] {
	if (
		!Array.isArray(value) ||
		!value.every((type) => typeof type === "string" && type.trim())
	) {
		throw new Error(
			`Invalid Jira config at ${where} must be an array of non-empty strings`,
		);
	}
	return (value as string[]).map((type) => type.trim());
}

/**
 * Parse an issue-type selection written as one string, for `--jira-issue-types`
 * and `JIRA_ISSUE_TYPES`.
 *
 * Three shapes, so one flag can say all three things an operator wants:
 *   "any" | "all" | "*"        every issue type, everywhere
 *   "Story,Bug"                those types, in every project
 *   "DFA=Story,Bug;SUPPORT=any"  those types, per project
 * A bare list may ride along with per-project entries ("any;DFA=Bug") and then
 * applies to every project the string does not name.
 */
export function parseIssueTypeSelection(
	raw: string | undefined,
): { all?: string[]; byProject: Record<string, string[]> } | undefined {
	if (raw === undefined) {
		return undefined;
	}
	const selection: { all?: string[]; byProject: Record<string, string[]> } = {
		byProject: {},
	};
	for (const segment of raw.split(";")) {
		const trimmed = segment.trim();
		if (trimmed === "") continue;
		const scoped = /^([^=]+)=(.*)$/.exec(trimmed);
		if (scoped?.[1] !== undefined && scoped[2] !== undefined) {
			selection.byProject[scoped[1].trim()] = parseTypeList(scoped[2]);
		} else {
			selection.all = parseTypeList(trimmed);
		}
	}
	// A string of only separators means "every type", the same as "any".
	if (
		selection.all === undefined &&
		Object.keys(selection.byProject).length === 0
	) {
		selection.all = [];
	}
	return selection;
}

/** "any"/"all"/"*" and the empty list both mean every issue type. */
function parseTypeList(raw: string): string[] {
	const trimmed = raw.trim();
	if (["any", "all", "*", ""].includes(trimmed.toLowerCase())) {
		return [];
	}
	return trimmed
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part !== "");
}

/**
 * Apply an issue-type selection over a loaded config, without touching the file.
 *
 * A per-project entry wins over the project's own `issueTypes`, which in turn
 * wins over the run-wide list — the same precedence the provider applies, so a
 * flag narrows exactly what it names and leaves the rest as configured.
 */
export function applyIssueTypeSelection(
	config: JiraConfig,
	selection:
		| { all?: string[]; byProject: Record<string, string[]> }
		| undefined,
): JiraConfig {
	if (!selection) {
		return config;
	}
	return {
		...config,
		issueTypes: selection.all ?? config.issueTypes,
		projects: config.projects.map((project) => {
			const scoped = selection.byProject[project.key];
			if (scoped) return { ...project, issueTypes: scoped };
			// A run-wide list from the flag replaces a per-project list from the
			// file; otherwise "--jira-issue-types any" could not widen a config.
			if (selection.all) {
				const { issueTypes: _dropped, ...rest } = project;
				return rest;
			}
			return project;
		}),
	};
}

/**
 * Read `JIRA_ISSUE_TYPES` as a comma-separated list.
 *
 * An unset variable returns undefined and leaves the file's value alone. A set
 * but empty variable returns `[]`, which counts every issue type, so an operator
 * can widen a narrowed config for one run.
 */
export function parseIssueTypesEnv(
	value: string | undefined,
): string[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	return parseTypeList(value);
}

/**
 * Load the Jira story-points config. Returns `null` when the file is absent so
 * the caller can apply the report-time guard. Throws on a malformed file.
 */
export async function loadJiraConfig(): Promise<JiraConfig | null> {
	const path = getEnv("JIRA_CONFIG_PATH") ?? DEFAULT_JIRA_CONFIG_PATH;

	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (err) {
		// Only a missing file means "unconfigured". A permission/IO error is a real
		// problem and must not be silently swallowed as if no config existed.
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			consola.debug(
				`[jira-config] No config at ${path}; Jira story points unconfigured`,
			);
			return null;
		}
		throw new Error(
			`Failed to read Jira config at ${path}: ${(err as Error).message}`,
		);
	}

	let parsed: {
		projects?: unknown;
		issueTypes?: unknown;
		storyPointField?: unknown;
		creditBy?: unknown;
	};
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new Error(
			`Invalid Jira config at ${path}: ${(err as Error).message}`,
		);
	}

	if (!Array.isArray(parsed.projects)) {
		throw new Error(`Invalid Jira config at ${path}: missing "projects" array`);
	}
	if (parsed.projects.length === 0) {
		throw new Error(
			`Invalid Jira config at ${path}: "projects" array is empty`,
		);
	}

	const projects = parsed.projects.map((p, i) => coerceProject(p, i, path));

	let issueTypes: string[] | undefined;
	if (parsed.issueTypes !== undefined) {
		issueTypes = coerceIssueTypes(parsed.issueTypes, `${path}: "issueTypes"`);
	}

	if (
		parsed.storyPointField !== undefined &&
		(typeof parsed.storyPointField !== "string" ||
			!parsed.storyPointField.trim())
	) {
		throw new Error(
			`Invalid Jira config at ${path}: "storyPointField" must be a non-empty string`,
		);
	}

	const creditBy =
		parsed.creditBy === "assignee" || parsed.creditBy === "resolver"
			? parsed.creditBy
			: undefined;
	if (parsed.creditBy !== undefined && creditBy === undefined) {
		throw new Error(
			`Invalid Jira config at ${path}: "creditBy" must be "assignee" or "resolver"`,
		);
	}

	// Env wins over the file, so one run can try another field or narrow the
	// issue types without editing the saved config.
	const fieldOverride = getEnv("JIRA_STORY_POINT_FIELD")?.trim();
	const storyPointField =
		fieldOverride || (parsed.storyPointField as string | undefined)?.trim();

	return {
		projects,
		// An explicitly empty value is meaningful: count every issue type.
		issueTypes:
			parseIssueTypesEnv(getEnv("JIRA_ISSUE_TYPES", { preserveEmpty: true })) ??
			issueTypes,
		storyPointField,
		creditBy,
	};
}
