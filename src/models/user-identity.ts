/**
 * GitHub account information for a user.
 */
export interface GitHubAccount {
	login: string;
}

/**
 * Asana account information for a user.
 * All fields are optional - if not provided, the shared email/name from UserIdentity will be used.
 */
export interface AsanaAccount {
	/** Asana user's email address (overrides shared email) */
	email?: string;
	/** Asana user's display name (overrides shared name) */
	name?: string;
	/** Direct Asana user ID for precise matching */
	userGid?: string;
	/** Specific Asana workspace ID */
	workspaceGid?: string;
}

/**
 * Canonical user identity that maps to accounts across different systems.
 * The key in UserMap is a human-readable identifier (not tied to any system).
 */
export interface UserIdentity {
	/** User's display name (shared across systems) */
	name?: string;
	/** User's email address (shared across systems) */
	email?: string;
	/** GitHub account information */
	github?: GitHubAccount;
	/** Asana account information */
	asana?: AsanaAccount;
	// Future: jira?: JiraAccount;
	// Future: slack?: SlackAccount;
}

/**
 * Map of canonical user IDs to their identity information.
 * Example:
 * ```json
 * {
 *   "john_doe": {
 *     "name": "John Doe",
 *     "email": "john@company.com",
 *     "github": { "login": "johndoe123" },
 *     "asana": { "userGid": "123456" }
 *   }
 * }
 * ```
 */
export type UserMap = Record<string, UserIdentity>;
