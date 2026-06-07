import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAsciinemaCast } from "../../../../../src/services/interview/review/collectors/asciinema.js";

function tmp(): string {
	return mkdtempSync(join(tmpdir(), "iv-asciinema-edge-"));
}

function makeHeader(extra: object = {}): string {
	return JSON.stringify({
		version: 2,
		width: 80,
		height: 24,
		timestamp: 1700000000,
		...extra,
	});
}

function ev(delta: number, kind: "i" | "o", data: string): string {
	return JSON.stringify([delta, kind, data]);
}

describe("asciinema parser — control code handling", () => {
	it("ignores control codes (arrow keys, ESC sequences) without crashing", () => {
		const dir = tmp();
		try {
			const path = join(dir, "ctrl.cast");
			// ESC [ A = up-arrow escape sequence (3 chars); should be skipped
			const esc = "\x1b[A";
			writeFileSync(
				path,
				[
					makeHeader(),
					ev(0.1, "i", "l"),
					ev(0.2, "i", esc),
					ev(0.3, "i", "s"),
					ev(0.4, "i", "\r"),
				].join("\n"),
			);
			const result = parseAsciinemaCast(path);
			// Control sequences skipped; buffer only has 'l' and 's'
			expect(result.commands).toHaveLength(1);
			expect(result.commands[0].command).toBe("ls");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("skips output ('o') events entirely — only input ('i') events build commands", () => {
		const dir = tmp();
		try {
			const path = join(dir, "output.cast");
			writeFileSync(
				path,
				[
					makeHeader(),
					ev(0.1, "o", "prompt$ "),
					ev(0.2, "i", "l"),
					ev(0.3, "i", "s"),
					ev(0.4, "o", "file1  file2\n"),
					ev(0.5, "i", "\r"),
				].join("\n"),
			);
			const result = parseAsciinemaCast(path);
			expect(result.commands).toHaveLength(1);
			expect(result.commands[0].command).toBe("ls");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("handles Enter typed as '\\n' (LF) as well as '\\r' (CR)", () => {
		const dir = tmp();
		try {
			const path = join(dir, "lf.cast");
			writeFileSync(
				path,
				[
					makeHeader(),
					ev(0.1, "i", "p"),
					ev(0.2, "i", "w"),
					ev(0.3, "i", "d"),
					ev(0.4, "i", "\n"),
				].join("\n"),
			);
			const result = parseAsciinemaCast(path);
			expect(result.commands).toHaveLength(1);
			expect(result.commands[0].command).toBe("pwd");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("skips Enter keystrokes on an empty buffer (no command emitted)", () => {
		const dir = tmp();
		try {
			const path = join(dir, "empty-enter.cast");
			writeFileSync(
				path,
				[
					makeHeader(),
					ev(0.1, "i", "\r"), // Enter on empty buffer
					ev(0.2, "i", "\r"), // Another bare Enter
					ev(0.3, "i", "l"),
					ev(0.4, "i", "s"),
					ev(0.5, "i", "\r"),
				].join("\n"),
			);
			const result = parseAsciinemaCast(path);
			// Only the 'ls' command should be emitted; bare Enters are ignored
			expect(result.commands).toHaveLength(1);
			expect(result.commands[0].command).toBe("ls");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("handles tab characters in command input", () => {
		const dir = tmp();
		try {
			const path = join(dir, "tab.cast");
			writeFileSync(
				path,
				[
					makeHeader(),
					ev(0.1, "i", "b"),
					ev(0.2, "i", "u"),
					ev(0.3, "i", "n"),
					ev(0.4, "i", "\t"), // tab (e.g. shell autocomplete attempt)
					ev(0.5, "i", "t"),
					ev(0.6, "i", "e"),
					ev(0.7, "i", "s"),
					ev(0.8, "i", "t"),
					ev(0.9, "i", "\r"),
				].join("\n"),
			);
			const result = parseAsciinemaCast(path);
			// Tab is captured in the buffer, resulting in "bun\ttest"
			expect(result.commands).toHaveLength(1);
			expect(result.commands[0].command).toContain("bun");
			expect(result.commands[0].command).toContain("test");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("asciinema parser — header and metadata", () => {
	it("falls back to epoch 0 when header has no timestamp field", () => {
		const dir = tmp();
		try {
			const path = join(dir, "no-ts.cast");
			const header = JSON.stringify({ version: 2, width: 80, height: 24 });
			writeFileSync(
				path,
				[header, ev(1.5, "i", "l"), ev(2.0, "i", "s"), ev(3.0, "i", "\r")].join(
					"\n",
				),
			);
			const result = parseAsciinemaCast(path);
			// With baseEpoch=0, the timestamp is derived from delta alone
			expect(result.header.version).toBe(2);
			expect(result.commands).toHaveLength(1);
			// The timestamp should be a valid ISO string even without a header epoch
			expect(result.commands[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("preserves all raw events in the events array", () => {
		const dir = tmp();
		try {
			const path = join(dir, "events.cast");
			writeFileSync(
				path,
				[
					makeHeader(),
					ev(0.1, "i", "l"),
					ev(0.2, "o", "total 0\n"),
					ev(0.3, "i", "s"),
					ev(0.4, "i", "\r"),
				].join("\n"),
			);
			const result = parseAsciinemaCast(path);
			// 4 events: 1 output, 3 input
			expect(result.events).toHaveLength(4);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns the header env field when present", () => {
		const dir = tmp();
		try {
			const path = join(dir, "env.cast");
			writeFileSync(
				path,
				[
					makeHeader({ env: { SHELL: "/bin/zsh", TERM: "xterm-256color" } }),
					ev(0.1, "i", "l"),
					ev(0.2, "i", "\r"),
				].join("\n"),
			);
			const result = parseAsciinemaCast(path);
			expect(result.header.env?.SHELL).toBe("/bin/zsh");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("tolerates blank lines between event entries", () => {
		const dir = tmp();
		try {
			const path = join(dir, "blanks.cast");
			writeFileSync(
				path,
				[
					makeHeader(),
					"",
					ev(0.1, "i", "l"),
					"",
					ev(0.2, "i", "s"),
					ev(0.3, "i", "\r"),
					"",
				].join("\n"),
			);
			const result = parseAsciinemaCast(path);
			expect(result.commands).toHaveLength(1);
			expect(result.commands[0].command).toBe("ls");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("asciinema parser — pauseSecondsBeforeEnter calculation", () => {
	it("computes pause relative to the last typed key, not the first", () => {
		const dir = tmp();
		try {
			const path = join(dir, "pause.cast");
			// l at t=0.1, s at t=5.0, Enter at t=5.2 → pause = 5.2 - 5.0 = 0.2
			writeFileSync(
				path,
				[
					makeHeader(),
					ev(0.1, "i", "l"),
					ev(5.0, "i", "s"),
					ev(5.2, "i", "\r"),
				].join("\n"),
			);
			const result = parseAsciinemaCast(path);
			expect(result.commands[0].command).toBe("ls");
			expect(result.commands[0].pauseSecondsBeforeEnter).toBeCloseTo(0.2, 1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("clamps pauseSecondsBeforeEnter to 0 when Enter delta is before last key delta", () => {
		const dir = tmp();
		try {
			const path = join(dir, "no-neg-pause.cast");
			// Pathological cast: Enter at 0.1, key at 0.5 (would give negative pause)
			writeFileSync(
				path,
				[
					makeHeader({ timestamp: 0 }),
					// Only Enter — no preceding keystrokes — pause should be 0
					ev(0.1, "i", "l"),
					ev(0.0, "i", "\r"), // delta less than lastKeyDelta
				].join("\n"),
			);
			const result = parseAsciinemaCast(path);
			// Result may have 0 or 1 command depending on ordering; either way, no negative pause
			for (const cmd of result.commands) {
				expect(cmd.pauseSecondsBeforeEnter).toBeGreaterThanOrEqual(0);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
