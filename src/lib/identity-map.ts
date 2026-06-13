import { readFile } from "node:fs/promises";
import { load as loadYaml } from "js-yaml";
import type { IdentityMap, IdentityMapEntry } from "../models/person.js";

/**
 * Loading and validation for the human-maintained identity map.
 *
 * Real entries live ONLY in gitignored local data
 * (`.teamhero/local/identity-map.yaml`); a redacted, placeholder-only example
 * documenting the shape is committed at `.teamhero/identity-map.example.yaml`.
 */

function asStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out = value.filter(
		(item): item is string => typeof item === "string" && item.trim() !== "",
	);
	return out.length ? out : undefined;
}

/** Coerce one raw object into a validated entry, or null when it lacks an id. */
function coerceEntry(value: unknown): IdentityMapEntry | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as Record<string, unknown>;
	if (typeof raw.id !== "string" || raw.id.trim() === "") return null;
	return {
		id: raw.id.trim(),
		name: typeof raw.name === "string" ? raw.name : undefined,
		logins: asStringArray(raw.logins),
		emails: asStringArray(raw.emails),
		names: asStringArray(raw.names),
		external: raw.external === true,
	};
}

/** Validate an already-parsed value into an {@link IdentityMap} (lenient: drops bad entries). */
export function parseIdentityMap(value: unknown): IdentityMap {
	if (!Array.isArray(value)) return [];
	const entries: IdentityMap = [];
	for (const item of value) {
		const entry = coerceEntry(item);
		if (entry) entries.push(entry);
	}
	return entries;
}

/** Parse YAML text into an {@link IdentityMap}. Returns `[]` on a parse error. */
export function parseIdentityMapYaml(text: string): IdentityMap {
	try {
		return parseIdentityMap(loadYaml(text));
	} catch {
		return [];
	}
}

/**
 * Load the identity map from a YAML file. Returns `[]` when the file is missing
 * or unreadable so a first run without local data degrades gracefully.
 */
export async function loadIdentityMapFile(path: string): Promise<IdentityMap> {
	try {
		return parseIdentityMapYaml(await readFile(path, "utf8"));
	} catch {
		return [];
	}
}
