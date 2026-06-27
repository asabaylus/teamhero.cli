export interface ContributionMetricSet {
	memberLogin: string;
	commitsCount: number;
	prsOpenedCount: number;
	prsClosedCount: number;
	prsMergedCount: number;
	/**
	 * PRs closed without being merged, counted org-wide via the search API.
	 * Reported distinctly from `prsMergedCount` so abandoned PRs are never
	 * counted as delivered work. Optional during the migration to the Person
	 * model; populated by the reconciled collection path.
	 */
	prsClosedUnmergedCount?: number;
	/**
	 * Authored, non-merge commits per calendar month (`YYYY-MM`, UTC), attributed
	 * by author email/name matched locally to the Person. Optional during
	 * migration; populated by the reconciled collection path.
	 */
	commitsByMonth?: Record<string, number>;
	/**
	 * Total changed lines (additions + deletions) over authored non-merge
	 * commits, including data/generated files. Optional during migration.
	 */
	rawLoc?: number;
	/**
	 * Changed lines excluding data/generated files (the headline LoC). Optional
	 * during migration; populated by the reconciled collection path.
	 */
	codeLoc?: number;
	linesAdded: number;
	linesDeleted: number;
	linesAddedInProgress: number;
	linesDeletedInProgress: number;
	reviewsCount: number;
	reviewCommentsCount: number;
	approvalsCount: number;
	changesRequestedCount: number;
	commentedCount: number;
	windowStart: string;
	windowEnd: string;
}
