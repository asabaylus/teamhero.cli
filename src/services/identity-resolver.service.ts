import type {
	IdentityResolution,
	IdentityResolver,
	RawIdentity,
} from "../core/types.js";
import type {
	IdentityMap,
	IdentityMapEntry,
	Person,
} from "../models/person.js";

/** The GitHub merge-button / web-flow committer — non-authoring, never credited. */
export const GITHUB_MERGE_EMAIL = "noreply@github.com";

/** `<digits>+login@users.noreply.github.com` or `login@users.noreply.github.com`. */
const NOREPLY_RE = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i;

function normEmail(email?: string): string | undefined {
	const trimmed = email?.trim().toLowerCase();
	return trimmed ? trimmed : undefined;
}

function normLogin(login?: string): string | undefined {
	const trimmed = login?.trim().toLowerCase();
	return trimmed ? trimmed : undefined;
}

function normName(name?: string): string | undefined {
	const trimmed = name?.trim();
	return trimmed ? trimmed : undefined;
}

/** Extract the GitHub login from a noreply email, or undefined when not one. */
function parseNoreplyLogin(email: string): string | undefined {
	const match = NOREPLY_RE.exec(email);
	return match ? match[1].toLowerCase() : undefined;
}

/** Push `value` onto `list` only when present and not already there. */
function pushUnique(list: string[], value: string | undefined): void {
	if (value && !list.includes(value)) {
		list.push(value);
	}
}

/**
 * Build a pure {@link IdentityResolver} from an identity map.
 *
 * Entries that share any login, email, or name are unioned (union-find) so a
 * person split across several entries — or owning a legacy second account —
 * collapses into one {@link Person}. Resolution never instantiates a Person from
 * a bare name; unmatched identities are returned as `unmapped` for the
 * reconciliation review queue.
 */
export function createIdentityResolver(map: IdentityMap): IdentityResolver {
	const persons = buildPersons(map);

	const byLogin = new Map<string, Person>();
	const byEmail = new Map<string, Person>();
	const byName = new Map<string, Person>();
	for (const person of persons) {
		for (const login of person.logins) byLogin.set(login, person);
		for (const email of person.emails) byEmail.set(email, person);
		for (const name of person.names) byName.set(name.toLowerCase(), person);
	}

	function resolve(identity: RawIdentity): IdentityResolution {
		const email = normEmail(identity.email);
		if (email === GITHUB_MERGE_EMAIL) {
			return { type: "merge-identity" };
		}

		const login =
			normLogin(identity.login) ??
			(email ? parseNoreplyLogin(email) : undefined);
		if (login) {
			const match = byLogin.get(login);
			if (match) return { type: "resolved", person: match };
		}

		if (email) {
			const match = byEmail.get(email);
			if (match) return { type: "resolved", person: match };
		}

		const name = normName(identity.name);
		if (name) {
			const match = byName.get(name.toLowerCase());
			if (match) return { type: "resolved", person: match };
		}

		return { type: "unmapped", identity };
	}

	return {
		resolve,
		persons: () => persons,
	};
}

/** Union entries that share any login/email/name, then fold each group into a Person. */
function buildPersons(map: IdentityMap): Person[] {
	const parent = map.map((_, i) => i);

	const find = (i: number): number => {
		let root = i;
		while (parent[root] !== root) root = parent[root];
		// Path compression.
		while (parent[i] !== root) {
			const next = parent[i];
			parent[i] = root;
			i = next;
		}
		return root;
	};
	const union = (a: number, b: number): void => {
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
	};

	// Link any two entries that share a normalized login / email / name key.
	const seen = new Map<string, number>();
	const link = (key: string, index: number): void => {
		const prior = seen.get(key);
		if (prior === undefined) seen.set(key, index);
		else union(prior, index);
	};
	map.forEach((entry, index) => {
		for (const login of entry.logins ?? []) {
			const norm = normLogin(login);
			if (norm) link(`login:${norm}`, index);
		}
		for (const email of entry.emails ?? []) {
			const norm = normEmail(email);
			if (norm) link(`email:${norm}`, index);
		}
		for (const name of entry.names ?? []) {
			const norm = normName(name);
			if (norm) link(`name:${norm.toLowerCase()}`, index);
		}
	});

	// Fold each connected component into a single Person, keeping the
	// lowest-index entry as representative for stable ids.
	const groups = new Map<number, IdentityMapEntry[]>();
	map.forEach((entry, index) => {
		const root = find(index);
		const group = groups.get(root);
		if (group) group.push(entry);
		else groups.set(root, [entry]);
	});

	const persons: Person[] = [];
	for (const root of [...groups.keys()].sort((a, b) => a - b)) {
		const group = groups.get(root) as IdentityMapEntry[];
		const logins: string[] = [];
		const emails: string[] = [];
		const names: string[] = [];
		const jiraAccountIds: string[] = [];
		let asana: Person["asana"];
		const mergeAsana = (a: Person["asana"]) => {
			if (!a) return;
			// Field-by-field: fill any field not already supplied by an earlier entry.
			asana = {
				email: asana?.email ?? a.email,
				name: asana?.name ?? a.name,
				userGid: asana?.userGid ?? a.userGid,
				workspaceGid: asana?.workspaceGid ?? a.workspaceGid,
			};
		};
		let external = false;
		for (const entry of group) {
			for (const login of entry.logins ?? [])
				pushUnique(logins, normLogin(login));
			for (const email of entry.emails ?? [])
				pushUnique(emails, normEmail(email));
			for (const name of entry.names ?? []) pushUnique(names, normName(name));
			if (entry.jira?.accountId)
				pushUnique(jiraAccountIds, entry.jira.accountId);
			mergeAsana(entry.asana);
			if (entry.external) external = true;
		}
		const representative = group[0];
		const displayName =
			group.find((e) => normName(e.name))?.name?.trim() ??
			names[0] ??
			representative.id;
		persons.push({
			id: representative.id,
			displayName,
			logins,
			emails,
			names,
			jiraAccountIds,
			asana,
			external,
			hasMultipleLogins: logins.length > 1,
		});
	}
	return persons;
}
