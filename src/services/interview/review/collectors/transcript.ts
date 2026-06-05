import { readFileSync } from "node:fs";
import type { TranscriptLineEvent } from "../types.js";

/**
 * Parses an audio transcript. Supports a unified line format that all three
 * tested providers (Granola, Fireflies, Otter) export to when saved as
 * markdown or VTT-ish plain text:
 *
 *   [00:01:23] Alice: I'll start with the data model.
 *   [00:02:01] Bob:   That's the right call.
 *
 * Or the simpler form without a timestamp:
 *
 *   Alice: I'll start with the data model.
 *
 * Lines that don't match either form are skipped.
 *
 * For VTT files, this also accepts:
 *
 *   00:01:23.000 --> 00:01:26.000
 *   Alice: I'll start with the data model.
 */

const TIMESTAMPED = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s+([^:]+?):\s+(.+)$/;
// Speaker labels may include digits ("Speaker 1", "Interviewer 2") and
// non-ASCII letters (e.g. "Étienne", "Ångström", Cyrillic, CJK). \p{L}
// covers Unicode letters under the /u flag; \p{N} covers numbers in any
// script. Spaces, periods, hyphens, apostrophes, and underscores are also
// allowed inside the name.
const BARE = /^(\p{L}[\p{L}\p{N} .'_-]*?):\s+(.+)$/u;

function toIsoFromHMS(hms: string, sessionStartIso: string): string {
	const parts = hms.split(":").map(Number);
	let totalSeconds = 0;
	if (parts.length === 3) {
		totalSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
	} else if (parts.length === 2) {
		totalSeconds = parts[0] * 60 + parts[1];
	}
	const base = new Date(sessionStartIso).getTime();
	// An invalid sessionStartIso would make `base` NaN and crash toISOString().
	// Fall back to the unix epoch so the transcript still parses with relative
	// offsets, instead of aborting the entire review.
	const safeBase = Number.isFinite(base) ? base : 0;
	return new Date(safeBase + totalSeconds * 1000).toISOString();
}

export interface TranscriptParseOptions {
	/** Anchor wall-clock for "[00:00:00]"-style timestamps in the transcript. */
	readonly sessionStartIso?: string;
}

export function parseTranscript(
	path: string,
	options: TranscriptParseOptions = {},
): readonly TranscriptLineEvent[] {
	const body = readFileSync(path, "utf8");
	const lines = body.split("\n");
	const result: TranscriptLineEvent[] = [];
	const rawSessionStart = options.sessionStartIso ?? "1970-01-01T00:00:00.000Z";
	const sessionStart = Number.isFinite(new Date(rawSessionStart).getTime())
		? rawSessionStart
		: "1970-01-01T00:00:00.000Z";

	for (const raw of lines) {
		const line = raw.trim();
		if (line.length === 0) continue;
		if (line.startsWith("#") || line.includes("-->")) continue;

		const ts = line.match(TIMESTAMPED);
		if (ts) {
			result.push({
				type: "transcript-line",
				timestamp: toIsoFromHMS(ts[1], sessionStart),
				source: "transcript",
				speaker: ts[2].trim(),
				text: ts[3].trim(),
			});
			continue;
		}
		const bare = line.match(BARE);
		if (bare) {
			result.push({
				type: "transcript-line",
				timestamp: sessionStart,
				source: "transcript",
				speaker: bare[1].trim(),
				text: bare[2].trim(),
			});
		}
	}
	return result;
}
