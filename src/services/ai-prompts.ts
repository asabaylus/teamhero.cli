import type {
	LatestProjectStatus,
	RoadmapEntry,
	RoadmapSubtaskInfo,
	SectionAuditContext,
	VisibleWinsExtractionContext,
} from "../core/types.js";
import type {
	ReportMemberMetrics,
	ReportRenderInput,
} from "../lib/report-renderer.js";
import type { ContributorSummaryPayload } from "../models/individual-summary.js";
import type {
	NormalizedNote,
	ProjectAccomplishment,
	ProjectTask,
} from "../models/visible-wins.js";

export interface TeamHighlightContext {
	organization: string;
	windowHuman: string;
	windowStart: string;
	windowEnd: string;
	totals: {
		prs: number;
		prsMerged: number;
		repoCount: number;
		contributorCount: number;
	};
	highlights: string[];
	individualUpdates?: string[];
	/** Velocity context string for period-over-period trend narrative (Epic 5, Story 5.3). */
	velocityContext?: string;
	onStatus?: (message: string) => void;
}

export interface MemberHighlightContext {
	member: ReportMemberMetrics;
	windowHuman: string;
	onStatus?: (message: string) => void;
}

export interface MemberHighlightsContext {
	members: ReportMemberMetrics[];
	windowHuman: string;
	onStatus?: (message: string) => void;
}

export interface FinalReportContext {
	report: ReportRenderInput;
	onStatus?: (message: string) => void;
}

export type TechnicalWinsSubheadings = "auto" | string[];

export interface TechnicalWinsContext {
	windowStart: string;
	windowEnd: string;
	verbosity: "concise" | "standard" | "detailed";
	/**
	 * Either "auto" (let the AI infer 2–5 logical groupings) or an explicit
	 * ordered list of subheadings (e.g. ["AI / Engineering", "IT / Centre"]).
	 */
	subheadings: TechnicalWinsSubheadings;
	/** Short natural-language audience descriptor. */
	audience?: string;
	/** Raw bullets / notes from the current week's activity. */
	currentWeekItems: string[];
	/**
	 * Prior-week wins used strictly for deduplication. Should be pre-flattened
	 * into bullet strings by the caller.
	 */
	previousWeekItems?: string[];
	/**
	 * Rendered Visible Wins section text so the AI can cross-reference
	 * and avoid duplicating detail already covered there.
	 */
	visibleWinsSummary?: string;
	/**
	 * Roadmap entries (initiative names + status) so the AI can anchor
	 * wins to the strategic milestones the board cares about.
	 */
	roadmapContext?: string;
	onStatus?: (message: string) => void;
}

export interface IndividualSummariesContext {
	payloads: ContributorSummaryPayload[];
	windowHuman: string;
}

export function buildTeamPrompt(context: TeamHighlightContext): string {
	const windowStart = context.windowStart;
	const windowEnd = context.windowEnd;
	const totalPrs = context.totals.prs;
	const repoCount = context.totals.repoCount;
	const engineerCount = context.totals.contributorCount;
	const mergedCount = context.totals.prsMerged;

	const individualUpdatesText = context.individualUpdates?.join("\n") || "";

	const velocitySection = context.velocityContext
		? `\n• Velocity trends:\n${context.velocityContext}\nIf notable velocity changes (>20% delta) exist, briefly reference them in the narrative to explain trends.`
		: "";

	const prompt = `Using the individual updates below, write a concise executive overview suitable for a CTO to forward to ELT. Maintain the opening metrics line exactly in this format, then follow with a single narrative paragraph for Key themes that synthesizes drivers, outcomes, risks, and next steps. Avoid bullets and numbered lists. Use direct, confident language, present tense where possible, and keep it vendor-neutral. Focus on business impact rather than implementation detail. De-duplicate overlapping items and remove the section titled 'Top Highlights.' Do not introduce new work that is not present in the inputs. Keep total length of the Key themes paragraph between 120 and 180 words. Do not use em dashes.

Inputs:
• Window: ${windowStart}–${windowEnd}
• Totals: ${totalPrs} PRs across ${repoCount} repositories, ${engineerCount} engineers contributing, ${mergedCount} merged during the window
• Organizational context to prefer in synthesis: Salesforce Health Cloud, patient encounter model alignment, routing and data quality, permission-gated rollouts, operational reliability${velocitySection}
• Individual updates (verbatim, may include duplicates):
${individualUpdatesText}

Output format:
Overview:
Processed ${totalPrs} PRs across ${repoCount} repositories, with contributions from ${engineerCount} engineers, ${mergedCount} merged during the window. Key themes: {Generate one tight narrative paragraph that explains what changed, why it matters to the business, what risks exist, and what is coming next. Mention cross-team implications and measurable outcomes like reliability, throughput, data quality, coordinator efficiency, or audit readiness. Keep proper nouns and product names accurate. No bullets, no lists, no em dashes.}`;

	return prompt;
}

export function buildMemberHighlightsPrompt(
	context: MemberHighlightsContext,
): string {
	const header = [
		"You are an expert technical writer summarizing engineering work for leadership review.",
		`Time window: ${context.windowHuman}.`,
		"For each contributor, write a single cohesive paragraph (80-120 words) that describes their work at a functional level.",
		"",
		"Requirements:",
		"1. Focus on WHAT was built and WHY it matters—describe features, functionality, and business impact, not PR numbers or commit hashes.",
		"2. Group related work into logical themes (e.g., 'enrollment routing logic', 'Salesforce configuration', 'observability improvements').",
		"3. Translate technical changes into plain language outcomes (e.g., 'routes higher-priority patients first' instead of 'merged PR #2407').",
		"4. Lead with the most significant contribution, then describe supporting work in logical order.",
		"5. Use flowing narrative prose—avoid lists, bullet points, or technical jargon like PR numbers.",
		"6. Omit phrases like 'merged PR #X', 'commit abc123', or low-level implementation details unless they clarify a major architectural decision.",
		"7. If work is in-progress or under review, describe it as 'in progress' or 'under review' without implying it shipped.",
		"8. Closed PRs represent completed development work—describe what was built, even if not merged.",
		`9. Only respond with "No notable shipped outcomes were delivered by <Display Name> during ${context.windowHuman}." if there are NO PRs, commits, or tasks at all.`,
		"",
		'Return strictly valid JSON: {"member-login": "narrative paragraph"}',
		"Output JSON only—no markdown, commentary, or trailing commas.",
	];

	const blocks = context.members.map((member, index) =>
		buildMemberHighlightsBlock(member, context.windowHuman, index + 1),
	);

	return [...header, "", "Members:", ...blocks].join("\n");
}

