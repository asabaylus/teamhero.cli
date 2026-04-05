import type { ReportMemberMetrics } from "../lib/report-renderer.js";
import {
	type ContributorReportingWindow,
	type ContributorSummaryPayload,
	buildContributorPayload,
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
