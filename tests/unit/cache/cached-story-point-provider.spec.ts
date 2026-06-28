import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ReportingWindow,
	StoryPointFetchResult,
	StoryPointOptions,
	StoryPointProvider,
	TaskTrackerMemberInput,
} from "../../../src/core/types.js";
import * as envMod from "../../../src/lib/env.js";
import * as pathsMod from "../../../src/lib/paths.js";
import * as unifiedLogMod from "../../../src/lib/unified-log.js";

let testCacheDir: string;

mock.module("../../../src/lib/paths.js", () => ({
	...pathsMod,
	cacheDir: () => testCacheDir,
}));
mock.module("../../../src/lib/unified-log.js", () => ({
	...unifiedLogMod,
	appendUnifiedLog: mock(),
}));
mock.module("../../../src/lib/env.js", () => ({
	...envMod,
	getEnv: mock(() => undefined),
}));

afterAll(() => mock.restore());

const { CachedStoryPointProvider } = await import(
	"../../../src/adapters/cache/cached-story-point-provider.js"
);

const MEMBERS: TaskTrackerMemberInput[] = [
	{ login: "jane", displayName: "Jane" },
];
const OPTIONS: StoryPointOptions = {
	projects: [
		{
			key: "PT",
			fieldId: "customfield_10617",
			jqlName: "Story point estimate",
		},
	],
};
// closed window — end date in the past
const CLOSED: ReportingWindow = {
	startISO: "2020-01-01T00:00:00Z",
	endISO: "2020-01-31T00:00:00Z",
};

function fakeInner(
	result: StoryPointFetchResult,
): StoryPointProvider & { calls: number } {
	return {
		calls: 0,
		enabled: true,
		async fetchCompletedStoryPoints() {
			(this as { calls: number }).calls += 1;
			return result;
		},
	} as StoryPointProvider & { calls: number };
}

const RESULT: StoryPointFetchResult = {
	byPerson: new Map([
		[
			"jane-doe",
			{
				status: "matched",
				totalPoints: 8,
				byProject: { PT: 8 },
				issueCount: 2,
			},
		],
	]),
	unmatchedAssignees: ["Stranger"],
};

beforeEach(async () => {
	testCacheDir = await mkdtemp(join(tmpdir(), "sp-cache-"));
});
afterEach(async () => {
	await rm(testCacheDir, { recursive: true, force: true });
});

describe("CachedStoryPointProvider", () => {
	it("misses then hits: inner is called once, second call served from cache", async () => {
		const inner = fakeInner(RESULT);
		const cached = new CachedStoryPointProvider(inner);

		const first = await cached.fetchCompletedStoryPoints(
			MEMBERS,
			CLOSED,
			OPTIONS,
		);
		const second = await cached.fetchCompletedStoryPoints(
			MEMBERS,
			CLOSED,
			OPTIONS,
		);

		expect(inner.calls).toBe(1);
		expect(second.byPerson.get("jane-doe")?.totalPoints).toBe(8);
		expect(second.unmatchedAssignees).toEqual(["Stranger"]);
		expect(first.byPerson.get("jane-doe")?.totalPoints).toBe(8);
	});

	it("flush invalidates the cache and re-fetches", async () => {
		const inner = fakeInner(RESULT);
		await new CachedStoryPointProvider(inner).fetchCompletedStoryPoints(
			MEMBERS,
			CLOSED,
			OPTIONS,
		);

		const flushed = new CachedStoryPointProvider(inner, {
			flushSources: ["storypoints"],
		});
		await flushed.fetchCompletedStoryPoints(MEMBERS, CLOSED, OPTIONS);

		expect(inner.calls).toBe(2);
	});

	it("reflects enabled from the inner provider", () => {
		expect(new CachedStoryPointProvider(fakeInner(RESULT)).enabled).toBe(true);
	});
});
