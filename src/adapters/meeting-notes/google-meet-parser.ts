import { basename } from "node:path";
import type { NormalizedNote } from "../../models/visible-wins.js";

export type GoogleMeetParseResult =
	| { ok: true; note: Omit<NormalizedNote, "date"> & { date?: string } }
	| { ok: false; error: string; sourceFile: string };

const DATE_PATTERN = /(\d{4})\s+(\d{2})\s+(\d{2})/;

export function extractDateFromFilename(filename: string): string | undefined {
	const match = filename.match(DATE_PATTERN);
	if (!match) return undefined;
	const [, year, month, day] = match;
	const dateStr = `${year}-${month}-${day}`;
	const parsed = new Date(dateStr);
	if (
		Number.isNaN(parsed.getTime()) ||
		parsed.toISOString().slice(0, 10) !== dateStr
	) {
		return undefined;
	}
	return dateStr;
}

function parseAttendees(sectionContent: string): string[] {
	const lines = sectionContent.split("\n");
	const attendees: string[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
			const raw = trimmed.slice(2).trim();
			const name = raw.replace(/\([^)]*\)/g, "").trim();
			if (name) {
				attendees.push(name);
			}
		}
	}
	return attendees;
}

function parseDiscussionItems(sections: ParsedSection[]): string[] {
	const attendeeHeaders = new Set(["attendees", "participants"]);
	const items: string[] = [];

	for (const section of sections) {
		const headerLower = section.header.toLowerCase();
		if (attendeeHeaders.has(headerLower)) continue;

		const lines = section.content.split("\n");
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
				const item = trimmed.slice(2).trim();
				if (item) {
					items.push(item);
				}
			}
		}
	}
	return items;
}

interface ParsedSection {
	header: string;
	content: string;
}

function splitIntoSections(content: string): {
	title: string | undefined;
	sections: ParsedSection[];
} {
	const lines = content.split("\n");
	let title: string | undefined;
	const sections: ParsedSection[] = [];
	let currentHeader: string | null = null;
	let currentLines: string[] = [];

	for (const line of lines) {
		if (/^# [^#]/.test(line)) {
			if (!title) {
				title = line.slice(2).trim();
			}
			continue;
		}

		if (line.startsWith("## ")) {
			if (currentHeader !== null) {
				sections.push({
					header: currentHeader,
					content: currentLines.join("\n"),
				});
			}
			currentHeader = line.slice(3).trim();
			currentLines = [];
			continue;
		}

		if (currentHeader !== null) {
			currentLines.push(line);
		}
	}

	if (currentHeader !== null) {
		sections.push({
			header: currentHeader,
			content: currentLines.join("\n"),
		});
	}

	return { title, sections };
}

export function parseGoogleMeetMarkdown(
	content: string,
	sourceFile: string,
): GoogleMeetParseResult {
	const trimmed = content.trim();
	if (!trimmed) {
		return { ok: false, error: "Empty file content", sourceFile };
	}

	const { title, sections } = splitIntoSections(trimmed);

	if (!title && sections.length === 0) {
		return {
			ok: false,
			error: "No structured Markdown content found",
			sourceFile,
		};
	}

	const resolvedTitle = title ?? basename(sourceFile, ".md");

	const attendeeHeaders = new Set(["attendees", "participants"]);
	let attendees: string[] = [];
	for (const section of sections) {
		if (attendeeHeaders.has(section.header.toLowerCase())) {
			attendees = parseAttendees(section.content);
			break;
		}
	}

	const discussionItems = parseDiscussionItems(sections);

	const date = extractDateFromFilename(sourceFile);

	return {
		ok: true,
		note: {
			title: resolvedTitle,
			...(date !== undefined ? { date } : {}),
			attendees,
			discussionItems,
			sourceFile,
		},
	};
}
