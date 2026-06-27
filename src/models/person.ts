/**
 * Canonical contributor identity.
 *
 * A Person is the single human all GitHub activity rolls up to. One Person may
 * span multiple git author names, emails, and GitHub logins (including a legacy
 * account). This replaces the legacy single-login `UserIdentity` shape; see
 * `docs/adr/0001-person-identity-model.md`.
 *
 * Real identity data lives ONLY in gitignored local data
 * (`.teamhero/local/identity-map.yaml`). A redacted, placeholder-only example is
 * committed at `.teamhero/identity-map.example.yaml`.
 */
export interface Person {
	/** Stable identifier for this Person (the representative identity-map entry id). */
	id: string;
	/** Preferred display name. */
	displayName: string;
	/** Every GitHub login belonging to this Person (lowercased). */
	logins: string[];
	/** Every git author email belonging to this Person (lowercased). */
	emails: string[];
	/** Every git author name belonging to this Person (verbatim). */
	names: string[];
	/** True when this Person is an external collaborator (e.g. a Vendor Pod contractor). */
	external: boolean;
	/**
	 * True when this Person owns more than one GitHub login — the duplicate-account
	 * flag the reconciliation report surfaces for cleanup.
	 */
	hasMultipleLogins: boolean;
}

/**
 * One human-maintained entry in the identity map. Entries that share any login,
 * email, or name are unioned into a single {@link Person} by the resolver, so a
 * person split across several entries still collapses correctly.
 */
export interface IdentityMapEntry {
	/** Stable identifier for the entry (kebab-case placeholder in committed examples). */
	id: string;
	/** Preferred display name; falls back to the first `names` entry, then `id`. */
	name?: string;
	/** GitHub logins for this entry. Two logins here is the duplicate-account case. */
	logins?: string[];
	/** Git author emails for this entry (matched case-insensitively). */
	emails?: string[];
	/** Alternate git author names for this entry. */
	names?: string[];
	/** Marks an external collaborator (defaults to false). */
	external?: boolean;
}

/** The human-maintained mapping of git identities onto Persons. */
export type IdentityMap = IdentityMapEntry[];