function summarizeTasksForPrompt(
	tasks: ReportMemberMetrics["asana"]["tasks"],
): string[] {
	return tasks
		.filter((task) => task.status === "completed" || Boolean(task.completedAt))
		.map((task) => {
			const segments: string[] = [];
			if (task.name) {
				segments.push(
					truncateForPrompt(task.name.replace(/\s+/g, " ").trim(), 120),
				);
			}
			if (task.description) {
				const narrative = truncateForPrompt(
					task.description.replace(/\s+/g, " ").trim(),
					200,
				);
				if (narrative.length > 0) {
					segments.push(narrative);
				}
			}
			return segments.filter(Boolean).join(" — ");
		})
		.filter((entry) => entry.length > 0);
}

function truncateForPrompt(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}
	return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

export function buildFinalReportPrompt(report: ReportRenderInput): string {
	const detailGuidance = report.showDetails
		? [
				"11. Detailed listings are enabled. The system will automatically append detailed PR and commit listings after your narrative. Focus on writing the narrative summaries only.",
			]
		: [
				"11. Do not create additional bullet sections unless the data explicitly includes them; stick to paragraphs only for contributor updates.",
			];

	const instructions = [
		"You are acting as a VP of Engineering providing a concise weekly update to the CTO.",
		"Given a raw weekly activity report with GitHub stats, PR counts, commit details, and Asana tasks, generate a polished executive summary using the template provided below.",
		"",
		"Instructions:",
		"1. Use a clear, professional, and objective tone suitable for a CTO. Do not include praise, speculation, or character judgments.",
		'2. The At-a-Glance Summary must list every contributor individually — do not create aggregate rows such as "Others" or use value ranges.',
		"3. Present Top Highlights as a single bullet list of the most important accomplishments or themes; do not create nested categories.",
		"4. In Individual Updates, create a dedicated subsection for each contributor using the format `### {Display Name} (@{login})`.",
		"5. Write one or two short paragraphs (default to one) for each contributor; the opening paragraph must narrate their completed Asana tasks in plain English and connect them to user or operational value. If no tasks were completed, state that explicitly in the first paragraph.",
		"6. Use the supplied task descriptions and comment excerpts to describe the customer or operational impact without inventing new details.",
		"7. Rephrase raw titles into narrative language and omit PR numbers, commit hashes, or low-level test instructions while keeping descriptions factual.",
		"8. Summaries must prioritize shipped outcomes and clearly note the state of any in-flight work without implying completion.",
		"9. Avoid repeating information between sections and do not introduce extra sections beyond the template.",
		"10. Follow the Markdown template exactly, filling in all relevant data from the raw report.",
		...detailGuidance,
		"",
		"Markdown Template:",
		"# Weekly Engineering Summary ({{start_date}} – {{end_date}})",
		"",
		"**Overview:**  ",
		"High-level summary of overall activity, including PR count, key themes, and general trends.  ",
		"",
		"---",
		"",
		"## **At-a-Glance Summary**",
		"| Developer        | Commits | PRs Opened | PRs Merged | Lines Added | Lines Deleted | Reviews |",
		"|------------------|--------:|-----------:|-----------:|------------:|--------------:|--------:|",
		"| {{Developer Name}} | {{Commits}} | {{PRs Total}} | {{PRs Merged}} | {{Lines Added}} | {{Lines Deleted}} | {{Reviews}} |",
		"",
		"> *Note: This table provides a quick view of activity across the team. Reviews are counted as approved, changes requested, or commented.*",
		"",
		"---",
		"",
		"## **Top Highlights**",
		"- {{Highlight 1}}",
		"- {{Highlight 2}}",
		"- {{Highlight 3}}",
		"",
		"---",
		"",
		"## **Individual Updates**",
		"",
		"### {{Contributor Name}} (@{{login}})",
		"Paragraph summarizing their contributions.",
		"",
		"### {{Another Contributor}} (@{{login}})",
		"Paragraph summarizing their contributions.",
		"",
		"---",
		"",
		"## **Next Steps**",
		"- Bullet list of key priorities or follow-ups for the coming week.",
	].join("\n");

	const data = serializeReportData(report);
	return `${instructions}\n\nRaw data:\n${JSON.stringify(data)}\n\nGenerate the Markdown report now.`;
}

export function buildIndividualSummariesPrompt(
	context: IndividualSummariesContext,
): string {
	const header = [
		"You are assisting an engineering director preparing concise weekly report blurbs for each individual contributor.",
		`Reporting window: ${context.windowHuman}.`,
		"Summaries must be factual, reference concrete shipped work, and stay under 80 words.",
		"Write in third person — describe the contributor as an outside observer would (e.g. 'Led delivery of…', 'Shipped a fix for…'). Never use first person ('I', 'my').",
		"Describe the impact on customers, operations, or the codebase in plain language. If no shipped work exists, state that explicitly without speculation.",
		'Return strictly valid JSON with the shape {"summaries": [{"login": string, "summary": string}]}.',
		"Do not include markdown fences, code blocks, or commentary—JSON only.",
		"If a contributor has no meaningful updates, output the exact sentence 'No notable contributions were recorded during this reporting window.' for that person.",
		"Use the data provided for each contributor; do not invent work or extrapolate beyond the inputs.",
	];

	const blocks = context.payloads.map((payload, index) =>
		buildIndividualSummaryBlock(payload, index + 1),
	);

	return [...header, "", "Contributors:", ...blocks].join("\n");
}

export const TECHNICAL_WINS_SCHEMA = {
	type: "json_schema" as const,
	name: "technical_foundational_wins",
	strict: true,
	schema: {
		type: "object" as const,
		properties: {
			categories: {
				type: "array" as const,
				items: {
					type: "object" as const,
					properties: {
						category: { type: "string" as const },
						wins: {
							type: "array" as const,
							items: { type: "string" as const },
						},
					},
					required: ["category", "wins"] as const,
					additionalProperties: false as const,
				},
			},
		},
		required: ["categories"] as const,
		additionalProperties: false as const,
	},
} as const;

