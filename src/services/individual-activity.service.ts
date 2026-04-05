import type { ReportMemberMetrics } from "../lib/report-renderer.js";
import {
	buildContributorPayload,
	type ContributorReportingWindow,
	type ContributorSummaryPayload,
} from "../models/individual-summary.js";

export interface BuildActivityPayloadsInput {
	members: ReportMemberMetrics[];
	window: ContributorReportingWindow;
}

export class IndividualActivityService {
	buildContributorPayloads(
		input: BuildActivityPayloadsInput,
	): ContributorSummaryPayload[] {
		return input.members.map((member) =>
			buildContributorPayload({
				metrics: member,
				window: input.window,
			}),
		);
	}
}
