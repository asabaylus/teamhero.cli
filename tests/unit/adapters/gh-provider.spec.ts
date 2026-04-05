import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// We need to import the class under test AFTER setting env vars,
// because the constructor reads process.env.GITHUB_MAX_REPOSITORIES.
// We'll use dynamic import in tests that need specific env values.

// Counter for cache-busting dynamic imports
let importCounter = 0;

// ---------------------------------------------------------------------------
// parseMaxRepos — exported only indirectly (tested via constructor behavior)
// ---------------------------------------------------------------------------

describe("GitHubRepoProvider", () => {
	// Helper to create a mock Octokit with paginate returning given repos
	function makeMockOctokit(repos: any[] = []) {
		return {
			paginate: mock().mockResolvedValue(repos),
			rest: {
				repos: {
					listForOrg: Symbol("listForOrg"),
				},
			},
		} as any;
	}

	function makeRepo(
		overrides: Partial<{
			name: string;
			archived: boolean;
			private: boolean;
			pushed_at: string | null;
		}> = {},
	) {
		return {
			name: overrides.name ?? "repo-a",
			archived: overrides.archived ?? false,
			private: overrides.private ?? false,
			pushed_at:
				"pushed_at" in overrides ? overrides.pushed_at : "2026-02-01T00:00:00Z",
		};
	}

	let savedEnv: string | undefined;

	beforeEach(() => {
		savedEnv = process.env.GITHUB_MAX_REPOSITORIES;
		delete process.env.GITHUB_MAX_REPOSITORIES;
	});

	afterEach(() => {
		if (savedEnv !== undefined) {
			process.env.GITHUB_MAX_REPOSITORIES = savedEnv;
		} else {
			delete process.env.GITHUB_MAX_REPOSITORIES;
		}
	});

	// ---------------------------------------------------------------------------
	// parseMaxRepos (tested through constructor + listRepositories slicing)
	// ---------------------------------------------------------------------------

	describe("parseMaxRepos via constructor defaults", () => {
		it("uses fallback 100 when env var is not set", async () => {
			const { GitHubRepoProvider } = await import(
				`../../../src/adapters/github/gh-provider.js?bust=${importCounter++}`
			);
			const repos = Array.from({ length: 150 }, (_, i) =>
				makeRepo({ name: `repo-${i}` }),
			);
			const octokit = makeMockOctokit(repos);
			const provider = new GitHubRepoProvider(octokit);
			const result = await provider.listRepositories("org");
			expect(result).toHaveLength(100);
		});

		it("parses valid numeric env var", async () => {
			process.env.GITHUB_MAX_REPOSITORIES = "10";
			const { GitHubRepoProvider } = await import(
				`../../../src/adapters/github/gh-provider.js?bust=${importCounter++}`
			);
			const repos = Array.from({ length: 50 }, (_, i) =>
				makeRepo({ name: `repo-${i}` }),
			);
			const octokit = makeMockOctokit(repos);
			const provider = new GitHubRepoProvider(octokit);
			const result = await provider.listRepositories("org");
			expect(result).toHaveLength(10);
		});

		it("falls back for non-numeric string", async () => {
			process.env.GITHUB_MAX_REPOSITORIES = "not-a-number";
			const { GitHubRepoProvider } = await import(
				`../../../src/adapters/github/gh-provider.js?bust=${importCounter++}`
			);
			const repos = Array.from({ length: 150 }, (_, i) =>
				makeRepo({ name: `repo-${i}` }),
			);
			const octokit = makeMockOctokit(repos);
			const provider = new GitHubRepoProvider(octokit);
			const result = await provider.listRepositories("org");
			expect(result).toHaveLength(100);
		});

		it("falls back for empty string", async () => {
			process.env.GITHUB_MAX_REPOSITORIES = "";
			const { GitHubRepoProvider } = await import(
				`../../../src/adapters/github/gh-provider.js?bust=${importCounter++}`
			);
			const repos = Array.from({ length: 150 }, (_, i) =>
				makeRepo({ name: `repo-${i}` }),
			);
			const octokit = makeMockOctokit(repos);
			const provider = new GitHubRepoProvider(octokit);
			const result = await provider.listRepositories("org");
			expect(result).toHaveLength(100);
		});

		it("falls back for negative number", async () => {
			process.env.GITHUB_MAX_REPOSITORIES = "-5";
			const { GitHubRepoProvider } = await import(
				`../../../src/adapters/github/gh-provider.js?bust=${importCounter++}`
			);
			const repos = Array.from({ length: 150 }, (_, i) =>
				makeRepo({ name: `repo-${i}` }),
			);
			const octokit = makeMockOctokit(repos);
			const provider = new GitHubRepoProvider(octokit);
			const result = await provider.listRepositories("org");
			expect(result).toHaveLength(100);
		});

		it("falls back for zero", async () => {
			process.env.GITHUB_MAX_REPOSITORIES = "0";
			const { GitHubRepoProvider } = await import(
				`../../../src/adapters/github/gh-provider.js?bust=${importCounter++}`
			);
			const repos = Array.from({ length: 150 }, (_, i) =>
				makeRepo({ name: `repo-${i}` }),
			);
			const octokit = makeMockOctokit(repos);
			const provider = new GitHubRepoProvider(octokit);
			const result = await provider.listRepositories("org");
			expect(result).toHaveLength(100);
		});

		it("falls back for Infinity", async () => {
			process.env.GITHUB_MAX_REPOSITORIES = "Infinity";
			const { GitHubRepoProvider } = await import(
				`../../../src/adapters/github/gh-provider.js?bust=${importCounter++}`
			);
			const repos = Array.from({ length: 150 }, (_, i) =>
				makeRepo({ name: `repo-${i}` }),
			);
			const octokit = makeMockOctokit(repos);
			const provider = new GitHubRepoProvider(octokit);
			expect(await provider.listRepositories("org")).toHaveLength(100);
		});

		it("floors decimal env var values", async () => {
			process.env.GITHUB_MAX_REPOSITORIES = "3.9";
			const { GitHubRepoProvider } = await import(
				`../../../src/adapters/github/gh-provider.js?bust=${importCounter++}`
			);
			const repos = Array.from({ length: 10 }, (_, i) =>
				makeRepo({ name: `repo-${i}` }),
			);
			const octokit = makeMockOctokit(repos);
			const provider = new GitHubRepoProvider(octokit);
			const result = await provider.listRepositories("org");
			expect(result).toHaveLength(3);
		});

		it("prefers constructor option over env var", async () => {
			process.env.GITHUB_MAX_REPOSITORIES = "50";
			const { GitHubRepoProvider } = await import(
				`../../../src/adapters/github/gh-provider.js?bust=${importCounter++}`
			);
			const repos = Array.from({ length: 100 }, (_, i) =>
				makeRepo({ name: `repo-${i}` }),
			);
			const octokit = makeMockOctokit(repos);
			const provider = new GitHubRepoProvider(octokit, { defaultMaxRepos: 5 });
			const result = await provider.listRepositories("org");
			expect(result).toHaveLength(5);
		});
	});

	// ---------------------------------------------------------------------------
	// listRepositories
	// ---------------------------------------------------------------------------

	describe("listRepositories", () => {
		let GitHubRepoProvider: any;

		beforeEach(async () => {
			const mod = await import(
				`../../../src/adapters/github/gh-provider.js?bust=${importCounter++}`
			);
			GitHubRepoProvider = mod.GitHubRepoProvider;
		});

		it("calls octokit.paginate with correct parameters for defaults", async () => {
			const octokit = makeMockOctokit([]);
			const provider = new GitHubRepoProvider(octokit);
			await provider.listRepositories("my-org");

			expect(octokit.paginate).toHaveBeenCalledWith(
				octokit.rest.repos.listForOrg,
				{
					org: "my-org",
					type: "all",
					per_page: 100,
					sort: "pushed",
					direction: "desc",
				},
			);
		});

		it("uses type 'public' when includePrivate is false", async () => {
			const octokit = makeMockOctokit([]);
			const provider = new GitHubRepoProvider(octokit);
			await provider.listRepositories("my-org", { includePrivate: false });

			expect(octokit.paginate).toHaveBeenCalledWith(
				octokit.rest.repos.listForOrg,
				expect.objectContaining({ type: "public" }),
			);
		});

		it("uses sort 'full_name' and direction 'asc' for name sort", async () => {
			const octokit = makeMockOctokit([]);
			const provider = new GitHubRepoProvider(octokit);
			await provider.listRepositories("my-org", { sortBy: "name" });

			expect(octokit.paginate).toHaveBeenCalledWith(
				octokit.rest.repos.listForOrg,
				expect.objectContaining({ sort: "full_name", direction: "asc" }),
			);
		});

		it("filters out archived repos by default", async () => {
			const repos = [
				makeRepo({ name: "active", archived: false }),
				makeRepo({ name: "old", archived: true }),
			];
			const octokit = makeMockOctokit(repos);
			const provider = new GitHubRepoProvider(octokit);
			const result = await provider.listRepositories("org");
			expect(result).toEqual(["active"]);
		});

		it("includes archived repos when includeArchived is true", async () => {
			const repos = [
				makeRepo({ name: "active", archived: false }),
				makeRepo({ name: "old", archived: true }),
			];
			const octokit = makeMockOctokit(repos);
			const provider = new GitHubRepoProvider(octokit);
			const result = await provider.listRepositories("org", {
				includeArchived: true,
			});
			expect(result).toHaveLength(2);
			expect(result).toContain("old");
		});

		it("sorts by pushed_at descending by default", async () => {
			const repos = [
				makeRepo({ name: "old", pushed_at: "2026-01-01T00:00:00Z" }),
				makeRepo({ name: "newest", pushed_at: "2026-03-01T00:00:00Z" }),
				makeRepo({ name: "middle", pushed_at: "2026-02-01T00:00:00Z" }),
			];
			const octokit = makeMockOctokit(repos);
			const provider = new GitHubRepoProvider(octokit);
			const result = await provider.listRepositories("org");
			expect(result).toEqual(["newest", "middle", "old"]);
		});

		it("sorts by name alphabetically when sortBy is 'name'", async () => {
			const repos = [
				makeRepo({ name: "zebra" }),
				makeRepo({ name: "alpha" }),
				makeRepo({ name: "middle" }),
			];
			const octokit = makeMockOctokit(repos);
			const provider = new GitHubRepoProvider(octokit);
			const result = await provider.listRepositories("org", { sortBy: "name" });
			expect(result).toEqual(["alpha", "middle", "zebra"]);
		});

		it("treats null pushed_at as epoch 0 during sort", async () => {
			const repos = [
				makeRepo({ name: "has-date", pushed_at: "2026-01-01T00:00:00Z" }),
				makeRepo({ name: "no-date", pushed_at: null }),
			];
			const octokit = makeMockOctokit(repos);
			const provider = new GitHubRepoProvider(octokit);
			const result = await provider.listRepositories("org");
			expect(result).toEqual(["has-date", "no-date"]);
		});

		it("slices results to maxRepos from options", async () => {
			const repos = Array.from({ length: 20 }, (_, i) =>
				makeRepo({ name: `repo-${String(i).padStart(2, "0")}` }),
			);
			const octokit = makeMockOctokit(repos);
			const provider = new GitHubRepoProvider(octokit);
			const result = await provider.listRepositories("org", { maxRepos: 5 });
			expect(result).toHaveLength(5);
		});

		it("returns all repos when fewer than maxRepos", async () => {
			const repos = [makeRepo({ name: "only-one" })];
			const octokit = makeMockOctokit(repos);
			const provider = new GitHubRepoProvider(octokit);
			const result = await provider.listRepositories("org", { maxRepos: 100 });
			expect(result).toEqual(["only-one"]);
		});

		it("returns repo names (strings), not repo objects", async () => {
			const repos = [makeRepo({ name: "my-repo" })];
			const octokit = makeMockOctokit(repos);
			const provider = new GitHubRepoProvider(octokit);
			const result = await provider.listRepositories("org");
			expect(result).toEqual(["my-repo"]);
			expect(typeof result[0]).toBe("string");
		});

		it("returns empty array when no repos match", async () => {
			const repos = [makeRepo({ name: "archived", archived: true })];
			const octokit = makeMockOctokit(repos);
			const provider = new GitHubRepoProvider(octokit);
			const result = await provider.listRepositories("org");
			expect(result).toEqual([]);
		});
	});
});
