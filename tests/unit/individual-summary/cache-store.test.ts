import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IndividualSummaryCache } from "../../../src/lib/individual-cache.js";
import { buildContributorPayload } from "../../../src/models/individual-summary.js";
import {
	buildMemberMetricsFixture,
	buildReportingWindowFixture,
} from "../../helpers/fixtures/individual-summary.js";

const windowFixture = buildReportingWindowFixture();

function makePayload(login: string) {
	return buildContributorPayload({
		metrics: buildMemberMetricsFixture({ login, displayName: login }),
		window: windowFixture,
	});
}

describe("IndividualSummaryCache", () => {
	let cacheDir: string;
	let cache: IndividualSummaryCache;

	beforeEach(async () => {
		cacheDir = await mkdtemp(join(tmpdir(), "teamhero-cache-"));
		cache = new IndividualSummaryCache({ baseDir: cacheDir });
	});

	afterEach(async () => {
		// Remove files by reinitializing directory; cache class should clean up per test cases.
	});

	it("persists the summary payload to disk", async () => {
		const payload = makePayload("alpha");

		await cache.write({
			login: payload.contributor.login,
			payload,
			status: "completed",
			summary: "Alpha summary",
			usage: { promptTokens: 120, completionTokens: 80 },
		});

		const cachePath = join(cacheDir, "alpha.summary.json");
		const raw = JSON.parse(await readFile(cachePath, "utf-8"));

		expect(raw.status).toBe("completed");
		expect(raw.payload.contributor.login).toBe("alpha");
		expect(raw.summary).toBe("Alpha summary");
		expect(raw.usage).toEqual({ promptTokens: 120, completionTokens: 80 });
	});

	it("loads cached entries and exposes them via readAll", async () => {
		const alphaPayload = makePayload("alpha");
		const betaPayload = makePayload("beta");

		await cache.write({
			login: alphaPayload.contributor.login,
			payload: alphaPayload,
			status: "pending",
		});
		await cache.write({
			login: betaPayload.contributor.login,
			payload: betaPayload,
			status: "failed",
			error: "AI service unavailable",
		});

		const entries = await cache.readAll();

		expect(entries.size).toBe(2);
		expect(entries.get("alpha")?.status).toBe("pending");
		expect(entries.get("beta")?.error).toBe("AI service unavailable");
	});

	it("clears cached entries for a contributor", async () => {
		const payload = makePayload("alpha");

		await cache.write({
			login: payload.contributor.login,
			payload,
			status: "completed",
			summary: "Done",
		});
		await cache.clear("alpha");

		const entries = await cache.readAll();
		expect(entries.size).toBe(0);
	});
});