const TECHNICAL_WINS_VERBOSITY_GUIDE: Record<
	TechnicalWinsContext["verbosity"],
	string
> = {
	concise: "Terse, outcome-only. No explanation or context.",
	standard: "Include brief context (one short clause per bullet).",
	detailed: "Include impact or rationale (one short sentence max per bullet).",
};

export function buildTechnicalWinsPrompt(
	context: TechnicalWinsContext,
): string {
	const current = context.currentWeekItems
		.filter((x) => x && x.trim().length > 0)
		.map((x) => `- ${x}`)
		.join("\n");

	const subheadingsInstruction =
		context.subheadings === "auto"
			? "Infer 2-5 logical groupings based on themes (e.g. AI / Engineering, DevOps, IT / Centre, Product, Infrastructure). Group for readability, not strict taxonomy."
			: `Use exactly these subheadings in this order: ${context.subheadings
					.map((s) => `"${s}"`)
					.join(
						", ",
					)}. If a subheading has no wins this week, include the category with a single bullet: "No material changes this week".`;

	const audienceLine = context.audience
		? `Audience: ${context.audience}. Adapt tone accordingly. Do NOT mention the audience explicitly.`
		: "Audience: engineering leadership. Adapt tone accordingly. Do NOT mention the audience explicitly.";

	const previousItems = (context.previousWeekItems ?? [])
		.filter((x) => x && x.trim().length > 0)
		.map((x) => `- ${x}`)
		.join("\n");

	const deduplicationSection = previousItems
		? [
				"",
				"Deduplication rules:",
				"- Do NOT repeat wins already present in the previous report below.",
				"- If a win appears in both weeks, include it ONLY if there is meaningful progress or change.",
				"- Prefer delta-oriented phrasing when overlap exists (e.g. 'Expanded X from 50 to 130 users' instead of 'Deployed X').",
				"",
				"Previous report wins (for deduplication only):",
				previousItems,
			]
		: [];

	const crossRefSection: string[] = [];
	if (context.visibleWinsSummary) {
		crossRefSection.push(
			"",
			"Visible Wins section (already shown to the reader — do NOT repeat detail from here; at most, consolidate into a single status signal like 'Costs on track with budget'):",
			context.visibleWinsSummary,
		);
	}
	if (context.roadmapContext) {
		crossRefSection.push(
			"",
			"Quarterly Roadmap initiatives (anchor wins to these milestones when relevant):",
			context.roadmapContext,
		);
	}

	return [
		"You are generating a 'This Week's Technical / Foundational Wins' section for an engineering status report.",
		"",
		"PURPOSE:",
		"This section highlights wins in IT, DevOps, AI, and Engineering — the technical and foundational layer beneath the product work.",
		"It is NOT about product milestones or business outcomes (those belong in the Visible Wins section).",
		"Think: what did the engineering organization build, deploy, automate, standardize, or improve in its own infrastructure, tooling, processes, and platforms this week?",
		"",
		"CATEGORY DEFINITIONS (use only these, in this order, omitting any with no wins):",
		"1. IT — Infrastructure, security, compliance, cost management, user tooling rollouts. Examples: 'Deployed ActivTrak to 130 users', 'SOC 2 handoff on track for Apr 13', 'Costs on track with budget'.",
		"2. DevOps — CI/CD improvements, pipeline changes, test automation, deployment process improvements. Examples: 'Implemented end-to-end tests running in CI pipeline', 'Cut deployment cycle from 2 weeks to 3 days'.",
		"3. AI — AI tooling, agent capabilities, model integrations, prompt engineering. Examples: 'Introduced 5 new Claude slash commands (push-to-verdict, release-notes, etc.)', 'Added CSV export for mail-api report output'.",
		"4. Engineering — Code standardization, architecture improvements, tech debt reduction, developer experience. Examples: 'Standardized Apex trigger patterns across 4 repos', 'Corrected Salesforce page layout drift across operations flow'.",
		"",
		"HARD CONSTRAINTS ON OUTPUT SHAPE:",
		"- Use 2–4 of the categories above. Never invent new categories.",
		"- Each category should have 1–4 bullets.",
		"- Total output should be 4–10 bullets across all categories.",
		"- Omit a category entirely if the source data has nothing that fits it.",
		"",
		"WHAT TO EXCLUDE (strict rules):",
		"- Product milestone progress (GCCW pilot status, RVM phases, messaging rollouts) — those belong in Visible Wins, not here.",
		"- Incidents, outages, or failures — even if recovery was fast.",
		"- Ownership assignments and staffing decisions.",
		"- Items already described in the Visible Wins section — do not duplicate.",
		"",
		"BULLET STYLE:",
		`- ${audienceLine}`,
		`- Verbosity: ${context.verbosity}. ${TECHNICAL_WINS_VERBOSITY_GUIDE[context.verbosity]}`,
		"- Keep each bullet to one concise sentence fragment, ideally 8–14 words, never more than 18 words.",
		"- Use parallel phrasing across bullets.",
		"- No duplication across categories.",
		"",
		`Grouping: ${subheadingsInstruction}`,
		`Date window: ${context.windowStart} to ${context.windowEnd}.`,
		...crossRefSection,
		...deduplicationSection,
		"",
		"Current-week source items:",
		current || "- (none)",
		"",
		"Return structured JSON matching the provided schema. Each category object has a 'category' string and a 'wins' array of strings.",
	].join("\n");
}

function buildIndividualSummaryBlock(
	payload: ContributorSummaryPayload,
	index: number,
): string {
	const data = {
		login: payload.contributor.login,
		displayName: payload.contributor.displayName,
		metrics: payload.metrics,
		highlights: payload.highlights,
		pullRequestSummary: {
			total: payload.pullRequests.length,
			merged: payload.pullRequests.filter((pr) => pr.status === "MERGED")
				.length,
			open: payload.pullRequests.filter((pr) => pr.status === "OPEN").length,
		},
		asana: {
			status: payload.asana.status,
			message: payload.asana.message,
			completedTasksCount: payload.asana.tasks.filter((task) =>
				Boolean(task.completedAt),
			).length,
			taskSummaries: payload.asana.tasks.map((task) => ({
				name: truncateForPrompt(task.name, 160),
				completedAt: task.completedAt,
				description: task.description
					? truncateForPrompt(task.description, 300)
					: undefined,
			})),
		},
	};

	return `Contributor ${index}: ${JSON.stringify(data)}`;
}

