/**
 * Run history persistence — stores serialized report snapshots for
 * cross-period comparison without re-fetching API data.
 *
 * Storage layout:
 *   ~/.cache/teamhero/snapshots/{orgSlug}/
 *     {endDate}_{runId-short}.json   — full serialized ReportRenderInput
 *     index.json                      — lightweight metadata index
 */

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunSnapshotMeta } from "../core/types.js";
import { getEnv } from "./env.js";
import { cacheDir } from "./paths.js";

export interface RunSnapshotEntry extends RunSnapshotMeta {
	/** Relative filename within the org's snapshot directory. */
	filename: string;
}

interface SnapshotIndex {
	version: 1;
	entries: RunSnapshotEntry[];
}

export class RunHistoryStore {
	private readonly baseDir: string;

	constructor(baseDir?: string) {
		this.baseDir = baseDir ?? join(cacheDir(), "snapshots");
	}

	/**
	 * Save a run snapshot and update the index.
	 * Auto-prunes old entries beyond the retention limit.
	 */
	async save(entry: {
		runId: string;
		timestamp: string;
		orgSlug: string;
		startDate: string;
		endDate: string;
		memberCount: number;
		repoCount: number;
		blobSchemaVersion: number;
		checksum: string;
		reportData: Record<string, unknown>;
	}): Promise<void> {
		const orgDir = this.orgDir(entry.orgSlug);
		await mkdir(orgDir, { recursive: true });

		const shortId = entry.runId.slice(0, 8);
		const filename = `${entry.endDate}_${shortId}.json`;
		const filePath = join(orgDir, filename);

		await writeFile(
			filePath,
			JSON.stringify(entry.reportData, null, 2),
			"utf8",
		);

		const index = await this.readIndex(entry.orgSlug);
		const meta: RunSnapshotEntry = {
			runId: entry.runId,
			timestamp: entry.timestamp,
			orgSlug: entry.orgSlug,
			startDate: entry.startDate,
			endDate: entry.endDate,
			memberCount: entry.memberCount,
			repoCount: entry.repoCount,
			blobSchemaVersion: entry.blobSchemaVersion,
			checksum: entry.checksum,
			filename,
		};
		index.entries.push(meta);

		// Sort by timestamp descending (newest first)
		index.entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

		await this.prune(entry.orgSlug, index);
		await this.writeIndex(entry.orgSlug, index);
	}

	/**
	 * Find the most recent snapshot that covers a previous period.
	 * Matches by endDate being close to the target prevEndDate.
	 */
	async findForPreviousPeriod(
		orgSlug: string,
		prevStartDate: string,
		prevEndDate: string,
	): Promise<Record<string, unknown> | null> {
		const index = await this.readIndex(orgSlug);
		if (index.entries.length === 0) return null;

		// Find entries whose endDate matches the previous period's endDate
		const match = index.entries.find(
			(e) => e.endDate === prevEndDate && e.startDate === prevStartDate,
		);
		if (!match) return null;

		return this.loadSnapshot(orgSlug, match.filename);
	}

	/** List recent snapshots for an org. */
	async list(orgSlug: string, limit?: number): Promise<RunSnapshotEntry[]> {
		const index = await this.readIndex(orgSlug);
		const entries = index.entries;
		return limit ? entries.slice(0, limit) : entries;
	}

	/** Load a specific snapshot by filename. */
	async loadSnapshot(
		orgSlug: string,
		filename: string,
	): Promise<Record<string, unknown> | null> {
		try {
			const filePath = join(this.orgDir(orgSlug), filename);
			const raw = await readFile(filePath, "utf8");
			return JSON.parse(raw) as Record<string, unknown>;
		} catch {
			return null;
		}
	}

	private async prune(orgSlug: string, index: SnapshotIndex): Promise<void> {
		const maxRuns = Number.parseInt(
			getEnv("TEAMHERO_HISTORY_MAX_RUNS") ?? "20",
			10,
		);
		if (index.entries.length <= maxRuns) return;

		const toRemove = index.entries.splice(maxRuns);
		const orgDir = this.orgDir(orgSlug);

		for (const entry of toRemove) {
			try {
				await unlink(join(orgDir, entry.filename));
			} catch {
				// Ignore — file may already be gone
			}
		}
	}

	private orgDir(orgSlug: string): string {
		const safe = orgSlug.replace(/[^a-zA-Z0-9-_]/g, "-");
		return join(this.baseDir, safe);
	}

	private async readIndex(orgSlug: string): Promise<SnapshotIndex> {
		try {
			const raw = await readFile(
				join(this.orgDir(orgSlug), "index.json"),
				"utf8",
			);
			const parsed = JSON.parse(raw) as SnapshotIndex;
			if (parsed.version === 1 && Array.isArray(parsed.entries)) {
				return parsed;
			}
		} catch {
			// No index yet
		}
		return { version: 1, entries: [] };
	}

	private async writeIndex(
		orgSlug: string,
		index: SnapshotIndex,
	): Promise<void> {
		await mkdir(this.orgDir(orgSlug), { recursive: true });
		await writeFile(
			join(this.orgDir(orgSlug), "index.json"),
			JSON.stringify(index, null, 2),
			"utf8",
		);
	}
}
