/**
 * Synthetic golden fixture (REDACTED — placeholders only) for the Contributor
 * Identity Reconciliation engine. This is the committed acceptance oracle the
 * downstream collect() integration must reproduce; the real verified numbers
 * live in gitignored tests/fixtures/local/ and are cross-checked against GitHub
 * by hand (slice 02 HITL). See docs/issues/02-golden-fixture-verification.md.
 */
import type { RawCommit } from "../../../src/lib/commit-attribution.js";
import type { PrSearchItem } from "../../../src/lib/pr-search.js";
import type { IdentityMap } from "../../../src/models/person.js";

export const goldenIdentityMap: IdentityMap = [
	{
		// Fragmented lead: an active login plus a legacy account, one email.
		id: "person-a",
		name: "Person A",
		logins: ["login-a", "login-a-legacy"],
		emails: ["person-a@example.com"],
	},
	{
		id: "person-c",
		name: "Person C",
		logins: ["login-c"],
		emails: ["person-c@example.com"],
	},
	{
		// External (Vendor Pod) contributor committing under an unverified email.
		id: "person-d",
		name: "Person D",
		logins: ["login-d"],
		emails: ["person-d@vendor.example"],
		external: true,
	},
];

function prs(
	login: string,
	merged: number,
	closedUnmerged: number,
	open = 0,
): PrSearchItem[] {
	const items: PrSearchItem[] = [];
	let n = 0;
	for (let i = 0; i < merged; i++)
		items.push(pr(login, ++n, "closed", `2026-01-${(i % 27) + 1}T00:00:00Z`));
	for (let i = 0; i < closedUnmerged; i++)
		items.push(pr(login, ++n, "closed", null));
	for (let i = 0; i < open; i++) items.push(pr(login, ++n, "open", null));
	return items;
}
function pr(
	login: string,
	n: number,
	state: "open" | "closed",
	mergedAt: string | null,
): PrSearchItem {
	return {
		authorLogin: login,
		state,
		mergedAt,
		number: n,
		title: `${login} PR ${n}`,
		url: `https://example/${login}/pr/${n}`,
		repo: "the-org/repo-1",
	};
}

/**
 * PR search items per login. Person A's org-wide count is the union of both
 * accounts — 26 (25 merged + 1 closed-unmerged) — the corrected number behind
 * the 22→26 spreadsheet discrepancy. A zero-PR account would add nothing.
 */
export const goldenPrSearchItemsByLogin: Record<string, PrSearchItem[]> = {
	"login-a": prs("login-a", 24, 1),
	"login-a-legacy": prs("login-a-legacy", 1, 0),
	"login-c": prs("login-c", 2, 0, 1),
	"login-d": prs("login-d", 3, 0),
};

export const goldenCommits: RawCommit[] = [
	// Person A — two Jan commits, one Feb commit under a noreply email.
	{
		repo: "the-org/repo-1",
		oid: "a1",
		authorEmail: "person-a@example.com",
		authorName: "Person A",
		authoredAtISO: "2026-01-10T00:00:00Z",
		parentCount: 1,
		files: [{ path: "src/app.ts", additions: 100, deletions: 0 }],
	},
	{
		repo: "the-org/repo-1",
		oid: "a2",
		authorEmail: "person-a@example.com",
		authorName: "Person A",
		authoredAtISO: "2026-01-20T00:00:00Z",
		parentCount: 1,
		files: [
			{ path: "data/dump.json", additions: 1_000_000, deletions: 0 },
			{ path: "src/util.ts", additions: 20, deletions: 0 },
		],
	},
	{
		repo: "the-org/repo-1",
		oid: "a3",
		authorEmail: "999+login-a@users.noreply.github.com",
		authorName: "login-a",
		authoredAtISO: "2026-02-05T00:00:00Z",
		parentCount: 1,
		files: [{ path: "src/service.ts", additions: 30, deletions: 0 }],
	},
	// Excluded: a real merge commit (2 parents) and a web-flow/merge-button commit.
	{
		repo: "the-org/repo-1",
		oid: "merge1",
		authorEmail: "person-a@example.com",
		authoredAtISO: "2026-01-15T00:00:00Z",
		parentCount: 2,
		files: [{ path: "src/merged.ts", additions: 9999, deletions: 0 }],
	},
	{
		repo: "the-org/repo-1",
		oid: "webflow1",
		authorEmail: "person-a@example.com",
		authoredAtISO: "2026-01-18T00:00:00Z",
		parentCount: 1,
		committerEmail: "noreply@github.com",
		files: [{ path: "src/webflow.ts", additions: 8888, deletions: 0 }],
	},
	// Person D — a commit under an unverified external email GitHub would drop.
	{
		repo: "the-org/repo-2",
		oid: "d1",
		authorEmail: "person-d@vendor.example",
		authorName: "Person D",
		authoredAtISO: "2026-01-12T00:00:00Z",
		parentCount: 1,
		files: [{ path: "src/feature.ts", additions: 40, deletions: 0 }],
	},
	// Unmapped author — must surface in reconciliation, never as a zero Person.
	{
		repo: "the-org/repo-1",
		oid: "u1",
		authorEmail: "nobody@example.com",
		authorName: "Nobody",
		authoredAtISO: "2026-01-01T00:00:00Z",
		parentCount: 1,
		files: [{ path: "src/x.ts", additions: 5, deletions: 0 }],
	},
];

export interface ExpectedPersonMetrics {
	prsMerged: number;
	prsClosedUnmerged: number;
	commitsByMonth: Record<string, number>;
	commitsTotal: number;
	/** rawLoc / codeLoc as total changed lines (additions + deletions). */
	rawLoc: number;
	codeLoc: number;
}

export const goldenExpected: Record<string, ExpectedPersonMetrics> = {
	"person-a": {
		prsMerged: 25,
		prsClosedUnmerged: 1,
		commitsByMonth: { "2026-01": 2, "2026-02": 1 },
		commitsTotal: 3,
		rawLoc: 1_000_150, // 100 + 1_000_000 + 20 + 30
		codeLoc: 150, // data/dump.json excluded
	},
	"person-c": {
		prsMerged: 2,
		prsClosedUnmerged: 0,
		commitsByMonth: {},
		commitsTotal: 0,
		rawLoc: 0,
		codeLoc: 0,
	},
	"person-d": {
		prsMerged: 3,
		prsClosedUnmerged: 0,
		commitsByMonth: { "2026-01": 1 },
		commitsTotal: 1,
		rawLoc: 40,
		codeLoc: 40,
	},
};

export const goldenExpectedUnmapped = [
	{ email: "nobody@example.com", name: "Nobody", count: 1 },
];
