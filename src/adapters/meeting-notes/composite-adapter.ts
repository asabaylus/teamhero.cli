import { type ConsolaInstance, consola } from "consola";
import type {
	MeetingNotesProvider,
	ReportingWindow,
} from "../../core/types.js";
import type { NormalizedNote } from "../../models/visible-wins.js";

/**
 * Combines multiple MeetingNotesProvider instances, running them
 * concurrently with Promise.allSettled for error isolation.
 */
export class CompositeMeetingNotesAdapter implements MeetingNotesProvider {
	private readonly logger: ConsolaInstance;

	constructor(
		private readonly providers: MeetingNotesProvider[],
		logger?: ConsolaInstance,
	) {
		this.logger = logger ?? consola.withTag("teamhero:composite-notes");
	}

	async fetchNotes(window: ReportingWindow): Promise<NormalizedNote[]> {
		const results = await Promise.allSettled(
			this.providers.map((p) => p.fetchNotes(window)),
		);

		const notes: NormalizedNote[] = [];
		for (let i = 0; i < results.length; i++) {
			const result = results[i];
			if (result.status === "fulfilled") {
				notes.push(...result.value);
			} else {
				this.logger.warn(
					`Meeting notes provider ${i} failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
				);
			}
		}

		return notes;
	}
}
