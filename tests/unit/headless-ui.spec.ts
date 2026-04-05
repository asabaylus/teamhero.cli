import { describe, expect, it } from "bun:test";
import { HeadlessSelectionUI } from "../../src/adapters/ui/headless-ui.ts";

const repos = ["api", "web", "design-system"];

describe("HeadlessSelectionUI", () => {
	it("returns all when selectAll option is true", async () => {
		const ui = new HeadlessSelectionUI({ selectAll: true });
		const result = await ui.selectRepositories(repos, "acme");
		expect(result).toEqual({ type: "all" });
	});

	it("returns provided repositories when they exist", async () => {
		const ui = new HeadlessSelectionUI({ repositories: ["web", "api"] });
		const result = await ui.selectRepositories(repos, "acme");
		expect(result).toEqual({ type: "specific", repositories: ["web", "api"] });
	});

	it("filters unknown repositories and falls back to all when none match", async () => {
		const ui = new HeadlessSelectionUI({ repositories: ["unknown"] });
		const result = await ui.selectRepositories(repos, "acme");
		expect(result).toEqual({ type: "all" });
	});

	it("always confirms without prompting", async () => {
		const ui = new HeadlessSelectionUI();
		await expect(ui.confirm("any")).resolves.toBe(true);
	});
});
