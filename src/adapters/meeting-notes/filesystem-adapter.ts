import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type ConsolaInstance, consola } from "consola";
import type {
	MeetingNotesProvider,
	ReportingWindow,
} from "../../core/types.js";
import type { NormalizedNote } from "../../models/visible-wins.js";
import {
	extractDateFromFilename,
	parseGoogleMeetMarkdown,
} from "./google-meet-parser.js";

export interface MeetingNotesFilesystemAdapterConfig {
	notesDir: string;
	logger?: ConsolaInstance;
}

export class MeetingNotesFilesystemAdapter implements MeetingNotesProvider {
	private readonly notesDir: string;
	private readonly logger: ConsolaInstance;

	constructor(config: MeetingNotesFilesystemAdapterConfig) {
		this.notesDir = resolve(config.notesDir);
		this.logger = config.logger ?? consola.withTag("teamhero:meeting-notes");
	}

	async fetchNotes(window: ReportingWindow): Promise<NormalizedNote[]> {
		const entries = await readdir(this.notesDir, { withFileTypes: true }).catch(
			(err: NodeJS.ErrnoException) => {
				if (err.code !== "ENOENT") {
					this.logger.warn(`Error reading notes directory: ${err.message}`);
				}
				return [];
			},
		);

		const mdFiles = entries.filter(
			(entry) =>
				entry.name.endsWith(".md") && entry.isFile() && !entry.isSymbolicLink(),
		);

		if (mdFiles.length === 0) {
			return [];
		}

		const notes: NormalizedNote[] = [];

		for (const entry of mdFiles) {
			const filename = entry.name;
			const filePath = join(this.notesDir, filename);
			const resolved = resolve(filePath);
			if (!resolved.startsWith(this.notesDir)) {
				this.logger.warn(
					`Skipping file outside configured directory: ${filename}`,
				);
				continue;
			}

			try {
				const content = await readFile(resolved, "utf-8");
				const result = parseGoogleMeetMarkdown(content, filename);

				if (!result.ok) {
					this.logger.warn(
						`Skipping unparseable file ${filename}: ${result.error}`,
					);
					continue;
				}

				let date = result.note.date;
				if (!date) {
					const fileStat = await stat(resolved);
					date = fileStat.mtime.toISOString().slice(0, 10);
				}

				if (date < window.startISO || date > window.endISO) {
					continue;
				}

				notes.push({
					title: result.note.title,
					date,
					attendees: result.note.attendees,
					discussionItems: result.note.discussionItems,
					sourceFile: filename,
				});
			} catch (error) {
				this.logger.warn(
					`Error reading file ${filename}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		return notes;
	}
}
