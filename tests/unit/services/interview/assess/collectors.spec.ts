import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAsciinemaCast } from "../../../../../src/services/interview/assess/collectors/asciinema.js";
import { parseGitHistory } from "../../../../../src/services/interview/assess/collectors/git-history.js";
import { parseInterviewLog } from "../../../../../src/services/interview/assess/collectors/jsonl-log.js";
import { parseTranscript } from "../../../../../src/services/interview/assess/collectors/transcript.js";

function tmp(): string {
	return mkdtempSync(join(tmpdir(), "iv-coll-"));
}

describe("asciinema parser", () => {
	it("extracts the header and reconstructs commands from input events", () => {
		const dir = tmp();
		try {
			const path = join(dir, "terminal.cast");
			const header = JSON.stringify({
				version: 2,
				width: 80,
				height: 24,
				timestamp: 1700000000,
			});
			const events = [
				[0.1, "i", "l"],
				[0.2, "i", "s"],
				[0.3, "i", "\r"],
				[1.5, "i", "p"],
				[1.6, "i", "w"],
				[1.7, "i", "d"],
				[3.0, "i", "\r"],
			]
				.map((e) => JSON.stringify(e))
				.join("\n");
			writeFileSync(path, `${header}\n${events}\n`);
			const result = parseAsciinemaCast(path);
			expect(result.header.version).toBe(2);
			expect(result.commands.length).toBe(2);
			expect(result.commands[0].command).toBe("ls");
			expect(result.commands[1].command).toBe("pwd");
			// pwd took 3.0-1.7 = 1.3s pause before Enter
			expect(result.commands[1].pauseSecondsBeforeEnter).toBeCloseTo(1.3, 1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("throws on empty cast files", () => {
		const dir = tmp();
		try {
			const path = join(dir, "empty.cast");
			writeFileSync(path, "");
			expect(() => parseAsciinemaCast(path)).toThrow();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("handles backspace correctly", () => {
		const dir = tmp();
		try {
			const path = join(dir, "bs.cast");
			const header = JSON.stringify({
				version: 2,
				width: 80,
				height: 24,
				timestamp: 1700000000,
			});
			const events = [
				[0.1, "i", "l"],
				[0.2, "i", "x"],
				[0.3, "i", ""],
				[0.4, "i", "s"],
				[0.5, "i", "\r"],
			]
				.map((e) => JSON.stringify(e))
				.join("\n");
			writeFileSync(path, `${header}\n${events}\n`);
			const result = parseAsciinemaCast(path);
			expect(result.commands[0].command).toBe("ls");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("interview.log parser", () => {
	it("separates user-prompt-submit and pre-tool-use events", () => {
		const dir = tmp();
		try {
			const path = join(dir, "interview.log");
			const lines = [
				JSON.stringify({
					event: "user-prompt-submit",
					timestamp: "2026-05-10T10:00:00Z",
					prompt: "add a test",
				}),
				JSON.stringify({
					event: "pre-tool-use",
					timestamp: "2026-05-10T10:00:05Z",
					tool_name: "Bash",
					tool_input: { command: "bun test" },
				}),
				JSON.stringify({
					event: "user-prompt-submit",
					timestamp: "2026-05-10T10:01:00Z",
					prompt: "now fix it",
				}),
			].join("\n");
			writeFileSync(path, `${lines}\n`);
			const result = parseInterviewLog(path);
			expect(result.prompts).toHaveLength(2);
			expect(result.toolUses).toHaveLength(1);
			expect(result.toolUses[0].tool).toBe("Bash");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("silently skips malformed lines", () => {
		const dir = tmp();
		try {
			const path = join(dir, "interview.log");
			writeFileSync(
				path,
				`not-json\n${JSON.stringify({ event: "user-prompt-submit", timestamp: "2026-05-10T10:00:00Z", prompt: "hi" })}\n{broken\n`,
			);
			const result = parseInterviewLog(path);
			expect(result.prompts).toHaveLength(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("transcript parser", () => {
	it("parses [HH:MM:SS] Speaker: text format", () => {
		const dir = tmp();
		try {
			const path = join(dir, "t.txt");
			writeFileSync(
				path,
				`[00:01:23] Alice: I'll start with the data model.\n[00:02:01] Bob: That's the right call.\n`,
			);
			const result = parseTranscript(path, {
				sessionStartIso: "2026-05-10T10:00:00.000Z",
			});
			expect(result).toHaveLength(2);
			expect(result[0].speaker).toBe("Alice");
			expect(result[0].text).toContain("data model");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("parses bare Speaker: text without timestamps", () => {
		const dir = tmp();
		try {
			const path = join(dir, "t.txt");
			writeFileSync(path, `Alice: hello\nBob: hi\n`);
			const result = parseTranscript(path);
			expect(result).toHaveLength(2);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("skips VTT timing lines and comment lines", () => {
		const dir = tmp();
		try {
			const path = join(dir, "t.vtt");
			writeFileSync(
				path,
				`# header\n00:00:00.000 --> 00:00:05.000\nAlice: hi\n`,
			);
			const result = parseTranscript(path);
			expect(result).toHaveLength(1);
			expect(result[0].speaker).toBe("Alice");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("git history parser", () => {
	it("parses output from a stub git runner", () => {
		const stub = (args: string[]) => {
			expect(args[0]).toBe("log");
			return `abc123${"a".repeat(34)}\t2026-05-10T10:00:00Z\tFirst commit\n5\t3\tsrc/a.ts\n2\t1\tsrc/b.ts\nfff999${"f".repeat(34)}\t2026-05-10T10:30:00Z\tSecond commit\n10\t0\tsrc/c.ts\n`;
		};
		const result = parseGitHistory("/tmp/repo", stub);
		expect(result).toHaveLength(2);
		expect(result[0].message).toBe("First commit");
		expect(result[0].insertions).toBe(7);
		expect(result[0].deletions).toBe(4);
		expect(result[1].insertions).toBe(10);
	});

	it("returns an empty list when git fails", () => {
		const stub = () => {
			throw new Error("not a repo");
		};
		expect(parseGitHistory("/tmp/missing", stub)).toEqual([]);
	});
});
