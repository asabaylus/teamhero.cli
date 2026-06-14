import { describe, expect, it } from "bun:test";
import type { RawCommit } from "../../../src/lib/commit-attribution.js";
import {
	attributeCommitsByMonth,
	isMergeCommit,
	monthKey,
} from "../../../src/lib/commit-attribution.js";
import type { IdentityMap } from "../../../src/models/person.js";
import { createIdentityResolver } from "../../../src/services/identity-resolver.service.js";

const map: IdentityMap = [
	{
		id: "person-a",
		name: "Person A",
		logins: ["login-a"],
		emails: ["person-a@example.com"],
	},
	{
		// External (Vendor Pod) contributor committing under an unverified email.
		id: "person-b",
		name: "Person B",
		logins: ["login-b"],
		emails: ["person-b@vendor.example"],
		external: true,
	},
];
const resolver = createIdentityResolver(map);

function commit(over: Partial<RawCommit> & { oid: string }): RawCommit {
	return {
		repo: "the-org/repo-1",
		authorEmail: "person-a@example.com",
		authorName: "Person A",
		authoredAtISO: "2026-01-15T12:00:00Z",
		parentCount: 1,
		...over,
	};
}

describe("isMergeCommit", () => {
	it("flags commits with two or more parents", () => {
		expect(isMergeCommit({ parentCount: 2 })).toBe(true);
	});
	it("flags the GitHub merge/web-flow committer", () => {
		expect(
			isMergeCommit({ parentCount: 1, committerEmail: "noreply@github.com" }),
		).toBe(true);
	});
	it("does not flag a normal single-parent commit", () => {
		expect(
			isMergeCommit({ parentCount: 1, committerEmail: "dev@example.com" }),
		).toBe(false);
	});
});

describe("monthKey", () => {
	it("buckets by UTC calendar month", () => {
		expect(monthKey("2026-01-31T23:30:00Z")).toBe("2026-01");
		expect(monthKey("2026-02-01T00:00:00Z")).toBe("2026-02");
	});
});

describe("attributeCommitsByMonth", () => {
	it("attributes by author email and aggregates by month", () => {
		const result = attributeCommitsByMonth(
			[
				commit({ oid: "a1", authoredAtISO: "2026-01-10T00:00:00Z" }),
				commit({ oid: "a2", authoredAtISO: "2026-01-20T00:00:00Z" }),
				commit({ oid: "a3", authoredAtISO: "2026-02-03T00:00:00Z" }),
			],
			resolver,
		);
		const a = result.byPerson.get("person-a");
		expect(a?.total).toBe(3);
		expect(a?.commitsByMonth).toEqual({ "2026-01": 2, "2026-02": 1 });
		expect(result.unmapped).toEqual([]);
	});

	it("attributes a noreply-authored commit via the parsed login", () => {
		const result = attributeCommitsByMonth(
			[
				commit({
					oid: "n1",
					authorEmail: "999+login-a@users.noreply.github.com",
					authorName: "login-a",
				}),
			],
			resolver,
		);
		expect(result.byPerson.get("person-a")?.total).toBe(1);
	});

	it("captures a commit under an unverified external email (GitHub would drop it)", () => {
		const result = attributeCommitsByMonth(
			[
				commit({
					oid: "b1",
					authorEmail: "person-b@vendor.example",
					authorName: "Person B",
				}),
			],
			resolver,
		);
		expect(result.byPerson.get("person-b")?.total).toBe(1);
		expect(result.unmapped).toEqual([]);
	});

	it("excludes merge commits from the count", () => {
		const result = attributeCommitsByMonth(
			[
				commit({ oid: "m1", parentCount: 2 }),
				commit({ oid: "m2", committerEmail: "noreply@github.com" }),
				commit({ oid: "ok", authoredAtISO: "2026-01-05T00:00:00Z" }),
			],
			resolver,
		);
		expect(result.byPerson.get("person-a")?.total).toBe(1);
	});

	it("routes unknown author identities to the unmapped queue with counts", () => {
		const result = attributeCommitsByMonth(
			[
				commit({
					oid: "u1",
					authorEmail: "nobody@example.com",
					authorName: "Nobody",
				}),
				commit({
					oid: "u2",
					authorEmail: "nobody@example.com",
					authorName: "Nobody",
				}),
			],
			resolver,
		);
		expect(result.byPerson.size).toBe(0);
		expect(result.unmapped).toEqual([
			{ email: "nobody@example.com", name: "Nobody", count: 2 },
		]);
	});

	it("excludes bot authors — not counted and not surfaced as unmapped", () => {
		const result = attributeCommitsByMonth(
			[
				commit({
					oid: "bot1",
					authorEmail: "github-actions[bot]@users.noreply.github.com",
					authorName: "github-actions[bot]",
				}),
				commit({ oid: "ok", authoredAtISO: "2026-01-05T00:00:00Z" }),
			],
			resolver,
		);
		// Only the real commit counts; the bot is not in byPerson or unmapped.
		expect(result.byPerson.get("person-a")?.total).toBe(1);
		expect(result.unmapped).toEqual([]);
	});
});
