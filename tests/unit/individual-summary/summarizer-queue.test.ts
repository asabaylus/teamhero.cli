import { describe, expect, it, mock } from "bun:test";
import { buildContributorPayload } from "../../../src/models/individual-summary.js";
import { IndividualSummarizerService } from "../../../src/services/individual-summarizer.service.js";
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

describe("IndividualSummarizerService", () => {
	it("batches payloads according to configured batch size", async () => {
		const driver = mock(async (batch: any[]) =>
			batch.map((payload: any) => ({
				login: payload.contributor.login,
				summary: `Summary for ${payload.contributor.login}`,
			})),
		);

		const service = new IndividualSummarizerService({ driver, batchSize: 2 });
		const payloads = [
			makePayload("alpha"),
			makePayload("beta"),
			makePayload("gamma"),
		];

		const result = await service.process(payloads);

		expect(driver).toHaveBeenCalledTimes(2);
		expect(driver.mock.calls[0][0]).toHaveLength(2);
		expect(driver.mock.calls[1][0]).toHaveLength(1);
		expect(result.get("alpha")?.status).toBe("completed");
		expect(result.get("gamma")?.summary).toBe("Summary for gamma");
	});

	it("retries batches that fail with a rate-limit error", async () => {
		let firstAttempt = true;
		const driver = mock(async (batch: any[]) => {
			if (firstAttempt) {
				firstAttempt = false;
				const error: any = new Error("Too Many Requests");
				error.status = 429;
				throw error;
			}
			return batch.map((payload: any) => ({
				login: payload.contributor.login,
				summary: `Summary for ${payload.contributor.login}`,
			}));
		});

		const service = new IndividualSummarizerService({
			driver,
			batchSize: 2,
			maxRetries: 2,
		});
		const payloads = [makePayload("alpha"), makePayload("beta")];

		const result = await service.process(payloads);

		expect(driver).toHaveBeenCalledTimes(2);
		expect(result.get("alpha")?.status).toBe("completed");
	});

	it("flags failures after exhausting retries", async () => {
		const driver = mock(async () => {
			const error: any = new Error("Bad Gateway");
			error.status = 502;
			throw error;
		});

		const service = new IndividualSummarizerService({
			driver,
			batchSize: 1,
			maxRetries: 1,
		});
		const payloads = [makePayload("alpha")];

		const result = await service.process(payloads);

		const alphaResult = result.get("alpha");
		expect(alphaResult?.status).toBe("failed");
		expect(alphaResult?.error).toContain("Bad Gateway");
	});
});
