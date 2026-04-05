import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { mocked } from "../../helpers/mocked.js";

import * as envMod from "../../../src/lib/env.js";

mock.module("../../../src/lib/env.js", () => ({
	...envMod,
	getEnv: mock(),
}));

afterAll(() => {
	mock.restore();
});

import { getEnv } from "../../../src/lib/env.js";
import {
	isVisibleWinsEnabled,
	validateSharedConfig,
	validateVisibleWinsConfig,
} from "../../../src/lib/visible-wins-config.js";

function mockEnv(env: Record<string, string>): void {
	mocked(getEnv).mockImplementation((key: string) => env[key]);
}

const REQUIRED_ENV = {
	ASANA_PROJECT_GID: "proj-123",
	ASANA_SECTION_NAME: "Now",
	MEETING_NOTES_DIR: "/path/to/notes",
};

describe("validateVisibleWinsConfig", () => {
	beforeEach(() => {
		mocked(getEnv).mockReset();
	});

	it("returns valid with resolved config when all required vars are present", () => {
		mockEnv(REQUIRED_ENV);

		const result = validateVisibleWinsConfig();

		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.config.asanaProjectGid).toBe("proj-123");
			expect(result.config.meetingNotesDir).toBe("/path/to/notes");
		}
	});

	it("returns invalid with missing list when ASANA_PROJECT_GID is absent", () => {
		mockEnv({ ASANA_SECTION_NAME: "Now", MEETING_NOTES_DIR: "/path/to/notes" });

		const result = validateVisibleWinsConfig();

		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.missing).toHaveLength(1);
			expect(result.missing[0].key).toBe("ASANA_PROJECT_GID");
			expect(result.missing[0].hint).toContain(".env");
		}
	});

	it("returns invalid with missing list when MEETING_NOTES_DIR is absent", () => {
		mockEnv({ ASANA_PROJECT_GID: "proj-123", ASANA_SECTION_NAME: "Now" });

		const result = validateVisibleWinsConfig();

		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.missing).toHaveLength(1);
			expect(result.missing[0].key).toBe("MEETING_NOTES_DIR");
			expect(result.missing[0].hint).toContain(".env");
		}
	});

	it("returns invalid listing all when all required vars are absent", () => {
		mockEnv({});

		const result = validateVisibleWinsConfig();

		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.missing).toHaveLength(3);
			expect(result.missing.map((m) => m.key)).toEqual([
				"ASANA_PROJECT_GID",
				"MEETING_NOTES_DIR",
				"ASANA_SECTION_GID or ASANA_SECTION_NAME",
			]);
		}
	});

	it("returns invalid when neither ASANA_SECTION_GID nor ASANA_SECTION_NAME is set", () => {
		mockEnv({
			ASANA_PROJECT_GID: "proj-123",
			MEETING_NOTES_DIR: "/path/to/notes",
		});

		const result = validateVisibleWinsConfig();

		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.missing).toHaveLength(1);
			expect(result.missing[0].key).toContain("ASANA_SECTION_GID");
			expect(result.missing[0].key).toContain("ASANA_SECTION_NAME");
		}
	});

	it("accepts ASANA_SECTION_GID alone as valid section config", () => {
		mockEnv({
			ASANA_PROJECT_GID: "proj-123",
			ASANA_SECTION_GID: "sec-456",
			MEETING_NOTES_DIR: "/path/to/notes",
		});

		const result = validateVisibleWinsConfig();
		expect(result.valid).toBe(true);
	});

	it("treats whitespace-only env values as missing", () => {
		mockEnv({
			ASANA_PROJECT_GID: "   ",
			ASANA_SECTION_NAME: "Now",
			MEETING_NOTES_DIR: "  \t  ",
		});

		const result = validateVisibleWinsConfig();

		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.missing.map((m) => m.key)).toContain("ASANA_PROJECT_GID");
			expect(result.missing.map((m) => m.key)).toContain("MEETING_NOTES_DIR");
		}
	});

	it("applies defaults for optional vars when not set", () => {
		mockEnv(REQUIRED_ENV);

		const result = validateVisibleWinsConfig();

		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.config.asanaSectionGid).toBeUndefined();
			expect(result.config.asanaSectionName).toBe("Now");
			expect(result.config.asanaPriorityField).toBeUndefined();
			expect(result.config.meetingNotesProvider).toBe("google-meet");
			expect(result.config.aiModel).toBe("gpt-5-mini");
		}
	});

	it("uses explicit values for optional vars when set", () => {
		mockEnv({
			...REQUIRED_ENV,
			ASANA_SECTION_GID: "sec-456",
			ASANA_SECTION_NAME: "Now",
			ASANA_PRIORITY_FIELD: "RICE Score",
			MEETING_NOTES_PROVIDER: "custom-provider",
			VISIBLE_WINS_AI_MODEL: "gpt-5",
		});

		const result = validateVisibleWinsConfig();

		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.config.asanaSectionGid).toBe("sec-456");
			expect(result.config.asanaSectionName).toBe("Now");
			expect(result.config.asanaPriorityField).toBe("RICE Score");
			expect(result.config.meetingNotesProvider).toBe("custom-provider");
			expect(result.config.aiModel).toBe("gpt-5");
		}
	});

	it("parses GOOGLE_DRIVE_FOLDER_IDS into trimmed array", () => {
		mockEnv({
			...REQUIRED_ENV,
			GOOGLE_DRIVE_FOLDER_IDS: " folder-1 , folder-2 , folder-3 ",
		});

		const result = validateVisibleWinsConfig();

		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.config.googleDriveFolderIds).toEqual([
				"folder-1",
				"folder-2",
				"folder-3",
			]);
		}
	});

	it("returns undefined googleDriveFolderIds when env var is not set", () => {
		mockEnv(REQUIRED_ENV);

		const result = validateVisibleWinsConfig();

		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.config.googleDriveFolderIds).toBeUndefined();
		}
	});

	it("filters out empty segments from GOOGLE_DRIVE_FOLDER_IDS", () => {
		mockEnv({
			...REQUIRED_ENV,
			GOOGLE_DRIVE_FOLDER_IDS: "folder-1,,, ,folder-2",
		});

		const result = validateVisibleWinsConfig();

		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.config.googleDriveFolderIds).toEqual([
				"folder-1",
				"folder-2",
			]);
		}
	});

	it("returns googleDriveIncludeTranscripts true when env is 'true'", () => {
		mockEnv({
			...REQUIRED_ENV,
			GOOGLE_DRIVE_INCLUDE_TRANSCRIPTS: "true",
		});

		const result = validateVisibleWinsConfig();

		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.config.googleDriveIncludeTranscripts).toBe(true);
		}
	});

	it("returns googleDriveIncludeTranscripts false when env is 'false'", () => {
		mockEnv({
			...REQUIRED_ENV,
			GOOGLE_DRIVE_INCLUDE_TRANSCRIPTS: "false",
		});

		const result = validateVisibleWinsConfig();

		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.config.googleDriveIncludeTranscripts).toBe(false);
		}
	});

	it("returns googleDriveIncludeTranscripts true for non-'false' values", () => {
		mockEnv({
			...REQUIRED_ENV,
			GOOGLE_DRIVE_INCLUDE_TRANSCRIPTS: "yes",
		});

		const result = validateVisibleWinsConfig();

		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.config.googleDriveIncludeTranscripts).toBe(true);
		}
	});

	it("returns googleDriveIncludeTranscripts undefined when env is not set", () => {
		mockEnv(REQUIRED_ENV);

		const result = validateVisibleWinsConfig();

		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.config.googleDriveIncludeTranscripts).toBeUndefined();
		}
	});

	it("skips MEETING_NOTES_DIR requirement when provider is google-drive", () => {
		mockEnv({
			ASANA_PROJECT_GID: "proj-123",
			ASANA_SECTION_NAME: "Now",
			MEETING_NOTES_PROVIDER: "google-drive",
		});

		const result = validateVisibleWinsConfig();

		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.config.meetingNotesDir).toBeUndefined();
			expect(result.config.meetingNotesProvider).toBe("google-drive");
		}
	});
});

