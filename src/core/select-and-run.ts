import type {
	FetchOptions,
	RepoProvider,
	SelectionResult,
	SelectionUI,
} from "./types.js";

export interface RunRepositorySelectionOptions {
	org: string;
	provider: RepoProvider;
	selectionUI: SelectionUI;
	fetchOptions?: FetchOptions;
	confirm?: {
		enabled: boolean;
		messageBuilder?: (context: ConfirmationContext) => string;
	};
}

export interface ConfirmationContext {
	org: string;
	selection: SelectionResult;
	selectedCount: number;
	availableCount: number;
	sample: string[];
}

export interface SelectionOutcome {
	repositories: string[] | undefined;
	availableCount: number;
}

export class SelectionCancelledError extends Error {
	constructor(message = "Repository selection cancelled") {
		super(message);
		this.name = "SelectionCancelledError";
	}
}

function dedupe(list: string[]): string[] {
	return Array.from(new Set(list));
}

function defaultConfirmMessage(context: ConfirmationContext): string {
	if (context.selection.type === "specific") {
		const samplePreview =
			context.sample.length > 0 ? ` (e.g. ${context.sample.join(", ")})` : "";
		return `Generate report for ${context.org} with ${context.selectedCount} repositories${samplePreview}?`;
	}
	return `Generate report for ${context.org} with all ${context.availableCount} repositories?`;
}

export async function runRepositorySelection(
	options: RunRepositorySelectionOptions,
): Promise<SelectionOutcome> {
	const fetchOptions = options.fetchOptions ?? {};
	const allRepositories = await options.provider.listRepositories(
		options.org,
		fetchOptions,
	);
	const available = dedupe(allRepositories);
	const selection = await options.selectionUI.selectRepositories(
		available,
		options.org,
	);

	if (selection.type === "cancelled") {
		throw new SelectionCancelledError();
	}

	let selectedRepos: string[] | undefined;
	if (selection.type === "specific") {
		const availableSet = new Set(available);
		const filtered = selection.repositories.filter((name) =>
			availableSet.has(name),
		);
		selectedRepos = filtered.length > 0 ? filtered : undefined;
	}

	const selectedCount = selectedRepos?.length ?? available.length;
	const confirmSettings = options.confirm ?? { enabled: true };

	if (confirmSettings.enabled) {
		const sampleSource = (selectedRepos ?? available).slice(0, 5);
		const messageBuilder =
			confirmSettings.messageBuilder ?? defaultConfirmMessage;
		const message = messageBuilder({
			org: options.org,
			selection,
			selectedCount,
			availableCount: available.length,
			sample: sampleSource,
		});
		const accepted = await options.selectionUI.confirm(message);
		if (!accepted) {
			throw new SelectionCancelledError("Report cancelled by user");
		}
	}

	return {
		repositories: selectedRepos,
		availableCount: available.length,
	};
}
