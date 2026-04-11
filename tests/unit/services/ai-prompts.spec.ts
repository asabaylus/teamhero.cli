import type {
	RoadmapEntry,
	RoadmapSubtaskInfo,
	SectionAuditContext,
	VisibleWinsExtractionContext,
} from "../../../src/core/types.js";
import type {
	ReportMemberMetrics,
	ReportRenderInput,
} from "../../../src/lib/report-renderer.js";
import type { ContributorSummaryPayload } from "../../../src/models/individual-summary.js";
import type {
	NormalizedNote,
	ProjectAccomplishment,
	ProjectTask,
} from "../../../src/models/visible-wins.js";
import type { RoadmapSynthesisContext } from "../../../src/services/ai-prompts.js";

const {
	buildDiscrepancyAnalysisPrompt,
	buildFinalReportPrompt,
	buildIndividualSummariesPrompt,
	buildMemberHighlightsPrompt,
	buildRoadmapSynthesisPrompt,
	buildTeamPrompt,
	buildVisibleWinsExtractionPrompt,
	DISCREPANCY_ANALYSIS_SCHEMA,
} = await import(
	new URL(
		"../../../src/services/ai-prompts.js?ai-prompts-spec",
		import.meta.url,
	).href
);

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeMemberMetrics(
	overrides: Partial<ReportMemberMetrics> = {},
): ReportMemberMetrics {
	return {
		login: "jdoe",
		displayName: "Jane Doe",
		commits: 12,
		prsOpened: 4,
		prsClosed: 1,
		prsMerged: 3,
		linesAdded: 800,
		linesDeleted: 200,
		reviews: 5,
		approvals: 3,
		changesRequested: 1,
		commented: 1,
		reviewComments: 6,
		aiSummary: "Jane shipped key billing fixes and improved test coverage.",
		highlights: ["Merged billing improvements"],
		prHighlights: ["billing-service · PR #99 Fix invoice rounding"],
		commitHighlights: [
			"billing-service · commit abc1234: harden rounding logic",
		],
		taskTracker: {
			status: "matched",
			tasks: [
				{
					gid: "task-1",
					name: "Ship billing fix",
					status: "completed",
					completedAt: "2026-02-20T12:00:00Z",
					dueOn: "2026-02-20",
					dueAt: null,
					permalinkUrl: "https://app.asana.com/0/123/task-1",
					description: "Fix rounding in invoice calculations",
					comments: ["Reviewed with finance team"],
				},
			],
			message: undefined,
		},
		// ai-prompts.ts accesses prsTotal at runtime (pre-existing TS error)
		...({ prsTotal: 4 } as Record<string, unknown>),
		...overrides,
	} as ReportMemberMetrics;
}

function makeRenderInput(
	overrides: Partial<ReportRenderInput> = {},
): ReportRenderInput {
	return {
		schemaVersion: 1,
		orgSlug: "acme",
		generatedAt: "2026-02-28T10:00:00Z",
		filters: {
			includeBots: false,
			excludePrivate: false,
			includeArchived: false,
		},
		showDetails: false,
		window: {
			start: "2026-02-24",
			end: "2026-02-28",
			human: "Feb 24 – Feb 28, 2026",
		},
		totals: { prs: 15, prsMerged: 12, repoCount: 4, contributorCount: 3 },
		memberMetrics: [makeMemberMetrics()],
		globalHighlights: [
			"Billing reliability improved",
			"Test coverage expanded",
		],
		metricsDefinition: "Commits include default branch merges",
		archivedNote: "No repositories were archived.",
		sections: { git: true, taskTracker: true },
		...overrides,
	};
}

function makeContributorPayload(
	overrides: Partial<ContributorSummaryPayload> = {},
): ContributorSummaryPayload {
	return {
		contributor: { login: "jdoe", displayName: "Jane Doe" },
		reportingWindow: {
			startISO: "2026-02-24T00:00:00Z",
			endISO: "2026-02-28T23:59:59Z",
			human: "Feb 24 – Feb 28, 2026",
		},
		metrics: {
			commits: 12,
			prsTotal: 4,
			prsMerged: 3,
			linesAdded: 800,
			linesDeleted: 200,
			reviews: 5,
		},
		pullRequests: [
			{
				repo: "billing-service",
				number: 99,
				title: "Fix invoice rounding",
				url: "https://github.com/acme/billing-service/pull/99",
				status: "MERGED",
				mergedAt: "2026-02-26T15:00:00Z",
			},
		],
		asana: {
			status: "matched",
			tasks: [
				{
					gid: "task-1",
					name: "Ship billing fix",
					status: "completed",
					completedAt: "2026-02-20T12:00:00Z",
					dueOn: "2026-02-20",
					dueAt: null,
					permalinkUrl: "https://app.asana.com/0/123/task-1",
					description: "Fix rounding in invoice calculations",
				},
			],
		},
		highlights: {
			general: ["Merged billing improvements"],
			prs: ["billing-service · PR #99 Fix invoice rounding"],
			commits: ["billing-service · commit abc1234: harden rounding logic"],
		},
		...overrides,
	};
}

// ===================================================================
// buildTeamPrompt
// ===================================================================

