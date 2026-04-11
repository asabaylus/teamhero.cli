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
	roadmapItems?: Array<{
		gid: string;
		displayName: string;
		/**
		 * Explicit Asana project GID to pull project_statuses from for this rock.
		 * Highest-priority input for the rock→project resolver; when set, auto-
		 * resolution is skipped for this rock.
		 */
		statusProjectGid?: string;
	}>;
	/** @deprecated Use roadmapItems instead */
	rocks?: Array<{
		gid: string;
		displayName: string;
		statusProjectGid?: string;
	}>;
}

export interface BoardsConfigResult {
	boards: BoardConfig[];
	roadmapTitle?: string;
	/** When set, only projects whose name matches an entry appear in Visible Wins. */
	includeInVisibleWins?: string[];
	/**
	 * Map of rock task GID → Asana project GID used for fetching project_statuses.
	 * Built by resolveRockProjectGidMap in priority order: explicit statusProjectGid,
	 * task-as-project probe (handled at fetch time), auto-resolve via projectAliases,
	 * or skip. Rocks without an entry fall through to custom-field + subtask status.
	 */
	rockProjectGidMap?: Record<string, string>;
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
		rockProjectGidMap: resolveRockProjectGidMap(parsed.boards),
	};
}

/**
 * Resolve rock task GIDs → Asana project GIDs for project_statuses fetching.
 * Handles four org topologies in priority order:
 *
 *   1. Explicit `statusProjectGid` on the roadmapItems[] entry. Canonical.
 *   2. (Task-as-project is handled at fetch time by the caller — omitted here
 *      since it requires a live Asana probe, not a config-time inference.)
 *   3. Auto-resolve: walk the roadmap board's `projectAliases` to find each
 *      rock's display name, then locate a sibling `singleProject` board whose
 *      `label` matches — that sibling's `projectGid` is the status source.
 *      This is best-effort inference that lights up configs shaped like
 *      Lumata's without requiring a rewrite.
 *   4. Skip: no entry in the returned map. Caller degrades to Phase 1
 *      enrichment (notes + custom fields) without color from status updates.
 *
 * Pure function — accepts boards array, returns map. Testable in isolation.
 */
export function resolveRockProjectGidMap(
	boards: BoardConfig[],
): Record<string, string> {
	const map: Record<string, string> = {};

	// Build a label → projectGid lookup for sibling `singleProject` boards.
	// Used by the auto-resolve path below.
	const labelToProjectGid = new Map<string, string>();
	for (const board of boards) {
		if (board.singleProject && board.label) {
			labelToProjectGid.set(board.label.trim().toLowerCase(), board.projectGid);
		}
	}

	for (const board of boards) {
		const rocks = board.roadmapItems ?? board.rocks;
		if (!rocks) continue;

		for (const rock of rocks) {
			if (map[rock.gid]) continue; // already resolved via earlier board

			// Path 1: explicit declaration wins.
			if (rock.statusProjectGid) {
				map[rock.gid] = rock.statusProjectGid;
				continue;
			}

			// Path 3: auto-resolve via projectAliases + sibling singleProject label.
			// Look up the rock's display name (or its alias) in the sibling board
			// labels. If the alias and label match, use the sibling's projectGid.
			const aliasName = board.projectAliases?.[rock.gid];
			const candidates = [aliasName, rock.displayName].filter(
				(n): n is string => typeof n === "string" && n.length > 0,
			);
			for (const name of candidates) {
				const projectGid = labelToProjectGid.get(name.trim().toLowerCase());
				if (projectGid) {
					map[rock.gid] = projectGid;
					break;
				}
			}
		}
	}

	return map;
}
