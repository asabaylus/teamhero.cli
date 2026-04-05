import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
	collectLocMetricsRest,
	collectRepoCommits,
} from "../../src/metrics/loc.rest.ts";
import expectedMetrics from "../fixtures/expected/loc.metrics.snapshot.json";
import fixtureCommits from "../fixtures/github/commits.json";
import fixtureRepos from "../fixtures/github/org-repos.json";

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload));
}

describe("collectLocMetricsRest", () => {
	beforeEach(() => {
		spyOn(global, "fetch").mockImplementation((input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.includes("/orgs/")) {
				return Promise.resolve(jsonResponse(fixtureRepos));
			}
			if (url.includes("/commits/") && !url.includes("?")) {
				const sha = url.split("/").pop();
				const match =
					fixtureCommits.find((commit) => commit.sha === sha) ??
					fixtureCommits[0];
				return Promise.resolve(jsonResponse(match));
			}
			if (url.includes("/commits")) {
				return Promise.resolve(jsonResponse(fixtureCommits));
			}
			return Promise.resolve(new Response("{}", { status: 404 }));
		});
	});

	afterEach(() => {
		// Restore the fetch spy without undoing mock.module() registrations
		(global.fetch as any).mockRestore?.();
	});

	it("aggregates additions/deletions correctly", async () => {
		const result = await collectLocMetricsRest({
			org: "test-org",
			sinceIso: "2025-09-01T00:00:00Z",
			untilIso: "2025-10-01T00:00:00Z",
			token: "dummy",
		});
		expect(result).toEqual(expectedMetrics);
		expect(result).toMatchSnapshot();
	});
});

describe("collectRepoCommits — default-branch only (no feature-branch pass)", () => {
	afterEach(() => {
		// Restore the fetch spy without undoing mock.module() registrations
		(global.fetch as any).mockRestore?.();
	});

	it("classifies all default-branch commits as completed with zeroed inProgress", async () => {
		spyOn(global, "fetch").mockImplementation((input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();

			if (url.includes("/commits") && url.includes("sha=main")) {
				return Promise.resolve(
					jsonResponse([
						{
							sha: "commit-A",
							stats: { additions: 50, deletions: 10 },
							commit: { author: { date: "2026-02-25T00:00:00Z" } },
							author: { login: "alice" },
						},
						{
							sha: "commit-B",
							stats: { additions: 200, deletions: 30 },
							commit: { author: { date: "2026-02-26T00:00:00Z" } },
							author: { login: "bob" },
						},
					]),
				);
			}

			return Promise.resolve(new Response("{}", { status: 404 }));
		});

		const result = await collectRepoCommits(
			"acme",
			"repo-a",
			"token",
			"2026-02-22T00:00:00Z",
			"2026-02-28T00:00:00Z",
			undefined,
			"main",
		);

		const alice = result.get("alice");
		expect(alice).toBeDefined();
		expect(alice!.additions).toBe(50);
		expect(alice!.completed.additions).toBe(50);
		expect(alice!.completed.deletions).toBe(10);
		expect(alice!.completed.commit_count).toBe(1);
		expect(alice!.inProgress.additions).toBe(0);
		expect(alice!.inProgress.commit_count).toBe(0);

		const bob = result.get("bob");
		expect(bob).toBeDefined();
		expect(bob!.additions).toBe(200);
		expect(bob!.completed.additions).toBe(200);
		expect(bob!.completed.deletions).toBe(30);
		expect(bob!.completed.commit_count).toBe(1);
		expect(bob!.inProgress.additions).toBe(0);
		expect(bob!.inProgress.commit_count).toBe(0);
	});

	it("does not call the branches API", async () => {
		const fetchSpy = spyOn(global, "fetch").mockImplementation(
			(input: RequestInfo | URL) => {
				const url = typeof input === "string" ? input : input.toString();

				if (url.includes("/commits")) {
					return Promise.resolve(
						jsonResponse([
							{
								sha: "commit-X",
								stats: { additions: 100, deletions: 20 },
								commit: { author: { date: "2026-02-25T00:00:00Z" } },
								author: { login: "carol" },
							},
						]),
					);
				}

				return Promise.resolve(new Response("{}", { status: 404 }));
			},
		);

		await collectRepoCommits(
			"acme",
			"repo-b",
			"token",
			"2026-02-22T00:00:00Z",
			"2026-02-28T00:00:00Z",
			undefined,
			"main",
		);

		const urls = fetchSpy.mock.calls.map(([input]) =>
			typeof input === "string" ? input : input.toString(),
		);
		expect(urls.every((u) => !u.includes("/branches"))).toBe(true);
	});
});
