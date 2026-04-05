import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { ScopeOptions } from "../../../src/core/types.js";
import { ScopeService } from "../../../src/services/scope.service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOctokit(overrides: Record<string, any> = {}) {
	return {
		rest: {
			orgs: {
				get: mock().mockResolvedValue({
					data: {
						id: 1,
						login: "acme",
						name: "Acme Inc",
						node_id: "ORG_1",
					},
				}),
				listMembers: Symbol("listMembers"),
			},
			repos: {
				listForOrg: Symbol("listForOrg"),
			},
			teams: {
				listMembersInOrg: Symbol("listMembersInOrg"),
			},
			users: {
				getByUsername: mock(),
			},
		},
		paginate: mock().mockResolvedValue([]),
		...overrides,
	} as any;
}

function makeDefaultOptions(
	overrides: Partial<ScopeOptions> = {},
): ScopeOptions {
	return {
		includeBots: false,
		includeArchived: false,
		excludePrivate: false,
		...overrides,
	};
}

function makeGitHubRepo(
	overrides: Partial<{
		id: number;
		name: string;
		private: boolean;
		archived: boolean;
	}> = {},
) {
	return {
		id: overrides.id ?? 1,
		name: overrides.name ?? "repo-a",
		private: overrides.private ?? false,
		archived: overrides.archived ?? false,
	};
}

function makeGitHubUser(
	overrides: Partial<{
		id: number;
		node_id: string;
		login: string;
		type: string;
		name: string | null;
	}> = {},
) {
	return {
		id: overrides.id ?? 100,
		node_id: overrides.node_id ?? "USER_100",
		login: overrides.login ?? "alice",
		type: overrides.type ?? "User",
		name: overrides.name ?? null,
	};
}

// ---------------------------------------------------------------------------
// getOrganization
// ---------------------------------------------------------------------------

