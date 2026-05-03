import type { InterviewQuestion, InterviewQuestionId } from "./types.js";

/**
 * Phase-1 interview questions — verbatim from references/interview.md.
 *
 * The wording is calibrated; do not paraphrase. Each question is asked one at
 * a time and waits for an answer before proceeding (see SKILL.md).
 */
export const INTERVIEW_QUESTIONS: ReadonlyArray<InterviewQuestion> = [
	{
		id: "q1",
		prompt:
			"What AI tooling do engineers actually use day-to-day (Claude, Copilot, Cursor, etc.)? Is it company-paid with managed accounts, or are people using personal accounts or free tiers? Is there a documented policy on what data can be sent to third-party AI providers?",
		options: [
			"Company-paid managed seats + documented data-handling policy",
			"Company-paid seats but governance is loose / no written policy",
			"Mostly personal accounts or free tier; no policy",
			"I don't know",
		],
		allowFreeText: true,
		configHeading: "AI tooling (Q1)",
	},
	{
		id: "q2",
		prompt:
			"Do technical interviews allow candidates to use AI, and are interviewers trained to evaluate how well they use it (critique, decomposition, catching wrong outputs)? Or is AI either banned or effectively unassessed?",
		options: [
			"AI allowed in interviews, interviewers trained to assess judgment with AI",
			"AI allowed but assessment is informal / uncalibrated",
			"AI banned, or interviews don't really test technical judgment",
			"I don't know",
		],
		allowFreeText: true,
		configHeading: "Hiring (Q2)",
	},
	{
		id: "q3",
		prompt:
			"Are all four DORA metrics (deployment frequency, lead time, change failure rate, MTTR) actively tracked and visible to the team — e.g., a dashboard engineers actually look at? Or are some tracked in theory but not used?",
		options: [
			"All four DORA metrics tracked on a dashboard the team actually uses",
			"Some DORA metrics tracked but not actively watched",
			"Not really tracked / vibes-based",
			"I don't know",
		],
		allowFreeText: true,
		configHeading: "DORA visibility (Q3)",
	},
	{
		id: "q4",
		prompt:
			"When engineers hand work to AI agents, is there a consistent upfront design step (ADR, shared-understanding session, spec) before code generation? Or is it ad hoc — some engineers do it, others prompt straight into code?",
		options: [
			"Consistent upfront design step (ADR / spec / shared-understanding) before agent code",
			"Some engineers do it, others prompt straight into code",
			"No design step — agents are pointed at problems and turned loose",
			"I don't know",
		],
		allowFreeText: true,
		configHeading: "Design before code (Q4)",
	},
	{
		id: "q5",
		prompt:
			"Are LLMs in the product (user-facing features), in the dev loop only, or both? If in the product: is there an offline eval suite plus production telemetry? If dev-loop only: is AI impact tracked deliberately — even a spreadsheet, Asana board, or sprint retro metric counts — or is it purely gut-feel with no numbers anyone could point to?",
		options: [
			"LLMs in product with offline evals + prod telemetry",
			"LLMs in dev loop with tracked metrics (Asana, spreadsheet, retro numbers, etc.)",
			"LLMs used but purely gut-feel — no numbers anyone could point to",
			"No LLMs in product or dev loop",
			"I don't know",
		],
		allowFreeText: true,
		configHeading: "Eval coverage (Q5)",
	},
	{
		id: "q6",
		prompt:
			"Has anyone explicitly red-teamed a worst-case agent scenario in prod (bad migration, runaway infra change, secret exfiltration)? Are rollback paths for agent-triggered writes documented?",
		options: [
			"Worst-case agent scenarios have been red-teamed; rollback paths documented",
			"Some controls in place but no explicit red-teaming",
			"No red-teaming; agents share human-equivalent prod creds",
			"I don't know",
		],
		allowFreeText: true,
		configHeading: "Blast-radius red-teaming (Q6)",
	},
	{
		id: "q7",
		prompt:
			"Are there adjacent repos I should treat as in-scope that automated detection might miss — e.g., an internal handbook, security/IT policy repo, org-wide `.github` repo, shared skill library?",
		options: [
			"Yes — list the repos",
			"No, scope is just the primary repo(s) you've found",
			"I don't know",
		],
		allowFreeText: true,
		configHeading: "Out-of-band adjacent repos (Q7)",
	},
] as const;

export const FRAMING_MESSAGE =
	'I\'m going to ask 7 quick questions one at a time — they cover the parts of the audit that aren\'t visible in the repo. "I don\'t know" or "n/a" is a valid answer to any of them and will mark that criterion as not assessed, not failed.';

const UNKNOWN_TOKENS = new Set(
	["i don't know", "i dont know", "unknown", "n/a", "na", "skip"].map((s) =>
		s.toLowerCase().trim(),
	),
);

export function isUnknownAnswer(value: string): boolean {
	return UNKNOWN_TOKENS.has(value.trim().toLowerCase());
}

export function getQuestion(id: InterviewQuestionId): InterviewQuestion {
	const q = INTERVIEW_QUESTIONS.find((q) => q.id === id);
	if (!q) {
		throw new Error(`Unknown interview question: ${id}`);
	}
	return q;
}
