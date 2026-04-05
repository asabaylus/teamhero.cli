import { describe, expect, it } from "bun:test";
import { renderContributorReport } from "../../src/lib/contributor-report.js";
import type { ReportMemberMetrics } from "../../src/lib/report-renderer.js";

function buildMember(): ReportMemberMetrics {
	return {
		login: "jdoe",
		displayName: "Jane Doe",
		commits: 3,
		prsTotal: 2,
		prsMerged: 2,
		linesAdded: 120,
		linesDeleted: 30,
		linesAddedInProgress: 0,
		linesDeletedInProgress: 0,
		reviews: 1,
		approvals: 1,
		changesRequested: 0,
		commented: 0,
		reviewComments: 2,
		aiSummary: "",
		highlights: [],
		taskTracker: {
			status: "matched",
			tasks: [
				{
					gid: "task-1",
					name: "Finalize onboarding checklist",
					status: "completed",
					completedAt: "2025-09-18T10:00:00Z",
					dueOn: null,
					dueAt: null,
					permalinkUrl: "https://app.asana.com/0/1/1",
					description:
						"Document the revised workflow and confirm partner approval.",
					comments: [
						"Initial QA sign-off",
						"Customer success approved rollout",
					],
				},
			],
		},
		prHighlights: ["Merged scheduling API for clinics"],
		commitHighlights: ["Refined queue processor logging"],
		rawPullRequests: [
			{
				repoName: "platform",
				number: 42,
				title: "Add clinic scheduling API",
				url: "https://github.com/org/repo/pull/42",
				mergedAt: "2025-09-18T12:00:00Z",
				state: "MERGED",
				bodyText: "Implements scheduling endpoint",
			},
		],
		rawCommits: [
			{
				repoName: "platform",
				oid: "abcdef1234567890abcdef1234567890abcdef12",
				message: "Refine queue processor logging",
				url: "https://github.com/org/repo/commit/abcdef1",
				committedAt: "2025-09-17T09:00:00Z",
			},
		],
	} satisfies ReportMemberMetrics;
}

