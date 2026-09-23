import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	CompletedWorkFetchResult,
	JiraCompletedWorkProvider,
	StoryPointOptions,
} from "../../../src/core/types.js";
import * as envMod from "../../../src/lib/env.js";
import * as pathsMod from "../../../src/lib/paths.js";

let testCacheDir = "";
mock.module("../../../src/lib/paths.js", () => ({
	...pathsMod,
	cacheDir: () => testCacheDir,
}));
mock.module("../../../src/lib/env.js", () => ({
	...envMod,
	getEnv: mock(() => undefined),
}));
afterAll(() => mock.restore());

const { CachedCompletedWorkProvider } = await import(
	"../../../src/adapters/cache/cached-completed-work-provider.js"
);

const options: StoryPointOptions = {
	projects: [{ key: "PT", fieldId: "customfield_1", jqlName: "Story Points" }],
};
const result: CompletedWorkFetchResult = {
	items: [],
	unmatchedAssignees: [],
	warnings: [],
	complete: true,
};

beforeEach(async () => {
	testCacheDir = await mkdtemp(join(tmpdir(), "teamhero-completed-work-"));
});

describe("CachedCompletedWorkProvider", () => {
	it("reuses a completed-work result for the same rules and window", async () => {
		let calls = 0;
		const inner: JiraCompletedWorkProvider = {
			enabled: true,
			async fetchCompletedWork() {
				calls += 1;
				return result;
			},
		};
		const cached = new CachedCompletedWorkProvider(inner);
		const window = {
			startISO: "2020-01-01T00:00:00Z",
			endISO: "2020-01-08T00:00:00Z",
		};
		await cached.fetchCompletedWork(window, options);
		await cached.fetchCompletedWork(window, options);
		expect(calls).toBe(1);
	});
});