describe("buildTeamPrompt", () => {
	const baseContext = {
		organization: "acme",
		windowHuman: "Feb 24 – Feb 28, 2026",
		windowStart: "2026-02-24",
		windowEnd: "2026-02-28",
		totals: { prs: 15, prsMerged: 12, repoCount: 4, contributorCount: 3 },
		highlights: ["Billing reliability improved"],
	};

	it("returns a non-empty string", () => {
		const result = buildTeamPrompt(baseContext);
		expect(result.length).toBeGreaterThan(0);
	});

	it("includes window dates in the prompt", () => {
		const result = buildTeamPrompt(baseContext);
		expect(result).toContain("2026-02-24");
		expect(result).toContain("2026-02-28");
	});

	it("includes total metrics in the prompt", () => {
		const result = buildTeamPrompt(baseContext);
		expect(result).toContain("15 PRs");
		expect(result).toContain("4 repositories");
		expect(result).toContain("3 engineers");
		expect(result).toContain("12 merged");
	});

	it("includes individual updates when provided", () => {
		const result = buildTeamPrompt({
			...baseContext,
			individualUpdates: [
				"Dev A shipped the billing fix",
				"Dev B improved search",
			],
		});
		expect(result).toContain("Dev A shipped the billing fix");
		expect(result).toContain("Dev B improved search");
	});

	it("produces valid prompt with empty individualUpdates", () => {
		const result = buildTeamPrompt({ ...baseContext, individualUpdates: [] });
		expect(result.length).toBeGreaterThan(0);
		expect(result).toContain("15 PRs");
	});

	it("produces valid prompt with no individualUpdates at all", () => {
		const result = buildTeamPrompt(baseContext);
		expect(result.length).toBeGreaterThan(0);
	});

	it("includes velocity context when provided", () => {
		const result = buildTeamPrompt({
			...baseContext,
			velocityContext: "PRs merged up 28%, tasks completed down 14%",
		});
		expect(result).toContain("Velocity trends");
		expect(result).toContain("PRs merged up 28%");
	});

	it("omits velocity section when velocityContext is absent", () => {
		const result = buildTeamPrompt(baseContext);
		expect(result).not.toContain("Velocity trends");
	});

	it("includes CTO audience framing", () => {
		const result = buildTeamPrompt(baseContext);
		expect(result).toContain("CTO");
		expect(result).toContain("executive");
	});

	it("instructs against em dashes", () => {
		const result = buildTeamPrompt(baseContext);
		expect(result).toContain("Do not use em dashes");
	});

	it("produces different output for different totals", () => {
		const result1 = buildTeamPrompt(baseContext);
		const result2 = buildTeamPrompt({
			...baseContext,
			totals: { prs: 42, prsMerged: 30, repoCount: 8, contributorCount: 6 },
		});
		expect(result1).not.toBe(result2);
		expect(result2).toContain("42 PRs");
	});

	it("handles zero metrics gracefully", () => {
		const result = buildTeamPrompt({
			...baseContext,
			totals: { prs: 0, prsMerged: 0, repoCount: 0, contributorCount: 0 },
		});
		expect(result).toContain("0 PRs");
		expect(result).toContain("0 repositories");
	});
});

// ===================================================================
// buildMemberHighlightsPrompt
// ===================================================================

