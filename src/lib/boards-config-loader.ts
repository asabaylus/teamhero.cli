import { readFile } from "node:fs/promises";
import { join } from "node:path";
import consola from "consola";
import { getEnv } from "./env.js";
import { configDir } from "./paths.js";

export interface BoardConfig {
	projectGid: string;
	/** Sections to pull tasks from. Omit or leave empty to fetch all tasks in the project. */
	sections?: string[];
	label?: string;
	priorityField?: string;
	/** Map of Asana task GID to display name. Overrides the raw task name in reports. */
	projectAliases?: Record<string, string>;
	/** When true, all tasks from this board are rolled up into a single project entry using the board label. */
	singleProject?: boolean;
	/** When true, only tasks with a matching entry in projectAliases are included; all others are filtered out. */
	aliasesOnly?: boolean;
	/** When true, this board provides roadmap entries. */
	isRoadmapBoard?: boolean;
	/** @deprecated Use isRoadmapBoard instead */
	roadmapSection?: string;
	/** Roadmap initiative display name overrides (GID + displayName). */
	roadmapItems?: Array<{ gid: string; displayName: string }>;
	/** @deprecated Use roadmapItems instead */
	rocks?: Array<{ gid: string; displayName: string }>;
}

export interface BoardsConfigResult {
	boards: BoardConfig[];
	roadmapTitle?: string;
	/** When set, only projects whose name matches an entry appear in Visible Wins. */
	includeInVisibleWins?: string[];
}

interface BoardsFileSchema {
	boards: BoardConfig[];
	roadmapTitle?: string;
	includeInVisibleWins?: string[];
}

const DEFAULT_BOARDS_PATH = join(configDir(), "asana-config.json");

/**
 * Load multi-board configuration from JSON file.
 * Checks ASANA_BOARDS_CONFIG env var first, then default path.
 * Returns null if no config file exists (caller should fall back to single-board .env).
 */
export async function loadBoardsConfig(): Promise<BoardsConfigResult | null> {
	const configPath = getEnv("ASANA_BOARDS_CONFIG") ?? DEFAULT_BOARDS_PATH;
	consola.debug(`[boards-config] Looking for boards config at: ${configPath}`);

	let raw: string;
	try {
		raw = await readFile(configPath, "utf8");
	} catch {
		consola.debug(
			`[boards-config] No config file found at ${configPath}, falling back to single-board .env`,
		);
		return null;
	}

	const parsed = JSON.parse(raw) as BoardsFileSchema;

	if (!parsed.boards || !Array.isArray(parsed.boards)) {
		throw new Error(
			`Invalid boards config at ${configPath}: missing "boards" array`,
		);
	}

	if (parsed.boards.length === 0) {
		throw new Error(
			`Invalid boards config at ${configPath}: "boards" array is empty`,
		);
	}

	for (let i = 0; i < parsed.boards.length; i++) {
		const board = parsed.boards[i];
		if (!board.projectGid || typeof board.projectGid !== "string") {
			throw new Error(
				`Invalid boards config at ${configPath}: boards[${i}] missing "projectGid"`,
			);
		}
		if (board.sections !== undefined) {
			if (!Array.isArray(board.sections)) {
				throw new Error(
					`Invalid boards config at ${configPath}: boards[${i}].sections must be an array`,
				);
			}
			for (let j = 0; j < board.sections.length; j++) {
				if (
					typeof board.sections[j] !== "string" ||
					!board.sections[j].trim()
				) {
					throw new Error(
						`Invalid boards config at ${configPath}: boards[${i}].sections[${j}] must be a non-empty string`,
					);
				}
			}
		}

		// Migrate rocks → roadmapItems (backward compat)
		if (board.rocks && !board.roadmapItems) {
			board.roadmapItems = board.rocks;
		}

		if (board.roadmapItems) {
			if (!Array.isArray(board.roadmapItems)) {
				throw new Error(
					`Invalid boards config at ${configPath}: boards[${i}].roadmapItems must be an array`,
				);
			}
			for (let r = 0; r < board.roadmapItems.length; r++) {
				const item = board.roadmapItems[r];
				if (!item.gid || typeof item.gid !== "string") {
					throw new Error(
						`Invalid boards config at ${configPath}: boards[${i}].roadmapItems[${r}] missing "gid"`,
					);
				}
				if (!item.displayName || typeof item.displayName !== "string") {
					throw new Error(
						`Invalid boards config at ${configPath}: boards[${i}].roadmapItems[${r}] missing "displayName"`,
					);
				}
			}
		}

		// Migrate roadmapSection → isRoadmapBoard (backward compat)
		if (board.roadmapSection && !board.isRoadmapBoard) {
			board.isRoadmapBoard = true;
		}
	}

	// Validate includeInVisibleWins
	if (parsed.includeInVisibleWins !== undefined) {
		if (!Array.isArray(parsed.includeInVisibleWins)) {
			throw new Error(
				`Invalid boards config at ${configPath}: "includeInVisibleWins" must be an array of strings`,
			);
		}
		for (let i = 0; i < parsed.includeInVisibleWins.length; i++) {
			if (
				typeof parsed.includeInVisibleWins[i] !== "string" ||
				!parsed.includeInVisibleWins[i].trim()
			) {
				throw new Error(
					`Invalid boards config at ${configPath}: includeInVisibleWins[${i}] must be a non-empty string`,
				);
			}
		}
	}

	consola.debug(
		`[boards-config] Loaded ${parsed.boards.length} board(s) from ${configPath}`,
	);
	return {
		boards: parsed.boards,
		roadmapTitle: parsed.roadmapTitle,
		includeInVisibleWins: parsed.includeInVisibleWins,
	};
}
