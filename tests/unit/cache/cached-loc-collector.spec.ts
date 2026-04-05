import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as envMod from "../../../src/lib/env.js";
import * as pathsMod from "../../../src/lib/paths.js";
import * as unifiedLogMod from "../../../src/lib/unified-log.js";
import type { ContributorLocMetrics } from "../../../src/metrics/loc.rest.js";
import * as locRestMod from "../../../src/metrics/loc.rest.js";
import { mocked } from "../../helpers/mocked.js";

// Mock cacheDir(), unified log, env
let testCacheDir: string;

mock.module("../../../src/lib/paths.js", () => ({
	...pathsMod,
	cacheDir: () => testCacheDir,
}));

mock.module("../../../src/lib/unified-log.js", () => ({
	...unifiedLogMod,
	appendUnifiedLog: mock(),
}));

mock.module("../../../src/lib/env.js", () => ({
	...envMod,
	getEnv: mock(() => undefined),
}));

// Mock loc.rest.ts — collectRepoCommits, listOrgRepos, discoverOrgRepos
const collectRepoCommitsMock =
	mock<(...args: unknown[]) => Promise<Map<string, ContributorLocMetrics>>>();
const listOrgReposMock = mock<(...args: unknown[]) => Promise<string[]>>();
const discoverOrgReposMock =
	mock<
		(
			...args: unknown[]
		) => Promise<{ repos: string[]; defaultBranches: Record<string, string> }>
	>();
const collectLocMetricsRestMock =
	mock<(...args: unknown[]) => Promise<ContributorLocMetrics[]>>();

mock.module("../../../src/metrics/loc.rest.js", () => ({
	...locRestMod,
	collectRepoCommits: (...args: unknown[]) => collectRepoCommitsMock(...args),
	listOrgRepos: (...args: unknown[]) => listOrgReposMock(...args),
	discoverOrgRepos: (...args: unknown[]) => discoverOrgReposMock(...args),
	collectLocMetricsRest: (...args: unknown[]) =>
		collectLocMetricsRestMock(...args),
}));

afterAll(() => {
	mock.restore();
});

const { CachedLocCollector } = await import(
	"../../../src/adapters/cache/cached-loc-collector.js"
);
const { getEnv } = await import("../../../src/lib/env.js");

function makeRepoMap(
	entries: Array<{
		login: string;
		additions: number;
		deletions: number;
		commit_count: number;
	}>,
): Map<string, ContributorLocMetrics> {
	const map = new Map<string, ContributorLocMetrics>();
	for (const e of entries) {
		map.set(e.login, {
			login: e.login,
			additions: e.additions,
			deletions: e.deletions,
			net: e.additions - e.deletions,
			commit_count: e.commit_count,
			completed: {
				additions: e.additions,
				deletions: e.deletions,
				commit_count: e.commit_count,
			},
			inProgress: { additions: 0, deletions: 0, commit_count: 0 },
		});
	}
	return map;
}

