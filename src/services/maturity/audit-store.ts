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
 * Extracts org-level interview answers from a CONFIG.md document.
 *
 * Parses the "## Org-level answers" section, reading each `###` question heading and its following lines as the answer value.
 *
 * @param text - Full contents of a CONFIG.md file
 * @returns An array of `InterviewAnswer` objects for recognized questions. Headings are matched case-insensitively to known interview questions; multi-line answers are preserved and trimmed; empty answers and unknown headings are ignored.
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

/**
 * Finds the interview question id whose config heading matches the given heading (case-insensitive).
 *
 * @param heading - The heading text to match against question config headings.
 * @returns The matching `InterviewQuestionId` if found, `null` otherwise.
 */
function matchQuestionByHeading(heading: string): InterviewQuestionId | null {
	const q = INTERVIEW_QUESTIONS.find(
		(q) => q.configHeading.toLowerCase() === heading.toLowerCase(),
	);
	return q?.id ?? null;
}

/**
 * Render the contents of CONFIG.md's "Org-level answers" section from provided answers.
 *
 * @param answers - Collected interview answers to include in the document
 * @param today - Date string written to the `last_updated` line
 * @returns A CONFIG.md-formatted string containing the header, `last_updated: {today}`, and one `### {question}` section per interview question; unanswered questions are rendered as `unknown`
 */
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
 * Load pre-supplied interview answers from a JSON file for headless mode.
 *
 * @param path - Filesystem path to a JSON file shaped like `{ "q1": "…", "q2": "…", … }`
 * @returns An array of `InterviewAnswer` for entries whose question IDs are recognized; unrecognized IDs are skipped.
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
