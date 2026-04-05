import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseGeminiTranscript } from "../../../src/adapters/meeting-notes/gemini-transcript-parser.js";

const FIXTURE_DIR = join(__dirname, "../../fixtures/meeting-notes");

async function loadFixture(name: string): Promise<string> {
	return readFile(join(FIXTURE_DIR, name), "utf-8");
}

describe("parseGeminiTranscript", () => {
	it("parses a valid Gemini transcript", async () => {
		const content = await loadFixture("valid-gemini-transcript.txt");
		const result = parseGeminiTranscript(content, "gdrive:transcript123");

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.note.attendees).toContain("Alice");
		expect(result.note.attendees).toContain("Bob");
		expect(result.note.attendees).toContain("Carol");
		expect(result.note.attendees).toContain("David");
		expect(result.note.discussionItems.length).toBeGreaterThan(0);
		expect(result.note.sourceFile).toBe("gdrive:transcript123");
	});

	it("extracts unique speakers in order of appearance", async () => {
		const content = await loadFixture("valid-gemini-transcript.txt");
		const result = parseGeminiTranscript(content, "test.txt");

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		// Alice appears first
		expect(result.note.attendees[0]).toBe("Alice");
		// No duplicates
		const unique = new Set(result.note.attendees);
		expect(unique.size).toBe(result.note.attendees.length);
	});

	it("groups discussion items from transcript lines", async () => {
		const content = await loadFixture("valid-gemini-transcript.txt");
		const result = parseGeminiTranscript(content, "test.txt");

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		// Should have grouped items (not one per line)
		expect(result.note.discussionItems.length).toBeGreaterThan(0);
		expect(result.note.discussionItems.length).toBeLessThan(14); // fewer than total lines
	});

	it("returns parse error for empty content", () => {
		const result = parseGeminiTranscript("", "empty.txt");

		expect(result.ok).toBe(false);
		if (result.ok) return;

		expect(result.error).toBe("Empty transcript content");
	});

	it("returns parse error for content with no timestamp lines", () => {
		const result = parseGeminiTranscript(
			"This is just plain text\nwith no timestamps",
			"noformat.txt",
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;

		expect(result.error).toBe("No timestamped transcript lines found");
	});

	it("derives title from source filename", () => {
		const content = "[00:00:01] Alice: Hello\n[00:00:05] Bob: Hi there\n";
		const result = parseGeminiTranscript(
			content,
			"Sprint Review 2026-02-15.txt",
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.note.title).toBe("Sprint Review 2026-02-15");
	});

	it("handles single-line transcript", () => {
		const content = "[00:00:01] Alice: Hello everyone\n";
		const result = parseGeminiTranscript(content, "test.txt");

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.note.attendees).toEqual(["Alice"]);
		expect(result.note.discussionItems).toHaveLength(1);
	});
});
