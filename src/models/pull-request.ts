export interface PullRequest {
	id: number;
	number: number;
	title: string;
	author: string;
	repository: string;
	mergedAt: string | null;
	createdAt: string;
}
