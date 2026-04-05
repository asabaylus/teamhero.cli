import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	extractDateFromFilename,
	parseGoogleMeetMarkdown,
} from "../../../src/adapters/meeting-notes/google-meet-parser.js";

const FIXTURE_DIR = join(__dirname, "../../fixtures/meeting-notes");

async function loadFixture(name: string): Promise<string> {
	return readFile(join(FIXTURE_DIR, name), "utf-8");
}

describe("parseGoogleMeetMarkdown", () => {
	it("parses a valid Google Meet export with attendees, discussion items, and title", async () => {
		const content = await loadFixture("valid-google-meet.md");
		const result = parseGoogleMeetMarkdown(
			content,
			"2026 01 29 Weekly Standup.md",
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.note.title).toBe("Weekly Team Standup");
		expect(result.note.attendees).toEqual([
			"Alice Johnson",
			"Bob Smith",
			"Carol Davis",
		]);
		expect(result.note.discussionItems.length).toBeGreaterThan(0);
		expect(result.note.sourceFile).toBe("2026 01 29 Weekly Standup.md");
		expect(result.note.date).toBe("2026-01-29");
	});

	it("parses a minimal valid file with empty attendees", async () => {
		const content = await loadFixture("minimal-google-meet.md");
		const result = parseGoogleMeetMarkdown(content, "minimal-google-meet.md");

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.note.title).toBe("Quick Sync");
		expect(result.note.attendees).toEqual([]);
		expect(result.note.discussionItems).toEqual(["Agreed on deployment date"]);
	});

	it("returns parse error for malformed non-Markdown content", async () => {
		const content = await loadFixture("malformed-note.md");
		const result = parseGoogleMeetMarkdown(content, "malformed-note.md");

		expect(result.ok).toBe(false);
		if (result.ok) return;

		expect(result.error).toBeTruthy();
		expect(result.sourceFile).toBe("malformed-note.md");
	});

	it("parses a file with no attendees section as valid with empty attendees", async () => {
		const content = await loadFixture("no-attendees.md");
		const result = parseGoogleMeetMarkdown(content, "no-attendees.md");

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.note.title).toBe("Project Review Meeting");
		expect(result.note.attendees).toEqual([]);
		expect(result.note.discussionItems.length).toBeGreaterThan(0);
	});

	it("returns parse error for empty content", () => {
		const result = parseGoogleMeetMarkdown("", "empty.md");

		expect(result.ok).toBe(false);
		if (result.ok) return;

		expect(result.error).toBe("Empty file content");
		expect(result.sourceFile).toBe("empty.md");
	});

	it("derives title from filename when no H1 heading exists", () => {
		const content = "## Discussion\n- Some topic\n";
		const result = parseGoogleMeetMarkdown(content, "some-meeting.md");

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.note.title).toBe("some-meeting");
	});

	it("returns parse error for whitespace-only content", () => {
		const result = parseGoogleMeetMarkdown("   \n\n\t  ", "whitespace.md");

		expect(result.ok).toBe(false);
		if (result.ok) return;

		expect(result.error).toBe("Empty file content");
	});

	it("includes nested discussion items from indented bullets", () => {
		const content =
			"# Title\n## Topics\n- Main point\n  - Nested point\n    - Double nested\n";
		const result = parseGoogleMeetMarkdown(content, "test.md");

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.note.discussionItems).toContain("Main point");
		expect(result.note.discussionItems).toContain("Nested point");
		expect(result.note.discussionItems).toContain("Double nested");
	});
});

describe("extractDateFromFilename", () => {
	it("extracts date from filename with date at start", () => {
		expect(extractDateFromFilename("2026 01 29 Weekly Standup.md")).toBe(
			"2026-01-29",
		);
	});

	it("returns undefined for filename with no date pattern", () => {
		expect(extractDateFromFilename("random-meeting-notes.md")).toBeUndefined();
	});

	it("extracts date from filename with date not at start", () => {
		expect(extractDateFromFilename("Meeting 2026 02 01 Sprint Review.md")).toBe(
			"2026-02-01",
		);
	});

	it("returns undefined for invalid date values", () => {
		expect(extractDateFromFilename("9999 99 99 Meeting.md")).toBeUndefined();
		expect(extractDateFromFilename("2026 02 31 Meeting.md")).toBeUndefined();
	});
});
