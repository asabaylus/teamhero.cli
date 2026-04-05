import { describe, expect, it, mock } from "bun:test";
import { MetricsService } from "../../src/services/metrics.service.js";

describe("MetricsService", () => {
	it("uses REST API data for all metrics", () => {
		const service = new MetricsService({ graphql: mock() } as any);
		const member = {
			id: 42,
			nodeId: "DEV42",
			login: "sanand",
			displayName: "Sanket Anand Lumata",
			isBot: false,
			teamSlugs: [],
		};
		const options = {
			organization: {
				id: 99,
				login: "lumatahealth",
				name: "Lumata Health",
				nodeId: "ORG99",
			},
			members: [member],
			repositories: [],
			since: "2025-09-20T00:00:00.000Z",
			until: "2025-09-27T23:59:59.000Z",
		};
		const commitHighlights = [
			{
				repoName: "platform",
				oid: "aaa0001",
				message: "branch commit",
				additions: 16,
				deletions: 4,
				committedAt: "2025-09-22T10:00:00Z",
				url: "",
			},
			{
				repoName: "platform",
				oid: "bbb0001",
				message: "pr commit 1",
				additions: 0,
				deletions: 0,
				committedAt: "2025-09-23T10:00:00Z",
				url: "",
			},
			{
				repoName: "platform",
				oid: "bbb0002",
				message: "pr commit 2",
				additions: 0,
				deletions: 0,
				committedAt: "2025-09-23T11:00:00Z",
				url: "",
			},
		];
		const commitTotals = {
			commits: 1,
			additions: 16,
			deletions: 4,
			highlights: commitHighlights,
		};
		const prTotals = {
			opened: 1,
			closed: 0,
			merged: 1,
			commits: 7,
			highlights: [
				{
					repoName: "platform",
					number: 1869,
					title: "Improve ingestion",
					bodyText: "",
					additions: 1450,
					deletions: 320,
					url: "https://github.com/lumatahealth/platform/pull/1869",
					mergedAt: "2025-09-25T12:00:00.000Z",
					state: "MERGED",
				},
			],
		};

		const result = (service as any).toMetricResult(
			member,
			null,
			options,
			commitTotals,
			prTotals,
		);

		// commitsCount uses deduplicated highlights (after collect() merges default-branch + PR commits)
		expect(result.metrics.commitsCount).toBe(3);
		expect(result.metrics.prsOpenedCount).toBe(1);
		expect(result.metrics.prsClosedCount).toBe(0);
		expect(result.metrics.prsMergedCount).toBe(1);
		expect(result.metrics.linesAdded).toBe(1450); // Max of PR highlights
		expect(result.metrics.linesDeleted).toBe(320);
	});

	it("correctly classifies pull request states (MERGED, CLOSED, OPEN)", () => {
		const service = new MetricsService({ rest: {} } as any);
		const member = {
			id: 1,
			nodeId: "DEV1",
			login: "testdev",
			displayName: "Test Developer",
			isBot: false,
			teamSlugs: [],
		};
		const options = {
			organization: {
				id: 1,
				login: "testorg",
				name: "Test Org",
				nodeId: "ORG1",
			},
			members: [member],
			repositories: [],
			since: "2025-10-01T00:00:00.000Z",
			until: "2025-10-10T23:59:59.000Z",
		};

		// REST API data for pull requests
		const prStats = {
			opened: 4,
			closed: 1,
			merged: 2,
			commits: 0,
			highlights: [
				{
					repoName: "repo",
					number: 1,
					title: "Merged with state field",
					bodyText: "",
					additions: 100,
					deletions: 10,
					url: "https://github.com/testorg/repo/pull/1",
					mergedAt: "2025-10-05T12:00:00.000Z",
					state: "MERGED" as const,
				},
				{
					repoName: "repo",
					number: 2,
					title: "Merged without state field",
					bodyText: "",
					additions: 50,
					deletions: 5,
					url: "https://github.com/testorg/repo/pull/2",
					mergedAt: "2025-10-06T12:00:00.000Z",
					state: "MERGED" as const,
				},
				{
					repoName: "repo",
					number: 3,
					title: "Closed without merge",
					bodyText: "",
					additions: 20,
					deletions: 2,
					url: "https://github.com/testorg/repo/pull/3",
					mergedAt: "2025-10-07T12:00:00.000Z",
					state: "CLOSED" as const,
				},
				{
					repoName: "repo",
					number: 4,
					title: "Open PR",
					bodyText: "",
					additions: 30,
					deletions: 3,
					url: "https://github.com/testorg/repo/pull/4",
					mergedAt: "",
					state: "OPEN" as const,
				},
			],
		};

		const result = (service as any).toMetricResult(
			member,
			null,
			options,
			undefined,
			prStats,
		);

		// Verify merged count
		expect(result.metrics.prsMergedCount).toBe(2);

		// Verify rawPullRequests contains all PRs with correct states
		expect(result.rawPullRequests).toHaveLength(4);

		const pr1 = result.rawPullRequests.find((pr: any) => pr.number === 1);
		expect(pr1?.state).toBe("MERGED");

		const pr2 = result.rawPullRequests.find((pr: any) => pr.number === 2);
		expect(pr2?.state).toBe("MERGED");

		const pr3 = result.rawPullRequests.find((pr: any) => pr.number === 3);
		expect(pr3?.state).toBe("CLOSED");

		const pr4 = result.rawPullRequests.find((pr: any) => pr.number === 4);
		expect(pr4?.state).toBe("OPEN");
	});
});
