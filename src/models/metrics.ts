export interface ContributionMetricSet {
	memberLogin: string;
	commitsCount: number;
	prsOpenedCount: number;
	prsClosedCount: number;
	prsMergedCount: number;
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
