import { describe, expect, it } from "bun:test";
import {
	type ReportRenderInput,
	renderReport,
} from "../../src/lib/report-renderer.js";

const disabledAsana = {
	status: "disabled" as const,
	tasks: [],
	message: "Integration disabled (set ASANA_API_TOKEN).",
};

describe("report template", () => {
	it("matches the canonical markdown structure", () => {
		const result = renderReport({
			schemaVersion: 1,
			orgSlug: "acme",
			orgName: "Acme Corporation",
			generatedAt: "2025-09-19T10:00:00.000Z",
			teamSlug: "backend",
			teamName: "Backend",
			members: ["dev1", "dev2"],
			filters: {
				includeBots: false,
				excludePrivate: false,
				includeArchived: false,
				repositories: [],
			},
			showDetails: true,
			window: {
				start: "2025-08-20T00:00:00.000Z",
				end: "2025-09-19T00:00:00.000Z",
				human: "Aug 20 – Sep 19, 2025",
			},
			totals: {
				prs: 42,
				prsMerged: 42,
				repoCount: 12,
				contributorCount: 18,
			},
			memberMetrics: [
				{
					login: "dev1",
					displayName: "Dev One",
					commits: 12,
					prsOpened: 4,
					prsClosed: 0,
					prsMerged: 4,
					linesAdded: 1234,
					linesDeleted: 220,
					linesAddedInProgress: 0,
					linesDeletedInProgress: 0,
					reviews: 9,
					approvals: 5,
					changesRequested: 2,
					commented: 2,
					reviewComments: 15,
					aiSummary: "Dev One led database migration and resolved incidents",
					highlights: ["led database migration", "resolved incidents"],
					prHighlights: [
						"api-service · PR #1042 add billing pipeline",
						"incident-response · PR #871 tighten alert thresholds",
					],
					commitHighlights: [
						"api-service · commit abc1234: refactor billing provider",
					],
					taskTracker: disabledAsana,
				},
				{
					login: "dev2",
					displayName: "Dev Two",
					commits: 8,
					prsOpened: 6,
					prsClosed: 0,
					prsMerged: 6,
					linesAdded: 890,
					linesDeleted: 450,
					linesAddedInProgress: 0,
					linesDeletedInProgress: 0,
					reviews: 4,
					approvals: 2,
					changesRequested: 1,
					commented: 1,
					reviewComments: 6,
					aiSummary: "Dev Two shipped billing improvements",
					highlights: ["shipped billing improvements"],
					prHighlights: ["billing-ui · PR #512 polish invoicing dashboard"],
					commitHighlights: [],
					taskTracker: disabledAsana,
				},
			],
			globalHighlights: [
				"backend team stabilized the new API rollout",
				"reduced incident response time by 30%",
			],
			teamHighlight:
				"Processed 42 PRs across 12 repositories, with contributions from 18 engineers, 42 merged during the window. Key themes: Backend team stabilized the new API rollout and reduced incident response time by 30%.",
			metricsDefinition:
				"Commits include default branch merges; reviews exclude self-approvals",
			archivedNote:
				"No repositories were archived or transferred during the reporting window.",
			sections: {
				git: true,
				taskTracker: true,
			},
		} satisfies ReportRenderInput);

		expect(result).toMatchSnapshot();
	});
});
