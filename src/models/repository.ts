export interface Repository {
	id: number;
	name: string;
	isPrivate: boolean;
	isArchived: boolean;
	defaultBranch: string;
}
