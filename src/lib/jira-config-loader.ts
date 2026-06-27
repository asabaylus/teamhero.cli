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
	/** Issue types that carry points. Default ["Story", "Task"]. */
	issueTypes?: string[];
	creditBy?: "assignee" | "resolver";
}

/** Company-managed default (simplified: false). */
export const COMPANY_MANAGED_FIELD: Omit<JiraProjectFieldConfig, "key"> = {
	fieldId: "customfield_10005",
	jqlName: "Story Points[Number]",
};

/** Team-managed default (simplified: true, e.g. PT). */
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
	return {
		key: (raw.key as string).trim(),
		fieldId: (raw.fieldId as string).trim(),
		jqlName: (raw.jqlName as string).trim(),
	};
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

	let parsed: { projects?: unknown; issueTypes?: unknown; creditBy?: unknown };
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
		if (
			!Array.isArray(parsed.issueTypes) ||
			!parsed.issueTypes.every((t) => typeof t === "string" && t.trim())
		) {
			throw new Error(
				`Invalid Jira config at ${path}: "issueTypes" must be an array of non-empty strings`,
			);
		}
		issueTypes = parsed.issueTypes as string[];
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

	return { projects, issueTypes, creditBy };
}