describe("buildMemberHighlightsPrompt", () => {
	it("returns a non-empty string", () => {
		const result = buildMemberHighlightsPrompt({
			members: [makeMemberMetrics()],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result.length).toBeGreaterThan(0);
	});

	it("includes the window reference", () => {
		const result = buildMemberHighlightsPrompt({
			members: [makeMemberMetrics()],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result).toContain("Feb 24 – Feb 28, 2026");
	});

	it("includes member login and display name", () => {
		const result = buildMemberHighlightsPrompt({
			members: [makeMemberMetrics()],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result).toContain("jdoe");
		expect(result).toContain("Jane Doe");
	});

	it("includes PR highlights categorized by status", () => {
		const result = buildMemberHighlightsPrompt({
			members: [
				makeMemberMetrics({
					prHighlights: [
						"billing-service · PR #99 Fix invoice rounding (merged)",
						"billing-service · PR #100 Add retry logic (open)",
						"billing-service · PR #101 Remove dead code (closed)",
					],
				}),
			],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result).toContain("Delivered work:");
		expect(result).toContain("In review:");
		expect(result).toContain("Closed PRs");
	});

	it("shows 'none recorded' when there are no PR highlights", () => {
		const result = buildMemberHighlightsPrompt({
			members: [
				makeMemberMetrics({
					prHighlights: [],
				}),
			],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result).toContain("Delivered work: none recorded in the window");
	});

	it("filters out 'No PRs found.' from highlights", () => {
		const result = buildMemberHighlightsPrompt({
			members: [
				makeMemberMetrics({
					prHighlights: ["No PRs found."],
				}),
			],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result).toContain("none recorded in the window");
	});

	it("includes commit context", () => {
		const result = buildMemberHighlightsPrompt({
			members: [
				makeMemberMetrics({
					commitHighlights: [
						"billing-service · commit abc1234: harden rounding logic",
					],
				}),
			],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result).toContain("Supporting commits:");
		expect(result).toContain("harden rounding logic");
	});

	it("shows 'none recorded' for empty commit highlights", () => {
		const result = buildMemberHighlightsPrompt({
			members: [makeMemberMetrics({ commitHighlights: [] })],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result).toContain("Supporting commits: none recorded in the window");
	});

	it("includes completed Asana tasks in context", () => {
		const result = buildMemberHighlightsPrompt({
			members: [makeMemberMetrics()],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result).toContain("Operational tasks:");
		expect(result).toContain("Ship billing fix");
	});

	it("shows no completed tasks message when there are none", () => {
		const result = buildMemberHighlightsPrompt({
			members: [
				makeMemberMetrics({
					taskTracker: { status: "matched", tasks: [], message: undefined },
				}),
			],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result).toContain(
			"Operational tasks: No completed Asana tasks recorded",
		);
	});

	it("includes metrics line with correct values", () => {
		const result = buildMemberHighlightsPrompt({
			members: [makeMemberMetrics()],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result).toContain("Metrics:");
		expect(result).toContain("Commits=12");
		expect(result).toContain("Reviews=5");
	});

	it("renders multiple members with numbered positions", () => {
		const result = buildMemberHighlightsPrompt({
			members: [
				makeMemberMetrics({ login: "alice", displayName: "Alice A" }),
				makeMemberMetrics({ login: "bob", displayName: "Bob B" }),
			],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result).toContain("Member 1: Alice A");
		expect(result).toContain("Member 2: Bob B");
	});

	it("handles empty members array", () => {
		const result = buildMemberHighlightsPrompt({
			members: [],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result.length).toBeGreaterThan(0);
		expect(result).toContain("Members:");
	});

	it("requests JSON output format", () => {
		const result = buildMemberHighlightsPrompt({
			members: [makeMemberMetrics()],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result).toContain("JSON");
	});

	it("includes additional highlights when present", () => {
		const result = buildMemberHighlightsPrompt({
			members: [
				makeMemberMetrics({
					highlights: ["Merged API improvements", "Improved test reliability"],
				}),
			],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result).toContain("Additional highlights:");
		expect(result).toContain("Merged API improvements");
	});

	it("omits additional highlights line when highlights are empty", () => {
		const result = buildMemberHighlightsPrompt({
			members: [makeMemberMetrics({ highlights: [] })],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result).not.toContain("Additional highlights:");
	});

	it("includes task comments when present", () => {
		const result = buildMemberHighlightsPrompt({
			members: [
				makeMemberMetrics({
					taskTracker: {
						status: "matched",
						tasks: [
							{
								gid: "task-2",
								name: "Deploy hotfix",
								status: "completed",
								completedAt: "2026-02-25T10:00:00Z",
								dueOn: "2026-02-25",
								dueAt: null,
								description: "Emergency fix for production",
								comments: ["Deployed at 2pm", "Verified by QA"],
							},
						],
					},
				}),
			],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result).toContain("Comments:");
		expect(result).toContain("Deployed at 2pm");
	});
});

// ===================================================================
// buildFinalReportPrompt
// ===================================================================

describe("buildFinalReportPrompt", () => {
	it("returns a non-empty string", () => {
		const result = buildFinalReportPrompt(makeRenderInput());
		expect(result.length).toBeGreaterThan(0);
	});

	it("includes VP of Engineering framing", () => {
		const result = buildFinalReportPrompt(makeRenderInput());
		expect(result).toContain("VP of Engineering");
		expect(result).toContain("CTO");
	});

	it("includes the markdown template structure", () => {
		const result = buildFinalReportPrompt(makeRenderInput());
		expect(result).toContain("# Weekly Engineering Summary");
		expect(result).toContain("At-a-Glance Summary");
		expect(result).toContain("Top Highlights");
		expect(result).toContain("Individual Updates");
		expect(result).toContain("Next Steps");
	});

	it("includes serialized report data as JSON", () => {
		const result = buildFinalReportPrompt(makeRenderInput());
		expect(result).toContain("Raw data:");
		// Should include member data in JSON
		expect(result).toContain('"jdoe"');
		expect(result).toContain('"Jane Doe"');
	});

	it("includes detail guidance when showDetails is true", () => {
		const result = buildFinalReportPrompt(
			makeRenderInput({ showDetails: true }),
		);
		expect(result).toContain("Detailed listings are enabled");
	});

	it("includes no-detail guidance when showDetails is false", () => {
		const result = buildFinalReportPrompt(
			makeRenderInput({ showDetails: false }),
		);
		expect(result).toContain("Do not create additional bullet sections");
	});

	it("serializes member metrics in the data block", () => {
		const result = buildFinalReportPrompt(makeRenderInput());
		// JSON should contain metric fields
		expect(result).toContain('"commits"');
		expect(result).toContain('"prsMerged"');
		expect(result).toContain('"reviews"');
	});

	it("serializes completed Asana task summaries", () => {
		const result = buildFinalReportPrompt(makeRenderInput());
		expect(result).toContain('"asana"');
		expect(result).toContain('"completedTasksCount"');
	});

	it("ends with a generate instruction", () => {
		const result = buildFinalReportPrompt(makeRenderInput());
		expect(result).toContain("Generate the Markdown report now.");
	});

	it("produces different output for different inputs", () => {
		const result1 = buildFinalReportPrompt(makeRenderInput());
		const result2 = buildFinalReportPrompt(
			makeRenderInput({
				totals: { prs: 42, prsMerged: 30, repoCount: 8, contributorCount: 6 },
			}),
		);
		expect(result1).not.toBe(result2);
	});

	it("handles zero member metrics", () => {
		const result = buildFinalReportPrompt(
			makeRenderInput({ memberMetrics: [] }),
		);
		expect(result.length).toBeGreaterThan(0);
		expect(result).toContain("Raw data:");
	});
});

// ===================================================================
// buildIndividualSummariesPrompt
// ===================================================================

describe("buildIndividualSummariesPrompt", () => {
	it("returns a non-empty string", () => {
		const result = buildIndividualSummariesPrompt({
			payloads: [makeContributorPayload()],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result.length).toBeGreaterThan(0);
	});

	it("includes the window reference", () => {
		const result = buildIndividualSummariesPrompt({
			payloads: [makeContributorPayload()],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result).toContain("Feb 24 – Feb 28, 2026");
	});

	it("includes contributor login and display name", () => {
		const result = buildIndividualSummariesPrompt({
			payloads: [makeContributorPayload()],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result).toContain("jdoe");
		expect(result).toContain("Jane Doe");
	});

	it("includes pull request summary counts", () => {
		const result = buildIndividualSummariesPrompt({
			payloads: [makeContributorPayload()],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		// The block serializes pullRequestSummary with total, merged, open counts
		expect(result).toContain('"pullRequestSummary"');
	});

	it("includes Asana task data", () => {
		const result = buildIndividualSummariesPrompt({
			payloads: [makeContributorPayload()],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result).toContain('"asana"');
		expect(result).toContain("Ship billing fix");
	});

	it("numbers multiple contributors sequentially", () => {
		const result = buildIndividualSummariesPrompt({
			payloads: [
				makeContributorPayload({
					contributor: { login: "alice", displayName: "Alice" },
				}),
				makeContributorPayload({
					contributor: { login: "bob", displayName: "Bob" },
				}),
			],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result).toContain("Contributor 1:");
		expect(result).toContain("Contributor 2:");
	});

	it("handles empty payloads array", () => {
		const result = buildIndividualSummariesPrompt({
			payloads: [],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result.length).toBeGreaterThan(0);
		expect(result).toContain("Contributors:");
	});

	it("requests JSON output format", () => {
		const result = buildIndividualSummariesPrompt({
			payloads: [makeContributorPayload()],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result).toContain("JSON");
		expect(result).toContain('"summaries"');
	});

	it("instructs third person writing", () => {
		const result = buildIndividualSummariesPrompt({
			payloads: [makeContributorPayload()],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result).toContain("third person");
	});

	it("instructs handling of contributors with no work", () => {
		const result = buildIndividualSummariesPrompt({
			payloads: [makeContributorPayload()],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		expect(result).toContain("No notable contributions");
	});

	it("truncates long task names in the block", () => {
		const longName = "A".repeat(200);
		const result = buildIndividualSummariesPrompt({
			payloads: [
				makeContributorPayload({
					asana: {
						status: "matched",
						tasks: [
							{
								gid: "task-long",
								name: longName,
								status: "completed",
								completedAt: "2026-02-20T12:00:00Z",
								dueOn: null,
								dueAt: null,
							},
						],
					},
				}),
			],
			windowHuman: "Feb 24 – Feb 28, 2026",
		});
		// Name should be truncated to 160 chars with ellipsis
		expect(result).not.toContain(longName);
		expect(result).toContain("A".repeat(159));
	});
});

// ===================================================================
// buildDiscrepancyAnalysisPrompt
// ===================================================================

describe("buildDiscrepancyAnalysisPrompt", () => {
	const baseAuditContext: SectionAuditContext = {
		sectionName: "individualContribution",
		claims: "Jane shipped billing improvements and merged 3 PRs.",
		evidence:
			'PR #99 status: MERGED. PR #100 status: OPEN. Asana task "Ship billing fix" completed.',
		contributor: "jdoe",
		contributorDisplayName: "Jane Doe",
	};

	it("returns a non-empty string", () => {
		const result = buildDiscrepancyAnalysisPrompt(baseAuditContext);
		expect(result.length).toBeGreaterThan(0);
	});

	it("includes the claims text", () => {
		const result = buildDiscrepancyAnalysisPrompt(baseAuditContext);
		expect(result).toContain("Jane shipped billing improvements");
	});

	it("includes the evidence text", () => {
		const result = buildDiscrepancyAnalysisPrompt(baseAuditContext);
		expect(result).toContain("PR #99 status: MERGED");
	});

	it("includes the contributor when provided", () => {
		const result = buildDiscrepancyAnalysisPrompt(baseAuditContext);
		expect(result).toContain("Jane Doe");
		expect(result).toContain("@jdoe");
	});

	it("omits contributor line when contributor is absent", () => {
		const result = buildDiscrepancyAnalysisPrompt({
			sectionName: "teamHighlight",
			claims: "Team merged 15 PRs.",
			evidence: "Actual merged count: 12.",
		});
		expect(result).not.toContain("Contributor:");
	});

	it("uses section-specific framing for teamHighlight", () => {
		const result = buildDiscrepancyAnalysisPrompt({
			sectionName: "teamHighlight",
			claims: "Team shipped major updates.",
			evidence: "PR data shows 5 merged.",
		});
		expect(result).toContain("Team Highlight executive summary");
	});

	it("uses section-specific framing for visibleWins", () => {
		const result = buildDiscrepancyAnalysisPrompt({
			sectionName: "visibleWins",
			claims: "Dashboard redesign deployed Feb 15th.",
			evidence: "Meeting notes show Feb 22nd target.",
		});
		expect(result).toContain("Visible Wins section");
	});

	it("uses section-specific framing for individualContribution", () => {
		const result = buildDiscrepancyAnalysisPrompt(baseAuditContext);
		expect(result).toContain("Individual Contribution summary");
	});

	it("falls back to generic framing for unknown section names", () => {
		const result = buildDiscrepancyAnalysisPrompt({
			sectionName: "unknownSection" as SectionAuditContext["sectionName"],
			claims: "Some claims.",
			evidence: "Some evidence.",
		});
		expect(result).toContain("Audit the claims against the evidence");
	});

	it("includes auditor role instruction", () => {
		const result = buildDiscrepancyAnalysisPrompt(baseAuditContext);
		expect(result).toContain("report auditor");
	});

	it("includes confidence scoring instructions", () => {
		const result = buildDiscrepancyAnalysisPrompt(baseAuditContext);
		expect(result).toContain("confidence");
		expect(result).toContain("0–100");
	});

	it("instructs conservative flagging", () => {
		const result = buildDiscrepancyAnalysisPrompt(baseAuditContext);
		expect(result).toContain("conservative");
	});

	it("instructs returning empty array when no issues found", () => {
		const result = buildDiscrepancyAnalysisPrompt(baseAuditContext);
		expect(result).toContain("empty discrepancies array");
	});

	it("produces different output for different claims", () => {
		const result1 = buildDiscrepancyAnalysisPrompt(baseAuditContext);
		const result2 = buildDiscrepancyAnalysisPrompt({
			...baseAuditContext,
			claims: "Bob refactored the auth system.",
		});
		expect(result1).not.toBe(result2);
	});
});

// ===================================================================
// DISCREPANCY_ANALYSIS_SCHEMA
// ===================================================================

describe("DISCREPANCY_ANALYSIS_SCHEMA", () => {
	it("has strict mode enabled", () => {
		expect(DISCREPANCY_ANALYSIS_SCHEMA.strict).toBe(true);
	});

	it("has type json_schema for OpenAI Responses API", () => {
		expect(DISCREPANCY_ANALYSIS_SCHEMA.type).toBe("json_schema");
	});

	it("uses json_schema name discrepancy_analysis", () => {
		expect(DISCREPANCY_ANALYSIS_SCHEMA.name).toBe("discrepancy_analysis");
	});

	it("requires discrepancies array at root", () => {
		expect(DISCREPANCY_ANALYSIS_SCHEMA.schema.required).toContain(
			"discrepancies",
		);
		expect(
			DISCREPANCY_ANALYSIS_SCHEMA.schema.properties.discrepancies.type,
		).toBe("array");
	});

	it("enforces discrepancy item structure", () => {
		const itemSchema =
			DISCREPANCY_ANALYSIS_SCHEMA.schema.properties.discrepancies.items;
		expect(itemSchema.required).toContain("summary");
		expect(itemSchema.required).toContain("explanation");
		expect(itemSchema.required).toContain("sourceA");
		expect(itemSchema.required).toContain("sourceB");
		expect(itemSchema.required).toContain("suggestedResolution");
		expect(itemSchema.required).toContain("confidence");
		expect(itemSchema.required).toContain("rule");
		expect(itemSchema.required).toContain("contributorLogin");
		expect(itemSchema.required).toContain("contributorDisplayName");
		expect(itemSchema.additionalProperties).toBe(false);
	});

	it("enforces sourceA and sourceB structure", () => {
		const itemSchema =
			DISCREPANCY_ANALYSIS_SCHEMA.schema.properties.discrepancies.items;
		for (const source of ["sourceA", "sourceB"] as const) {
			const sourceSchema = itemSchema.properties[source];
			expect(sourceSchema.required).toContain("sourceName");
			expect(sourceSchema.required).toContain("state");
			expect(sourceSchema.required).toContain("url");
			expect(sourceSchema.required).toContain("itemId");
			expect(sourceSchema.additionalProperties).toBe(false);
		}
	});

	it("disallows additional properties at root", () => {
		expect(DISCREPANCY_ANALYSIS_SCHEMA.schema.additionalProperties).toBe(false);
	});
});

// ===================================================================
// buildVisibleWinsExtractionPrompt
// ===================================================================

describe("buildVisibleWinsExtractionPrompt", () => {
	function makeContext(
		overrides: Partial<VisibleWinsExtractionContext> = {},
	): VisibleWinsExtractionContext {
		return {
			projects: [],
			associations: [],
			notes: [],
			...overrides,
		};
	}

	function makeProjectTask(overrides: Partial<ProjectTask> = {}): ProjectTask {
		return {
			name: "API Gateway",
			gid: "proj-1",
			customFields: {},
			priorityScore: 60,
			...overrides,
		};
	}

	it("includes project with Child Tasks custom field", () => {
		const project = makeProjectTask({
			customFields: { "Child Tasks": "Task A, Task B" },
		});
		const prompt = buildVisibleWinsExtractionPrompt(
			makeContext({
				projects: [project],
				associations: [],
				notes: [],
			}),
		);
		expect(prompt).toContain("Contains tasks: Task A, Task B");
	});

	it("omits Child Tasks line when custom field is absent", () => {
		const project = makeProjectTask();
		const prompt = buildVisibleWinsExtractionPrompt(
			makeContext({
				projects: [project],
				associations: [],
				notes: [],
			}),
		);
		expect(prompt).not.toContain("Contains tasks:");
	});

	it("includes supplementary notes when provided", () => {
		const prompt = buildVisibleWinsExtractionPrompt(
			makeContext({
				supplementaryNotes: "VP note: Focus on billing migration this week.",
			}),
		);
		expect(prompt).toContain("Supplementary Notes");
		expect(prompt).toContain("VP note: Focus on billing migration this week.");
	});

	it("omits supplementary notes section when not provided", () => {
		const prompt = buildVisibleWinsExtractionPrompt(makeContext());
		expect(prompt).not.toContain("Supplementary Notes");
	});

	it("includes pre-matched discussion items for associated projects", () => {
		const project = makeProjectTask();
		const prompt = buildVisibleWinsExtractionPrompt(
			makeContext({
				projects: [project],
				associations: [
					{
						projectGid: "proj-1",
						projectName: "API Gateway",
						relevantItems: [
							"Discussed API rate limiting",
							"Reviewed gateway latency",
						],
						sourceNotes: ["standup.md"],
					},
				],
				notes: [],
			}),
		);
		expect(prompt).toContain("Pre-matched Discussion Items (2):");
		expect(prompt).toContain("Discussed API rate limiting");
		expect(prompt).toContain("Source Note Files: standup.md");
	});

	it("shows 'none' for projects without pre-matched items", () => {
		const project = makeProjectTask();
		const prompt = buildVisibleWinsExtractionPrompt(
			makeContext({
				projects: [project],
				associations: [],
				notes: [],
			}),
		);
		expect(prompt).toContain("Pre-matched Discussion Items: none");
	});

	it("includes meeting notes in the prompt", () => {
		const note: NormalizedNote = {
			title: "Weekly Sync",
			date: "2026-03-10",
			attendees: ["alice", "bob"],
			discussionItems: ["Reviewed sprint velocity"],
			sourceFile: "sync.md",
		};
		const prompt = buildVisibleWinsExtractionPrompt(
			makeContext({
				notes: [note],
			}),
		);
		expect(prompt).toContain("Note: Weekly Sync (2026-03-10) [sync.md]");
		expect(prompt).toContain("Reviewed sprint velocity");
	});

	it("includes priority tier labels", () => {
		const topPriority = makeProjectTask({ priorityScore: 90 });
		const highPriority = makeProjectTask({
			gid: "proj-2",
			name: "Billing",
			priorityScore: 55,
		});
		const standard = makeProjectTask({
			gid: "proj-3",
			name: "Docs",
			priorityScore: 30,
		});
		const prompt = buildVisibleWinsExtractionPrompt(
			makeContext({
				projects: [topPriority, highPriority, standard],
			}),
		);
		expect(prompt).toContain("TOP PRIORITY (Company Rock)");
		expect(prompt).toContain("Priority Tier: High");
		expect(prompt).toContain("Priority Tier: Standard");
	});
});

// ===================================================================
// buildRoadmapSynthesisPrompt — configured mode
// ===================================================================

describe("buildRoadmapSynthesisPrompt — configured mode", () => {
	function makeRoadmapContext(
		overrides: Partial<RoadmapSynthesisContext> = {},
	): RoadmapSynthesisContext {
		return {
			roadmapItems: [],
			accomplishments: [],
			notes: [],
			projects: [],
			mode: "configured",
			...overrides,
		};
	}

	function makeRoadmapEntry(
		overrides: Partial<RoadmapEntry> = {},
	): RoadmapEntry {
		return {
			gid: "gid-1",
			displayName: "Auth Overhaul",
			overallStatus: "on-track",
			nextMilestone: "Beta launch Mar 15",
			keyNotes: "",
			...overrides,
		};
	}

	function makeAccomplishment(
		overrides: Partial<ProjectAccomplishment> = {},
	): ProjectAccomplishment {
		return {
			projectName: "Auth Overhaul",
			projectGid: "gid-1",
			bullets: [
				{
					text: "Implemented SSO login",
					subBullets: [],
					sourceDates: [],
					sourceFigures: [],
					sourceNoteFile: "notes.md",
				},
			],
			...overrides,
		};
	}

	function makeNote(overrides: Partial<NormalizedNote> = {}): NormalizedNote {
		return {
			title: "Weekly Standup",
			date: "2026-03-10",
			attendees: ["alice"],
			discussionItems: ["Discussed auth timeline"],
			sourceFile: "standup.md",
			...overrides,
		};
	}

	function makeProject(overrides: Partial<ProjectTask> = {}): ProjectTask {
		return {
			name: "Auth Overhaul",
			gid: "gid-1",
			customFields: {},
			priorityScore: 10,
			...overrides,
		};
	}

	function makeSubtask(
		overrides: Partial<RoadmapSubtaskInfo> = {},
	): RoadmapSubtaskInfo {
		return {
			gid: "sub-1",
			name: "Design SSO flow",
			completed: false,
			children: [],
			...overrides,
		};
	}

	it("includes initiative header and status in configured mode", () => {
		const item = makeRoadmapEntry();
		const prompt = buildRoadmapSynthesisPrompt(
			makeRoadmapContext({
				roadmapItems: [item],
			}),
		);
		expect(prompt).toContain("Initiative: Auth Overhaul (GID: gid-1)");
		expect(prompt).toContain("Current Status: on-track");
		expect(prompt).toContain(
			"Next Milestone (pre-computed): Beta launch Mar 15",
		);
	});

	it("includes accomplishment bullets when present", () => {
		const item = makeRoadmapEntry();
		const acc = makeAccomplishment();
		const prompt = buildRoadmapSynthesisPrompt(
			makeRoadmapContext({
				roadmapItems: [item],
				accomplishments: [acc],
			}),
		);
		expect(prompt).toContain("Implemented SSO login");
		expect(prompt).toContain("This Week's Accomplishments:");
	});

	it("shows 'No accomplishments this week' when none match", () => {
		const item = makeRoadmapEntry({ gid: "gid-99" });
		const prompt = buildRoadmapSynthesisPrompt(
			makeRoadmapContext({
				roadmapItems: [item],
			}),
		);
		expect(prompt).toContain("No accomplishments this week.");
	});

	it("includes meeting notes when present", () => {
		const note = makeNote();
		const prompt = buildRoadmapSynthesisPrompt(
			makeRoadmapContext({
				notes: [note],
			}),
		);
		expect(prompt).toContain("Meeting: Weekly Standup (2026-03-10)");
		expect(prompt).toContain("Discussed auth timeline");
	});

	it("shows 'No meeting notes available' when notes are empty", () => {
		const prompt = buildRoadmapSynthesisPrompt(makeRoadmapContext());
		expect(prompt).toContain("No meeting notes available.");
	});

	it("includes Dev Done Target from project custom fields", () => {
		const item = makeRoadmapEntry();
		const project = makeProject({
			customFields: { "Dev Done Target (Current)": "2026-04-01" },
		});
		const prompt = buildRoadmapSynthesisPrompt(
			makeRoadmapContext({
				roadmapItems: [item],
				projects: [project],
			}),
		);
		expect(prompt).toContain("Dev Done Target: 2026-04-01");
	});

	it("falls back to Dev Done Target (Original) when Current is absent", () => {
		const item = makeRoadmapEntry();
		const project = makeProject({
			customFields: { "Dev Done Target (Original)": "2026-03-15" },
		});
		const prompt = buildRoadmapSynthesisPrompt(
			makeRoadmapContext({
				roadmapItems: [item],
				projects: [project],
			}),
		);
		expect(prompt).toContain("Dev Done Target: 2026-03-15");
	});

	it("includes Parent Task Notes when project notes are present", () => {
		const item = makeRoadmapEntry();
		const project = makeProject({
			notes:
				"UAT complete as of 4/06. Pilot release overdue. Rolling out Apr 13.",
		});
		const prompt = buildRoadmapSynthesisPrompt(
			makeRoadmapContext({
				roadmapItems: [item],
				projects: [project],
			}),
		);
		expect(prompt).toContain(
			"Parent Task Notes: UAT complete as of 4/06. Pilot release overdue. Rolling out Apr 13.",
		);
	});

	it("omits Parent Task Notes line when project has no notes", () => {
		const item = makeRoadmapEntry();
		const project = makeProject({ notes: null });
		const prompt = buildRoadmapSynthesisPrompt(
			makeRoadmapContext({
				roadmapItems: [item],
				projects: [project],
			}),
		);
		expect(prompt).not.toContain("Parent Task Notes:");
	});

	it("truncates long parent task notes and strips HTML tags", () => {
		const item = makeRoadmapEntry();
		const project = makeProject({
			notes: `<body>${"x".repeat(2000)}</body>`,
		});
		const prompt = buildRoadmapSynthesisPrompt(
			makeRoadmapContext({
				roadmapItems: [item],
				projects: [project],
			}),
		);
		const match = prompt.match(/Parent Task Notes: (.*)/);
		expect(match).not.toBeNull();
		const notesLine = (match as RegExpMatchArray)[1];
		expect(notesLine).not.toContain("<body>");
		expect(notesLine.endsWith("…")).toBe(true);
		expect(notesLine.length).toBeLessThanOrEqual(1501);
	});

	it("includes subtask notes snippet under each subtask line", () => {
		const subtaskMap = new Map<string, RoadmapSubtaskInfo[]>();
		subtaskMap.set("gid-1", [
			makeSubtask({
				name: "UAT cycle",
				notes: "Finished 4/05, regression clean. Luciano signed off.",
			}),
		]);
		const prompt = buildRoadmapSynthesisPrompt(
			makeRoadmapContext({
				roadmapItems: [makeRoadmapEntry()],
				subtasksByGid: subtaskMap,
			}),
		);
		expect(prompt).toContain("[TODO] UAT cycle");
		expect(prompt).toContain(
			"notes: Finished 4/05, regression clean. Luciano signed off.",
		);
	});

	it("serializes subtask tree with TODO/DONE/OVERDUE status", () => {
		const subtasks: RoadmapSubtaskInfo[] = [
			makeSubtask({
				name: "Done task",
				completed: true,
				completedAt: "2026-03-08T12:00:00Z",
			}),
			makeSubtask({
				gid: "sub-2",
				name: "Overdue task",
				completed: false,
				dueOn: "2026-01-01",
			}),
			makeSubtask({
				gid: "sub-3",
				name: "Future task",
				completed: false,
				dueOn: "2099-12-31",
			}),
		];
		const subtaskMap = new Map<string, RoadmapSubtaskInfo[]>();
		subtaskMap.set("gid-1", subtasks);

		const prompt = buildRoadmapSynthesisPrompt(
			makeRoadmapContext({
				roadmapItems: [makeRoadmapEntry()],
				subtasksByGid: subtaskMap,
			}),
		);
		expect(prompt).toContain("[DONE] Done task");
		expect(prompt).toContain("(completed 2026-03-08)");
		expect(prompt).toContain("[OVERDUE] Overdue task");
		expect(prompt).toContain("(due 2026-01-01)");
		expect(prompt).toContain("[TODO] Future task");
	});

	it("serializes nested subtask children with increased indent", () => {
		const child = makeSubtask({
			gid: "child-1",
			name: "Child task",
			completed: false,
		});
		const parent = makeSubtask({ name: "Parent task", children: [child] });
		const subtaskMap = new Map<string, RoadmapSubtaskInfo[]>();
		subtaskMap.set("gid-1", [parent]);

		const prompt = buildRoadmapSynthesisPrompt(
			makeRoadmapContext({
				roadmapItems: [makeRoadmapEntry()],
				subtasksByGid: subtaskMap,
			}),
		);
		expect(prompt).toContain("    - [TODO] Parent task");
		expect(prompt).toContain("      - [TODO] Child task");
	});

	it("shows 'No subtasks available' when subtask map is empty for item", () => {
		const prompt = buildRoadmapSynthesisPrompt(
			makeRoadmapContext({
				roadmapItems: [makeRoadmapEntry()],
			}),
		);
		expect(prompt).toContain("No subtasks available.");
	});

	it("shows TBD when nextMilestone is empty", () => {
		const item = makeRoadmapEntry({ nextMilestone: "" });
		const prompt = buildRoadmapSynthesisPrompt(
			makeRoadmapContext({
				roadmapItems: [item],
			}),
		);
		expect(prompt).toContain("Next Milestone (pre-computed): TBD");
	});

	it("includes structured output instructions", () => {
		const prompt = buildRoadmapSynthesisPrompt(makeRoadmapContext());
		expect(prompt).toContain(
			"Return structured JSON matching the provided schema.",
		);
		expect(prompt).toContain("synthesizing a roadmap progress table");
	});
});

// ===================================================================
// buildRoadmapSynthesisPrompt — ai-derived mode
// ===================================================================

describe("buildRoadmapSynthesisPrompt — ai-derived mode", () => {
	function makeAiDerivedContext(
		overrides: Partial<RoadmapSynthesisContext> = {},
	): RoadmapSynthesisContext {
		return {
			roadmapItems: [],
			accomplishments: [],
			notes: [],
			projects: [],
			mode: "ai-derived",
			...overrides,
		};
	}

	it("uses ai-derived prompt when mode is ai-derived", () => {
		const prompt = buildRoadmapSynthesisPrompt(makeAiDerivedContext());
		expect(prompt).toContain("No specific roadmap configuration was provided");
		expect(prompt).toContain("Identify the TOP initiatives");
	});

	it("includes accomplishment blocks in ai-derived mode", () => {
		const acc: ProjectAccomplishment = {
			projectName: "Billing Rewrite",
			projectGid: "gid-2",
			bullets: [
				{
					text: "Migrated invoicing to new engine",
					subBullets: [],
					sourceDates: [],
					sourceFigures: [],
					sourceNoteFile: "notes.md",
				},
			],
		};
		const prompt = buildRoadmapSynthesisPrompt(
			makeAiDerivedContext({
				accomplishments: [acc],
			}),
		);
		expect(prompt).toContain("Project: Billing Rewrite (GID: gid-2)");
		expect(prompt).toContain("Migrated invoicing to new engine");
	});

	it("shows 'No project data available' when accomplishments are empty", () => {
		const prompt = buildRoadmapSynthesisPrompt(makeAiDerivedContext());
		expect(prompt).toContain("No project data available.");
	});

	it("includes meeting notes in ai-derived mode", () => {
		const note: NormalizedNote = {
			title: "Sprint Retro",
			date: "2026-03-12",
			attendees: ["bob"],
			discussionItems: ["Reviewed velocity trends"],
			sourceFile: "retro.md",
		};
		const prompt = buildRoadmapSynthesisPrompt(
			makeAiDerivedContext({
				notes: [note],
			}),
		);
		expect(prompt).toContain("Meeting: Sprint Retro (2026-03-12)");
		expect(prompt).toContain("Reviewed velocity trends");
	});

	it("shows 'No meeting notes available' when notes are empty in ai-derived mode", () => {
		const prompt = buildRoadmapSynthesisPrompt(makeAiDerivedContext());
		expect(prompt).toContain("No meeting notes available.");
	});

	it("shows 'No accomplishments' for projects with empty bullets", () => {
		const acc: ProjectAccomplishment = {
			projectName: "Empty Project",
			projectGid: "gid-empty",
			bullets: [],
		};
		const prompt = buildRoadmapSynthesisPrompt(
			makeAiDerivedContext({
				accomplishments: [acc],
			}),
		);
		expect(prompt).toContain("No accomplishments.");
	});

	it("includes structured output instructions in ai-derived mode", () => {
		const prompt = buildRoadmapSynthesisPrompt(makeAiDerivedContext());
		expect(prompt).toContain(
			"Return structured JSON matching the provided schema.",
		);
	});
});
