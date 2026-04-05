import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { ConsolaInstance } from "consola";
import * as googleDriveClientMod from "../../../src/lib/google-drive-client.js";
import * as googleOauthMod from "../../../src/lib/google-oauth.js";
import { mocked } from "../../helpers/mocked.js";

mock.module("../../../src/lib/google-oauth.js", () => ({
	...googleOauthMod,
	getValidAccessToken: mock().mockResolvedValue("mock-access-token"),
	isGoogleAuthorized: mock().mockResolvedValue(true),
}));

mock.module("../../../src/lib/google-drive-client.js", () => ({
	...googleDriveClientMod,
	findFolderByName: mock(),
	listFiles: mock(),
	exportDocument: mock(),
}));

afterAll(() => {
	mock.restore();
});

import { GoogleDriveMeetingNotesAdapter } from "../../../src/adapters/meeting-notes/google-drive-adapter.js";
import type { ReportingWindow } from "../../../src/core/types.js";
import {
	exportDocument,
	findFolderByName,
	listFiles,
} from "../../../src/lib/google-drive-client.js";
import { getValidAccessToken } from "../../../src/lib/google-oauth.js";

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

const VALID_GEMINI_NOTES = `Weekly Sync

Attendees
Alice Johnson
Bob Smith

Key Discussion Points
- Sprint progress review
- Deployment planning

Action Items
- Alice: Update docs
`;

describe("GoogleDriveMeetingNotesAdapter", () => {
	beforeEach(() => {
		// mock.restore() alone doesn't reset call counts on module-level mocks,
		// so we explicitly clear each mock to avoid cross-test leakage.
		mocked(findFolderByName).mockClear();
		mocked(listFiles).mockClear();
		mocked(exportDocument).mockClear();
		mocked(getValidAccessToken).mockClear();
	});

	it("auto-discovers Meet Notes folder and fetches notes", async () => {
		mocked(findFolderByName).mockImplementation(async (name) => {
			if (name === "Meet Notes") return "folder-notes-id";
			return null;
		});
		mocked(listFiles).mockResolvedValue([
			{
				id: "doc-1",
				name: "Weekly Sync",
				mimeType: "application/vnd.google-apps.document",
				modifiedTime: "2026-01-29T10:00:00Z",
			},
		]);
		mocked(exportDocument).mockResolvedValue(VALID_GEMINI_NOTES);

		const adapter = new GoogleDriveMeetingNotesAdapter({
			logger: silentLogger,
		});
		const notes = await adapter.fetchNotes(window);

		expect(notes).toHaveLength(1);
		expect(notes[0].title).toBe("Weekly Sync");
		expect(notes[0].attendees).toEqual(["Alice Johnson", "Bob Smith"]);
		expect(notes[0].sourceFile).toBe("gdrive:doc-1");
	});

	it("returns empty when no folders found", async () => {
		mocked(findFolderByName).mockResolvedValue(null);

		const adapter = new GoogleDriveMeetingNotesAdapter({
			logger: silentLogger,
		});
		const notes = await adapter.fetchNotes(window);

		expect(notes).toEqual([]);
	});

	it("uses explicit folder IDs when provided", async () => {
		mocked(listFiles).mockResolvedValue([
			{
				id: "doc-2",
				name: "Meeting",
				mimeType: "application/vnd.google-apps.document",
				modifiedTime: "2026-01-30T14:00:00Z",
			},
		]);
		mocked(exportDocument).mockResolvedValue(VALID_GEMINI_NOTES);

		const adapter = new GoogleDriveMeetingNotesAdapter({
			folderIds: ["explicit-folder-id"],
			logger: silentLogger,
		});
		const notes = await adapter.fetchNotes(window);

		expect(findFolderByName).not.toHaveBeenCalled();
		expect(notes).toHaveLength(1);
	});

	it("continues when one document fails to parse", async () => {
		mocked(findFolderByName).mockImplementation(async (name) => {
			if (name === "Meet Notes") return "folder-id";
			return null;
		});
		mocked(listFiles).mockResolvedValue([
			{
				id: "good-doc",
				name: "Good",
				mimeType: "application/vnd.google-apps.document",
				modifiedTime: "2026-01-29T10:00:00Z",
			},
			{
				id: "bad-doc",
				name: "Bad",
				mimeType: "application/vnd.google-apps.document",
				modifiedTime: "2026-01-29T11:00:00Z",
			},
		]);
		mocked(exportDocument).mockImplementation(async (fileId) => {
			if (fileId === "good-doc") return VALID_GEMINI_NOTES;
			throw new Error("API error");
		});

		const adapter = new GoogleDriveMeetingNotesAdapter({
			logger: silentLogger,
		});
		const notes = await adapter.fetchNotes(window);

		expect(notes).toHaveLength(1);
		expect(notes[0].sourceFile).toBe("gdrive:good-doc");
	});

	it("filters docs outside the reporting window", async () => {
		mocked(findFolderByName).mockImplementation(async (name) => {
			if (name === "Meet Notes") return "folder-id";
			return null;
		});
		mocked(listFiles).mockResolvedValue([
			{
				id: "doc-old",
				name: "Old Meeting",
				mimeType: "application/vnd.google-apps.document",
				modifiedTime: "2025-12-01T10:00:00Z",
			},
		]);
		// The doc has a date in the content that's outside the window
		mocked(exportDocument).mockResolvedValue(VALID_GEMINI_NOTES);

		const adapter = new GoogleDriveMeetingNotesAdapter({
			logger: silentLogger,
		});
		const notes = await adapter.fetchNotes(window);

		// modifiedTime "2025-12-01" is outside window, so it should be filtered out
		// (the parser doesn't set a date, so it falls back to modifiedTime)
		expect(notes).toHaveLength(0);
	});
});