function buildMemberHighlightsBlock(
	member: ReportMemberMetrics,
	windowHuman: string,
	position: number,
): string {
	const sanitize = (value: string) => value.replace(/\s+/g, " ").trim();
	const prHighlights = member.prHighlights
		.map(sanitize)
		.filter(
			(highlight) => highlight !== "No PRs found." && highlight.length > 0,
		);
	const deliveredPrs = prHighlights.filter(
		(highlight) => !/(open|draft|in review|closed)/i.test(highlight),
	);
	const inReviewPrs = prHighlights.filter((highlight) =>
		/(open|draft|in review)/i.test(highlight),
	);
	const closedPrs = prHighlights.filter((highlight) =>
		/(closed)/i.test(highlight),
	);
	const prLines: string[] = [];
	if (deliveredPrs.length > 0) {
		prLines.push(`Delivered work: ${deliveredPrs.join("; ")}.`);
	}
	if (inReviewPrs.length > 0) {
		prLines.push(`In review: ${inReviewPrs.join("; ")}.`);
	}
	if (closedPrs.length > 0) {
		prLines.push(
			`Closed PRs (development completed): ${closedPrs.join("; ")}.`,
		);
	}
	if (prLines.length === 0) {
		prLines.push("Delivered work: none recorded in the window.");
	}
	const commitHighlights = member.commitHighlights
		.map(sanitize)
		.filter((highlight) => highlight.length > 0);
	const commitContext =
		commitHighlights.length > 0
			? `Supporting commits: ${commitHighlights.join("; ")}.`
			: "Supporting commits: none recorded in the window.";
	const completedTasks = (member.taskTracker.tasks ?? [])
		.filter((task) => task.status === "completed" || Boolean(task.completedAt))
		.map((task) => {
			const segments: string[] = [];
			if (task.name) {
				segments.push(sanitize(task.name));
			}
			if (task.description) {
				segments.push(sanitize(task.description));
			}
			if (task.comments && task.comments.length > 0) {
				const comments = task.comments
					.map(sanitize)
					.filter(Boolean)
					.join(" | ");
				if (comments.length > 0) {
					segments.push(`Comments: ${comments}`);
				}
			}
			return segments.filter(Boolean).join(" — ");
		})
		.filter((entry) => entry.length > 0);
	const taskContext =
		completedTasks.length > 0
			? `Operational tasks: ${completedTasks.join("; ")}.`
			: "Operational tasks: No completed Asana tasks recorded in the window.";
	const additional = member.highlights
		.map(sanitize)
		.filter((highlight) => highlight.length > 0);
	const additionalLine =
		additional.length > 0
			? `Additional highlights: ${additional.join("; ")}.`
			: "";
	const metrics = `Metrics: Commits=${member.commits}; PRs=${member.prsTotal}; Merged=${member.prsMerged}; Reviews=${member.reviews}; Lines added=${member.linesAdded}.`;
	return [
		`Member ${position}: ${member.displayName} (${member.login})`,
		metrics,
		...prLines,
		commitContext,
		taskContext,
		additionalLine,
		`Reminder: Output JSON entry { "${member.login}": "<sentence>" }`,
		`Window reference: ${windowHuman}.`,
	]
		.filter((line) => line.trim().length > 0)
		.join("\n");
}

export type { VisibleWinsExtractionContext } from "../core/types.js";

/**
 * JSON Schema for Visible Wins AI extraction.
 * Used with OpenAI Responses API text.format + json_schema + strict: true.
 */
export const VISIBLE_WINS_SCHEMA = {
	type: "json_schema" as const,
	name: "visible_wins_extraction",
	strict: true,
	schema: {
		type: "object" as const,
		properties: {
			accomplishments: {
				type: "array" as const,
				items: {
					type: "object" as const,
					properties: {
						projectName: { type: "string" as const },
						projectGid: { type: "string" as const },
						bullets: {
							type: "array" as const,
							items: {
								type: "object" as const,
								properties: {
									text: { type: "string" as const },
									subBullets: {
										type: "array" as const,
										items: { type: "string" as const },
									},
									sourceDates: {
										type: "array" as const,
										items: { type: "string" as const },
									},
									sourceFigures: {
										type: "array" as const,
										items: { type: "string" as const },
									},
									sourceNoteFile: { type: "string" as const },
								},
								required: [
									"text",
									"subBullets",
									"sourceDates",
									"sourceFigures",
									"sourceNoteFile",
								] as const,
								additionalProperties: false as const,
							},
						},
					},
					required: ["projectName", "projectGid", "bullets"] as const,
					additionalProperties: false as const,
				},
			},
		},
		required: ["accomplishments"] as const,
		additionalProperties: false as const,
	},
} as const;

