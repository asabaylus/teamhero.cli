import { readFile } from "node:fs/promises";
import { type ConsolaInstance, consola } from "consola";
import type {
	MeetingNotesProvider,
	ProjectBoardProvider,
	ReportingWindow,
	VisibleWinsDataResult,
	VisibleWinsProvider,
} from "../../core/types.js";
import { associateNotesWithProjects } from "../meeting-notes/note-project-associator.js";

export interface VisibleWinsAdapterConfig {
	boardProviders: ProjectBoardProvider[];
	notesProvider: MeetingNotesProvider;
	supplementsPath?: string;
	/** When set, only projects whose name matches an entry appear in output (case-insensitive). */
	includeInVisibleWins?: string[];
	logger?: ConsolaInstance;
}

export class VisibleWinsAdapter implements VisibleWinsProvider {
	private readonly boardProviders: ProjectBoardProvider[];
	private readonly notesProvider: MeetingNotesProvider;
	private readonly supplementsPath?: string;
	private readonly includeAllowlist?: Set<string>;
	private readonly logger: ConsolaInstance;

	constructor(config: VisibleWinsAdapterConfig) {
		this.boardProviders = config.boardProviders;
		this.notesProvider = config.notesProvider;
		this.supplementsPath = config.supplementsPath;
		this.includeAllowlist = config.includeInVisibleWins?.length
			? new Set(config.includeInVisibleWins.map((n) => n.trim().toLowerCase()))
			: undefined;
		this.logger = config.logger ?? consola.withTag("teamhero:visible-wins");
	}

	async fetchData(window: ReportingWindow): Promise<VisibleWinsDataResult> {
		// Fetch projects from all configured board providers, merging by name
		const allProjects: import("../../models/visible-wins.js").ProjectTask[] =
			[];
		const indexByName = new Map<string, number>();

		for (const provider of this.boardProviders) {
			try {
				const projects = await provider.fetchProjects();
				for (const project of projects) {
					const key = project.name.trim().toLowerCase();
					const existingIdx = indexByName.get(key);
					if (existingIdx !== undefined) {
						// Merge: combine child task info and take higher priority
						const existing = allProjects[existingIdx];
						const existingTasks = existing.customFields?.["Child Tasks"];
						const newTasks = project.customFields?.["Child Tasks"];
						if (existingTasks && newTasks) {
							existing.customFields["Child Tasks"] =
								`${existingTasks}; ${newTasks}`;
						} else if (newTasks) {
							existing.customFields["Child Tasks"] = newTasks;
						}
						existing.priorityScore = Math.max(
							existing.priorityScore,
							project.priorityScore,
						);
					} else {
						indexByName.set(key, allProjects.length);
						allProjects.push(project);
					}
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.logger.warn(`Skipping board provider: ${message}`);
			}
		}

		// Apply allowlist filter if configured
		const filteredProjects = this.includeAllowlist
			? allProjects.filter((p) => {
					const included = this.includeAllowlist!.has(
						p.name.trim().toLowerCase(),
					);
					if (!included) {
						this.logger.debug(
							`Excluding project from visible wins: "${p.name}"`,
						);
					}
					return included;
				})
			: allProjects;

		// Fetch meeting notes
		const notes = await this.notesProvider.fetchNotes(window);

		// Associate notes with projects
		const associations = associateNotesWithProjects(notes, filteredProjects);

		// Read optional supplementary notes
		let supplementaryNotes: string | undefined;
		if (this.supplementsPath) {
			try {
				supplementaryNotes = await readFile(this.supplementsPath, "utf-8");
				this.logger.info(
					`Loaded supplementary notes from ${this.supplementsPath}`,
				);
			} catch {
				this.logger.warn(
					`Could not read supplements file: ${this.supplementsPath}`,
				);
			}
		}

		return {
			projects: filteredProjects,
			notes,
			associations,
			supplementaryNotes,
		};
	}
}
