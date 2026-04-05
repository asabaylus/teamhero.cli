import { describe, expect, it } from "bun:test";
import { buildContributorPayload } from "../../../src/models/individual-summary.js";
import {
	buildAsanaTaskSummaryFixture,
	buildMemberMetricsFixture,
	buildReportingWindowFixture,
} from "../../helpers/fixtures/individual-summary.js";

describe("buildContributorPayload", () => {
	it("maps member metrics and Asana data into the contributor payload", () => {
		const metrics = buildMemberMetricsFixture();
		const window = buildReportingWindowFixture();

		const payload = buildContributorPayload({ metrics, window });

		expect(payload.contributor).toEqual({
			login: metrics.login,
			displayName: metrics.displayName,
		});
		expect(payload.reportingWindow).toEqual(window);

		expect(payload.pullRequests).toHaveLength(2);
		expect(payload.pullRequests[0]).toMatchObject({
			repo: "teamhero/cli",
			number: 42,
			title: "Improve report cache",
			status: "MERGED",
			description: "Adds weekly summary caching",
			url: "https://github.com/teamhero/cli/pull/42",
		});

		expect(payload.metrics).toMatchObject({
			commits: 4,
			prsTotal: 2,
			prsMerged: 1,
			linesAdded: 420,
			linesDeleted: 137,
			reviews: 3,
		});

		expect(payload.asana.tasks).toHaveLength(1);
		expect(payload.asana.status).toBe("matched");
	});

	it("captures integration status when no Asana match is available", () => {
		const metrics = buildMemberMetricsFixture({
			taskTracker: {
				status: "no-match",
				tasks: [],
				message: "No matching Asana profile",
			},
		});
		const window = buildReportingWindowFixture();

		const payload = buildContributorPayload({ metrics, window });

		expect(payload.asana.tasks).toEqual([]);
		expect(payload.asana.status).toBe("no-match");
		expect(payload.asana.message).toBe("No matching Asana profile");
	});

	it("falls back to empty PR list when no rawPullRequests are present", () => {
		const metrics = buildMemberMetricsFixture({ rawPullRequests: undefined });
		const window = buildReportingWindowFixture();

		const payload = buildContributorPayload({ metrics, window });

		expect(payload.pullRequests).toEqual([]);
	});

	it("ensures Asana tasks are cloned, avoiding accidental mutation", () => {
		const originalTask = buildAsanaTaskSummaryFixture();
		const metrics = buildMemberMetricsFixture({
			taskTracker: {
				status: "matched",
				matchType: "email",
				tasks: [originalTask],
			},
		});
		const window = buildReportingWindowFixture();

		const payload = buildContributorPayload({ metrics, window });

		expect(payload.asana.tasks[0]).not.toBe(originalTask);
		expect(payload.asana.tasks[0]).toEqual(originalTask);
	});
});
