import type { ScopeOptions, ScopeProvider } from "../core/types.js";
import type { OctokitClient } from "../lib/octokit.js";
import type { Member } from "../models/member.js";
import type { Organization } from "../models/organization.js";
import type { Repository } from "../models/repository.js";

export type { ScopeOptions };

export interface ScopeResult {
	organization: Organization;
	repositories: Repository[];
	members: Member[];
}

export class ScopeService implements ScopeProvider {
	constructor(private readonly octokit: OctokitClient) {}

	async getOrganization(org: string): Promise<Organization> {
		try {
			const { data } = await this.octokit.rest.orgs.get({ org });
			return {
				id: data.id,
				login: data.login,
				name: data.name ?? data.login,
				nodeId: data.node_id,
			} satisfies Organization;
		} catch (error) {
			throw this.wrapError(
				error,
				`Unable to fetch organization '${org}'. Ensure the organization exists and the token has access.`,
			);
		}
	}

	async getRepositories(
		org: string,
		options: ScopeOptions,
	): Promise<Repository[]> {
		let repos;
		try {
			repos = await this.octokit.paginate(this.octokit.rest.repos.listForOrg, {
				org,
				type: "all",
				per_page: 100,
				sort: "full_name",
			});
		} catch (error) {
			throw this.wrapError(
				error,
				`Unable to list repositories for '${org}'. Confirm the token has repository read access.`,
			);
		}

		const mapped: Repository[] = repos.map((repo) => ({
			id: repo.id,
			name: repo.name,
			isPrivate: Boolean(repo.private),
			isArchived: Boolean(repo.archived),
			defaultBranch:
				(repo as { default_branch?: string }).default_branch ?? "main",
		}));
		const filteredByName = this.filterRepositoryNames(
			mapped,
			options.repositoryNames,
		);
		return this.filterRepositories(filteredByName, options);
	}

	private filterRepositories(
		repos: Repository[],
		options: ScopeOptions,
	): Repository[] {
		return repos.filter((repo) => {
			if (!options.includeArchived && repo.isArchived) {
				return false;
			}
			if (options.excludePrivate && repo.isPrivate) {
				return false;
			}
			return true;
		});
	}

	private filterRepositoryNames(
		repos: Repository[],
		names?: string[],
	): Repository[] {
		if (!names || names.length === 0) {
			return repos;
		}
		const normalized = new Set(names.map((name) => name.toLowerCase()));
		return repos.filter((repo) => normalized.has(repo.name.toLowerCase()));
	}

	async getMembers(org: string, options: ScopeOptions): Promise<Member[]> {
		let members: Member[];
		if (options.teamSlug) {
			members = await this.fetchTeamMembers(org, options.teamSlug);
		} else if (options.memberLogins && options.memberLogins.length > 0) {
			members = await this.fetchSpecificMembers(options.memberLogins);
		} else {
			const users = await this.paginateMembers(org);
			members = users.map((user) => ({
				id: user.id,
				nodeId: user.node_id,
				login: user.login,
				displayName: user.login,
				isBot: user.type === "Bot",
				teamSlugs: [],
			}));
		}

		return this.filterMembers(members, options);
	}

	private async fetchTeamMembers(
		org: string,
		teamSlug: string,
	): Promise<Member[]> {
		let members;
		try {
			members = await this.octokit.paginate(
				this.octokit.rest.teams.listMembersInOrg,
				{
					org,
					team_slug: teamSlug,
					per_page: 100,
				},
			);
		} catch (error) {
			throw this.wrapError(
				error,
				`Unable to list members for team '${teamSlug}' in '${org}'. Check that the team exists and the token has team read access.`,
			);
		}
		return members.map((member) => ({
			id: member.id,
			nodeId: member.node_id,
			login: member.login,
			displayName: member.login,
			isBot: member.type === "Bot",
			teamSlugs: [teamSlug],
		}));
	}

	private async fetchSpecificMembers(logins: string[]): Promise<Member[]> {
		const unique = Array.from(
			new Set(logins.map((login) => login.trim()).filter(Boolean)),
		);
		const results: Member[] = [];
		for (const login of unique) {
			try {
				const { data } = await this.octokit.rest.users.getByUsername({
					username: login,
				});
				results.push({
					id: data.id,
					nodeId: data.node_id,
					login: data.login,
					displayName: data.name ?? data.login,
					isBot: data.type === "Bot",
					teamSlugs: [],
				});
			} catch (error) {
				throw this.wrapError(error, `Unable to resolve user '${login}'.`);
			}
		}
		return results;
	}

	private filterMembers(members: Member[], options: ScopeOptions): Member[] {
		return members.filter((member) => {
			if (!options.includeBots && member.isBot) {
				return false;
			}
			if (options.memberLogins && options.memberLogins.length > 0) {
				return options.memberLogins.includes(member.login);
			}
			return true;
		});
	}

	private async paginateMembers(org: string) {
		try {
			return await this.octokit.paginate(this.octokit.rest.orgs.listMembers, {
				org,
				per_page: 100,
				role: "all",
			});
		} catch (error) {
			throw this.wrapError(
				error,
				`Unable to list members for '${org}'. Verify that the organization exists and the token has 'Members: Read' permission.`,
			);
		}
	}

	private wrapError(error: unknown, context: string): Error {
		if (error && typeof error === "object") {
			const status = (error as { status?: number }).status;
			const message = this.extractErrorMessage(error);
			if (status) {
				return new Error(`${context} (HTTP ${status}: ${message}).`);
			}
			if (message) {
				return new Error(`${context} (${message}).`);
			}
		}

		if (error instanceof Error) {
			return new Error(`${context} (${error.message}).`);
		}

		return new Error(context);
	}

	private extractErrorMessage(error: unknown): string {
		if (!error || typeof error !== "object") {
			return "unknown error";
		}
		const direct = (error as { message?: string }).message;
		if (direct) {
			return direct;
		}
		const responseMessage = (
			error as { response?: { data?: { message?: string } } }
		).response?.data?.message;
		if (responseMessage) {
			return responseMessage;
		}
		return "unknown error";
	}
}
