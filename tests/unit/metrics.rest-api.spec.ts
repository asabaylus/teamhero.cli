import { describe, expect, it, mock } from "bun:test";
import { MetricsService } from "../../src/services/metrics.service.js";

describe("MetricsService REST API Collection", () => {
	describe("collectCommitTotals", () => {
		it("collects commit statistics from repository default branch", async () => {
			const mockListCommits = mock().mockResolvedValue({
				data: [
					{
						sha: "abc123",
						commit: {
							message: "Add feature\n\nDetailed description",
							author: {
								date: "2025-10-05T12:00:00Z",
							},
						},
						author: {
							login: "dev1",
						},
						html_url: "https://github.com/org/repo/commit/abc123",
						stats: {
							additions: 100,
							deletions: 20,
						},
					},
					{
						sha: "def456",
						commit: {
							message: "Fix bug",
							author: {
								date: "2025-10-06T14:30:00Z",
							},
						},
						author: {
							login: "dev1",
						},
						html_url: "https://github.com/org/repo/commit/def456",
						stats: {
							additions: 50,
							deletions: 10,
						},
					},
					{
						sha: "ghi789",
						commit: {
							message: "Update docs",
							author: {
								date: "2025-10-07T09:15:00Z",
							},
						},
						author: {
							login: "dev2",
						},
						html_url: "https://github.com/org/repo/commit/ghi789",
						stats: {
							additions: 30,
							deletions: 5,
						},
					},
				],
			});

			const mockOctokit = {
				rest: {
					repos: {
						listCommits: mockListCommits,
					},
				},
			};

			const service = new MetricsService(mockOctokit as any);
			const result = await (service as any).collectCommitTotals(
				"org",
				[{ id: 1, name: "repo", isPrivate: false, isArchived: false }],
				"2025-10-04T00:00:00Z",
				"2025-10-10T23:59:59Z",
				5,
			);

			expect(mockListCommits).toHaveBeenCalled();
			expect(result.totals.size).toBe(2);

			const dev1Stats = result.totals.get("dev1");
			expect(dev1Stats).toBeDefined();
			expect(dev1Stats?.commits).toBe(2);
			expect(dev1Stats?.additions).toBe(0); // LOC not tracked in REST API
			expect(dev1Stats?.deletions).toBe(0); // LOC not tracked in REST API
			expect(dev1Stats?.highlights).toHaveLength(2);

			const dev2Stats = result.totals.get("dev2");
			expect(dev2Stats).toBeDefined();
			expect(dev2Stats?.commits).toBe(1);
			expect(dev2Stats?.additions).toBe(0); // LOC not tracked in REST API
			expect(dev2Stats?.deletions).toBe(0); // LOC not tracked in REST API
		});

		it("handles repositories without commits", async () => {
			const mockListCommits = mock().mockResolvedValue({
				data: [],
			});

			const mockOctokit = {
				rest: {
					repos: {
						listCommits: mockListCommits,
					},
				},
			};

			const service = new MetricsService(mockOctokit as any);
			const result = await (service as any).collectCommitTotals(
				"org",
				[{ id: 1, name: "empty-repo", isPrivate: false, isArchived: false }],
				"2025-10-04T00:00:00Z",
				"2025-10-10T23:59:59Z",
				5,
			);

			expect(result.totals.size).toBe(0);
			expect(result.warnings).toHaveLength(0);
		});

		it("aggregates commits across multiple repositories", async () => {
			const mockListCommits = mock()
				.mockResolvedValueOnce({
					data: [
						{
							sha: "abc123",
							commit: {
								message: "Commit in repo1",
								author: {
									date: "2025-10-05T12:00:00Z",
								},
							},
							author: {
								login: "dev1",
							},
							html_url: "https://github.com/org/repo1/commit/abc123",
							stats: {
								additions: 100,
								deletions: 20,
							},
						},
					],
				})
				.mockResolvedValueOnce({
					data: [
						{
							sha: "def456",
							commit: {
								message: "Commit in repo2",
								author: {
									date: "2025-10-06T14:30:00Z",
								},
							},
							author: {
								login: "dev1",
							},
							html_url: "https://github.com/org/repo2/commit/def456",
							stats: {
								additions: 50,
								deletions: 10,
							},
						},
					],
				});

			const mockOctokit = {
				rest: {
					repos: {
						listCommits: mockListCommits,
					},
				},
			};

			const service = new MetricsService(mockOctokit as any);
			const result = await (service as any).collectCommitTotals(
				"org",
				[
					{ id: 1, name: "repo1", isPrivate: false, isArchived: false },
					{ id: 2, name: "repo2", isPrivate: false, isArchived: false },
				],
				"2025-10-04T00:00:00Z",
				"2025-10-10T23:59:59Z",
				5,
			);

			expect(mockListCommits).toHaveBeenCalledTimes(2);
			const dev1Stats = result.totals.get("dev1");
			expect(dev1Stats?.commits).toBe(2);
			expect(dev1Stats?.additions).toBe(0); // LOC not tracked in REST API
			expect(dev1Stats?.deletions).toBe(0); // LOC not tracked in REST API
			expect(dev1Stats?.highlights).toHaveLength(2);
		});
	});

	describe("collectPullRequestTotals", () => {
		it("collects pull request statistics from repositories", async () => {
			const mockListPulls = mock().mockResolvedValue({
				data: [
					{
						number: 100,
						title: "Add feature",
						html_url: "https://github.com/org/repo/pull/100",
						state: "closed",
						created_at: "2025-10-05T10:00:00Z",
						merged_at: "2025-10-05T12:00:00Z",
						closed_at: "2025-10-05T12:00:00Z",
						updated_at: "2025-10-05T12:00:00Z",
						commits: 3,
						additions: 150,
						deletions: 30,
						body: "Feature implementation",
						user: {
							login: "dev1",
						},
					},
					{
						number: 101,
						title: "Fix bug",
						html_url: "https://github.com/org/repo/pull/101",
						state: "closed",
						created_at: "2025-10-06T12:00:00Z",
						merged_at: "2025-10-06T14:00:00Z",
						closed_at: "2025-10-06T14:00:00Z",
						updated_at: "2025-10-06T14:00:00Z",
						commits: 1,
						additions: 50,
						deletions: 10,
						body: "Bug fix",
						user: {
							login: "dev1",
						},
					},
					{
						number: 102,
						title: "Update docs",
						html_url: "https://github.com/org/repo/pull/102",
						state: "closed",
						created_at: "2025-10-07T09:00:00Z",
						merged_at: null,
						closed_at: "2025-10-07T10:00:00Z",
						updated_at: "2025-10-07T10:00:00Z",
						commits: 2,
						additions: 20,
						deletions: 5,
						body: "Documentation",
						user: {
							login: "dev2",
						},
					},
				],
			});

			const mockOctokit = {
				rest: {
					pulls: {
						list: mockListPulls,
					},
				},
			};

			const service = new MetricsService(mockOctokit as any);
			const result = await (service as any).collectPullRequestTotals(
				"org",
				[{ id: 1, name: "repo", isPrivate: false, isArchived: false }],
				"2025-10-04T00:00:00Z",
				"2025-10-10T23:59:59Z",
				5,
			);

			expect(mockListPulls).toHaveBeenCalled();
			expect(result.totals.size).toBe(2);

			const dev1Stats = result.totals.get("dev1");
			expect(dev1Stats).toBeDefined();
			expect(dev1Stats?.opened).toBe(2);
			expect(dev1Stats?.merged).toBe(2);
			expect(dev1Stats?.additions).toBe(200);
			expect(dev1Stats?.deletions).toBe(40);
			expect(dev1Stats?.highlights).toHaveLength(2);

			const dev2Stats = result.totals.get("dev2");
			expect(dev2Stats).toBeDefined();
			expect(dev2Stats?.opened).toBe(1);
			expect(dev2Stats?.merged).toBe(0); // Closed but not merged
			expect(dev2Stats?.additions).toBe(20);
			expect(dev2Stats?.deletions).toBe(5);

			// Verify total merged count
			expect(result.totalMergedOverall).toBe(2);
		});

		it("filters PRs by merge date within window", async () => {
			const mockListPulls = mock().mockResolvedValue({
				data: [
					{
						number: 100,
						title: "PR merged before window",
						html_url: "https://github.com/org/repo/pull/100",
						state: "closed",
						created_at: "2025-09-30T10:00:00Z", // Created before window
						merged_at: "2025-10-01T12:00:00Z", // Before window
						closed_at: "2025-10-01T12:00:00Z",
						updated_at: "2025-10-05T12:00:00Z", // Updated in window
						commits: 2,
						additions: 50,
						deletions: 10,
						body: "",
						user: { login: "dev1" },
					},
					{
						number: 101,
						title: "PR merged in window",
						html_url: "https://github.com/org/repo/pull/101",
						state: "closed",
						created_at: "2025-10-04T10:00:00Z", // Created in window
						merged_at: "2025-10-05T12:00:00Z", // In window
						closed_at: "2025-10-05T12:00:00Z",
						updated_at: "2025-10-05T12:00:00Z",
						commits: 5,
						additions: 100,
						deletions: 20,
						body: "",
						user: { login: "dev1" },
					},
					{
						number: 102,
						title: "PR closed in window",
						html_url: "https://github.com/org/repo/pull/102",
						state: "closed",
						created_at: "2025-10-05T10:00:00Z", // Created in window
						merged_at: null,
						closed_at: "2025-10-06T14:00:00Z", // Closed in window
						updated_at: "2025-10-06T14:00:00Z",
						commits: 3,
						additions: 30,
						deletions: 5,
						body: "",
						user: { login: "dev1" },
					},
					{
						number: 103,
						title: "PR still open",
						html_url: "https://github.com/org/repo/pull/103",
						state: "open",
						created_at: "2025-10-02T10:00:00Z", // Created before window
						merged_at: null,
						closed_at: null,
						updated_at: "2025-10-03T10:00:00Z", // Before window
						commits: 1,
						additions: 20,
						deletions: 2,
						body: "",
						user: { login: "dev1" },
					},
				],
			});

			const mockOctokit = {
				rest: {
					pulls: {
						list: mockListPulls,
					},
				},
			};

			const service = new MetricsService(mockOctokit as any);
			const result = await (service as any).collectPullRequestTotals(
				"org",
				[{ id: 1, name: "repo", isPrivate: false, isArchived: false }],
				"2025-10-04T00:00:00Z",
				"2025-10-10T23:59:59Z",
				5,
			);

			const dev1Stats = result.totals.get("dev1");
			expect(dev1Stats?.opened).toBe(2); // Only PRs 101 and 102 (merged/closed in window)
			expect(dev1Stats?.merged).toBe(1); // Only PR 101
			expect(result.totalMergedOverall).toBe(1);
		});

		it("aggregates PRs across multiple repositories", async () => {
			const mockListPulls = mock()
				.mockResolvedValueOnce({
					data: [
						{
							number: 100,
							title: "PR in repo1",
							html_url: "https://github.com/org/repo1/pull/100",
							state: "closed",
							created_at: "2025-10-05T10:00:00Z",
							merged_at: "2025-10-05T12:00:00Z",
							closed_at: "2025-10-05T12:00:00Z",
							updated_at: "2025-10-05T12:00:00Z",
							commits: 4,
							additions: 100,
							deletions: 20,
							body: "",
							user: { login: "dev1" },
						},
					],
				})
				.mockResolvedValueOnce({
					data: [
						{
							number: 200,
							title: "PR in repo2",
							html_url: "https://github.com/org/repo2/pull/200",
							state: "closed",
							created_at: "2025-10-06T12:00:00Z",
							merged_at: "2025-10-06T14:00:00Z",
							closed_at: "2025-10-06T14:00:00Z",
							updated_at: "2025-10-06T14:00:00Z",
							commits: 2,
							additions: 50,
							deletions: 10,
							body: "",
							user: { login: "dev1" },
						},
					],
				});

			const mockOctokit = {
				rest: {
					pulls: {
						list: mockListPulls,
					},
				},
			};

			const service = new MetricsService(mockOctokit as any);
			const result = await (service as any).collectPullRequestTotals(
				"org",
				[
					{ id: 1, name: "repo1", isPrivate: false, isArchived: false },
					{ id: 2, name: "repo2", isPrivate: false, isArchived: false },
				],
				"2025-10-04T00:00:00Z",
				"2025-10-10T23:59:59Z",
				5,
			);

			expect(mockListPulls).toHaveBeenCalledTimes(2);
			const dev1Stats = result.totals.get("dev1");
			expect(dev1Stats?.opened).toBe(2);
			expect(dev1Stats?.merged).toBe(2);
			expect(result.totalMergedOverall).toBe(2);
		});
	});

	describe("collect (integration)", () => {
		it("queries REST API for all metrics (no GraphQL)", async () => {
			const mockListCommits = mock().mockResolvedValue({
				data: [
					{
						sha: "abc123",
						commit: {
							message: "Commit",
							author: {
								date: "2025-10-05T12:00:00Z",
							},
						},
						author: {
							login: "dev1",
						},
						html_url: "https://github.com/org/repo/commit/abc123",
						stats: {
							additions: 100,
							deletions: 20,
						},
					},
				],
			});

			const mockListPulls = mock().mockResolvedValue({
				data: [
					{
						number: 100,
						title: "PR 100",
						html_url: "https://github.com/org/repo/pull/100",
						state: "closed",
						created_at: "2025-10-05T10:00:00Z",
						merged_at: "2025-10-05T12:00:00Z",
						closed_at: "2025-10-05T12:00:00Z",
						updated_at: "2025-10-05T12:00:00Z",
						commits: 3,
						additions: 150,
						deletions: 30,
						body: "",
						user: { login: "dev1" },
					},
					{
						number: 101,
						title: "PR 101",
						html_url: "https://github.com/org/repo/pull/101",
						state: "closed",
						created_at: "2025-10-06T12:00:00Z",
						merged_at: "2025-10-06T14:00:00Z",
						closed_at: "2025-10-06T14:00:00Z",
						updated_at: "2025-10-06T14:00:00Z",
						commits: 2,
						additions: 50,
						deletions: 10,
						body: "",
						user: { login: "dev1" },
					},
				],
			});

			const mockOctokit = {
				rest: {
					repos: {
						listCommits: mockListCommits,
					},
					pulls: {
						list: mockListPulls,
					},
				},
			};

			const service = new MetricsService(mockOctokit as any);
			const result = await service.collect({
				organization: {
					id: 1,
					login: "org",
					name: "Organization",
					nodeId: "ORG1",
				},
				members: [
					{
						id: 1,
						nodeId: "DEV1",
						login: "dev1",
						displayName: "Developer One",
						isBot: false,
						teamSlugs: [],
					},
				],
				repositories: [
					{ id: 1, name: "repo", isPrivate: false, isArchived: false },
				],
				since: "2025-10-04T00:00:00Z",
				until: "2025-10-10T23:59:59Z",
			});

			// Verify only REST API was called (2 calls: commits + PRs)
			expect(mockListCommits).toHaveBeenCalledTimes(1);
			expect(mockListPulls).toHaveBeenCalledTimes(1);

			// Verify the result includes REST API data
			expect(result.members).toHaveLength(1);
			expect(result.mergedTotal).toBe(2); // From REST API

			const member = result.members[0];
			expect(member.metrics.prsMergedCount).toBe(2); // From REST API
			expect(member.metrics.prsOpenedCount).toBe(2); // From REST API
			expect(member.metrics.linesAdded).toBe(200);
			expect(member.metrics.linesDeleted).toBe(40);
			expect(member.displayName).toBe("Developer One"); // From member input
		});

		it("derives LOC from PR details when list responses omit additions/deletions", async () => {
			const mockListCommits = mock().mockResolvedValue({ data: [] });
			const mockListPulls = mock().mockResolvedValue({
				data: [
					{
						number: 200,
						title: "Feature work on release branch",
						html_url: "https://github.com/org/repo/pull/200",
						state: "closed",
						created_at: "2025-10-06T12:00:00Z",
						merged_at: "2025-10-06T15:00:00Z",
						closed_at: "2025-10-06T15:00:00Z",
						updated_at: "2025-10-06T15:00:00Z",
						commits: 2,
						additions: 0,
						deletions: 0,
						body: "",
						user: { login: "dev1" },
					},
				],
			});
			const mockGetPull = mock().mockResolvedValue({
				data: {
					additions: 75,
					deletions: 15,
				},
			});
			const mockListPullCommits = mock().mockResolvedValue({ data: [] });

			const mockOctokit = {
				rest: {
					repos: {
						listCommits: mockListCommits,
					},
					pulls: {
						list: mockListPulls,
						get: mockGetPull,
						listCommits: mockListPullCommits,
					},
				},
			};

			const service = new MetricsService(mockOctokit as any);
			const result = await service.collect({
				organization: {
					id: 1,
					login: "org",
					name: "Organization",
					nodeId: "ORG1",
				},
				members: [
					{
						id: 1,
						nodeId: "DEV1",
						login: "dev1",
						displayName: "Developer One",
						isBot: false,
						teamSlugs: [],
					},
				],
				repositories: [
					{ id: 1, name: "repo", isPrivate: false, isArchived: false },
				],
				since: "2025-10-04T00:00:00Z",
				until: "2025-10-10T23:59:59Z",
			});

			expect(mockGetPull).toHaveBeenCalledWith({
				owner: "org",
				repo: "repo",
				pull_number: 200,
			});
			expect(result.members).toHaveLength(1);
			expect(result.members[0].metrics.linesAdded).toBe(75);
			expect(result.members[0].metrics.linesDeleted).toBe(15);
		});

		/*
		 * RULE: a pull request's commits count in the week the pull request merged — all of them,
		 * whenever they were written — and never in a week it was only opened, closed, or updated.
		 * See docs/adr/0002-credit-commits-to-merge-week.md. These tests guard that rule.
		 */
		describe("commit credit follows the pull request's merge week", () => {
			const commit = (sha: string, date: string) => ({
				sha,
				html_url: `https://github.com/org/repo/commit/${sha}`,
				commit: {
					message: `commit ${sha}`,
					author: { date },
					committer: { date },
				},
			});
			const WEEK = {
				since: "2025-10-04T00:00:00Z",
				until: "2025-10-10T23:59:59Z",
			};

			async function collectWith(
				pr: Record<string, unknown>,
				prCommits: ReturnType<typeof commit>[],
			) {
				const service = new MetricsService({
					rest: {
						repos: { listCommits: mock().mockResolvedValue({ data: [] }) },
						pulls: {
							list: mock().mockResolvedValue({
								data: [
									{
										html_url: "https://github.com/org/repo/pull/1",
										additions: 10,
										deletions: 1,
										body: "",
										user: { login: "dev1" },
										...pr,
									},
								],
							}),
							get: mock().mockResolvedValue({
								data: { additions: 10, deletions: 1 },
							}),
							listCommits: mock().mockResolvedValue({ data: prCommits }),
						},
					},
				} as any);
				const result = await service.collect({
					organization: {
						id: 1,
						login: "org",
						name: "Organization",
						nodeId: "ORG1",
					},
					members: [
						{
							id: 1,
							nodeId: "DEV1",
							login: "dev1",
							displayName: "Developer One",
							isBot: false,
							teamSlugs: [],
						},
					],
					repositories: [
						{ id: 1, name: "repo", isPrivate: false, isArchived: false },
					],
					...WEEK,
				});
				return result.members[0];
			}

			it("credits every commit of a PR merged this week, even commits written weeks earlier", async () => {
				const member = await collectWith(
					{
						number: 1,
						title: "Merged this week",
						state: "closed",
						created_at: "2025-09-11T12:00:00Z",
						merged_at: "2025-10-08T15:00:00Z",
						closed_at: "2025-10-08T15:00:00Z",
						updated_at: "2025-10-08T15:00:00Z",
					},
					[
						commit("old0001", "2025-09-11T10:00:00Z"),
						commit("old0002", "2025-09-15T10:00:00Z"),
						commit("new0001", "2025-10-07T10:00:00Z"),
					],
				);
				expect(member.metrics.commitsCount).toBe(3);
				expect(member.rawCommits?.map((c) => c.oid).sort()).toEqual([
					"new0001",
					"old0001",
					"old0002",
				]);
			});

			it("credits no commits for a PR closed this week without merging, even commits written this week", async () => {
				const member = await collectWith(
					{
						number: 1,
						title: "Stale branch closed during cleanup",
						state: "closed",
						created_at: "2025-09-11T12:00:00Z",
						merged_at: null,
						closed_at: "2025-10-08T15:00:00Z",
						updated_at: "2025-10-08T15:00:00Z",
					},
					[
						commit("old0001", "2025-09-11T10:00:00Z"),
						commit("new0001", "2025-10-07T10:00:00Z"),
					],
				);
				expect(member.metrics.commitsCount).toBe(0);
			});

			it("credits no commits for a PR opened this week that has not merged yet", async () => {
				const member = await collectWith(
					{
						number: 1,
						title: "Still open",
						state: "open",
						created_at: "2025-10-06T12:00:00Z",
						merged_at: null,
						closed_at: null,
						updated_at: "2025-10-09T15:00:00Z",
					},
					[commit("new0001", "2025-10-07T10:00:00Z")],
				);
				expect(member.metrics.commitsCount).toBe(0);
			});
		});

		/*
		 * The Commits count is uncapped, and a default-branch copy of a merged pull request
		 * (squash, rebase, or merge commit) never counts again on top of the pull request's
		 * own commits. See docs/adr/0002-credit-commits-to-merge-week.md.
		 */
		describe("commit count is uncapped and counts merged pull request work once", () => {
			const member = {
				id: 1,
				nodeId: "DEV1",
				login: "dev1",
				displayName: "Developer One",
				isBot: false,
				teamSlugs: [],
			};
			const defaultBranchCommit = (sha: string) => ({
				sha,
				html_url: `https://github.com/org/repo/commit/${sha}`,
				author: { login: "dev1" },
				commit: {
					message: `commit ${sha}`,
					author: { date: "2025-10-07T10:00:00Z" },
					committer: { date: "2025-10-07T10:00:00Z" },
				},
			});
			const branchCommit = (sha: string) => ({
				sha,
				html_url: `https://github.com/org/repo/commit/${sha}`,
				commit: {
					message: `commit ${sha}`,
					author: { date: "2025-09-20T10:00:00Z" },
					committer: { date: "2025-09-20T10:00:00Z" },
				},
			});

			function serviceWith(opts: {
				defaultBranch: ReturnType<typeof defaultBranchCommit>[];
				pulls?: Record<string, unknown>[];
				prCommits?: ReturnType<typeof branchCommit>[];
				/** Commits per PR number and REST page (1-based); overrides `prCommits`. */
				prCommitsFor?: (
					pullNumber: number,
					page: number,
				) => ReturnType<typeof branchCommit>[];
				/** Successive pages of `pulls.list`; overrides `pulls`. */
				pullPages?: Record<string, unknown>[][];
				mergedCopies?: Set<string>;
			}) {
				const pages = [];
				for (let i = 0; i < opts.defaultBranch.length; i += 100)
					pages.push(opts.defaultBranch.slice(i, i + 100));
				let page = 0;
				const graphql = mock(async (query: string) => {
					const repository: Record<string, unknown> = {};
					for (const match of query.matchAll(
						/(c\d+): object\(oid: "([0-9a-f]+)"\)/g,
					)) {
						const merged = opts.mergedCopies?.has(match[2]) ?? false;
						repository[match[1]] = {
							associatedPullRequests: {
								nodes: merged ? [{ merged: true, baseRefName: "dev" }] : [],
							},
						};
					}
					return { repository };
				});
				const service = new MetricsService({
					graphql,
					rest: {
						repos: {
							listCommits: mock(async () => ({ data: pages[page++] ?? [] })),
						},
						pulls: {
							list: opts.pullPages
								? mock(async ({ page }: { page: number }) => ({
										data: opts.pullPages?.[page - 1] ?? [],
									}))
								: mock().mockResolvedValue({ data: opts.pulls ?? [] }),
							get: mock().mockResolvedValue({
								data: { additions: 1, deletions: 0 },
							}),
							listCommits: mock(
								async ({
									pull_number,
									page,
								}: {
									pull_number: number;
									page?: number;
								}) => ({
									data: opts.prCommitsFor
										? opts.prCommitsFor(pull_number, page ?? 1)
										: (page ?? 1) === 1
											? (opts.prCommits ?? [])
											: [],
								}),
							),
						},
					},
				} as any);
				return { service, graphql };
			}

			const member2 = {
				...member,
				id: 2,
				nodeId: "DEV2",
				login: "dev2",
				displayName: "Developer Two",
			};
			const mergedPull = (
				number: number,
				login: string,
				baseRef: string,
			): Record<string, unknown> => ({
				number,
				title: `PR ${number}`,
				html_url: `https://github.com/org/repo/pull/${number}`,
				state: "closed",
				created_at: "2025-09-20T12:00:00Z",
				merged_at: "2025-10-07T12:00:00Z",
				closed_at: "2025-10-07T12:00:00Z",
				updated_at: "2025-10-07T12:00:00Z",
				additions: 1,
				deletions: 0,
				body: "",
				user: { login },
				base: { ref: baseRef },
			});

			const collect = (service: MetricsService) =>
				service.collect({
					organization: { id: 1, login: "org", name: "Org", nodeId: "ORG1" },
					members: [member, member2],
					repositories: [
						{
							id: 1,
							name: "repo",
							isPrivate: false,
							isArchived: false,
							defaultBranch: "dev",
						},
					],
					since: "2025-10-04T00:00:00Z",
					until: "2025-10-10T23:59:59Z",
				});

			it("counts every direct push, far past the 50-commit sample cap", async () => {
				const shas = Array.from({ length: 120 }, (_, i) =>
					`d${String(i).padStart(6, "0")}`.replace(/[^0-9a-f]/g, "a"),
				);
				const { service } = serviceWith({
					defaultBranch: shas.map(defaultBranchCommit),
				});
				const result = await collect(service);
				expect(result.members[0].metrics.commitsCount).toBe(120);
			});

			it("does not count a squash copy of a PR merged this week on top of the PR's commits", async () => {
				const { service } = serviceWith({
					defaultBranch: [
						defaultBranchCommit("5a0a5a0"),
						defaultBranchCommit("d1ec7aa"),
					],
					mergedCopies: new Set(["5a0a5a0"]),
					pulls: [
						{
							number: 7,
							title: "Merged with squash",
							html_url: "https://github.com/org/repo/pull/7",
							state: "closed",
							created_at: "2025-09-20T12:00:00Z",
							merged_at: "2025-10-07T12:00:00Z",
							closed_at: "2025-10-07T12:00:00Z",
							updated_at: "2025-10-07T12:00:00Z",
							additions: 1,
							deletions: 0,
							body: "",
							user: { login: "dev1" },
						},
					],
					prCommits: [
						branchCommit("b0000a1"),
						branchCommit("b0000a2"),
						branchCommit("b0000a3"),
					],
				});
				const result = await collect(service);
				// 3 PR commits + 1 direct push; the squash copy 5a0a5a0 is not counted.
				expect(result.members[0].metrics.commitsCount).toBe(4);
				expect(result.warnings.join("\n")).not.toContain("counted twice");
			});

			it("warns instead of dropping commits silently when GitHub GraphQL is unavailable", async () => {
				const service = new MetricsService({
					rest: {
						repos: {
							listCommits: mock()
								.mockResolvedValueOnce({
									data: [defaultBranchCommit("d1ec7aa")],
								})
								.mockResolvedValue({ data: [] }),
						},
						pulls: { list: mock().mockResolvedValue({ data: [] }) },
					},
				} as any);
				const result = await collect(service);
				expect(result.members[0].metrics.commitsCount).toBe(1);
				expect(result.warnings.join("\n")).toContain("may be counted twice");
			});

			it("credits no commits for a PR merged into a branch other than the default branch", async () => {
				// A stacked PR merged into a feature branch, and a promotion PR merged into a release
				// branch, both carry commits that count when they reach the default branch. Counting
				// them here too would count the same commits twice, often for the wrong person.
				const { service } = serviceWith({
					defaultBranch: [],
					pulls: [
						mergedPull(11, "dev1", "feat/stacked-base"),
						mergedPull(12, "dev2", "main"),
					],
					prCommitsFor: (number, page) =>
						page > 1
							? []
							: number === 11
								? [branchCommit("aaaa001"), branchCommit("aaaa002")]
								: [branchCommit("bbbb001"), branchCommit("aaaa001")],
				});
				const result = await collect(service);
				expect(result.members[0].metrics.commitsCount).toBe(0);
				expect(result.members[1].metrics.commitsCount).toBe(0);
			});

			it("counts a stacked PR's commits once, through the PR that reaches the default branch", async () => {
				const { service } = serviceWith({
					defaultBranch: [],
					pulls: [
						mergedPull(21, "dev1", "feat/stacked-base"),
						mergedPull(22, "dev2", "dev"),
					],
					prCommitsFor: (number, page) =>
						page > 1
							? []
							: number === 21
								? [branchCommit("cccc001"), branchCommit("cccc002")]
								: [
										branchCommit("cccc001"),
										branchCommit("cccc002"),
										branchCommit("dddd001"),
									],
				});
				const result = await collect(service);
				const total =
					result.members[0].metrics.commitsCount +
					result.members[1].metrics.commitsCount;
				expect(total).toBe(3);
			});

			it("counts every commit of a PR with more than 100 commits", async () => {
				const all = Array.from({ length: 130 }, (_, i) =>
					branchCommit(`e${i.toString(16).padStart(6, "0")}`),
				);
				const { service } = serviceWith({
					defaultBranch: [],
					pulls: [mergedPull(31, "dev1", "dev")],
					prCommitsFor: (_number, page) =>
						all.slice((page - 1) * 100, page * 100),
				});
				const result = await collect(service);
				expect(result.members[0].metrics.commitsCount).toBe(130);
			});

			it("counts a PR once when GitHub returns it on two pages", async () => {
				// The PR list is sorted by last update; a PR updated during the run moves and can
				// appear again on the next page.
				const pr = mergedPull(41, "dev1", "dev");
				// 99 PRs closed long ago but touched this week fill page 1, so the run reads page 2.
				const filler = Array.from({ length: 99 }, (_, i) => ({
					...mergedPull(1000 + i, "dev2", "dev"),
					merged_at: null,
					created_at: "2025-08-01T12:00:00Z",
					closed_at: "2025-08-02T12:00:00Z",
					updated_at: "2025-10-09T12:00:00Z",
				}));
				const { service } = serviceWith({
					defaultBranch: [],
					pullPages: [[...filler, pr], [pr]],
					prCommitsFor: (_number, page) =>
						page > 1 ? [] : [branchCommit("f000001"), branchCommit("f000002")],
				});
				const result = await collect(service);
				expect(result.members[0].metrics.prsMergedCount).toBe(1);
				expect(result.members[0].metrics.commitsCount).toBe(2);
			});
		});

		it("tracks LOC totals even when highlights are omitted and records PR detail failures", async () => {
			const mockListCommits = mock().mockResolvedValue({ data: [] });
			const mockListPulls = mock().mockResolvedValue({
				data: [
					{
						number: 300,
						title: "Large PR with many changes",
						html_url: "https://github.com/org/repo/pull/300",
						state: "closed",
						created_at: "2025-10-06T12:00:00Z",
						merged_at: "2025-10-06T14:00:00Z",
						closed_at: "2025-10-06T14:00:00Z",
						updated_at: "2025-10-06T14:00:00Z",
						commits: 2,
						additions: 0,
						deletions: 0,
						body: "",
						user: { login: "dev1" },
					},
				],
			});
			const mockGetPull = mock().mockRejectedValue(
				new Error("API unavailable"),
			);
			const mockListPullCommits = mock().mockResolvedValue({ data: [] });

			const mockOctokit = {
				rest: {
					repos: {
						listCommits: mockListCommits,
					},
					pulls: {
						list: mockListPulls,
						get: mockGetPull,
						listCommits: mockListPullCommits,
					},
				},
			};

			const service = new MetricsService(mockOctokit as any);
			const result = await service.collect({
				organization: {
					id: 1,
					login: "org",
					name: "Organization",
					nodeId: "ORG1",
				},
				members: [
					{
						id: 1,
						nodeId: "DEV1",
						login: "dev1",
						displayName: "Developer One",
						isBot: false,
						teamSlugs: [],
					},
				],
				repositories: [
					{ id: 1, name: "repo", isPrivate: false, isArchived: false },
				],
				since: "2025-10-04T00:00:00Z",
				until: "2025-10-10T23:59:59Z",
			});

			expect(result.errors).toContain(
				"Unable to load LOC for PR org/repo#300: API unavailable",
			);
			expect(result.members[0].metrics.linesAdded).toBe(0);
			expect(result.members[0].metrics.linesDeleted).toBe(0);
		});

		it("records commit collection failures and continues", async () => {
			const mockListCommits = mock().mockRejectedValue(
				new Error("GitHub API rate limit exceeded"),
			);

			const mockOctokit = {
				rest: {
					repos: {
						listCommits: mockListCommits,
					},
					pulls: {
						list: mock().mockResolvedValue({ data: [] }),
					},
				},
			};

			const service = new MetricsService(mockOctokit as any);

			const result = await service.collect({
				organization: {
					id: 1,
					login: "org",
					name: "Organization",
					nodeId: "ORG1",
				},
				members: [
					{
						id: 1,
						nodeId: "DEV1",
						login: "dev1",
						displayName: "Developer One",
						isBot: false,
						teamSlugs: [],
					},
				],
				repositories: [
					{ id: 1, name: "repo", isPrivate: false, isArchived: false },
				],
				since: "2025-10-04T00:00:00Z",
				until: "2025-10-10T23:59:59Z",
			});

			expect(result.errors).toContain(
				"Failed to collect commits for org/repo: GitHub API rate limit exceeded",
			);
			expect(result.warnings).toContain(
				"Skipped org/repo: GitHub API rate limit exceeded",
			);
			expect(result.members).toHaveLength(1);
			expect(result.members[0].metrics.linesAdded).toBe(0);
			expect(result.members[0].metrics.linesDeleted).toBe(0);
		});

		it("records pull request collection failures and continues", async () => {
			const mockListCommits = mock().mockResolvedValue({ data: [] });
			const mockListPulls = mock().mockRejectedValue(
				new Error("Network timeout"),
			);

			const mockOctokit = {
				rest: {
					repos: {
						listCommits: mockListCommits,
					},
					pulls: {
						list: mockListPulls,
					},
				},
			};

			const service = new MetricsService(mockOctokit as any);

			const result = await service.collect({
				organization: {
					id: 1,
					login: "org",
					name: "Organization",
					nodeId: "ORG1",
				},
				members: [
					{
						id: 1,
						nodeId: "DEV1",
						login: "dev1",
						displayName: "Developer One",
						isBot: false,
						teamSlugs: [],
					},
				],
				repositories: [
					{ id: 1, name: "repo", isPrivate: false, isArchived: false },
				],
				since: "2025-10-04T00:00:00Z",
				until: "2025-10-10T23:59:59Z",
			});

			expect(result.errors).toContain(
				"Failed to collect pull requests for org/repo: Network timeout",
			);
			expect(result.warnings).toContain("Skipped org/repo: Network timeout");
			expect(result.members).toHaveLength(1);
			expect(result.members[0].metrics.linesAdded).toBe(0);
			expect(result.members[0].metrics.linesDeleted).toBe(0);
		});
	});
});
