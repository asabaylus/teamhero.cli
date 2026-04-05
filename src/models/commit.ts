export interface Commit {
	sha: string;
	author: string;
	committedDate: string;
	additions: number;
	deletions: number;
	repository: string;
}