describe("ScopeService", () => {
	describe("getOrganization", () => {
		it("returns mapped organization on success", async () => {
			const octokit = makeOctokit();
			const service = new ScopeService(octokit);
			const result = await service.getOrganization("acme");

			expect(result).toEqual({
				id: 1,
				login: "acme",
				name: "Acme Inc",
				nodeId: "ORG_1",
			});
		});

		it("uses login as name when name is null", async () => {
			const octokit = makeOctokit();
			octokit.rest.orgs.get.mockResolvedValue({
				data: { id: 2, login: "no-name", name: null, node_id: "ORG_2" },
			});
			const service = new ScopeService(octokit);
			const result = await service.getOrganization("no-name");

			expect(result.name).toBe("no-name");
		});

		it("wraps API error with status code", async () => {
			const octokit = makeOctokit();
			const apiError = Object.assign(new Error("Not Found"), { status: 404 });
			octokit.rest.orgs.get.mockRejectedValue(apiError);
			const service = new ScopeService(octokit);

			await expect(service.getOrganization("missing")).rejects.toThrow(
				/HTTP 404/,
			);
			await expect(service.getOrganization("missing")).rejects.toThrow(
				/Unable to fetch organization/,
			);
		});

		it("wraps API error without status code", async () => {
			const octokit = makeOctokit();
			octokit.rest.orgs.get.mockRejectedValue(new Error("Network failure"));
			const service = new ScopeService(octokit);

			await expect(service.getOrganization("offline")).rejects.toThrow(
				/Network failure/,
			);
			await expect(service.getOrganization("offline")).rejects.toThrow(
				/Unable to fetch organization/,
			);
		});

		it("wraps non-Error thrown values", async () => {
			const octokit = makeOctokit();
			octokit.rest.orgs.get.mockRejectedValue("raw string error");
			const service = new ScopeService(octokit);

			await expect(service.getOrganization("broken")).rejects.toThrow(
				/Unable to fetch organization/,
			);
		});
	});

	// ---------------------------------------------------------------------------
	// getRepositories
	// ---------------------------------------------------------------------------

	describe("getRepositories", () => {
		it("maps GitHub repos to Repository model", async () => {
			const octokit = makeOctokit();
			octokit.paginate.mockResolvedValue([
				makeGitHubRepo({
					id: 10,
					name: "web-app",
					private: true,
					archived: false,
				}),
			]);
			const service = new ScopeService(octokit);
			const result = await service.getRepositories(
				"acme",
				makeDefaultOptions(),
			);

			expect(result).toEqual([
				{
					id: 10,
					name: "web-app",
					isPrivate: true,
					isArchived: false,
					defaultBranch: "main",
				},
			]);
		});

		it("filters by repository names case-insensitively", async () => {
			const octokit = makeOctokit();
			octokit.paginate.mockResolvedValue([
				makeGitHubRepo({ name: "Alpha" }),
				makeGitHubRepo({ name: "beta" }),
				makeGitHubRepo({ name: "GAMMA" }),
			]);
			const service = new ScopeService(octokit);
			const result = await service.getRepositories(
				"acme",
				makeDefaultOptions({
					repositoryNames: ["alpha", "BETA"],
				}),
			);

			expect(result.map((r) => r.name)).toEqual(["Alpha", "beta"]);
		});

		it("returns all repos when repositoryNames is empty", async () => {
			const octokit = makeOctokit();
			octokit.paginate.mockResolvedValue([
				makeGitHubRepo({ name: "a" }),
				makeGitHubRepo({ name: "b" }),
			]);
			const service = new ScopeService(octokit);
			const result = await service.getRepositories(
				"acme",
				makeDefaultOptions({
					repositoryNames: [],
				}),
			);

			expect(result).toHaveLength(2);
		});

		it("returns all repos when repositoryNames is undefined", async () => {
			const octokit = makeOctokit();
			octokit.paginate.mockResolvedValue([
				makeGitHubRepo({ name: "a" }),
				makeGitHubRepo({ name: "b" }),
			]);
			const service = new ScopeService(octokit);
			const result = await service.getRepositories(
				"acme",
				makeDefaultOptions(),
			);

			expect(result).toHaveLength(2);
		});

		it("excludes archived repos when includeArchived is false", async () => {
			const octokit = makeOctokit();
			octokit.paginate.mockResolvedValue([
				makeGitHubRepo({ name: "active", archived: false }),
				makeGitHubRepo({ name: "old", archived: true }),
			]);
			const service = new ScopeService(octokit);
			const result = await service.getRepositories(
				"acme",
				makeDefaultOptions({
					includeArchived: false,
				}),
			);

			expect(result.map((r) => r.name)).toEqual(["active"]);
		});

		it("includes archived repos when includeArchived is true", async () => {
			const octokit = makeOctokit();
			octokit.paginate.mockResolvedValue([
				makeGitHubRepo({ name: "active", archived: false }),
				makeGitHubRepo({ name: "old", archived: true }),
			]);
			const service = new ScopeService(octokit);
			const result = await service.getRepositories(
				"acme",
				makeDefaultOptions({
					includeArchived: true,
				}),
			);

			expect(result).toHaveLength(2);
		});

		it("excludes private repos when excludePrivate is true", async () => {
			const octokit = makeOctokit();
			octokit.paginate.mockResolvedValue([
				makeGitHubRepo({ name: "public", private: false }),
				makeGitHubRepo({ name: "secret", private: true }),
			]);
			const service = new ScopeService(octokit);
			const result = await service.getRepositories(
				"acme",
				makeDefaultOptions({
					excludePrivate: true,
				}),
			);

			expect(result.map((r) => r.name)).toEqual(["public"]);
		});

		it("wraps API error on paginate failure", async () => {
			const octokit = makeOctokit();
			octokit.paginate.mockRejectedValue(
				Object.assign(new Error("Forbidden"), { status: 403 }),
			);
			const service = new ScopeService(octokit);

			await expect(
				service.getRepositories("acme", makeDefaultOptions()),
			).rejects.toThrow(/Unable to list repositories/);
		});
	});

	// ---------------------------------------------------------------------------
	// getMembers
	// ---------------------------------------------------------------------------

	describe("getMembers", () => {
		describe("default path: org members", () => {
			it("returns org members when no teamSlug or memberLogins", async () => {
				const octokit = makeOctokit();
				octokit.paginate.mockResolvedValue([
					makeGitHubUser({ id: 1, login: "alice", type: "User" }),
					makeGitHubUser({ id: 2, login: "bob", type: "User" }),
				]);
				const service = new ScopeService(octokit);
				const result = await service.getMembers("acme", makeDefaultOptions());

				expect(result).toHaveLength(2);
				expect(result[0]).toEqual(
					expect.objectContaining({
						id: 1,
						login: "alice",
						isBot: false,
						teamSlugs: [],
					}),
				);
			});

			it("filters out bots when includeBots is false", async () => {
				const octokit = makeOctokit();
				octokit.paginate.mockResolvedValue([
					makeGitHubUser({ login: "human", type: "User" }),
					makeGitHubUser({ login: "ci-bot", type: "Bot" }),
				]);
				const service = new ScopeService(octokit);
				const result = await service.getMembers(
					"acme",
					makeDefaultOptions({ includeBots: false }),
				);

				expect(result.map((m) => m.login)).toEqual(["human"]);
			});

			it("includes bots when includeBots is true", async () => {
				const octokit = makeOctokit();
				octokit.paginate.mockResolvedValue([
					makeGitHubUser({ login: "human", type: "User" }),
					makeGitHubUser({ login: "ci-bot", type: "Bot" }),
				]);
				const service = new ScopeService(octokit);
				const result = await service.getMembers(
					"acme",
					makeDefaultOptions({ includeBots: true }),
				);

				expect(result).toHaveLength(2);
			});

			it("wraps error on paginateMembers failure", async () => {
				const octokit = makeOctokit();
				octokit.paginate.mockRejectedValue(
					Object.assign(new Error("Forbidden"), { status: 403 }),
				);
				const service = new ScopeService(octokit);

				await expect(
					service.getMembers("acme", makeDefaultOptions()),
				).rejects.toThrow(/Unable to list members for 'acme'/);
			});
		});

		describe("teamSlug path", () => {
			it("fetches team members by slug", async () => {
				const octokit = makeOctokit();
				octokit.paginate.mockResolvedValue([
					makeGitHubUser({ login: "team-member", type: "User" }),
				]);
				const service = new ScopeService(octokit);
				const result = await service.getMembers(
					"acme",
					makeDefaultOptions({
						teamSlug: "engineering",
					}),
				);

				expect(octokit.paginate).toHaveBeenCalledWith(
					octokit.rest.teams.listMembersInOrg,
					expect.objectContaining({
						org: "acme",
						team_slug: "engineering",
						per_page: 100,
					}),
				);
				expect(result[0].teamSlugs).toEqual(["engineering"]);
			});

			it("wraps error on team fetch failure", async () => {
				const octokit = makeOctokit();
				octokit.paginate.mockRejectedValue(
					Object.assign(new Error("Not Found"), { status: 404 }),
				);
				const service = new ScopeService(octokit);

				await expect(
					service.getMembers(
						"acme",
						makeDefaultOptions({ teamSlug: "nonexistent" }),
					),
				).rejects.toThrow(/Unable to list members for team 'nonexistent'/);
			});
		});

		describe("memberLogins path", () => {
			it("fetches specific members by login", async () => {
				const octokit = makeOctokit();
				octokit.rest.users.getByUsername
					.mockResolvedValueOnce({
						data: makeGitHubUser({ id: 10, login: "alice", name: "Alice A" }),
					})
					.mockResolvedValueOnce({
						data: makeGitHubUser({ id: 20, login: "bob", name: null }),
					});
				const service = new ScopeService(octokit);
				const result = await service.getMembers(
					"acme",
					makeDefaultOptions({
						memberLogins: ["alice", "bob"],
					}),
				);

				expect(result).toHaveLength(2);
				expect(result[0].displayName).toBe("Alice A");
				expect(result[1].displayName).toBe("bob"); // fallback to login
			});

			it("deduplicates logins", async () => {
				const octokit = makeOctokit();
				octokit.rest.users.getByUsername.mockResolvedValue({
					data: makeGitHubUser({ login: "alice" }),
				});
				const service = new ScopeService(octokit);
				await service.getMembers(
					"acme",
					makeDefaultOptions({
						memberLogins: ["alice", "alice", " alice "],
					}),
				);

				// "alice" and " alice " (trimmed) are the same, so only 1 call
				expect(octokit.rest.users.getByUsername).toHaveBeenCalledTimes(1);
			});

			it("filters out empty logins after trimming", async () => {
				const octokit = makeOctokit();
				octokit.rest.users.getByUsername.mockResolvedValue({
					data: makeGitHubUser({ login: "alice" }),
				});
				const service = new ScopeService(octokit);
				await service.getMembers(
					"acme",
					makeDefaultOptions({
						memberLogins: ["alice", "", "  "],
					}),
				);

				expect(octokit.rest.users.getByUsername).toHaveBeenCalledTimes(1);
			});

			it("throws on first user fetch failure", async () => {
				const octokit = makeOctokit();
				octokit.rest.users.getByUsername
					.mockResolvedValueOnce({
						data: makeGitHubUser({ login: "alice" }),
					})
					.mockRejectedValueOnce(
						Object.assign(new Error("Not Found"), { status: 404 }),
					);
				const service = new ScopeService(octokit);

				await expect(
					service.getMembers(
						"acme",
						makeDefaultOptions({
							memberLogins: ["alice", "nonexistent"],
						}),
					),
				).rejects.toThrow(/Unable to resolve user 'nonexistent'/);
			});

			it("filters by memberLogins after fetch (respects exact match)", async () => {
				const octokit = makeOctokit();
				octokit.rest.users.getByUsername
					.mockResolvedValueOnce({
						data: makeGitHubUser({ login: "alice" }),
					})
					.mockResolvedValueOnce({
						data: makeGitHubUser({ login: "bob" }),
					});
				const service = new ScopeService(octokit);
				const result = await service.getMembers(
					"acme",
					makeDefaultOptions({
						memberLogins: ["alice", "bob"],
					}),
				);

				// filterMembers checks memberLogins.includes(member.login)
				expect(result.map((m) => m.login)).toEqual(["alice", "bob"]);
			});
		});
	});

	// ---------------------------------------------------------------------------
	// wrapError / extractErrorMessage
	// ---------------------------------------------------------------------------

	describe("wrapError and extractErrorMessage", () => {
		it("includes HTTP status when present on error object", async () => {
			const octokit = makeOctokit();
			octokit.rest.orgs.get.mockRejectedValue({
				status: 403,
				message: "Forbidden",
			});
			const service = new ScopeService(octokit);

			await expect(service.getOrganization("acme")).rejects.toThrow(
				/HTTP 403.*Forbidden/,
			);
		});

		it("extracts message from error.response.data.message", async () => {
			const octokit = makeOctokit();
			octokit.rest.orgs.get.mockRejectedValue({
				status: 422,
				response: { data: { message: "Validation failed" } },
			});
			const service = new ScopeService(octokit);

			// The direct .message is undefined, but status exists so it should still show status.
			// Actually let me trace: status=422 exists, message=undefined on the outer,
			// extractErrorMessage will find no direct .message, then check response.data.message = "Validation failed"
			// Actually wait -- the error object has no .message property at the top level (it's a plain object, not an Error).
			// extractErrorMessage checks (error as { message?: string }).message -> undefined
			// Then checks response.data.message -> "Validation failed"
			await expect(service.getOrganization("acme")).rejects.toThrow(
				/HTTP 422.*Validation failed/,
			);
		});

		it("falls back to 'unknown error' when no message found", async () => {
			const octokit = makeOctokit();
			octokit.rest.orgs.get.mockRejectedValue({ status: 500 });
			const service = new ScopeService(octokit);

			await expect(service.getOrganization("acme")).rejects.toThrow(
				/HTTP 500.*unknown error/,
			);
		});

		it("wraps Error instances with their message", async () => {
			const octokit = makeOctokit();
			octokit.rest.orgs.get.mockRejectedValue(new Error("Connection refused"));
			const service = new ScopeService(octokit);

			await expect(service.getOrganization("acme")).rejects.toThrow(
				/Connection refused/,
			);
		});

		it("handles non-object error values", async () => {
			const octokit = makeOctokit();
			octokit.rest.orgs.get.mockRejectedValue(null);
			const service = new ScopeService(octokit);

			// null is falsy, hits the bottom branch: return new Error(context)
			await expect(service.getOrganization("acme")).rejects.toThrow(
				/Unable to fetch organization/,
			);
		});

		it("handles error object with message but no status", async () => {
			const octokit = makeOctokit();
			octokit.rest.orgs.get.mockRejectedValue({ message: "timeout exceeded" });
			const service = new ScopeService(octokit);

			// error is an object with message but no status -> wrapError branch: message exists, status undefined
			// It goes to: if (message) return new Error(`${context} (${message}).`)
			await expect(service.getOrganization("acme")).rejects.toThrow(
				/timeout exceeded/,
			);
		});
	});
});
