import { type ConsolaInstance, consola } from "consola";
import type { ProjectBoardProvider } from "../../core/types.js";
import type { ProjectTask } from "../../models/visible-wins.js";
import type { AsanaService } from "../../services/asana.service.js";

interface AsanaSectionResponse {
	gid: string;
	name: string;
}

interface AsanaCustomFieldResponse {
	gid: string;
	name: string;
	display_value: string | null;
	number_value?: number | null;
	type: string;
}

interface AsanaParentResponse {
	gid: string;
	name: string;
}

interface AsanaTaskResponse {
	gid: string;
	name: string;
	custom_fields?: AsanaCustomFieldResponse[];
	parent?: AsanaParentResponse | null;
}

export interface AsanaBoardAdapterConfig {
	asanaService: AsanaService;
	projectGid: string;
	sectionGid?: string;
	sectionName?: string;
	priorityFieldName?: string;
	/** Map of Asana task GID to display name alias. */
	projectAliases?: Record<string, string>;
	/** When true, only tasks with a matching alias in projectAliases are returned. */
	aliasesOnly?: boolean;
	logger?: ConsolaInstance;
}

export class AsanaBoardAdapter implements ProjectBoardProvider {
	private readonly asanaService: AsanaService;
	private readonly projectGid: string;
	private readonly sectionGid?: string;
	private readonly sectionName?: string;
	private readonly priorityFieldName?: string;
	private readonly projectAliases?: Record<string, string>;
	private readonly aliasesOnly: boolean;
	private readonly logger: ConsolaInstance;

	constructor(config: AsanaBoardAdapterConfig) {
		this.asanaService = config.asanaService;
		this.projectGid = config.projectGid;
		this.sectionGid = config.sectionGid;
		this.sectionName = config.sectionName;
		this.priorityFieldName = config.priorityFieldName;
		this.projectAliases = config.projectAliases;
		this.aliasesOnly = config.aliasesOnly ?? false;
		this.logger = config.logger ?? consola.withTag("teamhero:asana-board");
	}

	async fetchProjects(): Promise<ProjectTask[]> {
		if (!this.projectGid) {
			throw new Error(
				"projectGid is required but was empty. Set ASANA_PROJECT_GID in your .env file.",
			);
		}

		const optFields =
			"name,gid,custom_fields,custom_fields.name,custom_fields.display_value,custom_fields.number_value,custom_fields.type,parent,parent.gid,parent.name";

		let tasks: AsanaTaskResponse[];
		if (this.sectionGid || this.sectionName) {
			const sectionGid = await this.resolveSection();
			tasks = await this.asanaService.fetchFromPathPaginated<AsanaTaskResponse>(
				`/sections/${sectionGid}/tasks`,
				{ opt_fields: optFields },
			);
		} else {
			tasks = await this.asanaService.fetchFromPathPaginated<AsanaTaskResponse>(
				`/projects/${this.projectGid}/tasks`,
				{ opt_fields: optFields },
			);
		}

		let projects = tasks.map((task) => this.mapToProjectTask(task));
		if (this.aliasesOnly && this.projectAliases) {
			const aliasedGids = new Set(Object.keys(this.projectAliases));
			projects = projects.filter((p) => aliasedGids.has(p.gid));
		}
		projects.sort((a, b) => b.priorityScore - a.priorityScore);
		return projects;
	}

	private async resolveSection(): Promise<string> {
		if (this.sectionGid) {
			return this.sectionGid;
		}

		if (!this.sectionName) {
			throw new Error(
				"Either sectionGid or sectionName must be provided to resolve a board section.",
			);
		}

		const response = await this.asanaService.fetchFromPath<{
			data: AsanaSectionResponse[];
		}>(`/projects/${this.projectGid}/sections`);

		const normalizedTarget = this.sectionName.trim().toLowerCase();
		const match = response.data.find(
			(section) => section.name.trim().toLowerCase() === normalizedTarget,
		);

		if (!match) {
			const available = response.data.map((s) => s.name).join(", ");
			throw new Error(
				`Section '${this.sectionName}' not found in project ${this.projectGid}. Available sections: ${available}`,
			);
		}

		return match.gid;
	}

	private mapToProjectTask(task: AsanaTaskResponse): ProjectTask {
		const customFields: Record<string, string | number | null> = {};
		let priorityScore = 0;

		for (const field of task.custom_fields ?? []) {
			const value =
				field.type === "number"
					? (field.number_value ?? field.display_value ?? null)
					: field.display_value;
			customFields[field.name] = value;

			if (
				this.priorityFieldName &&
				field.name === this.priorityFieldName &&
				typeof value === "number"
			) {
				priorityScore = value;
			}
		}

		const alias = this.projectAliases?.[task.gid];
		const projectTask: ProjectTask = {
			name: alias ?? task.name,
			gid: task.gid,
			customFields,
			priorityScore,
			...(alias ? { originalName: task.name } : {}),
		};
		if (task.parent?.gid && task.parent?.name) {
			projectTask.parentGid = task.parent.gid;
			projectTask.parentName = task.parent.name;
		}
		return projectTask;
	}
}
