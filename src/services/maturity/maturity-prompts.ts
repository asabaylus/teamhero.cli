import { RUBRIC_CATEGORIES, RUBRIC_ITEMS } from "./rubric.js";
import type {
	AdjacentRepo,
	EvidenceFact,
	EvidenceTier,
	InterviewAnswer,
	ScopeDescriptor,
} from "./types.js";

export const MATURITY_ASSESSMENT_SCHEMA = {
	type: "json_schema" as const,
	name: "agent_maturity_assessment",
	strict: true,
	schema: {
		type: "object" as const,
		properties: {
			oneLineTake: { type: "string" as const },
			items: {
				type: "array" as const,
				items: {
					type: "object" as const,
					properties: {
						itemId: { type: "integer" as const },
						score: {
							type: "string" as const,
							enum: ["0", "0.5", "1", "n/a"] as const,
						},
						whyThisScore: { type: "string" as const },
					},
					required: ["itemId", "score", "whyThisScore"] as const,
					additionalProperties: false as const,
				},
			},
			topFixes: {
				type: "array" as const,
				items: {
					type: "object" as const,
					properties: {
						itemId: { type: "integer" as const },
						whyThisOne: { type: "string" as const },
						whatGoodLooksLike: { type: "string" as const },
						owner: { type: "string" as const },
					},
					required: [
						"itemId",
						"whyThisOne",
						"whatGoodLooksLike",
						"owner",
					] as const,
					additionalProperties: false as const,
				},
			},
			strengths: {
				type: "array" as const,
				items: { type: "string" as const },
			},
			notesForReaudit: {
				type: "array" as const,
				items: { type: "string" as const },
			},
		},
		required: [
			"oneLineTake",
			"items",
			"topFixes",
			"strengths",
			"notesForReaudit",
		] as const,
		additionalProperties: false as const,
	},
} as const;

export interface MaturityScoringContext {
	scope: ScopeDescriptor;
	tier: EvidenceTier;
	adjacentRepos: AdjacentRepo[];
	evidence: EvidenceFact[];
	interviewAnswers: InterviewAnswer[];
}

function rubricBlock(): string {
	const lines: string[] = [];
	for (const cat of RUBRIC_CATEGORIES) {
		lines.push(
			`### Category ${cat.id} — ${cat.title} (weight ${cat.weight.toFixed(2)}×)`,
		);
		for (const itemId of cat.itemIds) {
			const item = RUBRIC_ITEMS.find((i) => i.id === itemId);
			if (!item) continue;
			lines.push(`#### Item ${item.id} — ${item.title}`);
			lines.push(`- 1.0 — ${item.scoreLevels.one}`);
			lines.push(`- 0.5 — ${item.scoreLevels.half}`);
			lines.push(`- 0.0 — ${item.scoreLevels.zero}`);
			if (item.interviewLink) {
				lines.push(
					`- Interview link: ${item.interviewLink.questionId} (${item.interviewLink.mode})`,
				);
			}
			if (item.tier3Cap) {
				lines.push(`- Tier-3 cap: 0.5 (insufficient GitHub-side evidence)`);
			}
			lines.push(`- Why it matters: ${item.whyItMatters}`);
			lines.push("");
		}
	}
	return lines.join("\n");
}

function evidenceBlock(evidence: EvidenceFact[]): string {
	const byItem = new Map<number, EvidenceFact[]>();
	for (const f of evidence) {
		const list = byItem.get(f.itemId) ?? [];
		list.push(f);
		byItem.set(f.itemId, list);
	}
	const lines: string[] = [];
	for (const item of RUBRIC_ITEMS) {
		const facts = byItem.get(item.id) ?? [];
		lines.push(`#### Item ${item.id} — ${item.title}`);
		if (facts.length === 0) {
			lines.push("- (no deterministic evidence collected)");
		} else {
			for (const f of facts) {
				lines.push(`- [${f.signal}] ${f.summary}`);
			}
		}
		lines.push("");
	}
	return lines.join("\n");
}

function interviewBlock(answers: InterviewAnswer[]): string {
	if (answers.length === 0) return "_No interview answers supplied._";
	return answers.map((a) => `- ${a.questionId}: ${a.value}`).join("\n");
}

export function buildMaturityPrompt(context: MaturityScoringContext): string {
	const scopeLine = `${context.scope.mode} | ${context.scope.displayName}`;
	const adjacentLine =
		context.adjacentRepos.length === 0
			? "(none detected)"
			: context.adjacentRepos
					.map((r) => `${r.owner}/${r.name} (${r.reason})`)
					.join("; ");

	return [
		"You are auditing an engineering organization for AI-agentic-coding readiness using the Agent Maturity Assessment rubric.",
		"",
		"# Scope",
		`- ${scopeLine}`,
		`- Evidence tier: ${context.tier}`,
		`- Adjacent repos consulted: ${adjacentLine}`,
		"",
		"# Rules",
		"- Score each of the 12 items as exactly one of: 0, 0.5, 1, n/a.",
		"- Be conservative: if it's not visibly true, score 0.5. If there's no evidence at all, 0.",
		"- Use n/a ONLY if the corresponding interview answer is 'unknown' / 'I don't know' or the item genuinely doesn't apply to this scope. Never default to 0 because of missing context.",
		"- For tier-3 (git-only) audits, you MAY NOT award 1.0 to items 2, 3, 9, or 11 — cap them at 0.5.",
		"- 'whyThisScore' MUST be a single sentence of 25 words or fewer. State the single most decisive piece of evidence. No semicolons, no 'but also' hedging.",
		"- Pick the 3 highest-leverage fixes (preferentially from items scoring < 1.0). Each fix needs an owner suggestion (engineering-manager, platform-team, security, leadership, etc.). If you can't pick 3, return fewer; the schema requires the 'owner' field even if it's 'unassigned'.",
		"- Strengths: 1–3 short bullets the team is already doing right that should not get broken during change.",
		"- One-line take: a single sentence summarizing the audit at a glance.",
		"- Notes for re-audit: anything scored n/a, calibration warnings, or specific data to recheck next quarter.",
		"",
		"# Rubric (full text)",
		rubricBlock(),
		"",
		"# Deterministic evidence (collected from filesystem / GitHub)",
		evidenceBlock(context.evidence),
		"",
		"# Interview answers (Phase 1)",
		interviewBlock(context.interviewAnswers),
		"",
		"Return JSON matching the agent_maturity_assessment schema.",
	].join("\n");
}
