import readline from "node:readline";
import cliSpinners from "cli-spinners";
import type {
	ProgressHandle,
	ProgressReporter,
	ProgressReporterFactory,
} from "../core/types.js";
import { FrameRenderer } from "./frame-renderer.js";

export type { ProgressHandle, ProgressReporter };

export interface ProgressDisplayOptions {
	title?: string;
	expectedSteps?: number;
	anchorRow?: number;
}

export class ProgressDisplay implements ProgressReporter {
	private readonly isInteractive = Boolean(process.stdout.isTTY);
	private timer: NodeJS.Timeout | null = null;
	private frameIndex = 0;
	private currentText: string | null = null;
	private readonly frames = cliSpinners.dots.frames;
	private readonly interval = cliSpinners.dots.interval;
	private lastFrame: string = this.frames[0];
	private lastPrintedLength = 0;
	private readonly renderer: FrameRenderer | null = null;
	private readonly sigintHandler: (() => void) | null = null;

	constructor(options: ProgressDisplayOptions = {}) {
		if (options.title && this.isInteractive) {
			this.renderer = new FrameRenderer({
				title: options.title,
				expectedSteps: options.expectedSteps,
				anchorRow: options.anchorRow,
			});
			this.sigintHandler = () => {
				this.cleanup();
				process.exit(130);
			};
			process.on("SIGINT", this.sigintHandler);
		}
	}

	cleanup(): void {
		this.stopAnimation();
		if (this.renderer) {
			// Final render to show completed state
			const frame = this.frames[this.frameIndex];
			this.renderer.render(frame);
			this.renderer.cleanup();
		}
		if (this.sigintHandler) {
			process.removeListener("SIGINT", this.sigintHandler);
		}
	}

	start(text: string): ProgressHandle {
		if (!this.isInteractive) {
			this.writeSameLine(`… ${text}`);
			let finished = false;
			let current = text;
			const complete = (symbol: string, message?: string) => {
				if (finished) {
					return;
				}
				finished = true;
				this.writeSameLine(`${symbol} ${message ?? current}`);
				process.stdout.write("\n");
				this.lastPrintedLength = 0;
			};
			return {
				succeed: (message?: string) => complete("✔", message),
				fail: (message?: string) => complete("✖", message),
				update: (next: string, _progress?: number) => {
					if (finished || next.trim().length === 0) {
						return;
					}
					current = next;
					this.writeSameLine(`… ${current}`);
				},
			} satisfies ProgressHandle;
		}

		if (this.renderer) {
			const index = this.renderer.addLine(text);
			this.ensureTimer();

			let finished = false;
			return {
				succeed: (message?: string) => {
					if (finished) {
						return;
					}
					finished = true;
					this.renderer!.completeLine(index, "done", message);
				},
				fail: (message?: string) => {
					if (finished) {
						return;
					}
					finished = true;
					this.renderer!.completeLine(index, "error", message);
				},
				update: (next: string, progress?: number) => {
					if (finished || next.trim().length === 0) {
						return;
					}
					this.renderer!.updateLine(index, next, progress);
				},
			} satisfies ProgressHandle;
		}

		// Non-framed interactive mode (original single-line spinner)
		this.stopAnimation();
		this.currentText = text;
		this.frameIndex = 0;
		this.renderFrame();
		this.timer = setInterval(() => this.renderFrame(), this.interval);

		let finished = false;
		const complete = (symbol: string, message?: string) => {
			if (finished) {
				return;
			}
			finished = true;
			this.finish(symbol, message);
		};

		return {
			succeed: (message?: string) => complete("✔", message),
			fail: (message?: string) => complete("✖", message),
			update: (next: string, _progress?: number) => {
				if (finished || next.trim().length === 0) {
					return;
				}
				this.currentText = next;
				this.renderCurrentFrame();
			},
		} satisfies ProgressHandle;
	}

	instantSuccess(message: string): void {
		if (!this.isInteractive) {
			process.stdout.write(`✔ ${message}\n`);
			return;
		}

		if (this.renderer) {
			const index = this.renderer.addLine(message);
			this.renderer.completeLine(index, "done");
			this.ensureTimer();
			return;
		}

		this.stopAnimation();
		this.currentText = null;
		this.clearLine();
		process.stdout.write(`✔ ${message}\n`);
	}

	private ensureTimer(): void {
		if (!this.timer && this.renderer) {
			this.renderFramed();
			this.timer = setInterval(() => this.renderFramed(), this.interval);
		}
	}

	private renderFramed(): void {
		if (!this.renderer) {
			return;
		}
		const frame = this.frames[this.frameIndex];
		this.frameIndex = (this.frameIndex + 1) % this.frames.length;
		this.renderer.render(frame);
	}

	private renderFrame(): void {
		if (!this.isInteractive || this.currentText === null) {
			return;
		}
		const frame = this.frames[this.frameIndex];
		this.frameIndex = (this.frameIndex + 1) % this.frames.length;
		this.lastFrame = frame;
		this.clearLine();
		process.stdout.write(`${frame} ${this.currentText}`);
	}

	private renderCurrentFrame(): void {
		if (!this.isInteractive || this.currentText === null) {
			return;
		}
		this.clearLine();
		process.stdout.write(`${this.lastFrame} ${this.currentText}`);
	}

	private finish(symbol: string, message?: string): void {
		if (!this.isInteractive) {
			process.stdout.write(`${symbol} ${message ?? this.currentText ?? ""}\n`);
			return;
		}
		const finalText = message ?? this.currentText ?? "";
		this.stopAnimation();
		this.currentText = null;
		this.clearLine();
		process.stdout.write(`${symbol} ${finalText}\n`);
	}

	private stopAnimation(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	private clearLine(): void {
		if (!this.isInteractive) {
			if (this.lastPrintedLength > 0) {
				process.stdout.write(`\r${" ".repeat(this.lastPrintedLength)}\r`);
				this.lastPrintedLength = 0;
			}
			return;
		}
		readline.cursorTo(process.stdout, 0);
		readline.clearLine(process.stdout, 0);
	}

	private writeSameLine(text: string): void {
		const padded =
			text +
			(this.lastPrintedLength > text.length
				? " ".repeat(this.lastPrintedLength - text.length)
				: "");
		process.stdout.write(`\r${padded}`);
		this.lastPrintedLength = text.length;
	}
}

/**
 * Create a ProgressReporterFactory backed by ProgressDisplay.
 * The anchorRow is a TUI concern and stays in the factory closure,
 * never leaking into the service layer.
 */
export function createProgressFactory(
	anchorRow?: number,
): ProgressReporterFactory {
	return {
		create(options) {
			return new ProgressDisplay({
				title: options.title,
				expectedSteps: options.expectedSteps,
				anchorRow,
			});
		},
	};
}

export async function spinner<T>(
	text: string,
	run: () => Promise<T>,
): Promise<T> {
	const progress = new ProgressDisplay();
	const handle = progress.start(text);
	try {
		const result = await run();
		handle.succeed();
		return result;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		handle.fail(message);
		throw error;
	} finally {
		progress.cleanup();
	}
}
