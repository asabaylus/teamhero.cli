export interface FrameLine {
	text: string;
	status: "active" | "done" | "error";
	progress: number;
}

export interface FrameRendererOptions {
	title?: string;
	expectedSteps?: number;
	stream?: NodeJS.WriteStream;
	showProgressBar?: boolean;
	/** When set, use absolute row positioning instead of relative cursor-up. Immune to external terminal writes. */
	anchorRow?: number;
}

// ANSI color constants
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[90m";
const PURPLE = "\x1b[38;5;212m";
const RESET = "\x1b[0m";

export class FrameRenderer {
	private readonly lines: FrameLine[] = [];
	private renderedLineCount = 0;
	private linesBelow = 0;
	private readonly stream: NodeJS.WriteStream;
	private readonly title: string;
	private readonly expectedSteps: number;
	private readonly showProgressBar: boolean;
	private readonly anchorRow: number | null;

	constructor(options: FrameRendererOptions = {}) {
		this.stream = options.stream ?? process.stdout;
		this.title = options.title ?? "Progress";
		this.expectedSteps = options.expectedSteps ?? 0;
		this.showProgressBar = options.showProgressBar ?? true;
		this.anchorRow = options.anchorRow ?? null;
	}

	/** Track lines written below the frame since the last render. */
	addLinesBelow(count: number): void {
		this.linesBelow += count;
	}

	/** Render a standalone banner box (same style as the frame header). Returns line count. */
	static renderBanner(text: string, stream?: NodeJS.WriteStream): number {
		const out = stream ?? process.stdout;
		const cols = out.columns ?? 80;
		const borderWidth = cols - 2;

		const buf: string[] = [];
		let lineCount = 0;

		buf.push(`${PURPLE}╭${"─".repeat(borderWidth)}╮${RESET}\n`);
		lineCount++;

		buf.push(
			`${PURPLE}│${RESET}${" ".repeat(borderWidth)}${PURPLE}│${RESET}\n`,
		);
		lineCount++;

		const textLen = text.length;
		const leftPad = Math.max(0, Math.floor((borderWidth - textLen) / 2));
		const rightPad = Math.max(0, borderWidth - leftPad - textLen);
		buf.push(
			`${PURPLE}│${RESET}${" ".repeat(leftPad)}${PURPLE}${text}${RESET}${" ".repeat(rightPad)}${PURPLE}│${RESET}\n`,
		);
		lineCount++;

		buf.push(
			`${PURPLE}│${RESET}${" ".repeat(borderWidth)}${PURPLE}│${RESET}\n`,
		);
		lineCount++;

		buf.push(`${PURPLE}╰${"─".repeat(borderWidth)}╯${RESET}\n`);
		lineCount++;

		out.write(buf.join(""));
		return lineCount;
	}

	/** Number of content lines currently in the frame. */
	getEntryCount(): number {
		return this.lines.length;
	}

	addLine(text: string): number {
		const index = this.lines.length;
		this.lines.push({ text, status: "active", progress: 0 });
		return index;
	}

	updateLine(index: number, text: string, progress?: number): void {
		const line = this.lines[index];
		if (line && line.status === "active") {
			line.text = text;
			if (progress !== undefined) {
				line.progress = Math.max(0, Math.min(1, progress));
			}
		}
	}

	completeLine(index: number, status: "done" | "error", text?: string): void {
		const line = this.lines[index];
		if (line) {
			line.status = status;
			line.progress = 1;
			if (text !== undefined) {
				line.text = text;
			}
		}
	}

	render(spinnerFrame: string): void {
		const cols = this.stream.columns ?? 80;
		const innerWidth = cols - 4; // "│ " + content + " │"
		const borderWidth = cols - 2; // corner + dashes + corner

		const buf: string[] = [];
		let lineCount = 0;

		// Hide cursor during redraw
		buf.push("\x1b[?25l");

		// Position cursor at the top of the frame
		if (this.anchorRow !== null) {
			// Absolute positioning — immune to external terminal writes
			buf.push(`\x1b[${this.anchorRow};1H`);
		} else if (this.renderedLineCount > 0) {
			// Relative positioning — move up from current cursor
			const moveUp = this.renderedLineCount + this.linesBelow;
			buf.push(`\x1b[${moveUp}F`);
		}
		this.linesBelow = 0;

		// Top border with title
		const titleText = ` ${this.title} `;
		const rightDashes = Math.max(0, borderWidth - 1 - titleText.length);
		buf.push(`┌─${titleText}${"─".repeat(rightDashes)}┐\n`);
		lineCount++;

		// Progress bar (above content lines)
		if (
			this.showProgressBar &&
			(this.lines.length > 0 || this.expectedSteps > 0)
		) {
			const total = Math.max(this.lines.length, this.expectedSteps);
			const totalProgress = this.lines.reduce(
				(sum, l) => sum + (l.status !== "active" ? 1 : l.progress),
				0,
			);
			const ratio = total > 0 ? totalProgress / total : 0;
			const percent = Math.round(ratio * 100);
			const percentStr = `${percent}%`;
			const labelWidth = percentStr.length + 1; // space before percentage
			const barMaxWidth = Math.max(1, innerWidth - labelWidth);
			const filledCount = Math.round(ratio * barMaxWidth);
			const emptyCount = barMaxWidth - filledCount;
			const barContent = `${GREEN}${"█".repeat(filledCount)}${RESET}${DIM}${"░".repeat(emptyCount)}${RESET} ${percentStr}`;
			buf.push(`│ ${barContent} │\n`);
			lineCount++;
		}

		// Content lines
		for (const line of this.lines) {
			const icon = this.getColoredIcon(line, spinnerFrame);
			const content = this.truncate(line.text, innerWidth - 2); // -2 for icon + space
			const contentLen = this.visualLength(content);
			const padding = Math.max(0, innerWidth - 2 - contentLen);
			buf.push(`│ ${icon} ${content}${" ".repeat(padding)} │\n`);
			lineCount++;
		}

		// Bottom border (trailing \n places cursor below the frame for correct cursor-up math)
		buf.push(`└${"─".repeat(borderWidth)}┘\n`);
		lineCount++;

		// Clear any leftover lines from a previous taller render
		buf.push("\x1b[J");

		// Show cursor
		buf.push("\x1b[?25h");

		this.stream.write(buf.join(""));
		this.renderedLineCount = lineCount;
	}

	cleanup(): void {
		// Cursor is already below the frame (bottom border has trailing \n).
		// Just reset state so a subsequent render starts fresh.
		this.renderedLineCount = 0;
		this.linesBelow = 0;
	}

	private getColoredIcon(line: FrameLine, spinnerFrame: string): string {
		switch (line.status) {
			case "done":
				return `${GREEN}✔${RESET}`;
			case "error":
				return `${RED}✖${RESET}`;
			case "active":
				return `${CYAN}${spinnerFrame}${RESET}`;
		}
	}

	private truncate(text: string, maxWidth: number): string {
		const len = this.visualLength(text);
		if (len <= maxWidth) {
			return text;
		}
		// Truncate by characters (simple approach — no ANSI in progress text)
		let width = 0;
		let i = 0;
		for (; i < text.length && width < maxWidth - 1; i++) {
			width += 1;
		}
		return `${text.slice(0, i)}…`;
	}

	private visualLength(text: string): number {
		// Progress text should not contain ANSI escapes, so length is accurate
		return text.length;
	}
}
