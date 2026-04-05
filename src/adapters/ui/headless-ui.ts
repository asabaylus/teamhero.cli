import type { SelectionResult, SelectionUI } from "../../core/types.js";

export interface HeadlessSelectionOptions {
	selectAll?: boolean;
	repositories?: string[];
}

export class HeadlessSelectionUI implements SelectionUI {
	constructor(private readonly options: HeadlessSelectionOptions = {}) {}

	async selectRepositories(
		repositories: string[],
		_organization: string,
	): Promise<SelectionResult> {
		if (this.options.selectAll || repositories.length === 0) {
			return { type: "all" };
		}

		const provided = this.options.repositories?.filter(Boolean) ?? [];
		if (provided.length === 0) {
			return { type: "all" };
		}

		const available = new Set(repositories);
		const picked = provided.filter((name) => available.has(name));

		if (picked.length === 0) {
			return { type: "all" };
		}

		return { type: "specific", repositories: picked };
	}

	async confirm(): Promise<boolean> {
		return true;
	}
}
