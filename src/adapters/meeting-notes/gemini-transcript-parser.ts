import type { NormalizedNote } from "../../models/visible-wins.js";

export type GeminiTranscriptParseResult =
	| { ok: true; note: Omit<NormalizedNote, "date"> & { date?: string } }
	| { ok: false; error: string; sourceFile: string };

const TIMESTAMP_LINE = /^\[(\d{2}:\d{2}:\d{2})\]\s+([^:]+):\s+(.+)$/;

interface TranscriptLine {
	timestamp: string;
	speaker: string;
	content: string;
}

function parseTranscriptLines(content: string): TranscriptLine[] {
	const lines: TranscriptLine[] = [];
	for (const line of content.split("\n")) {
		const match = line.trim().match(TIMESTAMP_LINE);
		if (match) {
			lines.push({
				timestamp: match[1],
				speaker: match[2].trim(),
				content: match[3].trim(),
			});
		}
	}
	return lines;
}

function extractSpeakers(lines: TranscriptLine[]): string[] {
	const seen = new Set<string>();
	const speakers: string[] = [];
	for (const line of lines) {
		if (!seen.has(line.speaker)) {
			seen.add(line.speaker);
			speakers.push(line.speaker);
		}
	}
	return speakers;
}

/**
 * Group transcript lines into discussion items.
 * Uses a simple heuristic: combine consecutive lines into chunks,
 * then summarize each chunk as a discussion item.
 */
function extractDiscussionItems(lines: TranscriptLine[]): string[] {
	if (lines.length === 0) return [];

	const items: string[] = [];
	const CHUNK_SIZE = 5;

	for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
		const chunk = lines.slice(i, i + CHUNK_SIZE);
		// Use first line's content as the representative discussion item
		// Prefix with speaker for context
		const representative = chunk[0];
		const item = `${representative.speaker}: ${representative.content}`;
		items.push(item);
	}

	return items;
}

export function parseGeminiTranscript(
	content: string,
	sourceFile: string,
): GeminiTranscriptParseResult {
	const trimmed = content.trim();
	if (!trimmed) {
		return { ok: false, error: "Empty transcript content", sourceFile };
	}

	const lines = parseTranscriptLines(trimmed);

	if (lines.length === 0) {
		return {
			ok: false,
			error: "No timestamped transcript lines found",
			sourceFile,
		};
	}

	const speakers = extractSpeakers(lines);
	const discussionItems = extractDiscussionItems(lines);

	// Derive title from filename
	const title = sourceFile.replace(/\.[^.]+$/, "");

	return {
		ok: true,
		note: {
			title,
			attendees: speakers,
			discussionItems,
			sourceFile,
		},
	};
}
