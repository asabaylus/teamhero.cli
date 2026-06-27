import type { Member } from "../models/member.js";
import type { Person } from "../models/person.js";
import type { UserIdentity, UserMap } from "../models/user-identity.js";
import type { AsanaUserOverride } from "../services/asana.service.js";

/**
 * Adapt canonical {@link Person}s into the {@link UserMap} shape the report
 * pipeline's existing (well-tested) consumers expect. This is the bridge that
 * lets one identity source (identity-map.yaml) feed the report path — see the
 * identity-unification epic.
 */
export function personsToUserMap(persons: Person[]): UserMap {
	const map: UserMap = {};
	for (const p of persons) {
		map[p.id] = {
			name: p.displayName,
			email: p.emails[0],
			github: p.logins[0] ? { login: p.logins[0] } : undefined,
			asana: p.asana,
			jira: p.jiraAccountIds?.[0]
				? { accountId: p.jiraAccountIds[0] }
				: undefined,
		};
	}
	return map;
}

/**
 * Merge two user maps. `canonical` wins on key conflict; entries that exist
 * only in `supplemental` are preserved (back-compat for the USER_MAP env during
 * the migration to identity-map.yaml as the single source).
 */
export function mergeUserMaps(
	canonical: UserMap,
	supplemental: UserMap,
): UserMap {
	return { ...supplemental, ...canonical };
}

/**
 * Deprecation notice for the legacy USER_MAP env. Returns the message when the
 * env is set (so callers can log it once), or undefined. USER_MAP still works
 * — entries fold in via {@link mergeUserMaps} — but identity-map.yaml is now the
 * canonical source.
 */
export function userMapDeprecationNotice(
	raw: string | undefined,
): string | undefined {
	if (!raw?.trim()) return undefined;
	return "USER_MAP env is deprecated; migrate its entries (github/asana/jira) to .teamhero/local/identity-map.yaml. It still works for now.";
}

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
				jira: parseJiraAccount(identity.jira),
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

function parseJiraAccount(value: unknown): UserIdentity["jira"] | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const account = value as Record<string, unknown>;
	const accountId =
		typeof account.accountId === "string" ? account.accountId : undefined;
	const email = typeof account.email === "string" ? account.email : undefined;
	return accountId || email ? { accountId, email } : undefined;
}

/**
 * Build a reverse lookup from Jira accountId (and email fallback) to the
 * GitHub login the report pipeline keys members by. Story points fetched from
 * Jira can then be merged onto member metrics by login.
 */
export function buildJiraLoginLookup(userMap: UserMap): Map<string, string> {
	const lookup = new Map<string, string>();
	for (const identity of Object.values(userMap)) {
		const login = identity.github?.login;
		if (!login) continue;
		if (identity.jira?.accountId) lookup.set(identity.jira.accountId, login);
		const email = identity.jira?.email ?? identity.email;
		if (email && !lookup.has(email.toLowerCase())) {
			lookup.set(email.toLowerCase(), login);
		}
	}
	return lookup;
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

/**
 * Enrich member displayName fields using the user map.
 * When a member's GitHub login matches an entry in the user map that has a name,
 * the member's displayName is updated (unless GitHub already returned a proper name).
 * Mutates the members array in place and returns it for convenience.
 */
export function enrichMemberDisplayNames(
	members: Member[],
	userMap: UserMap,
): Member[] {
	const lookup = buildGitHubLookup(userMap);
	for (const member of members) {
		if (member.displayName === member.login) {
			const identity = lookup.get(member.login.toLowerCase());
			if (identity?.name) {
				member.displayName = identity.name;
			}
		}
	}
	return members;
}