describe("isVisibleWinsEnabled", () => {
	it("returns false when visibleWins is false", () => {
		expect(isVisibleWinsEnabled({ visibleWins: false })).toBe(false);
	});

	it("returns false when visibleWins is undefined", () => {
		expect(isVisibleWinsEnabled({})).toBe(false);
	});

	it("returns true when visibleWins is true", () => {
		expect(isVisibleWinsEnabled({ visibleWins: true })).toBe(true);
	});
});

describe("validateSharedConfig", () => {
	beforeEach(() => {
		mocked(getEnv).mockReset();
	});

	it("returns null when no notes source is configured", () => {
		mockEnv({});

		const result = validateSharedConfig();

		expect(result).toBeNull();
	});

	it("returns null when meetingNotesDir is missing and provider is not google-drive", () => {
		mockEnv({
			MEETING_NOTES_PROVIDER: "custom-provider",
		});

		const result = validateSharedConfig();

		expect(result).toBeNull();
	});

	it("returns config when meetingNotesDir is set", () => {
		mockEnv({
			MEETING_NOTES_DIR: "/path/to/notes",
		});

		const result = validateSharedConfig();

		expect(result).not.toBeNull();
		expect(result!.meetingNotesDir).toBe("/path/to/notes");
		expect(result!.meetingNotesProvider).toBe("google-meet");
		expect(result!.aiModel).toBe("gpt-5-mini");
	});

	it("returns config when provider is google-drive even without meetingNotesDir", () => {
		mockEnv({
			MEETING_NOTES_PROVIDER: "google-drive",
		});

		const result = validateSharedConfig();

		expect(result).not.toBeNull();
		expect(result!.meetingNotesDir).toBeUndefined();
		expect(result!.meetingNotesProvider).toBe("google-drive");
	});

	it("uses custom AI model when set", () => {
		mockEnv({
			MEETING_NOTES_DIR: "/path/to/notes",
			VISIBLE_WINS_AI_MODEL: "gpt-5",
		});

		const result = validateSharedConfig();

		expect(result).not.toBeNull();
		expect(result!.aiModel).toBe("gpt-5");
	});

	it("parses GOOGLE_DRIVE_FOLDER_IDS into trimmed array", () => {
		mockEnv({
			MEETING_NOTES_DIR: "/path/to/notes",
			GOOGLE_DRIVE_FOLDER_IDS: " folder-a , folder-b ",
		});

		const result = validateSharedConfig();

		expect(result).not.toBeNull();
		expect(result!.googleDriveFolderIds).toEqual(["folder-a", "folder-b"]);
	});

	it("returns undefined googleDriveFolderIds when env is not set", () => {
		mockEnv({
			MEETING_NOTES_DIR: "/path/to/notes",
		});

		const result = validateSharedConfig();

		expect(result).not.toBeNull();
		expect(result!.googleDriveFolderIds).toBeUndefined();
	});

	it("parses GOOGLE_DRIVE_INCLUDE_TRANSCRIPTS as boolean", () => {
		mockEnv({
			MEETING_NOTES_DIR: "/path/to/notes",
			GOOGLE_DRIVE_INCLUDE_TRANSCRIPTS: "false",
		});

		const result = validateSharedConfig();

		expect(result).not.toBeNull();
		expect(result!.googleDriveIncludeTranscripts).toBe(false);
	});

	it("returns googleDriveIncludeTranscripts true for non-false string", () => {
		mockEnv({
			MEETING_NOTES_DIR: "/path/to/notes",
			GOOGLE_DRIVE_INCLUDE_TRANSCRIPTS: "TRUE",
		});

		const result = validateSharedConfig();

		expect(result).not.toBeNull();
		expect(result!.googleDriveIncludeTranscripts).toBe(true);
	});

	it("returns undefined googleDriveIncludeTranscripts when not set", () => {
		mockEnv({
			MEETING_NOTES_DIR: "/path/to/notes",
		});

		const result = validateSharedConfig();

		expect(result).not.toBeNull();
		expect(result!.googleDriveIncludeTranscripts).toBeUndefined();
	});
});
