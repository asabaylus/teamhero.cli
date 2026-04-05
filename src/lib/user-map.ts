import type { UserIdentity, UserMap } from "../models/user-identity.js";
import type { AsanaUserOverride } from "../services/asana.service.js";

/**
 * Parse the USER_MAP environment variable JSON into a UserMap.
 * Returns an empty map if the input is undefined or invalid.
 */
export function parseUserMap(raw: string | undefined): UserMap {
	if (!raw) {
		return {};
	}

	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const userMap: UserMap = {};

		for (const [userId, value] of Object.entries(parsed)) {
			if (!value || typeof value !== "object") {
				continue;
			}

			const identity = value as Record<string, unknown>;
			userMap[userId] = {
				name: typeof identity.name === "string" ? identity.name : undefined,
				email: typeof identity.email === "string" ? identity.email : undefined,
				github: parseGitHubAccount(identity.github),
				asana: parseAsanaAccount(identity.asana),
			};
		}

		return userMap;
	} catch {
		return {};
	}
}

function parseGitHubAccount(value: unknown): { login: string } | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const account = value as Record<string, unknown>;
	if (typeof account.login === "string") {
		return { login: account.login };
	}
	return undefined;
}

function parseAsanaAccount(value: unknown): UserIdentity["asana"] | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const account = value as Record<string, unknown>;
	return {
		email: typeof account.email === "string" ? account.email : undefined,
		name: typeof account.name === "string" ? account.name : undefined,
		userGid: typeof account.userGid === "string" ? account.userGid : undefined,
		workspaceGid:
			typeof account.workspaceGid === "string"
				? account.workspaceGid
				: undefined,
	};
}

/**
 * Build a reverse lookup from GitHub login (lowercase) to UserIdentity.
 * This allows efficient lookup when starting from GitHub user data.
 */
export function buildGitHubLookup(userMap: UserMap): Map<string, UserIdentity> {
	const lookup = new Map<string, UserIdentity>();

	for (const identity of Object.values(userMap)) {
		if (identity.github?.login) {
			lookup.set(identity.github.login.toLowerCase(), identity);
		}
	}

	return lookup;
}

/**
 * Resolve AsanaUserOverride from a UserIdentity.
 * Uses Asana-specific fields if available, falls back to shared email/name.
 */
export function resolveAsanaOverride(
	identity: UserIdentity,
): AsanaUserOverride {
	return {
		email: identity.asana?.email ?? identity.email,
		name: identity.asana?.name ?? identity.name,
		userGid: identity.asana?.userGid,
		workspaceGid: identity.asana?.workspaceGid,
	};
}

/**
 * Convert UserMap to the legacy Record<string, AsanaUserOverride> format.
 * Keys are GitHub logins (lowercase) for backward compatibility with AsanaService.
 */
export function convertToAsanaOverrides(
	userMap: UserMap,
): Record<string, AsanaUserOverride> {
	const overrides: Record<string, AsanaUserOverride> = {};

	for (const identity of Object.values(userMap)) {
		if (identity.github?.login) {
			const login = identity.github.login.toLowerCase();
			overrides[login] = resolveAsanaOverride(identity);
		}
	}

	return overrides;
}