describe("renderContributorReport", () => {
	it("includes sectioned output with links when detailed", () => {
		const member = buildMember();
		const output = renderContributorReport(member, { detailed: true });

		const sections = [
			"Summary:",
			"Open pull requests:",
			"Supporting commit highlights:",
			"Merged pull requests:",
			"Closed pull requests:",
			"Supporting commits:",
			"Completed tasks:",
		];

		let lastIndex = -1;
		for (const section of sections) {
			const index = output.indexOf(section);
			expect(index, `Section ${section} missing`).toBeGreaterThan(-1);
			expect(index, `Section ${section} out of order`).toBeGreaterThan(
				lastIndex,
			);
			lastIndex = index;
		}

		expect(output).toContain("https://github.com/org/repo/pull/42");
		expect(output).toContain("https://app.asana.com/0/1/1");
		expect(output).toContain(
			"Document the revised workflow and confirm partner approval",
		);
		expect(output).toContain("Open pull requests:\n- None");
		expect(output).toContain("Closed pull requests:\n- None");
	});

	it("produces narrative paragraphs without raw identifiers in summary mode", () => {
		const member = buildMember();
		const output = renderContributorReport(member, { detailed: false });

		const lines = output.split("\n");
		expect(lines[0]).toBe("### Jane Doe (@jdoe)");
		const body = lines.slice(1).join("\n");

		expect(body).not.toMatch(/https?:\/\//);
		expect(body).not.toMatch(/#[0-9]+/);
		expect(body).not.toMatch(/\b[0-9a-f]{7}\b/i);

		const paragraphs = body
			.split(/\n{2,}/)
			.map((paragraph) => paragraph.trim())
			.filter(Boolean);
		expect(paragraphs.length).toBeGreaterThanOrEqual(2);
		expect(body).toContain(
			"Document the revised workflow and confirm partner approval",
		);
		expect(body).not.toMatch(/Finalize onboarding checklist/);
	});

	it("displays closed PRs separately from merged PRs in detailed view", () => {
		const memberWithClosedPRs: ReportMemberMetrics = {
			...buildMember(),
			rawPullRequests: [
				{
					repoName: "platform",
					number: 42,
					title: "Add clinic scheduling API",
					url: "https://github.com/org/repo/pull/42",
					mergedAt: "2025-09-18T12:00:00Z",
					state: "MERGED",
					bodyText: "Implements scheduling endpoint",
				},
				{
					repoName: "SalesforceHappySoup",
					number: 2377,
					title:
						"Refactored Billing Case Creation Service per Apex Enterprise Patterns",
					url: "https://github.com/lumata-health/SalesforceHappySoup/pull/2377",
					mergedAt: "2025-10-08T00:00:00Z",
					state: "CLOSED",
					bodyText: "Refactored billing service",
				},
			],
		};

		const output = renderContributorReport(memberWithClosedPRs, {
			detailed: true,
		});

		expect(output).toContain("Merged pull requests:");
		expect(output).toContain("platform · PR #42 Add clinic scheduling API");

		expect(output).toContain("Closed pull requests:");
		expect(output).toContain(
			"SalesforceHappySoup · PR #2377 Refactored Billing Case Creation Service per Apex Enterprise Patterns",
		);
		expect(output).toContain("(closed 2025-10-08)");

		// Ensure closed PR is not in merged section
		const sections = output.split("Closed pull requests:");
		expect(sections[0]).not.toContain(
			"Refactored Billing Case Creation Service",
		);
	});

	it("formats two PR highlights with 'and' conjunction in summary mode", () => {
		const member: ReportMemberMetrics = {
			...buildMember(),
			prHighlights: ["Fixed auth flow", "Added rate limiting"],
		};
		const output = renderContributorReport(member, { detailed: false });
		expect(output).toContain("Fixed auth flow and Added rate limiting");
	});

	it("formats three or more PR highlights with Oxford comma in summary mode", () => {
		const member: ReportMemberMetrics = {
			...buildMember(),
			prHighlights: ["Fixed auth flow", "Added rate limiting", "Updated docs"],
		};
		const output = renderContributorReport(member, { detailed: false });
		expect(output).toContain(
			"Fixed auth flow, Added rate limiting, and Updated docs",
		);
	});

	it("falls back to raw PR titles when prHighlights is empty in summary mode", () => {
		const member: ReportMemberMetrics = {
			...buildMember(),
			prHighlights: [],
			rawPullRequests: [
				{
					repoName: "platform",
					number: 42,
					title: "Add clinic scheduling API",
					url: "https://github.com/org/repo/pull/42",
					mergedAt: "2025-09-18T12:00:00Z",
					state: "MERGED",
					bodyText: "Implements scheduling endpoint",
				},
				{
					repoName: "platform",
					number: 43,
					title: "Fix session timeout",
					url: "https://github.com/org/repo/pull/43",
					mergedAt: "2025-09-19T12:00:00Z",
					state: "MERGED",
				},
			],
		};
		const output = renderContributorReport(member, { detailed: false });
		expect(output).toContain(
			"Add clinic scheduling API and Fix session timeout",
		);
	});

	it("handles contributors with only closed PRs", () => {
		const memberWithOnlyClosedPRs: ReportMemberMetrics = {
			...buildMember(),
			rawPullRequests: [
				{
					repoName: "repo-a",
					number: 100,
					title: "Closed Feature A",
					url: "https://github.com/org/repo-a/pull/100",
					mergedAt: "2025-10-08T00:00:00Z",
					state: "CLOSED",
				},
				{
					repoName: "repo-b",
					number: 200,
					title: "Closed Feature B",
					url: "https://github.com/org/repo-b/pull/200",
					mergedAt: "2025-10-09T00:00:00Z",
					state: "CLOSED",
				},
			],
		};

		const output = renderContributorReport(memberWithOnlyClosedPRs, {
			detailed: true,
		});

		expect(output).toContain("Merged pull requests:\n- None");
		expect(output).toContain("Closed pull requests:");
		expect(output).toContain("repo-a · PR #100 Closed Feature A");
		expect(output).toContain("repo-b · PR #200 Closed Feature B");
	});
});
