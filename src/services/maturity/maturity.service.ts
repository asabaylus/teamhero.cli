import { type ConsolaInstance, consola } from "consola";
import type {
	AuditStore,
	InterviewTransport,
	MaturityProvider,
} from "../../core/types.js";
import { detectAdjacentRepos } from "./adjacent-repos.js";
import { type MaturityAIResult, MaturityAIScorer } from "./ai-scorer.js";
import { defaultOutputPath, writeAudit } from "./audit-writer.js";
import { defaultCollectors, runAllCollectors } from "./evidence-collectors.js";
import {
	FRAMING_MESSAGE,
	INTERVIEW_QUESTIONS,
	isUnknownAnswer,
} from "./interview.js";
import { detectTier } from "./preflight.js";
import { RUBRIC_VERSION } from "./rubric.js";
import {
	categorySubtotals,
	computeOverallScore,
	findMissingItems,
} from "./scoring.js";
import type {
	AssessCommandInput,
	AssessmentArtifact,
	AssessResult,
	EvidenceFact,
	EvidenceTier,
	InterviewAnswer,
} from "./types.js";

export interface MaturityServiceDeps {
	collectors?: MaturityProvider[];
	scorer?: MaturityAIScorer;
	interview?: InterviewTransport;
	auditStore?: AuditStore;
	logger?: ConsolaInstance;
	/** ProgressReporter — fired at each pipeline step for the TUI / headless emit. */
	onProgress?: (step: string, message: string) => void;
}

export class MaturityService {
	private readonly collectors: MaturityProvider[];
	private readonly scorer: MaturityAIScorer;
	private readonly interview?: InterviewTransport;
	private readonly auditStore?: AuditStore;
	private readonly logger: ConsolaInstance;
	private readonly onProgress: (step: string, message: string) => void;

	constructor(deps: MaturityServiceDeps = {}) {
		this.collectors = deps.collectors ?? defaultCollectors();
		this.scorer = deps.scorer ?? new MaturityAIScorer();
		if (deps.interview) this.interview = deps.interview;
		if (deps.auditStore) this.auditStore = deps.auditStore;
		this.logger = deps.logger ?? consola.withTag("maturity");
		this.onProgress = deps.onProgress ?? (() => {});
	}

	async run(input: AssessCommandInput): Promise<AssessResult> {
		const today = new Date().toISOString().slice(0, 10);

		this.onProgress("preflight", "Detecting evidence tier…");
		const tier: EvidenceTier = await detectTier(
			input.scope.localPath ?? process.cwd(),
			input.evidenceTier,
		);
		this.onProgress("preflight", `Tier resolved: ${tier}`);

		this.onProgress("adjacent-repos", "Detecting adjacent repos…");
		const adjacentRepos = await detectAdjacentRepos(input.scope);
		if (adjacentRepos.length > 0) {
			this.onProgress(
				"adjacent-repos",
				`Found ${adjacentRepos.length} adjacent repo(s): ${adjacentRepos.map((r) => `${r.owner}/${r.name}`).join(", ")}`,
			);
		}

		this.onProgress("interview", "Gathering Phase-1 interview answers…");
		const interviewAnswers = await this.collectInterviewAnswers(input);

		this.onProgress("evidence", "Running deterministic evidence collectors…");
		const evidence: EvidenceFact[] = await runAllCollectors(this.collectors, {
			scope: input.scope,
			tier,
			adjacentRepos,
		});
		this.onProgress(
			"evidence",
			`Collected ${evidence.length} evidence fact(s) across ${this.collectors.length} items.`,
		);

		this.onProgress("scoring", "Running AI scorer…");
		const ai: MaturityAIResult = await this.scorer.score({
			scope: input.scope,
			tier,
			adjacentRepos,
			evidence,
			interviewAnswers,
		});

		const missing = findMissingItems(ai.items);
		if (missing.length > 0) {
			this.logger.warn(`Items missing from AI response: ${missing.join(", ")}`);
		}

		const overall = computeOverallScore(ai.items);
		const subtotals = categorySubtotals(ai.items);

		const artifact: AssessmentArtifact = {
			scope: input.scope,
			tier,
			rubricVersion: RUBRIC_VERSION,
			auditDate: today,
			items: ai.items,
			topFixes: ai.topFixes,
			strengths: ai.strengths,
			oneLineTake: ai.oneLineTake,
			adjacentRepos,
			notesForReaudit: ai.notesForReaudit,
			interviewAnswers,
			rawScore: overall.rawScore,
			rawScoreMax: overall.rawScoreMax,
			weightedScore: overall.weightedScore,
			weightedScoreMax: overall.weightedScoreMax,
			scorePercent: overall.scorePercent,
			band: overall.band.name,
			categorySubtotals: subtotals.map((s) => ({
				id: s.id,
				raw: s.rawSum,
				weighted: s.weighted,
				max: s.maxWeighted,
			})),
		};

		this.onProgress(
			"writing",
			`Writing audit (${overall.scorePercent.toFixed(1)}% — ${overall.band.name})…`,
		);
		const outputPath =
			input.outputPath ?? defaultOutputPath(input.scope.displayName, today);
		const written = await writeAudit(artifact, {
			outputPath,
			format: input.outputFormat ?? "both",
		});

		if (this.auditStore) {
			try {
				await this.auditStore.writeAnswers(interviewAnswers, today);
				this.onProgress(
					"audit-store",
					"Updated docs/audits/CONFIG.md with interview answers.",
				);
			} catch (err) {
				this.logger.warn(
					`Failed to update CONFIG.md: ${(err as Error).message}`,
				);
			}
		}

		const result: AssessResult = {
			outputPath: written.outputPath,
			artifact,
		};
		if (written.jsonOutputPath) result.jsonOutputPath = written.jsonOutputPath;
		return result;
	}

	private async collectInterviewAnswers(
		_input: AssessCommandInput,
	): Promise<InterviewAnswer[]> {
		const stored = (await this.auditStore?.readPriorAnswers()) ?? [];
		const byId = new Map(stored.map((a) => [a.questionId, a] as const));

		// In headless / non-interactive mode we just return the stored answers
		// (or "unknown" if missing).
		if (!this.interview) {
			return INTERVIEW_QUESTIONS.map((q) => {
				const prior = byId.get(q.id);
				if (prior) return prior;
				return { questionId: q.id, value: "unknown", isOption: false };
			});
		}

		await this.interview.frame(FRAMING_MESSAGE);
		const answers: InterviewAnswer[] = [];
		for (const q of INTERVIEW_QUESTIONS) {
			const answer = await this.interview.ask(q);
			// Normalize "I don't know" answers
			if (isUnknownAnswer(answer.value)) {
				answers.push({ ...answer, value: "unknown" });
			} else {
				answers.push(answer);
			}
		}
		return answers;
	}
}

/** Convenience: quick non-interactive run with default deps. */
export async function runHeadlessAssessment(
	input: AssessCommandInput,
	overrides?: MaturityServiceDeps,
): Promise<AssessResult> {
	const service = new MaturityService(overrides);
	return service.run(input);
}
