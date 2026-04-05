import { getEnv } from "./env.js";

export type { BoardConfig } from "./boards-config-loader.js";

export const VISIBLE_WINS_ENV_KEYS = {
	ASANA_PROJECT_GID: "ASANA_PROJECT_GID",
	ASANA_SECTION_GID: "ASANA_SECTION_GID",
	ASANA_SECTION_NAME: "ASANA_SECTION_NAME",
	ASANA_PRIORITY_FIELD: "ASANA_PRIORITY_FIELD",
	MEETING_NOTES_DIR: "MEETING_NOTES_DIR",
	MEETING_NOTES_PROVIDER: "MEETING_NOTES_PROVIDER",
	VISIBLE_WINS_AI_MODEL: "VISIBLE_WINS_AI_MODEL",
	ASANA_BOARDS_CONFIG: "ASANA_BOARDS_CONFIG",
	VISIBLE_WINS_SUPPLEMENTS_FILE: "VISIBLE_WINS_SUPPLEMENTS_FILE",
	GOOGLE_DRIVE_FOLDER_IDS: "GOOGLE_DRIVE_FOLDER_IDS",
	GOOGLE_DRIVE_INCLUDE_TRANSCRIPTS: "GOOGLE_DRIVE_INCLUDE_TRANSCRIPTS",
} as const;

export interface VisibleWinsResolvedConfig {
	asanaProjectGid: string;
	asanaSectionGid?: string;
	asanaSectionName?: string;
	asanaPriorityField?: string;
	meetingNotesDir?: string;
	meetingNotesProvider: string;
	aiModel: string;
	googleDriveFolderIds?: string[];
	googleDriveIncludeTranscripts?: boolean;
}

/** Shared config fields needed regardless of single-board or multi-board mode. */
export interface VisibleWinsSharedConfig {
	meetingNotesDir?: string;
	meetingNotesProvider: string;
	aiModel: string;
	googleDriveFolderIds?: string[];
	googleDriveIncludeTranscripts?: boolean;
}

export type VisibleWinsValidationResult =
	| { valid: true; config: VisibleWinsResolvedConfig }
	| { valid: false; missing: { key: string; hint: string }[] };

/**
 * Validate that all required Visible Wins environment variables are configured.
 * Returns a resolved config on success, or a list of missing variables with fix hints on failure.
 */
export function validateVisibleWinsConfig(): VisibleWinsValidationResult {
	const missing: { key: string; hint: string }[] = [];

	const projectGid =
		getEnv(VISIBLE_WINS_ENV_KEYS.ASANA_PROJECT_GID)?.trim() || undefined;
	if (!projectGid) {
		missing.push({
			key: VISIBLE_WINS_ENV_KEYS.ASANA_PROJECT_GID,
			hint: "Set to the Asana project board GID in your .env file",
		});
	}

	const meetingNotesProvider =
		getEnv(VISIBLE_WINS_ENV_KEYS.MEETING_NOTES_PROVIDER) ?? "google-meet";

	const meetingNotesDir =
		getEnv(VISIBLE_WINS_ENV_KEYS.MEETING_NOTES_DIR)?.trim() || undefined;
	// MEETING_NOTES_DIR is only required when provider is not google-drive
	if (!meetingNotesDir && meetingNotesProvider !== "google-drive") {
		missing.push({
			key: VISIBLE_WINS_ENV_KEYS.MEETING_NOTES_DIR,
			hint: "Set to the path of your meeting notes directory in your .env file",
		});
	}

	const sectionGid =
		getEnv(VISIBLE_WINS_ENV_KEYS.ASANA_SECTION_GID)?.trim() || undefined;
	const sectionName =
		getEnv(VISIBLE_WINS_ENV_KEYS.ASANA_SECTION_NAME)?.trim() || undefined;
	if (!sectionGid && !sectionName) {
		missing.push({
			key: `${VISIBLE_WINS_ENV_KEYS.ASANA_SECTION_GID} or ${VISIBLE_WINS_ENV_KEYS.ASANA_SECTION_NAME}`,
			hint: "Set one of these in your .env file to identify the Asana board section",
		});
	}

	if (missing.length > 0) {
		return { valid: false, missing };
	}

	const folderIdsRaw = getEnv(
		VISIBLE_WINS_ENV_KEYS.GOOGLE_DRIVE_FOLDER_IDS,
	)?.trim();
	const googleDriveFolderIds = folderIdsRaw
		? folderIdsRaw
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
		: undefined;
	const includeTranscriptsRaw = getEnv(
		VISIBLE_WINS_ENV_KEYS.GOOGLE_DRIVE_INCLUDE_TRANSCRIPTS,
	);
	const googleDriveIncludeTranscripts =
		includeTranscriptsRaw !== undefined
			? includeTranscriptsRaw.toLowerCase() !== "false"
			: undefined;

	return {
		valid: true,
		config: {
			asanaProjectGid: projectGid as string,
			asanaSectionGid: sectionGid,
			asanaSectionName: sectionName,
			asanaPriorityField: getEnv(VISIBLE_WINS_ENV_KEYS.ASANA_PRIORITY_FIELD),
			meetingNotesDir,
			meetingNotesProvider,
			aiModel:
				getEnv(VISIBLE_WINS_ENV_KEYS.VISIBLE_WINS_AI_MODEL) ?? "gpt-5-mini",
			googleDriveFolderIds,
			googleDriveIncludeTranscripts,
		},
	};
}

/** Check whether the Visible Wins section is enabled in the report config. */
export function isVisibleWinsEnabled(sections: {
	visibleWins?: boolean;
}): boolean {
	return sections.visibleWins === true;
}

/**
 * Validate shared config fields (meeting notes, AI model) that are required
 * regardless of single-board or multi-board mode.
 *
 * Returns config when at least one notes source is available (filesystem dir
 * or google-drive provider). Returns null when neither is configured.
 */
export function validateSharedConfig(): VisibleWinsSharedConfig | null {
	const meetingNotesDir =
		getEnv(VISIBLE_WINS_ENV_KEYS.MEETING_NOTES_DIR)?.trim() || undefined;
	const meetingNotesProvider =
		getEnv(VISIBLE_WINS_ENV_KEYS.MEETING_NOTES_PROVIDER) ?? "google-meet";

	// At least one notes source must be configured
	if (!meetingNotesDir && meetingNotesProvider !== "google-drive") {
		return null;
	}

	const folderIdsRaw = getEnv(
		VISIBLE_WINS_ENV_KEYS.GOOGLE_DRIVE_FOLDER_IDS,
	)?.trim();
	const googleDriveFolderIds = folderIdsRaw
		? folderIdsRaw
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
		: undefined;
	const includeTranscriptsRaw = getEnv(
		VISIBLE_WINS_ENV_KEYS.GOOGLE_DRIVE_INCLUDE_TRANSCRIPTS,
	);
	const googleDriveIncludeTranscripts =
		includeTranscriptsRaw !== undefined
			? includeTranscriptsRaw.toLowerCase() !== "false"
			: undefined;

	return {
		meetingNotesDir,
		meetingNotesProvider,
		aiModel:
			getEnv(VISIBLE_WINS_ENV_KEYS.VISIBLE_WINS_AI_MODEL) ?? "gpt-5-mini",
		googleDriveFolderIds,
		googleDriveIncludeTranscripts,
	};
}
