import { describe, expect, it } from "bun:test";
import { renderReport } from "../../src/lib/report-renderer.js";

const disabledAsana = {
	status: "disabled" as const,
	tasks: [],
	message: "Integration disabled (set ASANA_API_TOKEN).",
};

const baseInput = {
	orgSlug: "acme",
	generatedAt: "2025-09-19T10:00:00Z",
	filters: {
		includeBots: false,
		excludePrivate: false,
		includeArchived: false,
		repositories: [],
	},
	showDetails: false,
	window: {
		start: "2025-08-20",
		end: "2025-09-19",
		human: "Aug 20 – Sep 19, 2025",
	},
	totals: {
		prs: 5,
		prsMerged: 5,
		repoCount: 2,
		contributorCount: 2,
	},
	memberMetrics: [
		{
			login: "dev2",
			displayName: "Dev Two",
			commits: 5,
			prsTotal: 3,
			prsMerged: 3,
			linesAdded: 500,
			linesDeleted: 100,
			linesAddedInProgress: 0,
			linesDeletedInProgress: 0,
			reviews: 2,
			approvals: 1,
			changesRequested: 0,
			commented: 1,
			reviewComments: 3,
			aiSummary: "Dev Two highlight.",
			highlights: ["merged #12 Search improvements", "search service commit"],
			prHighlights: ["search-service · PR #12 search improvements"],
			commitHighlights: [
				"search-service · commit ab12cd3: optimize query cache",
			],
			taskTracker: disabledAsana,
		},
		{
			login: "dev1",
			displayName: "Dev One",
			commits: 7,
			prsTotal: 2,
			prsMerged: 2,
			linesAdded: 350,
			linesDeleted: 50,
			linesAddedInProgress: 0,
			linesDeletedInProgress: 0,
			reviews: 4,
			approvals: 2,
			changesRequested: 1,
			commented: 1,
			reviewComments: 4,
			aiSummary: "Dev One highlight.",
			highlights: ["merged #9 Fix billing"],
			prHighlights: ["billing-service · PR #9 Fix billing"],
			commitHighlights: [],
			taskTracker: disabledAsana,
		},
	],
	globalHighlights: ["search improvements", "billing fixes"],
	teamHighlight:
		"Processed 5 PRs across 2 repositories, with contributions from 2 engineers, 5 merged during the window. Key themes: Teams merged 5 PRs advancing search and billing stability.",
	metricsDefinition:
		"Commits include default branch merges; reviews exclude self-approvals",
	archivedNote:
		"No repositories were archived or transferred during the reporting window.",
	sections: {
		git: true,
		taskTracker: true,
	},
};

