import { readFileSync } from "node:fs";
import type { CommandEvent } from "../types.js";

/**
 * asciinema v2 cast files: first line is a JSON header; subsequent lines are
 * `[delta_seconds, "o"|"i", "data"]`. We collapse output events into shell
 * "commands" by detecting carriage returns following non-empty buffered text.
 *
 * This is a deliberately conservative parser. It extracts:
 *   - command lines (text typed then submitted with Enter)
 *   - the pause in seconds between the last keystroke and the Enter
 *
 * It is NOT a full PTY emulator. It does not interpret arrow keys, history
 * recall, or job control. For richer behavior, swap in a heavier parser later.
 */

interface CastHeader {
	readonly version: number;
	readonly width: number;
	readonly height: number;
	readonly timestamp?: number;
	readonly env?: Record<string, string>;
}

interface AsciinemaEvent {
	readonly delta: number;
	readonly kind: "i" | "o";
	readonly data: string;
}

export interface AsciinemaParseResult {
	readonly header: CastHeader;
	readonly events: readonly AsciinemaEvent[];
	readonly commands: readonly CommandEvent[];
}

function isoFromUnix(unixSeconds: number): string {
	return new Date(unixSeconds * 1000).toISOString();
}

export function parseAsciinemaCast(path: string): AsciinemaParseResult {
	const body = readFileSync(path, "utf8").trim();
	if (body.length === 0) {
		throw new Error(`Empty asciinema cast file: ${path}`);
	}
	const lines = body.split("\n");
	const headerLine = lines[0];
	const header = JSON.parse(headerLine) as CastHeader;
	const events: AsciinemaEvent[] = [];
	for (let i = 1; i < lines.length; i++) {
		const raw = lines[i].trim();
		if (raw.length === 0) continue;
		const parsed = JSON.parse(raw) as [number, "i" | "o", string];
		events.push({ delta: parsed[0], kind: parsed[1], data: parsed[2] });
	}

	const baseEpoch = header.timestamp ?? 0;
	const commands: CommandEvent[] = [];

	// Walk the input stream and reconstruct commands. When the user types
	// printable characters they appear as "i" events; the shell echoes them
	// back as "o" events. We focus on "i" events for what the user *typed*.
	//
	// evt.data is usually a single character for interactive shells but
	// can be a multi-character chunk on paste or rapid input. Iterate over
	// every character so a payload like "npm test\r" submits the buffered
	// command instead of being captured as one literal blob.
	let buffer = "";
	let lastKeyDelta = 0;
	for (const evt of events) {
		if (evt.kind !== "i") continue;
		const chunk = evt.data;
		for (let i = 0; i < chunk.length; i++) {
			const ch = chunk[i];
			// CSI / ANSI escape sequence: ESC [ ... letter. Skip the whole
			// sequence as a unit so per-char iteration doesn't accidentally
			// buffer the bracket and letter as printable characters.
			if (ch === "\x1b") {
				let j = i + 1;
				if (j < chunk.length && chunk[j] === "[") {
					j++;
					while (j < chunk.length) {
						const c = chunk.charCodeAt(j);
						if (c >= 0x40 && c <= 0x7e) {
							j++;
							break;
						}
						j++;
					}
				} else {
					// Two-byte escape (ESC + 1 char) or lone ESC; skip one more
					// char defensively if available.
					if (j < chunk.length) j++;
				}
				i = j - 1;
				continue;
			}
			if (ch === "\r" || ch === "\n") {
				if (buffer.trim().length > 0) {
					commands.push({
						type: "command",
						timestamp: isoFromUnix(baseEpoch + evt.delta),
						source: "terminal.cast",
						command: buffer,
						pauseSecondsBeforeEnter: Math.max(0, evt.delta - lastKeyDelta),
					});
				}
				buffer = "";
			} else if (ch === "" || ch === "\b") {
				buffer = buffer.slice(0, -1);
				lastKeyDelta = evt.delta;
			} else if (ch.charCodeAt(0) >= 32 || ch === "\t") {
				buffer += ch;
				lastKeyDelta = evt.delta;
			}
			// Else: lone control codes â skip silently.
		}
	}

	return { header, events, commands };
}
