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
