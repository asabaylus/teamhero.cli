import type { IdentityResolver } from "../core/types.js";
import type { Person } from "../models/person.js";
import { type FileLineChange, splitLoc } from "./code-loc.js";
import {
	attributeCommitsByMonth,
	isMergeCommit,
	type RawCommit,
} from "./commit-attribution.js";
import { type PrSearchItem, tallyPrs } from "./pr-search.js";

/**
 * Pure aggregator that combines the four reconciliation cores into per-Person
 * metrics. It performs no I/O — `collect()` fetches PR search items and commits
 * and hands them here — which is exactly why it can be tested directly against
 * the slice-02 golden fixture with no octokit mocking. See ADR-0001.
 */

/** Reconciled metrics for one canonical Person. */
export interface PersonMetrics {
	person: Person;
	/** Org-wide merged PRs, summed across all the Person's logins. */
	prsMerged: number;
	/** Org-wide PRs closed without merging, summed across logins. */
	prsClosedUnmerged: number;
	/** Org-wide open PRs created in window, summed across logins. */
	prsOpen: number;
	/** Authored non-merge commits per calendar month (`YYYY-MM`). */
	commitsByMonth: Record<string, number>;
	/** Total authored non-merge commits across all months. */
	commitsTotal: number;
	/** Total changed lines over authored non-merge commits (incl. data files). */
	rawLoc: number;
	/** Changed lines excluding data/generated files (headline LoC). */
	codeLoc: number;
}

/** Already-fetched inputs for {@link buildPersonMetrics}. */
export interface PersonMetricsInputs {
	/** PR search items keyed by author login (one entry per login queried). */
	prSearchItemsByLogin: Record<string, PrSearchItem[]>;
	/** Raw commits enumerated across all repos in the window. */
	commits: RawCommit[];
}

/** Author identity that matched no Person, with its commit count (reconciliation). */
export interface UnmappedAuthor {
	email?: string;
	name?: string;
	count: number;
}

export interface PersonMetricsResult {
	persons: PersonMetrics[];
	/** Commit authors that resolved to no Person — for the reconciliation report. */
	unmappedCommits: UnmappedAuthor[];
}

/** Combine resolver + PR search + commit attribution + LoC split into per-Person metrics. */
export function buildPersonMetrics(
	resolver: IdentityResolver,
	inputs: PersonMetricsInputs,
): PersonMetricsResult {
	const attribution = attributeCommitsByMonth(inputs.commits, resolver);

	// Aggregate each Person's changed files from their authored, non-merge commits.
	const filesByPerson = new Map<string, FileLineChange[]>();
	for (const commit of inputs.commits) {
		if (isMergeCommit(commit)) continue;
		const resolution = resolver.resolve({
			email: commit.authorEmail,
			name: commit.authorName,
		});
		if (resolution.type !== "resolved") continue;
		const list = filesByPerson.get(resolution.person.id) ?? [];
		if (commit.files) list.push(...commit.files);
		filesByPerson.set(resolution.person.id, list);
	}

	const persons: PersonMetrics[] = resolver.persons().map((person) => {
		const items = person.logins.flatMap(
			(login) => inputs.prSearchItemsByLogin[login] ?? [],
		);
		const prs = tallyPrs(items);
		const commits = attribution.byPerson.get(person.id);
		const loc = splitLoc(filesByPerson.get(person.id) ?? []);
		return {
			person,
			prsMerged: prs.merged,
			prsClosedUnmerged: prs.closedUnmerged,
			prsOpen: prs.open,
			commitsByMonth: commits?.commitsByMonth ?? {},
			commitsTotal: commits?.total ?? 0,
			rawLoc: loc.rawAdditions + loc.rawDeletions,
			codeLoc: loc.codeAdditions + loc.codeDeletions,
		};
	});

	return { persons, unmappedCommits: attribution.unmapped };
}
