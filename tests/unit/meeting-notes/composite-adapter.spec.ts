import { describe, expect, it, mock } from "bun:test";
import type { ConsolaInstance } from "consola";
import { CompositeMeetingNotesAdapter } from "../../../src/adapters/meeting-notes/composite-adapter.js";
import type {
	MeetingNotesProvider,
	ReportingWindow,
} from "../../../src/core/types.js";
import type { NormalizedNote } from "../../../src/models/visible-wins.js";

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
	withTag: mock().mockReturnThis(),
} as unknown as ConsolaInstance;

function makeNote(overrides: Partial<NormalizedNote> = {}): NormalizedNote {
	return {
		title: "Test Note",
		date: "2026-01-29",
		attendees: ["Alice"],
		discussionItems: ["item 1"],
		sourceFile: "test.md",
		...overrides,
	};
}

describe("CompositeMeetingNotesAdapter", () => {
	it("merges results from multiple providers", async () => {
		const providerA: MeetingNotesProvider = {
			fetchNotes: mock().mockResolvedValue([makeNote({ title: "Note A" })]),
		};
		const providerB: MeetingNotesProvider = {
			fetchNotes: mock().mockResolvedValue([makeNote({ title: "Note B" })]),
		};

		const composite = new CompositeMeetingNotesAdapter(
			[providerA, providerB],
			silentLogger,
		);
		const notes = await composite.fetchNotes(window);

		expect(notes).toHaveLength(2);
		expect(notes.map((n) => n.title)).toEqual(["Note A", "Note B"]);
	});

	it("continues when one provider fails", async () => {
		const providerA: MeetingNotesProvider = {
			fetchNotes: mock().mockRejectedValue(new Error("Provider A failed")),
		};
		const providerB: MeetingNotesProvider = {
			fetchNotes: mock().mockResolvedValue([makeNote({ title: "Note B" })]),
		};

		const composite = new CompositeMeetingNotesAdapter(
			[providerA, providerB],
			silentLogger,
		);
		const notes = await composite.fetchNotes(window);

		expect(notes).toHaveLength(1);
		expect(notes[0].title).toBe("Note B");
		expect(silentLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining("Provider A failed"),
		);
	});

	it("returns empty when all providers fail", async () => {
		const providerA: MeetingNotesProvider = {
			fetchNotes: mock().mockRejectedValue(new Error("fail A")),
		};
		const providerB: MeetingNotesProvider = {
			fetchNotes: mock().mockRejectedValue(new Error("fail B")),
		};

		const composite = new CompositeMeetingNotesAdapter(
			[providerA, providerB],
			silentLogger,
		);
		const notes = await composite.fetchNotes(window);

		expect(notes).toEqual([]);
	});

	it("returns empty when no providers are given", async () => {
		const composite = new CompositeMeetingNotesAdapter([], silentLogger);
		const notes = await composite.fetchNotes(window);

		expect(notes).toEqual([]);
	});
});