describe("CachedLocCollector (per-repo caching)", () => {
	beforeEach(async () => {
		testCacheDir = await mkdtemp(join(tmpdir(), "teamhero-loc-cache-"));
		collectRepoCommitsMock.mockReset();
		listOrgReposMock.mockReset();
		discoverOrgReposMock.mockReset();
		collectLocMetricsRestMock.mockReset();
		mocked(getEnv).mockReturnValue(undefined);
	});

	afterEach(async () => {
		await rm(testCacheDir, { recursive: true, force: true });
	});

	it("delegates to collectRepoCommits per repo on cache miss", async () => {
		collectRepoCommitsMock.mockResolvedValue(
			makeRepoMap([
				{ login: "alice", additions: 100, deletions: 20, commit_count: 3 },
			]),
		);

		const collector = new CachedLocCollector();
		const result = await collector.collect({
			repos: ["acme/repo-a", "acme/repo-b"],
			sinceIso: "2025-01-01T00:00:00Z",
			untilIso: "2025-01-08T00:00:00Z",
			token: "ghp_test",
		});

		// Called once per repo
		expect(collectRepoCommitsMock).toHaveBeenCalledTimes(2);
		// Alice's metrics merged from both repos
		expect(result).toHaveLength(1);
		expect(result[0].additions).toBe(200);
		expect(result[0].deletions).toBe(40);
		expect(result[0].commit_count).toBe(6);
	});

	it("returns cached results without API calls on second run", async () => {
		collectRepoCommitsMock.mockResolvedValue(
			makeRepoMap([
				{ login: "bob", additions: 50, deletions: 10, commit_count: 2 },
			]),
		);

		const collector = new CachedLocCollector();
		const input = {
			repos: ["acme/repo-a"],
			sinceIso: "2025-01-01T00:00:00Z",
			untilIso: "2025-01-08T00:00:00Z",
			token: "ghp_test",
		};

		await collector.collect(input);
		expect(collectRepoCommitsMock).toHaveBeenCalledTimes(1);

		const result2 = await collector.collect(input);
		expect(collectRepoCommitsMock).toHaveBeenCalledTimes(1); // NOT called again
		expect(result2[0].additions).toBe(50);
	});

	it("only fetches new repos when adding to the list", async () => {
		// Repo A returns alice, repo B returns bob, repo C returns charlie
		collectRepoCommitsMock
			.mockResolvedValueOnce(
				makeRepoMap([
					{ login: "alice", additions: 100, deletions: 10, commit_count: 5 },
				]),
			)
			.mockResolvedValueOnce(
				makeRepoMap([
					{ login: "bob", additions: 80, deletions: 20, commit_count: 3 },
				]),
			)
			.mockResolvedValueOnce(
				makeRepoMap([
					{ login: "charlie", additions: 60, deletions: 5, commit_count: 2 },
				]),
			);

		const collector = new CachedLocCollector();
		const baseInput = {
			sinceIso: "2025-01-01T00:00:00Z",
			untilIso: "2025-01-08T00:00:00Z",
			token: "ghp_test",
		};

		// First call with repos A and B
		await collector.collect({
			...baseInput,
			repos: ["acme/repo-a", "acme/repo-b"],
		});
		expect(collectRepoCommitsMock).toHaveBeenCalledTimes(2);

		// Second call adds repo C — only C should be fetched
		const result = await collector.collect({
			...baseInput,
			repos: ["acme/repo-a", "acme/repo-b", "acme/repo-c"],
		});
		expect(collectRepoCommitsMock).toHaveBeenCalledTimes(3); // only 1 new call
		expect(result).toHaveLength(3); // alice, bob, charlie
	});

	it("merges overlapping contributors across repos correctly", async () => {
		collectRepoCommitsMock
			.mockResolvedValueOnce(
				makeRepoMap([
					{ login: "alice", additions: 100, deletions: 20, commit_count: 5 },
				]),
			)
			.mockResolvedValueOnce(
				makeRepoMap([
					{ login: "alice", additions: 50, deletions: 10, commit_count: 3 },
				]),
			);

		const collector = new CachedLocCollector();
		const result = await collector.collect({
			repos: ["acme/repo-a", "acme/repo-b"],
			sinceIso: "2025-01-01T00:00:00Z",
			untilIso: "2025-01-08T00:00:00Z",
			token: "ghp_test",
		});

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			login: "alice",
			additions: 150,
			deletions: 30,
			net: 120,
			commit_count: 8,
			completed: { additions: 150, deletions: 30, commit_count: 8 },
			inProgress: { additions: 0, deletions: 0, commit_count: 0 },
		});
	});

	it("bypasses all per-repo caches when flush is set", async () => {
		collectRepoCommitsMock.mockResolvedValue(
			makeRepoMap([
				{ login: "alice", additions: 10, deletions: 1, commit_count: 1 },
			]),
		);

		const collector = new CachedLocCollector({ flush: true });
		const input = {
			repos: ["acme/repo-a"],
			sinceIso: "2025-01-01T00:00:00Z",
			untilIso: "2025-01-08T00:00:00Z",
			token: "ghp_test",
		};

		await collector.collect(input);
		await collector.collect(input);

		// Both calls should hit the API
		expect(collectRepoCommitsMock).toHaveBeenCalledTimes(2);
	});

	it("bypasses cache for specific source flush", async () => {
		collectRepoCommitsMock.mockResolvedValue(
			makeRepoMap([
				{ login: "alice", additions: 10, deletions: 1, commit_count: 1 },
			]),
		);

		const collector = new CachedLocCollector({ flushSources: ["loc"] });
		const input = {
			repos: ["acme/repo-a"],
			sinceIso: "2025-01-01T00:00:00Z",
			untilIso: "2025-01-08T00:00:00Z",
			token: "ghp_test",
		};

		await collector.collect(input);
		await collector.collect(input);

		expect(collectRepoCommitsMock).toHaveBeenCalledTimes(2);
	});

	it("skips caching entirely in test mode", async () => {
		mocked(getEnv).mockReturnValue("1");

		const testResult: ContributorLocMetrics[] = [
			{
				login: "alice",
				additions: 10,
				deletions: 1,
				net: 9,
				commit_count: 1,
				completed: { additions: 10, deletions: 1, commit_count: 1 },
				inProgress: { additions: 0, deletions: 0, commit_count: 0 },
			},
		];
		collectLocMetricsRestMock.mockResolvedValue(testResult);

		const collector = new CachedLocCollector();
		const input = {
			repos: ["acme/repo-a"],
			sinceIso: "2025-01-01T00:00:00Z",
			untilIso: "2025-01-08T00:00:00Z",
			token: "ghp_test",
		};

		await collector.collect(input);
		await collector.collect(input);

		// In test mode, collectLocMetricsRest is called directly each time (no caching)
		expect(collectLocMetricsRestMock).toHaveBeenCalledTimes(2);
		// Per-repo collectRepoCommits is never used
		expect(collectRepoCommitsMock).not.toHaveBeenCalled();
	});

	it("resolves repos from org via discoverOrgRepos when no repos provided", async () => {
		discoverOrgReposMock.mockResolvedValue({
			repos: ["acme/repo-x"],
			defaultBranches: { "acme/repo-x": "main" },
		});
		collectRepoCommitsMock.mockResolvedValue(
			makeRepoMap([
				{ login: "alice", additions: 10, deletions: 1, commit_count: 1 },
			]),
		);

		const collector = new CachedLocCollector();
		const result = await collector.collect({
			org: "acme",
			sinceIso: "2025-01-01T00:00:00Z",
			untilIso: "2025-01-08T00:00:00Z",
			token: "ghp_test",
		});

		expect(discoverOrgReposMock).toHaveBeenCalledWith("acme", "ghp_test");
		expect(result).toHaveLength(1);
		expect(result[0].login).toBe("alice");
	});
});
