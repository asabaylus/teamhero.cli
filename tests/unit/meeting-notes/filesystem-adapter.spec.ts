import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConsolaInstance } from "consola";
import { MeetingNotesFilesystemAdapter } from "../../../src/adapters/meeting-notes/filesystem-adapter.js";
import type { ReportingWindow } from "../../../src/core/types.js";

const VALID_MEETING = `# Weekly Standup

## Attendees
- Alice Johnson (alice@example.com)
- Bob Smith

## Discussion
- Sprint progress review
- Deployment planning

## Action Items
- Alice to update docs
`;

const MALFORMED_CONTENT = "Just plain text without any markdown structure.";

let tempDir: string;

const window: ReportingWindow = {
	startISO: "2026-01-27",
	endISO: "2026-02-02",
};

const silentLogger = {
	warn: mock(),
	error: mock(),
	info: mock(),
	debug: mock(),
	log: mock(),
	withTag: mock(),
} as unknown as ConsolaInstance;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "meeting-notes-test-"));
	// Clear call counts on logger mocks without undoing any mock.module() registrations
	(silentLogger.warn as ReturnType<typeof mock>).mockClear();
	(silentLogger.error as ReturnType<typeof mock>).mockClear();
	(silentLogger.info as ReturnType<typeof mock>).mockClear();
	(silentLogger.debug as ReturnType<typeof mock>).mockClear();
	(silentLogger.log as ReturnType<typeof mock>).mockClear();
	(silentLogger.withTag as ReturnType<typeof mock>).mockClear();
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

describe("MeetingNotesFilesystemAdapter", () => {
	it("discovers and parses .md files from the configured directory", async () => {
		await writeFile(
			join(tempDir, "2026 01 29 Weekly Standup.md"),
			VALID_MEETING,
		);

		const adapter = new MeetingNotesFilesystemAdapter({
			notesDir: tempDir,
			logger: silentLogger,
		});
		const notes = await adapter.fetchNotes(window);

		expect(notes).toHaveLength(1);
		expect(notes[0].title).toBe("Weekly Standup");
		expect(notes[0].date).toBe("2026-01-29");
		expect(notes[0].attendees).toEqual(["Alice Johnson", "Bob Smith"]);
		expect(notes[0].discussionItems.length).toBeGreaterThan(0);
	});

	it("filters notes by date range using filename dates", async () => {
		await writeFile(join(tempDir, "2026 01 29 In Range.md"), VALID_MEETING);
		await writeFile(join(tempDir, "2025 12 01 Out of Range.md"), VALID_MEETING);

		const adapter = new MeetingNotesFilesystemAdapter({
			notesDir: tempDir,
			logger: silentLogger,
		});
		const notes = await adapter.fetchNotes(window);

		expect(notes).toHaveLength(1);
		expect(notes[0].sourceFile).toBe("2026 01 29 In Range.md");
	});

	it("includes notes on date range boundaries", async () => {
		await writeFile(
			join(tempDir, "2026 01 27 Start Boundary.md"),
			VALID_MEETING,
		);
		await writeFile(join(tempDir, "2026 02 02 End Boundary.md"), VALID_MEETING);

		const adapter = new MeetingNotesFilesystemAdapter({
			notesDir: tempDir,
			logger: silentLogger,
		});
		const notes = await adapter.fetchNotes(window);

		expect(notes).toHaveLength(2);
	});

	it("falls back to mtime when filename has no date pattern", async () => {
		const filePath = join(tempDir, "team-sync.md");
		await writeFile(filePath, VALID_MEETING);
		const knownDate = new Date("2026-01-30T12:00:00Z");
		await utimes(filePath, knownDate, knownDate);

		const adapter = new MeetingNotesFilesystemAdapter({
			notesDir: tempDir,
			logger: silentLogger,
		});
		const notes = await adapter.fetchNotes(window);

		expect(notes).toHaveLength(1);
		expect(notes[0].date).toBe("2026-01-30");
	});

	it("skips unparseable files with a warning log", async () => {
		await writeFile(join(tempDir, "2026 01 29 Good.md"), VALID_MEETING);
		await writeFile(join(tempDir, "2026 01 30 Bad.md"), MALFORMED_CONTENT);

		const adapter = new MeetingNotesFilesystemAdapter({
			notesDir: tempDir,
			logger: silentLogger,
		});
		const notes = await adapter.fetchNotes(window);

		expect(notes).toHaveLength(1);
		expect(notes[0].sourceFile).toBe("2026 01 29 Good.md");
		expect(silentLogger.warn as ReturnType<typeof mock>).toHaveBeenCalledWith(
			expect.stringContaining("Skipping unparseable file"),
		);
	});

	it("returns empty array for empty directory", async () => {
		const adapter = new MeetingNotesFilesystemAdapter({
			notesDir: tempDir,
			logger: silentLogger,
		});
		const notes = await adapter.fetchNotes(window);

		expect(notes).toEqual([]);
	});

	it("returns empty array when directory does not exist", async () => {
		const adapter = new MeetingNotesFilesystemAdapter({
			notesDir: join(tempDir, "nonexistent"),
			logger: silentLogger,
		});
		const notes = await adapter.fetchNotes(window);

		expect(notes).toEqual([]);
	});

	it("ignores non-.md files", async () => {
		await writeFile(join(tempDir, "notes.txt"), "some text");
		await writeFile(join(tempDir, "data.json"), "{}");

		const adapter = new MeetingNotesFilesystemAdapter({
			notesDir: tempDir,
			logger: silentLogger,
		});
		const notes = await adapter.fetchNotes(window);

		expect(notes).toEqual([]);
	});
});
