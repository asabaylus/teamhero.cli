import { execFileSync } from "node:child_process";
import type { CommitEvent } from "../types.js";

/**
 * Reads a git repository's commit history and emits CommitEvent records.
 * Uses `git log` with a stable format string; tolerates absent repos by
 * returning an empty list rather than throwing.
 *
 * Tests inject a stub `runGit` for hermetic execution.
 */

export type GitRunner = (args: string[], cwd: string) => string;

const realRunner: GitRunner = (args, cwd) =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
	});

const FORMAT = "%H%x09%aI%x09%s";

export function parseGitHistory(
	repoDir: string,
	runner: GitRunner = realRunner,
): readonly CommitEvent[] {
	let logOut = "";
	try {
		logOut = runner(["log", `--format=${FORMAT}`, "--numstat"], repoDir);
	} catch {
		return [];
	}
	const result: CommitEvent[] = [];
	const blocks = logOut.trim().split(/\n(?=[0-9a-f]{40}\t)/);
	for (const block of blocks) {
		const lines = block.split("\n");
		const head = lines[0]?.split("\t");
		if (!head || head.length < 3) continue;
		const [sha, ts, ...subjectParts] = head;
		const subject = subjectParts.join("\t");
		let insertions = 0;
		let deletions = 0;
		for (let i = 1; i < lines.length; i++) {
			const numstat = lines[i].trim();
			if (!numstat) continue;
			const cols = numstat.split("\t");
			const ins = Number.parseInt(cols[0], 10);
			const del = Number.parseInt(cols[1], 10);
			if (Number.isFinite(ins)) insertions += ins;
			if (Number.isFinite(del)) deletions += del;
		}
		result.push({
			type: "commit",
			timestamp: ts,
			source: "git",
			sha,
			message: subject,
			insertions,
			deletions,
		});
	}
	return result;
}
