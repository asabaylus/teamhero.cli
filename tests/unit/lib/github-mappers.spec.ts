import { describe, expect, it } from "bun:test";
import {
	toPrSearchItem,
	toRawCommit,
} from "../../../src/lib/github-mappers.js";

describe("toPrSearchItem", () => {
	it("maps a merged PR (closed with merged_at)", () => {
		const item = toPrSearchItem({
			number: 7,
			title: "Add thing",
			html_url: "https://github.com/the-org/repo-1/pull/7",
			state: "closed",
			pull_request: { merged_at: "2026-01-10T00:00:00Z" },
			user: { login: "login-a" },
			repository_url: "https://api.github.com/repos/the-org/repo-1",
		});
		expect(item).toEqual({
			authorLogin: "login-a",
			state: "closed",
			mergedAt: "2026-01-10T00:00:00Z",
			number: 7,
			title: "Add thing",
			url: "https://github.com/the-org/repo-1/pull/7",
			repo: "the-org/repo-1",
		});
	});

	it("maps a closed-unmerged PR (no merged_at)", () => {
		const item = toPrSearchItem({
			number: 8,
			state: "closed",
			pull_request: { merged_at: null },
			user: { login: "login-a" },
		});
		expect(item.state).toBe("closed");
		expect(item.mergedAt).toBeNull();
	});

	it("maps an open PR and tolerates missing fields", () => {
		const item = toPrSearchItem({ number: 9, state: "open" });
		expect(item.state).toBe("open");
		expect(item.mergedAt).toBeNull();
		expect(item.authorLogin).toBe("");
	});
});

describe("toRawCommit", () => {
	it("maps author email/name, author date, parent count, committer, and files", () => {
		const commit = toRawCommit(
			{
				sha: "abc123",
				parents: [{}],
				commit: {
					author: {
						name: "Person A",
						email: "person-a@example.com",
						date: "2026-01-15T12:00:00Z",
					},
					committer: { email: "person-a@example.com" },
				},
				files: [
					{ filename: "src/app.ts", additions: 100, deletions: 5 },
					{ filename: "data/dump.json", additions: 1000, deletions: 0 },
				],
			},
			"the-org/repo-1",
		);
		expect(commit).toEqual({
			repo: "the-org/repo-1",
			oid: "abc123",
			authorEmail: "person-a@example.com",
			authorName: "Person A",
			authoredAtISO: "2026-01-15T12:00:00Z",
			parentCount: 1,
			committerEmail: "person-a@example.com",
			files: [
				{ path: "src/app.ts", additions: 100, deletions: 5 },
				{ path: "data/dump.json", additions: 1000, deletions: 0 },
			],
		});
	});

	it("treats two parents as a merge and tolerates missing files", () => {
		const commit = toRawCommit(
			{
				sha: "m1",
				parents: [{}, {}],
				commit: { author: { date: "2026-01-01T00:00:00Z" } },
			},
			"the-org/repo-1",
		);
		expect(commit.parentCount).toBe(2);
		expect(commit.files).toBeUndefined();
	});
});