describe("renderReport", () => {
	it("orders developers by merged PRs then commits in the summary table", () => {
		const shuffled = {
			...baseInput,
			memberMetrics: [...baseInput.memberMetrics].reverse(),
		};
		const output = renderReport(shuffled);
		const table = output.split("\n").filter((line) => line.startsWith("| "));
		const devTwoRowIndex = table.findIndex((line) => line.includes("Dev Two"));
		const devOneRowIndex = table.findIndex((line) => line.includes("Dev One"));
		expect(devTwoRowIndex).toBeLessThan(devOneRowIndex);
	});

	it("produces deterministic output for identical input", () => {
		const first = renderReport(baseInput);
		const second = renderReport(baseInput);
		expect(first).toBe(second);
	});

	it("renders the executive summary template sections", () => {
		const output = renderReport(baseInput);
		expect(output).toContain("# Weekly Engineering Summary");
		expect(output).toContain("Processed 5 PRs across 2 repositories");
		expect(output).toContain("## **At-a-Glance Summary**");
		expect(output).toContain("## **Individual Updates**");
	});

	it("includes individual member summaries", () => {
		const output = renderReport(baseInput);
		expect(output).toContain("### Dev Two (@dev2)");
		expect(output).toContain("Dev Two highlight.");
		expect(output).toContain("### Dev One (@dev1)");
		expect(output).toContain("Dev One highlight.");
	});

	it("nests pull request and commit details under individual updates when details are enabled", () => {
		const output = renderReport({
			...baseInput,
			showDetails: true,
		});

		expect(output).toContain("- **Open pull requests**\n  - None");
		expect(output).toContain("- **Commits**\n  - None");
	});

	it("includes deterministic overview sentence without key themes", () => {
		const output = renderReport(baseInput);
		expect(output).toContain(
			"Processed 5 PRs across 2 repositories, with contributions from 2 engineers.",
		);
		expect(output).not.toContain("Key themes");
	});

	it("uses aiSummary for member narrative when available", () => {
		const customSummary =
			"Dev Three delivered key infrastructure improvements and coordinated with multiple teams.";

		const report = renderReport({
			...baseInput,
			showDetails: true,
			memberMetrics: [
				{
					...baseInput.memberMetrics[0],
					login: "dev3",
					displayName: "Dev Three",
					aiSummary: customSummary,
				},
			],
		});

		expect(report).toContain("### Dev Three (@dev3)");
		expect(report).toContain(customSummary);
	});

	it("displays closed PRs in detailed view", () => {
		const output = renderReport({
			...baseInput,
			showDetails: true,
			memberMetrics: [
				{
					...baseInput.memberMetrics[0],
					login: "dev4",
					displayName: "Dev Four",
					rawPullRequests: [
						{
							repoName: "SalesforceHappySoup",
							number: 2377,
							title:
								"Refactored Billing Case Creation Service per Apex Enterprise Patterns",
							url: "https://github.com/lumata-health/SalesforceHappySoup/pull/2377",
							mergedAt: "2025-10-08T00:00:00Z",
							state: "CLOSED",
							bodyText: "Refactored billing service for maintainability",
						},
					],
				},
			],
		});

		expect(output).toContain("- **Closed pull requests**");
		expect(output).toContain(
			"SalesforceHappySoup · PR #2377 Refactored Billing Case Creation Service per Apex Enterprise Patterns",
		);
		expect(output).toContain(
			"https://github.com/lumata-health/SalesforceHappySoup/pull/2377",
		);
		expect(output).toContain("(closed 2025-10-08)");
	});

	it("displays closed PRs separately from merged PRs", () => {
		const output = renderReport({
			...baseInput,
			showDetails: true,
			memberMetrics: [
				{
					...baseInput.memberMetrics[0],
					login: "dev5",
					displayName: "Dev Five",
					rawPullRequests: [
						{
							repoName: "repo-a",
							number: 100,
							title: "Merged Feature A",
							url: "https://github.com/org/repo-a/pull/100",
							mergedAt: "2025-10-08T00:00:00Z",
							state: "MERGED",
						},
						{
							repoName: "repo-b",
							number: 200,
							title: "Closed Feature B",
							url: "https://github.com/org/repo-b/pull/200",
							mergedAt: "2025-10-09T00:00:00Z",
							state: "CLOSED",
						},
						{
							repoName: "repo-c",
							number: 300,
							title: "Open Feature C",
							url: "https://github.com/org/repo-c/pull/300",
							mergedAt: "",
							state: "OPEN",
						},
					],
				},
			],
		});

		// Verify all three sections exist and contain the right PRs
		expect(output).toContain("- **Open pull requests**");
		expect(output).toContain("repo-c · PR #300 Open Feature C");

		expect(output).toContain("- **Merged pull requests**");
		expect(output).toContain("repo-a · PR #100 Merged Feature A");

		expect(output).toContain("- **Closed pull requests**");
		expect(output).toContain("repo-b · PR #200 Closed Feature B");

		// Verify the closed PR is not in the merged section
		const mergedSection = output.split("- **Closed pull requests**")[0];
		expect(mergedSection).not.toContain("Closed Feature B");
	});

	it("shows 'None' for closed PRs when there are no closed PRs", () => {
		const output = renderReport({
			...baseInput,
			showDetails: true,
			memberMetrics: [
				{
					...baseInput.memberMetrics[0],
					rawPullRequests: [
						{
							repoName: "repo-a",
							number: 100,
							title: "Merged Feature",
							url: "https://github.com/org/repo-a/pull/100",
							mergedAt: "2025-10-08T00:00:00Z",
							state: "MERGED",
						},
					],
				},
			],
		});

		expect(output).toContain("- **Closed pull requests**\n  - None");
	});

	it("hides At-a-Glance and Individual Updates when individualContributions is false", () => {
		const output = renderReport({
			...baseInput,
			sections: {
				git: true,
				taskTracker: true,
				individualContributions: false,
			},
		});

		expect(output).not.toContain("At-a-Glance Summary");
		expect(output).not.toContain("Individual Updates");
		expect(output).not.toContain("Weekly Engineering Summary");
	});

	it("shows At-a-Glance and Individual Updates by default (individualContributions undefined)", () => {
		const output = renderReport(baseInput);
		expect(output).toContain("At-a-Glance Summary");
		expect(output).toContain("Individual Updates");
	});

	it("renders In-Progress columns when any member has in-progress work", () => {
		const output = renderReport({
			...baseInput,
			memberMetrics: baseInput.memberMetrics.map((m, i) => ({
				...m,
				linesAddedInProgress: i === 0 ? 1660 : 0,
				linesDeletedInProgress: i === 0 ? 131 : 0,
			})),
		});

		expect(output).toContain("In-Progress +");
		expect(output).toContain("In-Progress -");
		expect(output).toContain("1660");
		expect(output).toContain("131");
	});

	it("omits In-Progress columns when no member has in-progress work", () => {
		const output = renderReport(baseInput);
		expect(output).not.toContain("In-Progress +");
		expect(output).not.toContain("In-Progress -");
	});

	it("lists generation errors at the end of the report", () => {
		const output = renderReport({
			...baseInput,
			errors: [
				"Failed to collect commits for acme/repo-a: timeout",
				"Failed to collect pull requests for acme/repo-b: 403 Forbidden",
			],
		});

		expect(output).toContain("## **Errors Encountered**");
		expect(output).toContain(
			"- Failed to collect commits for acme/repo-a: timeout",
		);
		expect(output).toContain(
			"- Failed to collect pull requests for acme/repo-b: 403 Forbidden",
		);
	});
});
