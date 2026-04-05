import type { ContributionMetricSet } from "./metrics.js";

export interface ReportContext {
	id: string;
	organization: string;
	teamSlug?: string;
	memberLogins?: string[];
	generatedAt: string;
	window: {
		start: string;
		end: string;
		humanReadable: string;
	};
}

export interface Report extends ReportContext {
	highlights: string[];
	metrics: ContributionMetricSet[];
}