export function buildVisibleWinsExtractionPrompt(
	context: VisibleWinsExtractionContext,
): string {
	const { projects, associations, notes, reportingWindow } = context;

	const associationsByGid = new Map(associations.map((a) => [a.projectGid, a]));

	// Always include ALL projects so the AI has the full set of valid names and GIDs.
	// Projects with pre-matched discussion items get those listed; others get "none matched".
	const projectBlock = projects.map((p) => {
		const association = associationsByGid.get(p.gid);
		const hasItems = association && association.relevantItems.length > 0;
		const priorityTier =
			p.priorityScore >= 80
				? "TOP PRIORITY (Company Rock)"
				: p.priorityScore >= 50
					? "High"
					: "Standard";
		const lines = [
			`Project: ${p.name} (GID: ${p.gid})`,
			`  Priority Score: ${p.priorityScore} — Priority Tier: ${priorityTier}`,
		];
		const childTasks = p.customFields?.["Child Tasks"];
		if (childTasks) {
			lines.push(`  Contains tasks: ${childTasks}`);
		}
		if (hasItems) {
			lines.push(
				`  Pre-matched Discussion Items (${association.relevantItems.length}):`,
				...association.relevantItems.map((item) => `    - ${item}`),
				`  Source Note Files: ${association.sourceNotes.join(", ")}`,
			);
		} else {
			lines.push(
				"  Pre-matched Discussion Items: none (scan Meeting Notes below for mentions of this project)",
			);
		}
		return lines.join("\n");
	});

	const noteBlock = notes.map((n) =>
		[
			`Note: ${n.title} (${n.date}) [${n.sourceFile}]`,
			`  Attendees: ${n.attendees.join(", ") || "none"}`,
			"  Discussion Items:",
			...n.discussionItems.map((item) => `    - ${item}`),
		].join("\n"),
	);

	const supplementsBlock = context.supplementaryNotes
		? [
				"",
				"Supplementary Notes (manually provided by the VP of Engineering — treat as authoritative):",
				context.supplementaryNotes,
			]
		: [];

	const prompt = [
		"You are an expert engineering writer extracting executive-ready accomplishment bullets from meeting notes for a weekly CTO report.",
		"",
		"Instructions:",
		"1. For each project, produce concise accomplishment bullets that frame work in terms of business value — dates, costs/revenue, and outcomes.",
		"2. CRITICAL — FORBIDDEN TECHNICAL TERMS: The following terms must NEVER appear in bullet text. Replace them with the business-language equivalent shown:",
		"  - Apex, Trigger, Batch Job, Flow, Process Builder → 'automation' or 'workflow'",
		"  - UAT → 'testing environment' or 'testing'",
		"  - CTI → 'phone integration'",
		"  - Metadata API, REST API, SOQL → omit entirely or say 'system integration'",
		"  - Custom Object, Custom Field, Big Object, sObject → 'data model' or omit",
		"  - Sandbox, Org → 'environment'",
		"  - Deployment pipeline, CI/CD, PR, Pull Request → 'release process'",
		"  - Feature flag → 'staged rollout'",
		"  - Playwright, Jest, test automation → 'automated testing'",
		"  - Async, synchronous, refactor → omit or describe the business outcome",
		"  - Record count (e.g. '19,071 records') → describe the outcome ('data gap closed', 'backlog cleared')",
		"  If a bullet cannot be written without these terms, rewrite it to describe the BUSINESS OUTCOME instead.",
		"3. Each bullet must be attributed to a specific project by name and GID. Use the EXACT projectName and projectGid from the Projects list above.",
		"4. The projectName field MUST be the exact project name from the input — do not append parenthetical descriptions, summaries, or topic labels (e.g. use 'Whisper Flow', never 'Whisper Flow (MSI distribution)').",
		"5. Do NOT prefix bullet text with the project name or an em dash. The project name is already rendered as a heading; bullet text should contain only the accomplishment content (e.g. 'MSI distribution scheduled for Feb 10th', not 'Whisper Flow — MSI distribution scheduled for Feb 10th').",
		"6. Use direct, confident executive language. State outcomes definitively ('Pilot delayed to Mar 2', not 'Pilot tentatively moved to Mar 4'). Never hedge with 'tentatively', 'potentially', or 'may'. If the status is uncertain, frame it as a blocker ('Pilot blocked on LOA approval') rather than hedging.",
		"6a. STATUS DISAMBIGUATION: For all projects, explicitly state whether milestones are 'completed', 'in progress', 'scheduled for [exact date]', or 'blocked on [reason]'. Never use ambiguous phrasing like 'planned for Monday' or 'launch planned'. Instead write 'Pilot scheduled to start Mar 2' or 'Pilot launched Mar 2 with Team Leads'. The CTO uses these bullets to verify progress against commitments; ambiguity generates immediate follow-up questions.",
		"6b. TOP-PRIORITY PROJECTS: Projects marked as 'TOP PRIORITY (Company Rock)' in the Projects list require the most detailed and precise status bullets. Include: current state, what changed this week, what is next, and any blockers. Every bullet for a Rock must pass this test: 'Could the CTO forward this to the board without needing to ask a follow-up question?'",
		...(reportingWindow
			? [
					`6c. RETROSPECTIVE FRAMING: This report covers ${reportingWindow.startDate} through ${reportingWindow.endDate} and will be reviewed several days later. You have meeting notes from multiple days within this window. When an earlier meeting mentions a planned event with a concrete date (e.g., 'production deployment Mar 11th', 'permission-set assignments Mar 12th morning'), cross-reference LATER meeting notes to verify whether it actually happened: (a) If a later meeting confirms delivery (e.g., 'deployment went smoothly', 'permissions assigned'), state it as completed — 'Production deployed Mar 11th'. (b) If a later meeting says it was delayed, blocked, or rescheduled, report that — 'Deployment delayed; rescheduled to Mar 14th'. (c) If the date has passed but NO later meeting mentions the outcome, report it as unconfirmed — 'Deployment targeted for Mar 11th; outcome not confirmed in follow-up notes'. (d) For events with dates clearly after ${reportingWindow.endDate}, use 'scheduled for [date]'. The CTO reads this days after the period closes; 'scheduled for' on a past date signals the writer doesn't know whether it happened.`,
				]
			: []),
		"7. Each bullet should express a single outcome or status (e.g. 'Pilot on track for Mar 2', 'Updates deployed to testing; validation started', 'Visibility criteria defined for pre-call and in-call sections'). Do not bury multiple ideas in one long bullet.",
		"8. Keep bullets short and punchy (about 6–15 words). If you need to cover multiple related items, create separate top-level bullets.",
		"9. THIS IS A STRICT RULE: Focus on WHAT changed and WHAT is blocked, not HOW it was implemented. The CTO does not read code — translate ALL technical work into business outcomes. Every bullet must pass this test: 'Would a non-technical executive understand this without asking for clarification?'",
		"9a. EARLY-STAGE PROJECTS: For projects where meeting notes show planning, estimation, or decision-making activity but no shipped code, engineering-side progress IS the update. Surface: (a) tech plan and approach decisions, (b) POC results and technology stack choices, (c) engineering milestones and time estimates, (d) next engineering steps. If a project has been discussed across multiple weeks with no engineering-specific deliverables, note this gap explicitly — it is a risk signal the CTO needs.",
		"10. Avoid explanatory tails like 'to avoid user error' or 'to enable reliable testing' unless they are essential. Summarize the impact instead (e.g. 'Simplified call-type selection to reduce user error during pilot').",
		"11. Prefer concrete, current statuses and decisions over future plans; if describing a decision, phrase it as a decision or constraint.",
		"12. Include specific dates mentioned in discussion items in the sourceDates array using friendly format (e.g. 'Feb 3rd', 'Mar 22nd', 'Jan 10th'). Never use ISO format like YYYY-MM-DD.",
		"13. Include specific dollar amounts, percentages, numeric figures, and cost comparisons mentioned in discussion items in the sourceFigures array. Cost data is high-priority for CTO review — always surface it (e.g. '$14.7k forecast', '$20k/month approved', 'down from $15.4k').",
		"13a. REGRESSION AND TREND DETECTION: When notes mention a metric alongside a prior or expected baseline (e.g., '67% before release, now 49%'), ALWAYS include BOTH values and flag the direction of change. Frame regressions explicitly: 'Auto-transfer rate dropped from 67% to 49% after Feb 27th release.' Never present a post-change metric in isolation when historical context exists in the notes. The CTO compares week-over-week numbers; a decline without explanation triggers immediate escalation.",
		"13b. Include comparative context for cost data as well. If a cost was $15.4k last month and is now $17k, include both values and the percentage change. If a success rate changed, include both the before and after.",
		"14. Set sourceNoteFile to the filename of the meeting note the bullet was primarily derived from.",
		"15. NEVER nest bullet points. Always use flat, top-level bullets. The subBullets array must always be empty.",
		"16. If a project appears in the Projects list but has NO relevant mentions in meeting notes and NO pre-matched discussion items, include it in the output with a single bullet: 'No change this period.' This ensures the CTO sees all tracked projects and knows that omission is intentional, not an oversight.",
		"17. Do not invent facts, figures, or dates not present in the source material.",
		"18. If a project has discussion items but no concrete accomplishments, still produce a status-oriented bullet.",
		"19. STRICT PROJECT BOUNDARY: Each discussion item must be attributed to exactly ONE project — the project it actually discusses. A discussion item about 'Postcard' belongs under the Postcard project, NOT under 'AWS Connect'. A discussion item about 'ECP' belongs under the ECP project. Match by the topic being discussed, not by which meeting it appeared in. A discussion item that mentions costs, pricing, or financial analysis belongs to the PROJECT being costed — not to a project named 'Costs' unless the item specifically discusses that project's tracked Asana work. Match by the primary subject of the discussion, not by incidental word overlap with a project name.",
		"20. Scan the Meeting Notes for ALL mentions of each project. Some projects have pre-matched items; others require you to identify relevant discussion items from the notes. When scanning, match by the project's actual tracked work and scope — not by generic words that happen to appear in the project name. A note about 'Marketing Cloud add-on cost analysis' belongs to whichever project owns that marketing initiative, not to a project named 'Costs'.",
		"21. When meeting notes mention a specific person responsible for an action, pending decision, or blocker, include their name in the bullet (e.g. 'Jessica to announce release', 'LOAs waiting on Rachel approval'). Named accountability is critical for CTO review.",
		"22. When a deployment or release date is mentioned, include the exact date and day of week if available (e.g. 'deployment Tuesday Feb 17th', not 'deployment next week'). The CTO uses these dates to verify progress.",
		"23. COST AS FIRST-CLASS CATEGORY: If cloud infrastructure costs, SaaS spending, or operational cost changes are discussed in meeting notes but not associated with a tracked project, create a dedicated entry under project name 'Cost & Infrastructure' with the GID set to 'cost-infrastructure'. Always include: current amount, trend vs prior period (with both values), and root cause if mentioned. Cost visibility is critical for CTO review.",
		"",
		...(reportingWindow
			? [
					`Reporting Period: ${reportingWindow.startDate} through ${reportingWindow.endDate}. This is a RETROSPECTIVE report — you are summarizing work that has already occurred or is currently in flight.`,
					"",
				]
			: []),
		"Projects:",
		...projectBlock,
		"",
		"Meeting Notes:",
		...noteBlock,
		...supplementsBlock,
		"",
		"Return structured JSON matching the provided schema.",
	].join("\n");

	return prompt;
}

