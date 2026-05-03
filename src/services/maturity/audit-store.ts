import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AuditStore } from "../../core/types.js";
import { getQuestion, INTERVIEW_QUESTIONS } from "./interview.js";
import type { InterviewAnswer, InterviewQuestionId } from "./types.js";

/**
 * Reads / writes docs/audits/CONFIG.md inside a repo. Format documented in
 * references/interview.md (## Org-level answers).
 */
export class FileSystemAuditStore implements AuditStore {
	constructor(private readonly repoPath: string) {}

	private configPath(): string {
		return join(this.repoPath, "docs", "audits", "CONFIG.md");
	}

	async readPriorAnswers(): Promise<InterviewAnswer[]> {
		try {
			const text = await readFile(this.configPath(), "utf8");
			return parseConfigMd(text);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw err;
		}
	}

	async writeAnswers(answers: InterviewAnswer[], today: string): Promise<void> {
		const text = renderConfigMd(answers, today);
		await mkdir(dirname(this.configPath()), { recursive: true });
		await writeFile(this.configPath(), text, "utf8");
	}
}

/**
 * Parse the `## Org-level answers` section of CONFIG.md. Heading mapping
 * comes from interview.md verbatim.
 */
export function parseConfigMd(text: string): InterviewAnswer[] {
	const answers: InterviewAnswer[] = [];
	const lines = text.split(/\r?\n/);
	let inSection = false;
	let currentQuestion: InterviewQuestionId | null = null;
	let buffer: string[] = [];

	const flush = () => {
		if (currentQuestion) {
			const value = buffer.join("\n").trim();
			if (value.length > 0) {
				answers.push({
					questionId: currentQuestion,
					value,
					isOption: false,
				});
			}
			currentQuestion = null;
			buffer = [];
		}
	};

	for (const line of lines) {
		if (/^##\s+Org-level answers/i.test(line)) {
			inSection = true;
			continue;
		}
		if (inSection && /^##\s+/.test(line)) {
			flush();
			break;
		}
		if (!inSection) continue;

		const headingMatch = /^###\s+(.+)$/.exec(line);
		if (headingMatch) {
			flush();
			currentQuestion = matchQuestionByHeading(headingMatch[1].trim());
			continue;
		}
		if (currentQuestion) {
			buffer.push(line);
		}
	}
	flush();
	return answers;
}

function matchQuestionByHeading(heading: string): InterviewQuestionId | null {
	const q = INTERVIEW_QUESTIONS.find(
		(q) => q.configHeading.toLowerCase() === heading.toLowerCase(),
	);
	return q?.id ?? null;
}

export function renderConfigMd(
	answers: InterviewAnswer[],
	today: string,
): string {
	const lines: string[] = [];
	lines.push("## Org-level answers");
	lines.push("");
	lines.push(`last_updated: ${today}`);
	lines.push("");
	for (const q of INTERVIEW_QUESTIONS) {
		lines.push(`### ${q.configHeading}`);
		const answer = answers.find((a) => a.questionId === q.id);
		lines.push(answer?.value?.trim() || "unknown");
		lines.push("");
	}
	return lines.join("\n");
}

/**
 * Read pre-supplied interview answers from a JSON file (used by --interview-answers
 * in headless mode). Format: { "q1": "...", "q2": "...", ... }.
 */
export async function readAnswersJson(
	path: string,
): Promise<InterviewAnswer[]> {
	const text = await readFile(path, "utf8");
	const parsed = JSON.parse(text) as Record<string, string>;
	const answers: InterviewAnswer[] = [];
	for (const [qid, value] of Object.entries(parsed)) {
		try {
			getQuestion(qid as InterviewQuestionId);
		} catch {
			continue;
		}
		answers.push({
			questionId: qid as InterviewQuestionId,
			value,
			isOption: false,
		});
	}
	return answers;
}
