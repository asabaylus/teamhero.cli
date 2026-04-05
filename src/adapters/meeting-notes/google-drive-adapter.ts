import { type ConsolaInstance, consola } from "consola";
import type {
	MeetingNotesProvider,
	ReportingWindow,
} from "../../core/types.js";
import {
	exportDocument,
	findFolderByName,
	listFiles,
} from "../../lib/google-drive-client.js";
import { getValidAccessToken } from "../../lib/google-oauth.js";
import type { NormalizedNote } from "../../models/visible-wins.js";
import { parseGeminiMeetingNotes } from "./gemini-notes-parser.js";
import { parseGeminiTranscript } from "./gemini-transcript-parser.js";

export interface GoogleDriveMeetingNotesAdapterConfig {
	/** Optional explicit folder IDs to search. Auto-discovers "Meet Notes" / "Meet Recordings" if omitted. */
	folderIds?: string[];
	/** Whether to include call transcripts from "Meet Recordings". Default: true */
	includeTranscripts?: boolean;
	logger?: ConsolaInstance;
}

export class GoogleDriveMeetingNotesAdapter implements MeetingNotesProvider {
	private readonly folderIds?: string[];
	private readonly includeTranscripts: boolean;
	private readonly logger: ConsolaInstance;

	constructor(config: GoogleDriveMeetingNotesAdapterConfig = {}) {
		this.folderIds = config.folderIds;
		this.includeTranscripts = config.includeTranscripts ?? true;
		this.logger = config.logger ?? consola.withTag("teamhero:gdrive-notes");
	}

	async fetchNotes(window: ReportingWindow): Promise<NormalizedNote[]> {
		// Ensure we have a valid token before making any calls
		await getValidAccessToken();

		const folders = await this.resolveFolders();
		if (folders.length === 0) {
			this.logger.debug("No Google Drive meeting notes folders found");
			return [];
		}

		const notes: NormalizedNote[] = [];

		for (const folder of folders) {
			const docs = await this.listDocsInFolder(folder.id, window);
			this.logger.debug(`Found ${docs.length} docs in folder "${folder.name}"`);

			for (const doc of docs) {
				try {
					const text = await exportDocument(doc.id);
					const result = folder.isTranscript
						? parseGeminiTranscript(text, `gdrive:${doc.id}`)
						: parseGeminiMeetingNotes(text, `gdrive:${doc.id}`);

					if (!result.ok) {
						this.logger.debug(
							`Skipping unparseable doc "${doc.name}": ${result.error}`,
						);
						continue;
					}

					const date = result.note.date ?? doc.modifiedTime.slice(0, 10);

					if (date < window.startISO || date > window.endISO) {
						continue;
					}

					notes.push({
						title: result.note.title || doc.name,
						date,
						attendees: result.note.attendees,
						discussionItems: result.note.discussionItems,
						sourceFile: `gdrive:${doc.id}`,
					});
				} catch (error) {
					this.logger.warn(
						`Error processing doc "${doc.name}": ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
		}

		return notes;
	}

	private async resolveFolders(): Promise<
		{ id: string; name: string; isTranscript: boolean }[]
	> {
		if (this.folderIds && this.folderIds.length > 0) {
			return this.folderIds.map((id) => ({
				id,
				name: id,
				isTranscript: false,
			}));
		}

		const folders: { id: string; name: string; isTranscript: boolean }[] = [];

		const notesId = await findFolderByName("Meet Notes");
		if (notesId) {
			folders.push({
				id: notesId,
				name: "Meet Notes",
				isTranscript: false,
			});
		}

		if (this.includeTranscripts) {
			const recordingsId = await findFolderByName("Meet Recordings");
			if (recordingsId) {
				folders.push({
					id: recordingsId,
					name: "Meet Recordings",
					isTranscript: true,
				});
			}
		}

		return folders;
	}

	private async listDocsInFolder(
		folderId: string,
		window: ReportingWindow,
	): Promise<{ id: string; name: string; modifiedTime: string }[]> {
		const query = [
			`'${folderId}' in parents`,
			"mimeType = 'application/vnd.google-apps.document'",
			"trashed = false",
			`modifiedTime >= '${window.startISO}'`,
			`modifiedTime <= '${window.endISO}'`,
		].join(" and ");

		return listFiles(query, "files(id,name,modifiedTime)");
	}
}
