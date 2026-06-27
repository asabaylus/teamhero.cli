import { describe, expect, it } from "bun:test";
import { buildPersonMetrics } from "../../../src/lib/person-metrics.js";
import { createIdentityResolver } from "../../../src/services/identity-resolver.service.js";
import {
	goldenCommits,
	goldenExpected,
	goldenExpectedUnmapped,
	goldenIdentityMap,
	goldenPrSearchItemsByLogin,
} from "../../fixtures/golden/identity-reconciliation.js";

/**
 * The pure aggregator is correct exactly when it reproduces the slice-02 golden
 * oracle from the same inputs collect() will fetch — no octokit mocking needed.
 */
describe("buildPersonMetrics — reconciled per-Person metrics", () => {
	const resolver = createIdentityResolver(goldenIdentityMap);
	const result = buildPersonMetrics(resolver, {
		prSearchItemsByLogin: goldenPrSearchItemsByLogin,
		commits: goldenCommits,
	});

	it("produces one entry per canonical Person", () => {
		expect(result.persons.map((p) => p.person.id).sort()).toEqual(
			Object.keys(goldenExpected).sort(),
		);
	});

	it("matches the golden expected metrics for every Person", () => {
		for (const id of Object.keys(goldenExpected)) {
			const got = result.persons.find((p) => p.person.id === id);
			if (!got) throw new Error(`missing person ${id}`);
			const expected = goldenExpected[id];
			expect({
				prsMerged: got.prsMerged,
				prsClosedUnmerged: got.prsClosedUnmerged,
				commitsByMonth: got.commitsByMonth,
				commitsTotal: got.commitsTotal,
				rawLoc: got.rawLoc,
				codeLoc: got.codeLoc,
			}).toEqual({
				prsMerged: expected.prsMerged,
				prsClosedUnmerged: expected.prsClosedUnmerged,
				commitsByMonth: expected.commitsByMonth,
				commitsTotal: expected.commitsTotal,
				rawLoc: expected.rawLoc,
				codeLoc: expected.codeLoc,
			});
		}
	});

	it("surfaces unmapped commit authors for reconciliation", () => {
		expect(result.unmappedCommits).toEqual(goldenExpectedUnmapped);
	});

	it("flags the fragmented lead as one Person with a summed PR count of 26", () => {
		const a = result.persons.find((p) => p.person.id === "person-a");
		expect(a?.person.hasMultipleLogins).toBe(true);
		expect((a?.prsMerged ?? 0) + (a?.prsClosedUnmerged ?? 0)).toBe(26);
	});
});
