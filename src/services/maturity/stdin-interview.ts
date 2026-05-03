import type { InterviewTransport } from "../../core/types.js";
import type { InterviewAnswer, InterviewQuestion } from "./types.js";

type Emit = (event: Record<string, unknown>) => void;

/**
 * Shared line reader for a stdin-like stream. Used by both the initial
 * config-line read and the interview-answer round-trip so they don't
 * compete for ownership of stdin.
 *
 * Buffers incoming bytes, splits on `\n`, and resolves callers in FIFO
 * order. Once `on('end')` fires, all queued and future callers receive `""`.
 *
 * Two-queue design: incoming lines that arrive *before* a caller is waiting
 * sit in `pending`; waiters that arrive before lines do sit in `waiters`.
 * `pump()` matches them up FIFO-style.
 */
export class StdinLineReader {
	private buffered = "";
	private pending: string[] = [];
	private waiters: Array<(line: string) => void> = [];
	private closed = false;

	constructor(private readonly stream: NodeJS.ReadableStream = process.stdin) {
		this.stream.setEncoding?.("utf8");
		this.stream.on("data", (chunk: string | Buffer) => {
			const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
			this.buffered += text;
			this.parseLines();
			this.pump();
		});
		this.stream.on("end", () => {
			this.closed = true;
			this.parseLines();
			this.pump();
			// Remaining waiters get "" (EOF).
			while (this.waiters.length > 0) {
				const w = this.waiters.shift();
				if (w) w("");
			}
		});
		// `error` events on stdin (e.g. premature pipe closure) — treat as EOF.
		this.stream.on("error", () => {
			this.closed = true;
			while (this.waiters.length > 0) {
				const w = this.waiters.shift();
				if (w) w("");
			}
		});
	}

	/** Pull complete lines off the byte buffer into `pending`. */
	private parseLines(): void {
		while (true) {
			const idx = this.buffered.indexOf("\n");
			if (idx < 0) break;
			const line = this.buffered.slice(0, idx).replace(/\r$/, "");
			this.buffered = this.buffered.slice(idx + 1);
			this.pending.push(line);
		}
	}

	/** Match any pending lines against any waiting callers, FIFO. */
	private pump(): void {
		while (this.pending.length > 0 && this.waiters.length > 0) {
			const line = this.pending.shift() as string;
			const w = this.waiters.shift();
			if (w) w(line);
		}
	}

	nextLine(): Promise<string> {
		return new Promise<string>((resolve) => {
			if (this.pending.length > 0) {
				const line = this.pending.shift() as string;
				resolve(line);
				return;
			}
			if (this.closed) {
				resolve("");
				return;
			}
			this.waiters.push(resolve);
		});
	}
}

/**
 * Interview transport that emits `interview-question` JSON-line events on stdout
 * and reads `interview-answer` events from a shared StdinLineReader. Used by
 * scripts/run-assess.ts when the Go TUI is acting as the interactive frontend.
 *
 * The TUI (or another harness) must reply to each question with a JSON line:
 *   {"type":"interview-answer","questionId":"q1","value":"...","isOption":true}
 */
export class StdinInterviewTransport implements InterviewTransport {
	constructor(
		private readonly reader: StdinLineReader,
		private readonly emit: Emit,
	) {}

	async frame(message: string): Promise<void> {
		this.emit({ type: "interview-frame", message });
	}

	async ask(question: InterviewQuestion): Promise<InterviewAnswer> {
		this.emit({
			type: "interview-question",
			questionId: question.id,
			questionText: question.prompt,
			options: question.options,
			allowFreeText: question.allowFreeText,
			configHeading: question.configHeading,
		});

		while (true) {
			const line = await this.reader.nextLine();
			if (!line) {
				return { questionId: question.id, value: "unknown", isOption: false };
			}
			let parsed: Record<string, unknown>;
			try {
				parsed = JSON.parse(line);
			} catch {
				continue;
			}
			if (parsed.type !== "interview-answer") continue;
			if (parsed.questionId !== question.id) continue;
			const value = typeof parsed.value === "string" ? parsed.value : "unknown";
			const isOption =
				typeof parsed.isOption === "boolean" ? parsed.isOption : false;
			return { questionId: question.id, value, isOption };
		}
	}
}
