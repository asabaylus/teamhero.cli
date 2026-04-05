import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseGeminiMeetingNotes } from "../../../src/adapters/meeting-notes/gemini-notes-parser.js";

const FIXTURE_DIR = join(__dirname, "../../fixtures/meeting-notes");

async function loadFixture(name: string): Promise<string> {
	return readFile(join(FIXTURE_DIR, name), "utf-8");
}

describe("parseGeminiMeetingNotes", () => {
	it("parses a valid Gemini meeting notes export", async () => {
		const content = await loadFixture("valid-gemini-notes.txt");
		const result = parseGeminiMeetingNotes(content, "gdrive:abc123");

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.note.title).toBe("Weekly Product Sync - Q1 Planning");
		expect(result.note.attendees).toEqual([
			"Alice Johnson",
			"Bob Smith",
			"Carol Davis",
			"David Lee",
		]);
		expect(result.note.discussionItems.length).toBeGreaterThan(0);
		expect(result.note.sourceFile).toBe("gdrive:abc123");
	});

	it("extracts discussion items from all relevant sections", async () => {
		const content = await loadFixture("valid-gemini-notes.txt");
		const result = parseGeminiMeetingNotes(content, "test.txt");

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		// Should include items from Summary, Key Discussion Points, Decisions, Actions, Next Steps
		expect(result.note.discussionItems.length).toBeGreaterThanOrEqual(5);
		// Check specific items from different sections
		expect(result.note.discussionItems).toEqual(
			expect.arrayContaining([expect.stringContaining("dashboard")]),
		);
	});

	it("handles summary section as paragraph text", () => {
		const content = `Meeting Title

Summary
The team discussed important topics and made progress on the project.

Key Discussion Points
- Point one
- Point two
`;
		const result = parseGeminiMeetingNotes(content, "test.txt");

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.note.discussionItems).toEqual(
			expect.arrayContaining([
				expect.stringContaining("discussed important topics"),
			]),
		);
	});

	it("handles missing attendees section", () => {
		const content = `Meeting Title

Key Discussion Points
- Some discussion point
`;
		const result = parseGeminiMeetingNotes(content, "test.txt");

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.note.attendees).toEqual([]);
		expect(result.note.discussionItems).toHaveLength(1);
	});

	it("returns parse error for empty content", () => {
		const result = parseGeminiMeetingNotes("", "empty.txt");

		expect(result.ok).toBe(false);
		if (result.ok) return;

		expect(result.error).toBe("Empty file content");
	});

	it("returns parse error for whitespace-only content", () => {
		const result = parseGeminiMeetingNotes("   \n\n  ", "whitespace.txt");

		expect(result.ok).toBe(false);
		if (result.ok) return;

		expect(result.error).toBe("Empty file content");
	});

	it("handles notes with only a title and no sections", () => {
		const content = "Just a Title Line";
		const result = parseGeminiMeetingNotes(content, "minimal.txt");

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.note.title).toBe("Just a Title Line");
		expect(result.note.attendees).toEqual([]);
		expect(result.note.discussionItems).toEqual([]);
	});

	it("strips bullet markers from attendee names", () => {
		const content = `Team Meeting

Participants
- Alice Johnson
* Bob Smith
Carol Davis
`;
		const result = parseGeminiMeetingNotes(content, "test.txt");

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.note.attendees).toEqual([
			"Alice Johnson",
			"Bob Smith",
			"Carol Davis",
		]);
	});
});
