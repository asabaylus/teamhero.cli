import { describe, expect, it } from "bun:test";
import { type FileLineChange, splitLoc } from "../../../src/lib/code-loc.js";
import {
	attributeCommitsByMonth,
	isMergeCommit,
	monthKey,
} from "../../../src/lib/commit-attribution.js";
import { tallyPrs } from "../../../src/lib/pr-search.js";
import { createIdentityResolver } from "../../../src/services/identity-resolver.service.js";
import {
	goldenCommits,
	goldenExpected,
	goldenExpectedUnmapped,
	goldenIdentityMap,
	goldenPrSearchItemsByLogin,
} from "../../fixtures/golden/identity-reconciliation.js";

/**
 * The acceptance oracle: every shipped core, run over the synthetic golden
 * inputs, must reproduce the expected per-Person numbers. The collect()
 * integration (slice 3-5 wiring) is correct exactly when it produces these.
 */
describe("golden fixture — cores reproduce expected per-Person metrics", () => {
	const resolver = createIdentityResolver(goldenIdentityMap);
	const personIds = Object.keys(goldenExpected);

	it("resolves the identity map to the expected Persons", () => {
		expect(
			resolver
				.persons()
				.map((p) => p.id)
				.sort(),
		).toEqual([...personIds].sort());
	});

	it("reproduces PR counts (merged vs closed-unmerged) summed across logins", () => {
		for (const id of personIds) {
			const person = resolver.persons().find((p) => p.id === id);
			if (!person) throw new Error(`missing person ${id}`);
			const items = person.logins.flatMap(
				(login) => goldenPrSearchItemsByLogin[login] ?? [],
			);
			const counts = tallyPrs(items);
			expect({
				merged: counts.merged,
				closedUnmerged: counts.closedUnmerged,
			}).toEqual({
				merged: goldenExpected[id].prsMerged,
				closedUnmerged: goldenExpected[id].prsClosedUnmerged,
			});
		}
	});

	it("reproduces monthly commit totals and routes unmapped authors", () => {
		const attribution = attributeCommitsByMonth(goldenCommits, resolver);
		for (const id of personIds) {
			const totals = attribution.byPerson.get(id);
			const expected = goldenExpected[id];
			expect(totals?.commitsByMonth ?? {}).toEqual(expected.commitsByMonth);
			expect(totals?.total ?? 0).toBe(expected.commitsTotal);
		}
		expect(attribution.unmapped).toEqual(goldenExpectedUnmapped);
	});

	it("reproduces raw vs code LoC over authored non-merge commits", () => {
		// Aggregate each Person's files from their authored, non-merge commits —
		// the same aggregation collect() will perform.
		const filesByPerson = new Map<string, FileLineChange[]>();
		for (const commit of goldenCommits) {
			if (isMergeCommit(commit)) continue;
			const resolution = resolver.resolve({
				email: commit.authorEmail,
				name: commit.authorName,
			});
			if (resolution.type !== "resolved") continue;
			const list = filesByPerson.get(resolution.person.id) ?? [];
			list.push(...(commit.files ?? []));
			filesByPerson.set(resolution.person.id, list);
		}

		for (const id of personIds) {
			const split = splitLoc(filesByPerson.get(id) ?? []);
			const rawLoc = split.rawAdditions + split.rawDeletions;
			const codeLoc = split.codeAdditions + split.codeDeletions;
			expect({ rawLoc, codeLoc }).toEqual({
				rawLoc: goldenExpected[id].rawLoc,
				codeLoc: goldenExpected[id].codeLoc,
			});
		}
	});

	it("buckets commit months in UTC", () => {
		expect(monthKey(goldenCommits[0].authoredAtISO)).toBe("2026-01");
	});
});