function serializeReportData(report: ReportRenderInput) {
	return {
		window: report.window,
		showDetails: report.showDetails,
		totals: report.totals,
		highlights: report.globalHighlights,
		filters: report.filters,
		metricsDefinition: report.metricsDefinition,
		archivedNote: report.archivedNote,
		members: report.memberMetrics.map((member) => ({
			login: member.login,
			displayName: member.displayName,
			commits: member.commits,
			prsMerged: member.prsMerged,
			prsTotal: member.prsTotal,
			linesAdded: member.linesAdded,
			linesDeleted: member.linesDeleted,
			reviews: member.reviews,
			approvals: member.approvals,
			changesRequested: member.changesRequested,
			commented: member.commented,
			reviewComments: member.reviewComments,
			aiSummary: member.aiSummary,
			prHighlights: member.prHighlights,
			commitHighlights: member.commitHighlights,
			asana: {
				status: member.taskTracker.status,
				message: member.taskTracker.message,
				completedTasksCount: member.taskTracker.tasks.filter(
					(task) => task.status === "completed" || Boolean(task.completedAt),
				).length,
				completedTasks: summarizeTasksForPrompt(member.taskTracker.tasks ?? []),
			},
		})),
	};
}

// ---------------------------------------------------------------------------
// AI audit: Discrepancy analysis (single-step pipeline)
// ---------------------------------------------------------------------------

/**
 * JSON Schema for discrepancy analysis.
 * Used with OpenAI Responses API text.format + json_schema + strict: true.
 */
