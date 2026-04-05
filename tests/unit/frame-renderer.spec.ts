import { beforeEach, describe, expect, it } from "bun:test";
import { Writable } from "node:stream";
import { FrameRenderer } from "../../src/lib/frame-renderer.js";

function createMockStream(columns = 80): NodeJS.WriteStream {
	const chunks: string[] = [];
	const stream = new Writable({
		write(chunk, _encoding, callback) {
			chunks.push(chunk.toString());
			callback();
		},
	}) as unknown as NodeJS.WriteStream;
	(stream as any).columns = columns;
	(stream as any).getOutput = () => chunks.join("");
	(stream as any).getChunks = () => [...chunks];
	(stream as any).clear = () => {
		chunks.length = 0;
	};
	return stream;
}

function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
}

describe("FrameRenderer", () => {
	let stream: NodeJS.WriteStream & {
		getOutput: () => string;
		clear: () => void;
	};

	beforeEach(() => {
		stream = createMockStream() as any;
	});

	describe("addLine", () => {
		it("should return sequential indices", () => {
			const renderer = new FrameRenderer({ stream });
			expect(renderer.addLine("first")).toBe(0);
			expect(renderer.addLine("second")).toBe(1);
			expect(renderer.addLine("third")).toBe(2);
		});
	});

	describe("updateLine", () => {
		it("should update active line text", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("initial");
			renderer.updateLine(0, "updated");
			renderer.render("⠋");

			const output = stripAnsi(stream.getOutput());
			expect(output).toContain("updated");
			expect(output).not.toContain("initial");
		});

		it("should not update completed line", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("initial");
			renderer.completeLine(0, "done");
			renderer.updateLine(0, "should not appear");
			renderer.render("⠋");

			const output = stripAnsi(stream.getOutput());
			expect(output).toContain("initial");
			expect(output).not.toContain("should not appear");
		});
	});

	describe("completeLine", () => {
		it("should mark line as done with checkmark", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("task");
			renderer.completeLine(0, "done");
			renderer.render("⠋");

			const output = stripAnsi(stream.getOutput());
			expect(output).toContain("✔ task");
		});

		it("should mark line as error with cross", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("task");
			renderer.completeLine(0, "error");
			renderer.render("⠋");

			const output = stripAnsi(stream.getOutput());
			expect(output).toContain("✖ task");
		});

		it("should update text when provided", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("working");
			renderer.completeLine(0, "done", "finished");
			renderer.render("⠋");

			const output = stripAnsi(stream.getOutput());
			expect(output).toContain("✔ finished");
			expect(output).not.toContain("working");
		});
	});

	describe("render", () => {
		it("should draw frame borders", () => {
			const renderer = new FrameRenderer({ stream, title: "Test" });
			renderer.addLine("hello");
			renderer.render("⠋");

			const output = stripAnsi(stream.getOutput());
			expect(output).toContain("┌─");
			expect(output).toContain("Test");
			expect(output).toContain("┐");
			expect(output).toContain("│");
			expect(output).toContain("└");
			expect(output).toContain("┘");
		});

		it("should use spinner frame for active lines", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("loading");
			renderer.render("⠋");

			const output = stripAnsi(stream.getOutput());
			expect(output).toContain("⠋ loading");
		});

		it("should hide cursor during render", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("test");
			renderer.render("⠋");

			const output = stream.getOutput();
			expect(output).toContain("\x1b[?25l");
			expect(output).toContain("\x1b[?25h");
		});

		it("should render multiple lines inside frame", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("first");
			renderer.addLine("second");
			renderer.completeLine(0, "done");
			renderer.render("⠋");

			const output = stripAnsi(stream.getOutput());
			expect(output).toContain("✔ first");
			expect(output).toContain("⠋ second");
		});

		it("should move cursor up on subsequent renders", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("test");
			renderer.render("⠋");

			stream.clear();
			renderer.render("⠙");

			const output = stream.getOutput();
			// 4 lines: top border + progress bar + 1 content + bottom border
			expect(output).toContain("\x1b[4F");
		});

		it("should truncate long text to prevent wrapping", () => {
			const narrowStream = createMockStream(30) as any;
			const renderer = new FrameRenderer({ stream: narrowStream });
			renderer.addLine("this is a very long line that should be truncated");
			renderer.render("⠋");

			const output = narrowStream.getOutput();
			expect(output).toContain("…");
		});
	});

	describe("colored icons", () => {
		it("should render checkmark in green", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("task");
			renderer.completeLine(0, "done");
			renderer.render("⠋");

			const output = stream.getOutput();
			expect(output).toContain("\x1b[32m✔\x1b[0m");
		});

		it("should render cross in red", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("task");
			renderer.completeLine(0, "error");
			renderer.render("⠋");

			const output = stream.getOutput();
			expect(output).toContain("\x1b[31m✖\x1b[0m");
		});

		it("should render spinner in cyan", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("loading");
			renderer.render("⠋");

			const output = stream.getOutput();
			expect(output).toContain("\x1b[36m⠋\x1b[0m");
		});
	});

	describe("progress bar", () => {
		it("should show 0% when no lines are completed", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("task1");
			renderer.addLine("task2");
			renderer.render("⠋");

			const output = stripAnsi(stream.getOutput());
			expect(output).toContain("0%");
			expect(output).toContain("░");
		});

		it("should show 50% when half the lines are completed", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("task1");
			renderer.addLine("task2");
			renderer.completeLine(0, "done");
			renderer.render("⠋");

			const output = stripAnsi(stream.getOutput());
			expect(output).toContain("50%");
			expect(output).toContain("█");
			expect(output).toContain("░");
		});

		it("should show 100% when all lines are completed", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("task1");
			renderer.addLine("task2");
			renderer.completeLine(0, "done");
			renderer.completeLine(1, "done");
			renderer.render("⠋");

			const output = stripAnsi(stream.getOutput());
			expect(output).toContain("100%");
			expect(output).toContain("█");
			expect(output).not.toContain("░");
		});

		it("should use green for filled portion", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("task");
			renderer.completeLine(0, "done");
			renderer.render("⠋");

			const output = stream.getOutput();
			// Green filled bar chars
			expect(output).toContain("\x1b[32m█");
		});
	});

	describe("showProgressBar", () => {
		it("should hide progress bar when showProgressBar is false", () => {
			const renderer = new FrameRenderer({ stream, showProgressBar: false });
			renderer.addLine("task1");
			renderer.addLine("task2");
			renderer.completeLine(0, "done");
			renderer.render("⠋");

			const output = stripAnsi(stream.getOutput());
			expect(output).not.toContain("%");
			expect(output).not.toContain("█");
			expect(output).not.toContain("░");
			expect(output).toContain("✔ task1");
			expect(output).toContain("⠋ task2");
		});

		it("should show progress bar by default", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("task");
			renderer.render("⠋");

			const output = stripAnsi(stream.getOutput());
			expect(output).toContain("0%");
		});
	});

	describe("linesBelow", () => {
		it("should account for linesBelow in cursor-up on re-render", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("test");
			renderer.render("⠋");

			stream.clear();
			// Simulate 2 lines written below the frame (e.g. gum echo + spinner)
			renderer.addLinesBelow(2);
			renderer.render("⠙");

			const output = stream.getOutput();
			// 4 (frame lines) + 2 (lines below) = 6
			expect(output).toContain("\x1b[6F");
		});

		it("should reset linesBelow after render", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("test");
			renderer.render("⠋");

			renderer.addLinesBelow(3);
			stream.clear();
			renderer.render("⠙");

			// First re-render accounts for linesBelow
			const output1 = stream.getOutput();
			expect(output1).toContain("\x1b[7F"); // 4 + 3

			stream.clear();
			renderer.render("⠚");

			// Second re-render: linesBelow was reset to 0
			const output2 = stream.getOutput();
			expect(output2).toContain("\x1b[4F"); // just frame lines
		});

		it("should accumulate multiple addLinesBelow calls", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("test");
			renderer.render("⠋");

			renderer.addLinesBelow(1);
			renderer.addLinesBelow(2);

			stream.clear();
			renderer.render("⠙");

			const output = stream.getOutput();
			// 4 (frame) + 1 + 2 = 7
			expect(output).toContain("\x1b[7F");
		});
	});

	describe("anchorRow", () => {
		it("should use absolute positioning instead of cursor-up when anchorRow is set", () => {
			const renderer = new FrameRenderer({ stream, anchorRow: 6 });
			renderer.addLine("test");
			renderer.render("⠋");

			stream.clear();
			renderer.render("⠙");

			const output = stream.getOutput();
			// Should use absolute positioning \x1b[6;1H instead of cursor-up \x1b[NF
			expect(output).toContain("\x1b[6;1H");
			expect(output).not.toMatch(/\x1b\[\d+F/);
		});

		it("should use absolute positioning on first render too", () => {
			const renderer = new FrameRenderer({ stream, anchorRow: 10 });
			renderer.addLine("task");
			renderer.render("⠋");

			const output = stream.getOutput();
			expect(output).toContain("\x1b[10;1H");
		});

		it("should ignore linesBelow when anchorRow is set", () => {
			const renderer = new FrameRenderer({ stream, anchorRow: 6 });
			renderer.addLine("test");
			renderer.render("⠋");

			renderer.addLinesBelow(5);
			stream.clear();
			renderer.render("⠙");

			const output = stream.getOutput();
			// Still uses absolute positioning, not affected by linesBelow
			expect(output).toContain("\x1b[6;1H");
			expect(output).not.toMatch(/\x1b\[\d+F/);
		});
	});

	describe("expectedSteps", () => {
		it("should use expectedSteps as denominator when larger than line count", () => {
			const renderer = new FrameRenderer({ stream, expectedSteps: 10 });
			renderer.addLine("task1");
			renderer.addLine("task2");
			renderer.addLine("task3");
			renderer.completeLine(0, "done");
			renderer.completeLine(1, "done");
			renderer.completeLine(2, "done");
			renderer.render("⠋");

			const output = stripAnsi(stream.getOutput());
			// 3 done out of 10 expected = 30%
			expect(output).toContain("30%");
		});

		it("should use lines.length when it exceeds expectedSteps", () => {
			const renderer = new FrameRenderer({ stream, expectedSteps: 2 });
			renderer.addLine("task1");
			renderer.addLine("task2");
			renderer.addLine("task3");
			renderer.completeLine(0, "done");
			renderer.render("⠋");

			const output = stripAnsi(stream.getOutput());
			// 1 done out of 3 lines (exceeds expected 2) = 33%
			expect(output).toContain("33%");
		});

		it("should render 0% progress bar when expectedSteps set but no lines added", () => {
			const renderer = new FrameRenderer({ stream, expectedSteps: 5 });
			renderer.render("⠋");

			const output = stripAnsi(stream.getOutput());
			expect(output).toContain("0%");
			expect(output).toContain("░");
		});
	});

	describe("cleanup", () => {
		it("should reset state without writing output", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("test");
			renderer.render("⠋");
			stream.clear();

			renderer.cleanup();
			// Cleanup no longer writes — bottom border already has \n
			const output = stream.getOutput();
			expect(output).toBe("");
		});

		it("should allow fresh render after cleanup", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("test");
			renderer.render("⠋");
			renderer.cleanup();

			stream.clear();
			renderer.addLine("new");
			renderer.render("⠋");

			const output = stream.getOutput();
			// Should not contain cursor-up (renderedLineCount was reset)
			expect(output).not.toContain("F");
		});
	});

	describe("default title", () => {
		it("should use 'Progress' as default title", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("test");
			renderer.render("⠋");

			const output = stripAnsi(stream.getOutput());
			expect(output).toContain("Progress");
		});
	});

	describe("sub-progress tracking", () => {
		it("should reflect fractional progress in the bar", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("task1");
			renderer.addLine("task2");
			renderer.addLine("task3");
			renderer.addLine("task4");
			renderer.completeLine(0, "done");
			renderer.updateLine(1, "halfway", 0.5);
			renderer.render("⠋");

			// 1 done (1.0) + 1 at 0.5 + 2 at 0 = 1.5 / 4 = 37.5% → rounds to 38%
			const output = stripAnsi(stream.getOutput());
			expect(output).toContain("38%");
		});

		it("should show 0% when all lines have zero sub-progress", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("task1");
			renderer.addLine("task2");
			renderer.render("⠋");

			const output = stripAnsi(stream.getOutput());
			expect(output).toContain("0%");
		});

		it("should clamp progress between 0 and 1", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("task");
			renderer.updateLine(0, "over", 1.5);
			renderer.render("⠋");

			// Clamped to 1.0 → 100%
			const output = stripAnsi(stream.getOutput());
			expect(output).toContain("100%");
		});

		it("should set progress to 1 when line completes", () => {
			const renderer = new FrameRenderer({ stream });
			renderer.addLine("task1");
			renderer.addLine("task2");
			renderer.updateLine(0, "partial", 0.3);
			renderer.completeLine(0, "done");
			renderer.render("⠋");

			// 1 done (1.0) + 1 active (0) = 1 / 2 = 50%
			const output = stripAnsi(stream.getOutput());
			expect(output).toContain("50%");
		});
	});

	describe("renderBanner (static)", () => {
		it("should draw a standalone banner box", () => {
			const lineCount = FrameRenderer.renderBanner("Hello World", stream);

			const output = stripAnsi(stream.getOutput());
			expect(output).toContain("╭");
			expect(output).toContain("Hello World");
			expect(output).toContain("╰");
			expect(lineCount).toBe(5);
		});

		it("should use purple color", () => {
			FrameRenderer.renderBanner("Banner", stream);

			const output = stream.getOutput();
			expect(output).toContain("\x1b[38;5;212m╭");
		});

		it("should center the text", () => {
			FrameRenderer.renderBanner("Hi", stream);

			const output = stripAnsi(stream.getOutput());
			// With 80 cols, borderWidth = 78, text "Hi" = 2 chars
			// leftPad = floor((78-2)/2) = 38, rightPad = 78-38-2 = 38
			const lines = output.split("\n");
			const textLine = lines.find((l) => l.includes("Hi"))!;
			// Text should be surrounded by spaces inside │...│
			expect(textLine).toMatch(/│\s+Hi\s+│/);
		});
	});

	describe("border alignment", () => {
		it("should align top border corners with bottom border", () => {
			const renderer = new FrameRenderer({ stream, title: "Test" });
			renderer.addLine("task");
			renderer.render("⠋");

			const output = stripAnsi(stream.getOutput());
			const lines = output.split("\n").filter((l) => l.length > 0);
			const topLine = lines.find((l) => l.includes("┌"))!;
			const bottomLine = lines.find((l) => l.includes("└"))!;
			expect(topLine.length).toBe(bottomLine.length);
		});
	});

	describe("progress bar position", () => {
		it("should render progress bar above content lines", () => {
			const renderer = new FrameRenderer({ stream, expectedSteps: 3 });
			renderer.addLine("task1");
			renderer.completeLine(0, "done");
			renderer.render("⠋");

			const output = stripAnsi(stream.getOutput());
			const lines = output.split("\n").filter((l) => l.length > 0);
			const progressBarIndex = lines.findIndex((l) => l.includes("%"));
			const contentIndex = lines.findIndex((l) => l.includes("task1"));
			expect(progressBarIndex).toBeGreaterThan(-1);
			expect(contentIndex).toBeGreaterThan(-1);
			expect(progressBarIndex).toBeLessThan(contentIndex);
		});
	});
});
