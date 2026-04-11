import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as envMod from "../../../src/lib/env.js";
import { mocked } from "../../helpers/mocked.js";

mock.module("../../../src/lib/env.js", () => ({
	...envMod,
	getEnv: mock(),
}));

afterAll(() => {
	mock.restore();
});

import { loadBoardsConfig } from "../../../src/lib/boards-config-loader.js";
import { getEnv } from "../../../src/lib/env.js";

describe("loadBoardsConfig", () => {
	let tempDir: string;

	beforeEach(async () => {
		mocked(getEnv).mockReset();
		tempDir = await mkdtemp(join(tmpdir(), "boards-config-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("returns null when no config file exists", async () => {
		mocked(getEnv).mockReturnValue(join(tempDir, "nonexistent.json"));
		const result = await loadBoardsConfig();
		expect(result).toBeNull();
	});

	it("loads valid config from ASANA_BOARDS_CONFIG path", async () => {
		const configPath = join(tempDir, "boards.json");
		const config = {
			boards: [
				{
					projectGid: "123",
					sections: ["Now"],
					label: "Roadmap",
					priorityField: "RICE Score",
				},
			],
		};
		await writeFile(configPath, JSON.stringify(config), "utf8");
		mocked(getEnv).mockImplementation((key: string) =>
			key === "ASANA_BOARDS_CONFIG" ? configPath : undefined,
		);

		const result = await loadBoardsConfig();

		expect(result?.boards).toHaveLength(1);
		expect(result?.boards[0].projectGid).toBe("123");
		expect(result?.boards[0].sections).toEqual(["Now"]);
		expect(result?.boards[0].label).toBe("Roadmap");
		expect(result?.boards[0].priorityField).toBe("RICE Score");
	});

	it("loads config with multiple boards", async () => {
		const configPath = join(tempDir, "boards.json");
		const config = {
			boards: [
				{ projectGid: "111", sections: ["Section A"] },
				{ projectGid: "222", sections: ["Section B", "Section C"] },
			],
		};
		await writeFile(configPath, JSON.stringify(config), "utf8");
		mocked(getEnv).mockImplementation((key: string) =>
			key === "ASANA_BOARDS_CONFIG" ? configPath : undefined,
		);

		const result = await loadBoardsConfig();

		expect(result?.boards).toHaveLength(2);
		expect(result?.boards[1].sections).toEqual(["Section B", "Section C"]);
	});

	it("throws on missing boards array", async () => {
		const configPath = join(tempDir, "boards.json");
		await writeFile(configPath, JSON.stringify({ other: true }), "utf8");
		mocked(getEnv).mockImplementation((key: string) =>
			key === "ASANA_BOARDS_CONFIG" ? configPath : undefined,
		);

		await expect(loadBoardsConfig()).rejects.toThrow('missing "boards" array');
	});

	it("throws on empty boards array", async () => {
		const configPath = join(tempDir, "boards.json");
		await writeFile(configPath, JSON.stringify({ boards: [] }), "utf8");
		mocked(getEnv).mockImplementation((key: string) =>
			key === "ASANA_BOARDS_CONFIG" ? configPath : undefined,
		);

		await expect(loadBoardsConfig()).rejects.toThrow('"boards" array is empty');
	});

	it("throws when board is missing projectGid", async () => {
		const configPath = join(tempDir, "boards.json");
		await writeFile(
			configPath,
			JSON.stringify({ boards: [{ sections: ["Now"] }] }),
			"utf8",
		);
		mocked(getEnv).mockImplementation((key: string) =>
			key === "ASANA_BOARDS_CONFIG" ? configPath : undefined,
		);

		await expect(loadBoardsConfig()).rejects.toThrow(
			'boards[0] missing "projectGid"',
		);
	});

	it("accepts board with empty sections (fetches all tasks)", async () => {
		const configPath = join(tempDir, "boards.json");
		await writeFile(
			configPath,
			JSON.stringify({ boards: [{ projectGid: "123", sections: [] }] }),
			"utf8",
		);
		mocked(getEnv).mockImplementation((key: string) =>
			key === "ASANA_BOARDS_CONFIG" ? configPath : undefined,
		);

		const result = await loadBoardsConfig();
		expect(result?.boards).toHaveLength(1);
		expect(result?.boards[0].sections).toEqual([]);
	});

	it("accepts board with omitted sections (fetches all tasks)", async () => {
		const configPath = join(tempDir, "boards.json");
		await writeFile(
			configPath,
			JSON.stringify({ boards: [{ projectGid: "123" }] }),
			"utf8",
		);
		mocked(getEnv).mockImplementation((key: string) =>
			key === "ASANA_BOARDS_CONFIG" ? configPath : undefined,
		);

		const result = await loadBoardsConfig();
		expect(result?.boards).toHaveLength(1);
		expect(result?.boards[0].sections).toBeUndefined();
	});

	it("throws when section name is empty string", async () => {
		const configPath = join(tempDir, "boards.json");
		await writeFile(
			configPath,
			JSON.stringify({
				boards: [{ projectGid: "123", sections: ["Valid", "  "] }],
			}),
			"utf8",
		);
		mocked(getEnv).mockImplementation((key: string) =>
			key === "ASANA_BOARDS_CONFIG" ? configPath : undefined,
		);

		await expect(loadBoardsConfig()).rejects.toThrow(
			"boards[0].sections[1] must be a non-empty string",
		);
	});

	it("loads config with valid roadmapItems array", async () => {
		const configPath = join(tempDir, "boards.json");
		const config = {
			boards: [
				{
					projectGid: "123",
					sections: ["Now"],
					roadmapItems: [
						{ gid: "r1", displayName: "Item One" },
						{ gid: "r2", displayName: "Item Two" },
					],
				},
			],
		};
		await writeFile(configPath, JSON.stringify(config), "utf8");
		mocked(getEnv).mockImplementation((key: string) =>
			key === "ASANA_BOARDS_CONFIG" ? configPath : undefined,
		);

		const result = await loadBoardsConfig();
		expect(result?.boards[0].roadmapItems).toHaveLength(2);
		expect(result?.boards[0].roadmapItems?.[0]).toEqual({
			gid: "r1",
			displayName: "Item One",
		});
	});

	it("migrates rocks[] to roadmapItems[] for backward compat", async () => {
		const configPath = join(tempDir, "boards.json");
		const config = {
			boards: [
				{
					projectGid: "123",
					rocks: [{ gid: "r1", displayName: "Rock One" }],
				},
			],
		};
		await writeFile(configPath, JSON.stringify(config), "utf8");
		mocked(getEnv).mockImplementation((key: string) =>
			key === "ASANA_BOARDS_CONFIG" ? configPath : undefined,
		);

		const result = await loadBoardsConfig();
		expect(result?.boards[0].roadmapItems).toHaveLength(1);
		expect(result?.boards[0].roadmapItems?.[0]).toEqual({
			gid: "r1",
			displayName: "Rock One",
		});
	});

	it("throws when roadmapItem is missing gid", async () => {
		const configPath = join(tempDir, "boards.json");
		await writeFile(
			configPath,
			JSON.stringify({
				boards: [
					{ projectGid: "123", roadmapItems: [{ displayName: "No GID" }] },
				],
			}),
			"utf8",
		);
		mocked(getEnv).mockImplementation((key: string) =>
			key === "ASANA_BOARDS_CONFIG" ? configPath : undefined,
		);

		await expect(loadBoardsConfig()).rejects.toThrow(
			'boards[0].roadmapItems[0] missing "gid"',
		);
	});

	it("throws when roadmapItem is missing displayName", async () => {
		const configPath = join(tempDir, "boards.json");
		await writeFile(
			configPath,
			JSON.stringify({
				boards: [{ projectGid: "123", roadmapItems: [{ gid: "r1" }] }],
			}),
			"utf8",
		);
		mocked(getEnv).mockImplementation((key: string) =>
			key === "ASANA_BOARDS_CONFIG" ? configPath : undefined,
		);

		await expect(loadBoardsConfig()).rejects.toThrow(
			'boards[0].roadmapItems[0] missing "displayName"',
		);
	});

	it("loads roadmapTitle from top-level config", async () => {
		const configPath = join(tempDir, "boards.json");
		const config = {
			roadmapTitle: "My Custom Roadmap Title",
			boards: [{ projectGid: "123" }],
		};
		await writeFile(configPath, JSON.stringify(config), "utf8");
		mocked(getEnv).mockImplementation((key: string) =>
			key === "ASANA_BOARDS_CONFIG" ? configPath : undefined,
		);

		const result = await loadBoardsConfig();
		expect(result?.roadmapTitle).toBe("My Custom Roadmap Title");
	});

	it("loads config with isRoadmapBoard", async () => {
		const configPath = join(tempDir, "boards.json");
		const config = {
			boards: [{ projectGid: "123", isRoadmapBoard: true }],
		};
		await writeFile(configPath, JSON.stringify(config), "utf8");
		mocked(getEnv).mockImplementation((key: string) =>
			key === "ASANA_BOARDS_CONFIG" ? configPath : undefined,
		);

		const result = await loadBoardsConfig();
		expect(result?.boards[0].isRoadmapBoard).toBe(true);
	});

	it("migrates roadmapSection to isRoadmapBoard for backward compat", async () => {
		const configPath = join(tempDir, "boards.json");
		const config = {
			boards: [{ projectGid: "123", roadmapSection: "🔥 Now" }],
		};
		await writeFile(configPath, JSON.stringify(config), "utf8");
		mocked(getEnv).mockImplementation((key: string) =>
			key === "ASANA_BOARDS_CONFIG" ? configPath : undefined,
		);

		const result = await loadBoardsConfig();
		expect(result?.boards[0].isRoadmapBoard).toBe(true);
	});

	it("loads includeInVisibleWins from top-level config", async () => {
		const configPath = join(tempDir, "boards.json");
		const config = {
			includeInVisibleWins: ["GCCW", "OmniChannel"],
			boards: [{ projectGid: "123" }],
		};
		await writeFile(configPath, JSON.stringify(config), "utf8");
		mocked(getEnv).mockImplementation((key: string) =>
			key === "ASANA_BOARDS_CONFIG" ? configPath : undefined,
		);

		const result = await loadBoardsConfig();
		expect(result?.includeInVisibleWins).toEqual(["GCCW", "OmniChannel"]);
	});

	it("throws when includeInVisibleWins contains empty string", async () => {
		const configPath = join(tempDir, "boards.json");
		await writeFile(
			configPath,
			JSON.stringify({
				includeInVisibleWins: ["GCCW", "  "],
				boards: [{ projectGid: "123" }],
			}),
			"utf8",
		);
		mocked(getEnv).mockImplementation((key: string) =>
			key === "ASANA_BOARDS_CONFIG" ? configPath : undefined,
		);

		await expect(loadBoardsConfig()).rejects.toThrow(
			"includeInVisibleWins[1] must be a non-empty string",
		);
	});

	it("throws on malformed JSON", async () => {
		const configPath = join(tempDir, "boards.json");
		await writeFile(configPath, "{ not valid json", "utf8");
		mocked(getEnv).mockImplementation((key: string) =>
			key === "ASANA_BOARDS_CONFIG" ? configPath : undefined,
		);

		await expect(loadBoardsConfig()).rejects.toThrow();
	});
});

describe("resolveRockProjectGidMap", () => {
	it("explicit statusProjectGid wins over every other path", async () => {
		const { resolveRockProjectGidMap } = await import(
			"../../../src/lib/boards-config-loader.js"
		);
		const map = resolveRockProjectGidMap([
			{
				projectGid: "roadmap-board",
				isRoadmapBoard: true,
				projectAliases: { "rock-1": "GCCW" },
				roadmapItems: [
					{
						gid: "rock-1",
						displayName: "GCCW v1.x",
						statusProjectGid: "explicit-project",
					},
				],
			},
			{
				projectGid: "auto-would-win",
				label: "GCCW",
				singleProject: true,
			},
		]);
		expect(map).toEqual({ "rock-1": "explicit-project" });
	});

	it("auto-resolves via projectAliases + sibling singleProject label (Lumata shape)", async () => {
		const { resolveRockProjectGidMap } = await import(
			"../../../src/lib/boards-config-loader.js"
		);
		const map = resolveRockProjectGidMap([
			{
				projectGid: "roadmap-board",
				isRoadmapBoard: true,
				projectAliases: {
					"task-gccw": "GCCW",
					"task-soc2": "SOC 2 [Rock]",
				},
				roadmapItems: [
					{ gid: "task-gccw", displayName: "GCCW v1.x outbound care" },
					{ gid: "task-soc2", displayName: "SOC 2 Type 1 audit" },
				],
			},
			{
				projectGid: "proj-gccw",
				label: "GCCW",
				singleProject: true,
			},
		]);
		expect(map).toEqual({ "task-gccw": "proj-gccw" });
		// SOC 2 has no sibling singleProject board → skipped, not in map
		expect(map["task-soc2"]).toBeUndefined();
	});

	it("falls back to rock displayName when no projectAliases entry exists", async () => {
		const { resolveRockProjectGidMap } = await import(
			"../../../src/lib/boards-config-loader.js"
		);
		const map = resolveRockProjectGidMap([
			{
				projectGid: "roadmap-board",
				isRoadmapBoard: true,
				roadmapItems: [{ gid: "rock-1", displayName: "RVM" }],
			},
			{ projectGid: "proj-rvm", label: "RVM", singleProject: true },
		]);
		expect(map).toEqual({ "rock-1": "proj-rvm" });
	});

	it("label matching is case-insensitive and trims whitespace", async () => {
		const { resolveRockProjectGidMap } = await import(
			"../../../src/lib/boards-config-loader.js"
		);
		const map = resolveRockProjectGidMap([
			{
				projectGid: "roadmap-board",
				isRoadmapBoard: true,
				roadmapItems: [{ gid: "rock-1", displayName: "  GCCW  " }],
			},
			{ projectGid: "proj-gccw", label: "gccw", singleProject: true },
		]);
		expect(map).toEqual({ "rock-1": "proj-gccw" });
	});

	it("sparse config (no aliases, no siblings, no explicit) produces empty map", async () => {
		const { resolveRockProjectGidMap } = await import(
			"../../../src/lib/boards-config-loader.js"
		);
		const map = resolveRockProjectGidMap([
			{
				projectGid: "roadmap-board",
				isRoadmapBoard: true,
				roadmapItems: [
					{ gid: "rock-1", displayName: "Unresolvable Rock" },
					{ gid: "rock-2", displayName: "Another Unresolvable" },
				],
			},
		]);
		expect(map).toEqual({});
	});

	it("mixed config: some explicit, some auto-resolved, some skipped", async () => {
		const { resolveRockProjectGidMap } = await import(
			"../../../src/lib/boards-config-loader.js"
		);
		const map = resolveRockProjectGidMap([
			{
				projectGid: "roadmap-board",
				isRoadmapBoard: true,
				projectAliases: { "task-gccw": "GCCW" },
				roadmapItems: [
					{
						gid: "rock-explicit",
						displayName: "Explicit Rock",
						statusProjectGid: "proj-explicit",
					},
					{ gid: "task-gccw", displayName: "GCCW v1.x" },
					{ gid: "rock-skipped", displayName: "No Project Rock" },
				],
			},
			{ projectGid: "proj-gccw", label: "GCCW", singleProject: true },
		]);
		expect(map).toEqual({
			"rock-explicit": "proj-explicit",
			"task-gccw": "proj-gccw",
		});
	});

	it("honors deprecated rocks[] alias when roadmapItems[] is absent", async () => {
		const { resolveRockProjectGidMap } = await import(
			"../../../src/lib/boards-config-loader.js"
		);
		const map = resolveRockProjectGidMap([
			{
				projectGid: "roadmap-board",
				isRoadmapBoard: true,
				rocks: [
					{
						gid: "rock-1",
						displayName: "Legacy Rock",
						statusProjectGid: "proj-legacy",
					},
				],
			},
		]);
		expect(map).toEqual({ "rock-1": "proj-legacy" });
	});
});