export const DISCREPANCY_ANALYSIS_SCHEMA = {
	type: "json_schema" as const,
	name: "discrepancy_analysis",
	strict: true,
	schema: {
		type: "object" as const,
		properties: {
			discrepancies: {
				type: "array" as const,
				items: {
					type: "object" as const,
					properties: {
						summary: { type: "string" as const },
						explanation: { type: "string" as const },
						sourceA: {
							type: "object" as const,
							properties: {
								sourceName: { type: "string" as const },
								state: { type: "string" as const },
								url: { type: "string" as const },
								itemId: { type: "string" as const },
							},
							required: ["sourceName", "state", "url", "itemId"] as const,
							additionalProperties: false as const,
						},
						sourceB: {
							type: "object" as const,
							properties: {
								sourceName: { type: "string" as const },
								state: { type: "string" as const },
								url: { type: "string" as const },
								itemId: { type: "string" as const },
							},
							required: ["sourceName", "state", "url", "itemId"] as const,
							additionalProperties: false as const,
						},
						suggestedResolution: { type: "string" as const },
						confidence: { type: "number" as const },
						rule: { type: "string" as const },
						contributorLogin: { type: "string" as const },
						contributorDisplayName: { type: "string" as const },
					},
					required: [
						"summary",
						"explanation",
						"sourceA",
						"sourceB",
						"suggestedResolution",
						"confidence",
						"rule",
						"contributorLogin",
						"contributorDisplayName",
					] as const,
					additionalProperties: false as const,
				},
			},
		},
		required: ["discrepancies"] as const,
		additionalProperties: false as const,
	},
} as const;

/**
 * Build a discrepancy-analysis prompt from raw claims and evidence.
 * The model extracts facts and identifies discrepancies in a single pass.
 */
export function buildDiscrepancyAnalysisPrompt(
	context: SectionAuditContext,
): string {
	const sectionFraming: Record<string, string> = {
		teamHighlight:
			"The claims below are from a Team Highlight executive summary. Audit assertions about team output, themes, and trends against the evidence (individual member summaries and metric totals).",
		visibleWins:
			"The claims below are from a Visible Wins section describing project accomplishments. Audit dates, figures, and status assertions against the evidence (meeting notes and Asana project tasks).",
		individualContribution:
			"The claims below are from an Individual Contribution summary for a single team member. Audit assertions about their work output against the evidence (their PRs, commits, and task tracker data).",
	};

	const framing =
		sectionFraming[context.sectionName] ??
		"Audit the claims against the evidence.";
	const contributorLine = context.contributor
		? `\nContributor: ${context.contributorDisplayName ?? context.contributor} (@${context.contributor})`
		: "";

	return [
		"You are a report auditor. Compare the report claims against raw source data and identify genuine discrepancies.",
		"",
		framing,
		contributorLine,
		"",
		"Instructions:",
		"1. Identify genuine discrepancies where report claims are NOT supported by or are contradicted by the evidence.",
		"2. Be conservative — only flag real issues, not noise or minor wording differences.",
		"3. Always name source systems specifically (e.g. 'Asana task', 'GitHub PR #123') — never use bare 'task'.",
		"4. For sourceA, use the report section (e.g. 'Report: Individual Summary'); for sourceB, use the raw data source. Populate url and itemId from the raw data whenever available — only use empty string when no artifact URL or identifier exists in the evidence.",
		"5. Format the rule field as 'Category — Third-person description.' (e.g. 'Metric mismatch — Report overstates merged PR count.').",
		"6. If all claims are well-supported by the evidence, return an empty discrepancies array.",
		"7. Set contributorLogin and contributorDisplayName from the contributor this discrepancy belongs to; use empty string if not attributable to a specific individual.",
		"8. Set confidence as an integer from 0–100 representing how well the claims are supported by the evidence: start at 100; deduct for each unsupported or contradicted claim; Asana tasks alone cannot push a score above 50; any claim using outcome language ('reduces', 'lowers', 'improves', 'eliminates', 'enables') backed only by Asana task completion must score 50 or below; a CLOSED GitHub PR must be treated as unmerged unless a merge commit SHA or alternative merged PR is present in the evidence.",
		"9. Each piece of information must appear in exactly one field — do not repeat claim content across explanation, suggestedResolution, and rule.",
		"",
		"Claims (from report):",
		context.claims,
		"",
		"Evidence (from raw source data):",
		context.evidence,
		"",
		"Return structured JSON matching the provided schema.",
	].join("\n");
}

// ---------------------------------------------------------------------------
// Roadmap synthesis (Progress on Quarterly Roadmap table)
// ---------------------------------------------------------------------------

export const ROADMAP_SYNTHESIS_SCHEMA = {
	type: "json_schema" as const,
	name: "roadmap_synthesis",
	strict: true,
	schema: {
		type: "object" as const,
		properties: {
			items: {
				type: "array" as const,
				items: {
					type: "object" as const,
					properties: {
						gid: { type: "string" as const },
						displayName: { type: "string" as const },
						overallStatus: { type: "string" as const },
						nextMilestone: { type: "string" as const },
						keyNotes: { type: "string" as const },
					},
					required: [
						"gid",
						"displayName",
						"overallStatus",
						"nextMilestone",
						"keyNotes",
					] as const,
					additionalProperties: false as const,
				},
			},
		},
		required: ["items"] as const,
		additionalProperties: false as const,
	},
} as const;

export interface RoadmapSynthesisContext {
	roadmapItems: RoadmapEntry[];
	accomplishments: ProjectAccomplishment[];
	notes: NormalizedNote[];
	projects: ProjectTask[];
	subtasksByGid?: Map<string, RoadmapSubtaskInfo[]>;
	/**
	 * Latest Asana project status update per rock GID. Populated for rocks
	 * whose task GID resolves to a sibling project via rockProjectGidMap.
	 * When present, the prompt treats it as canonical for color/status.
	 */
	statusByGid?: Map<string, LatestProjectStatus>;
	mode: "configured" | "ai-derived";
}

