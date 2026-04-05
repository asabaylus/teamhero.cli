import type { NormalizedNote } from "../../models/visible-wins.js";

export type GeminiNotesParseResult =
	| { ok: true; note: Omit<NormalizedNote, "date"> & { date?: string } }
	| { ok: false; error: string; sourceFile: string };

// Known section headers for Gemini meeting notes (case-insensitive matching)
const ATTENDEE_HEADERS = new Set(["attendees", "participants"]);
const DISCUSSION_HEADERS = new Set([
	"summary",
	"key discussion points",
	"discussion points",
	"decisions made",
	"decisions",
	"action items",
	"next steps",
]);

interface Section {
	header: string;
	lines: string[];
}

function splitSections(content: string): {
	title: string | undefined;
	sections: Section[];
} {
	const lines = content.split("\n");
	let title: string | undefined;
	const sections: Section[] = [];
	let currentSection: Section | null = null;

	const allHeaders = new Set([...ATTENDEE_HEADERS, ...DISCUSSION_HEADERS]);

	for (const line of lines) {
		const trimmed = line.trim();

		// First non-empty line is the title
		if (!title && trimmed) {
			title = trimmed;
			continue;
		}

		// Check if this line is a section header
		if (trimmed && allHeaders.has(trimmed.toLowerCase())) {
			if (currentSection) {
				sections.push(currentSection);
			}
			currentSection = { header: trimmed, lines: [] };
			continue;
		}

		// Accumulate lines into current section
		if (currentSection) {
			currentSection.lines.push(trimmed);
		}
	}

	if (currentSection) {
		sections.push(currentSection);
	}

	return { title, sections };
}

function parseAttendees(section: Section): string[] {
	const attendees: string[] = [];
	for (const line of section.lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		// Strip bullet markers if present
		const name = trimmed.replace(/^[-*•]\s*/, "").trim();
		if (name) {
			attendees.push(name);
		}
	}
	return attendees;
}

function extractDiscussionItems(sections: Section[]): string[] {
	const items: string[] = [];

	for (const section of sections) {
		const headerLower = section.header.toLowerCase();
		if (!DISCUSSION_HEADERS.has(headerLower)) continue;

		// For summary sections, extract sentences if no bullets
		if (headerLower === "summary") {
			const hasBullets = section.lines.some((l) => /^\s*[-*•]/.test(l));
			if (!hasBullets) {
				// Extract paragraph text as a single discussion item
				const paragraph = section.lines.filter((l) => l.trim()).join(" ");
				if (paragraph) {
					items.push(paragraph);
				}
				continue;
			}
		}

		// Extract bullet items
		for (const line of section.lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const match = trimmed.match(/^[-*•]\s*(.+)/);
			if (match) {
				items.push(match[1].trim());
			}
		}
	}

	return items;
}

export function parseGeminiMeetingNotes(
	content: string,
	sourceFile: string,
): GeminiNotesParseResult {
	const trimmed = content.trim();
	if (!trimmed) {
		return { ok: false, error: "Empty file content", sourceFile };
	}

	const { title, sections } = splitSections(trimmed);

	if (!title && sections.length === 0) {
		return { ok: false, error: "No structured content found", sourceFile };
	}

	let attendees: string[] = [];
	for (const section of sections) {
		if (ATTENDEE_HEADERS.has(section.header.toLowerCase())) {
			attendees = parseAttendees(section);
			break;
		}
	}

	const discussionItems = extractDiscussionItems(sections);

	return {
		ok: true,
		note: {
			title: title ?? sourceFile,
			attendees,
			discussionItems,
			sourceFile,
		},
	};
}
