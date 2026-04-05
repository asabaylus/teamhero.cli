export type ReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED";

export interface ReviewActivity {
	id: number;
	prNumber: number;
	reviewer: string;
	state: ReviewState;
	createdAt: string;
	commentCount: number;
}