function truncateNotes(raw: string | null | undefined, max: number): string {
	if (!raw) return "";
	const plain = raw
		.replace(/<[^>]+>/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (plain.length <= max) return plain;
	return `${plain.slice(0, max).trimEnd()}…`;
}

function serializeSubtaskTree(
	subtasks: RoadmapSubtaskInfo[],
	indent = "    ",
): string {
	const lines: string[] = [];
	for (const st of subtasks) {
		const status = st.completed
			? "DONE"
			: st.dueOn && new Date(st.dueOn) < new Date()
				? "OVERDUE"
				: "TODO";
		const dueStr = st.dueOn ? ` (due ${st.dueOn})` : "";
		const completedStr = st.completedAt
			? ` (completed ${st.completedAt.slice(0, 10)})`
			: "";
		lines.push(`${indent}- [${status}] ${st.name}${dueStr}${completedStr}`);
		const notesSnippet = truncateNotes(st.notes, 300);
		if (notesSnippet) {
			lines.push(`${indent}    notes: ${notesSnippet}`);
		}
		if (st.children.length > 0) {
			lines.push(serializeSubtaskTree(st.children, `${indent}  `));
		}
	}
	return lines.join("\n");
}

export function buildRoadmapSynthesisPrompt(
	context: RoadmapSynthesisContext,
): string {
	if (context.mode === "ai-derived") {
		return buildAiDerivedRoadmapPrompt(context);
	}
	return buildConfiguredRoadmapPrompt(context);
}

function buildConfiguredRoadmapPrompt(
	context: RoadmapSynthesisContext,
): string {
	const itemBlocks = context.roadmapItems.map((item) => {
		const project = context.projects.find((p) => p.gid === item.gid);
		const acc = context.accomplishments.find((a) => a.projectGid === item.gid);
		const bullets = acc?.bullets.map((b) => `  - ${b.text}`).join("\n") ?? "";

		const devDone =
			project?.customFields["Dev Done Target (Current)"] ??
			project?.customFields["Dev Done Target (Original)"];
		const devDoneStr = devDone ? `  Dev Done Target: ${devDone}` : "";

		const parentNotes = truncateNotes(project?.notes, 1500);
		const parentNotesStr = parentNotes
			? `  Parent Task Notes: ${parentNotes}`
			: "";

		const latest = context.statusByGid?.get(item.gid);
		const latestStatusStr = latest
			? [
					`  Latest Project Status Update: ${latest.color || "unknown"} — ${latest.title || "(no title)"}`,
					`    ${truncateNotes(latest.text, 800)}`,
					`    (by ${latest.createdBy ?? "unknown"} on ${latest.createdAt.slice(0, 10)})`,
				].join("\n")
			: "";

		const subtasks = context.subtasksByGid?.get(item.gid);
		const subtaskStr =
			subtasks && subtasks.length > 0
				? `  Subtasks:\n${serializeSubtaskTree(subtasks)}`
				: "  No subtasks available.";

		const milestoneStr = item.nextMilestone
			? `  Next Milestone (pre-computed): ${item.nextMilestone}`
			: "  Next Milestone (pre-computed): TBD";

		return [
			`Initiative: ${item.displayName} (GID: ${item.gid})`,
			`  Current Status: ${item.overallStatus}`,
			milestoneStr,
			devDoneStr,
			parentNotesStr,
			latestStatusStr,
			subtaskStr,
			bullets
				? `  This Week's Accomplishments:\n${bullets}`
				: "  No accomplishments this week.",
		]
			.filter(Boolean)
			.join("\n");
	});

	const noteBlocks = context.notes.map((n) => {
		const items = n.discussionItems.join("\n  - ");
		return `Meeting: ${n.title} (${n.date})\n  - ${items}`;
	});

	return [
		"You are synthesizing a roadmap progress table for a weekly engineering status report.",
		"",
		"For each initiative below, produce:",
		"1. keyNotes: Brief context — blockers, key decisions, or progress notes. Under 20 words. Use empty string if nothing notable.",
		"2. nextMilestone: Already computed — return the value exactly as provided in 'Next Milestone (pre-computed)'. Do NOT change it.",
		"3. overallStatus: Use the status already provided — do not change it.",
		"4. displayName: Use the display name already provided — do not change it.",
		"",
		"Rules:",
		"- Use ONLY information from the subtasks, accomplishments, meeting notes, and project status updates below. Do not invent information.",
		"- When a 'Latest Project Status Update' block is present for an initiative, treat it as the most recent canonical status and summarize its substance in keyNotes (still under 20 words).",
		"- Return items in the same order as provided.",
		"",
		"=== ROADMAP INITIATIVES ===",
		"",
		...itemBlocks,
		"",
		"=== MEETING NOTES (context) ===",
		"",
		...(noteBlocks.length > 0 ? noteBlocks : ["No meeting notes available."]),
		"",
		"Return structured JSON matching the provided schema.",
	].join("\n");
}

function buildAiDerivedRoadmapPrompt(context: RoadmapSynthesisContext): string {
	const projectBlocks = context.accomplishments.map((acc) => {
		const bullets = acc.bullets.map((b) => `  - ${b.text}`).join("\n");
		return [
			`Project: ${acc.projectName} (GID: ${acc.projectGid})`,
			bullets || "  No accomplishments.",
		].join("\n");
	});

	const noteBlocks = context.notes.map((n) => {
		const items = n.discussionItems.join("\n  - ");
		return `Meeting: ${n.title} (${n.date})\n  - ${items}`;
	});

	return [
		"You are synthesizing a roadmap progress table for a weekly engineering status report.",
		"No specific roadmap configuration was provided. Identify the TOP initiatives from the accomplishments and meeting notes below.",
		"",
		"For each initiative you identify, produce:",
		"1. gid: Use the project GID from the data. If no GID is available, use 'ai-derived-{index}' (e.g., 'ai-derived-0').",
		"2. displayName: A concise name for the initiative.",
		"3. overallStatus: One of 'on-track', 'at-risk', 'off-track', or 'unknown'. Infer from context (blockers = at-risk, no progress = off-track).",
		"4. nextMilestone: The next concrete delivery milestone with a date if evident. If not enough information, write 'TBD'.",
		"5. keyNotes: Brief context. Use empty string if nothing notable.",
		"",
		"Rules:",
		"- Identify 3-8 key initiatives. Focus on major projects, not minor tasks.",
		"- Use ONLY information from the data below. Do not invent dates or milestones.",
		"- If insufficient information for a milestone or status, use 'TBD' or 'unknown' respectively.",
		"- Order by apparent priority or impact.",
		"",
		"=== PROJECTS & ACCOMPLISHMENTS ===",
		"",
		...(projectBlocks.length > 0
			? projectBlocks
			: ["No project data available."]),
		"",
		"=== MEETING NOTES (context) ===",
		"",
		...(noteBlocks.length > 0 ? noteBlocks : ["No meeting notes available."]),
		"",
		"Return structured JSON matching the provided schema.",
	].join("\n");
}
