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
	let buffer = "";
	let lastKeyDelta = 0;
	for (const evt of events) {
		if (evt.kind !== "i") continue;
		const data = evt.data;
		if (data === "\r" || data === "\n") {
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
		} else if (data === "" || data === "\b") {
			// Backspace
			buffer = buffer.slice(0, -1);
			lastKeyDelta = evt.delta;
		} else if (data.charCodeAt(0) >= 32 || data === "\t") {
			buffer += data;
			lastKeyDelta = evt.delta;
		} else {
			// Control codes: arrows, escape sequences, etc. Skip silently.
		}
	}

	return { header, events, commands };
}
