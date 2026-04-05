import { describe, expect, it, mock } from "bun:test";
import {
	SelectionCancelledError,
	runRepositorySelection,
} from "../../src/core/select-and-run.ts";
import type {
	RepoProvider,
	SelectionResult,
	SelectionUI,
} from "../../src/core/types.ts";

function createRepoProvider(names: string[]): RepoProvider {
	return {
		async listRepositories() {
			return names;
		},
	} satisfies RepoProvider;
}

function createSelectionUI(
	result: SelectionResult,
	confirmValue = true,
): SelectionUI {
	return {
		async selectRepositories() {
			return result;
		},
		async confirm() {
			return confirmValue;
		},
	} satisfies SelectionUI;
}

describe("runRepositorySelection", () => {
	it("returns undefined repositories when UI chooses all", async () => {
		const provider = createRepoProvider(["api", "web"]);
		const ui = createSelectionUI({ type: "all" });
		const outcome = await runRepositorySelection({
			org: "acme",
			provider,
			selectionUI: ui,
			confirm: { enabled: true },
		});
		expect(outcome.repositories).toBeUndefined();
		expect(outcome.availableCount).toBe(2);
	});

	it("returns specific repositories when selected", async () => {
		const provider = createRepoProvider(["api", "web", "design"]);
		const confirm = mock().mockResolvedValue(true);
		const ui: SelectionUI = {
			async selectRepositories() {
				return { type: "specific", repositories: ["web", "api"] };
			},
			async confirm(message: string) {
				return confirm(message);
			},
		};

		const outcome = await runRepositorySelection({
			org: "acme",
			provider,
			selectionUI: ui,
			confirm: { enabled: true },
		});

		expect(outcome.repositories).toEqual(["web", "api"]);
		expect(confirm).toHaveBeenCalledWith(expect.stringContaining("acme"));
	});

	it("skips confirmation when disabled", async () => {
		const provider = createRepoProvider(["api"]);
		const ui = createSelectionUI({ type: "all" });
		const outcome = await runRepositorySelection({
			org: "acme",
			provider,
			selectionUI: ui,
			confirm: { enabled: false },
		});
		expect(outcome.repositories).toBeUndefined();
	});

	it("throws when user cancels selection", async () => {
		const provider = createRepoProvider(["api"]);
		const ui = createSelectionUI({ type: "cancelled" });
		await expect(
			runRepositorySelection({
				org: "acme",
				provider,
				selectionUI: ui,
				confirm: { enabled: true },
			}),
		).rejects.toBeInstanceOf(SelectionCancelledError);
	});
});
