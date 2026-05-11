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

/**
 * parseGitHistory builds the git-log argv from constants only, so callers
 * cannot inject ref or pathspec values that begin with `-` (which git would
 * parse as flags). If this function is ever extended to accept caller-
 * supplied refs, inject a literal "--" separator between flags and refs.
 */
export function parseGitHistory(
	repoDir: string,
	runner: GitRunner = realRunner,
): readonly CommitEvent[] {
	let logOut = "";
	try {
		// Hard-coded flags only — no user-controlled values reach git. The
		// "--" terminator is belt-and-braces in case the runner is replaced
		// by a wrapper that adds positional args later.
		logOut = runner(["log", `--format=${FORMAT}`, "--numstat", "--"], repoDir);
	} catch (err) {
		// Distinguish "no git history" (empty repo, freshly init'd) from
		// genuine failures (binary missing, permission denied). The former
		// is expected when a candidate's project is a Mode A scaffold; the
		// latter should at least be logged so it doesn't disappear into a
		// silent empty result.
		const message = err instanceof Error ? err.message : String(err);
		const benign =
			/does not have any commits|fatal: your current branch .* does not have/i.test(
				message,
			);
		if (!benign) {
			// Use stderr so the caller sees the failure even though we still
			// return an empty list — consistent with the rest of the
			// collector layer's "degrade to empty" contract.
			process.stderr.write(`[git-history] ${message}\n`);
		}
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
