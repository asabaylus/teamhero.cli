import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Measurement } from "../types.js";

/**
 * Test-pass / spec-satisfaction extractor.
 * Runs the candidate's test suite and reports pass/fail counts.
 *
 * For the MVP, we detect the runner from the project's package.json or
 * presence of go.mod. The runner is injectable for tests.
 */

export type TestRunner = (
	repoDir: string,
) => { readonly passed: number; readonly failed: number; readonly output: string };

// Wall-clock cap on a candidate test run. Beyond this the spawn is killed
// and the extractor reports a timeout rather than hanging the entire grader
// (e.g., on a candidate's runaway watch-mode invocation or infinite loop).
const TEST_TIMEOUT_MS = 5 * 60_000;

function summarizeSpawnError(err: Error | undefined): string {
	if (!err) return "";
	const code = (err as NodeJS.ErrnoException).code;
	if (code === "ETIMEDOUT") return "Test run timed out and was killed.";
	if (code === "ENOENT") return `Test runner not found: ${err.message}`;
	return err.message;
}

const realRunner: TestRunner = (repoDir) => {
	if (existsSync(join(repoDir, "go.mod"))) {
		const r = spawnSync("go", ["test", "./..."], {
			cwd: repoDir,
			encoding: "utf8",
			timeout: TEST_TIMEOUT_MS,
			killSignal: "SIGTERM",
		});
		const errSummary = summarizeSpawnError(r.error);
		const output = `${r.stdout ?? ""}\n${r.stderr ?? ""}${errSummary ? `\n${errSummary}` : ""}`;
		return {
			passed: countMatches(r.stdout ?? "", /^ok\s+/gm),
			failed: countMatches(r.stdout ?? "", /^FAIL\s+/gm),
			output,
		};
	}
	if (existsSync(join(repoDir, "package.json"))) {
		const r = spawnSync("bun", ["test"], {
			cwd: repoDir,
			encoding: "utf8",
			timeout: TEST_TIMEOUT_MS,
			killSignal: "SIGTERM",
		});
		const errSummary = summarizeSpawnError(r.error);
		const combined = `${r.stdout ?? ""}\n${r.stderr ?? ""}${errSummary ? `\n${errSummary}` : ""}`;
		const passMatch = combined.match(/(\d+)\s+pass\b/);
		const failMatch = combined.match(/(\d+)\s+fail\b/);
		return {
			passed: passMatch ? Number.parseInt(passMatch[1], 10) : 0,
			failed: failMatch ? Number.parseInt(failMatch[1], 10) : 0,
			output: combined,
		};
	}
	return { passed: 0, failed: 0, output: "No recognized test setup found." };
};

function countMatches(s: string, re: RegExp): number {
	let count = 0;
	while (re.exec(s) !== null) count += 1;
	return count;
}

export function extractTestPass(
	repoDir: string,
	runner: TestRunner = realRunner,
): Measurement {
	const r = runner(repoDir);
	const total = r.passed + r.failed;
	const facts: Array<{
		readonly label: string;
		readonly value: string | number;
		readonly context?: string;
	}> = [
		{ label: "Passing tests", value: r.passed },
		{ label: "Failing tests", value: r.failed },
		{
			label: "Pass rate",
			value: total === 0 ? "n/a" : `${r.passed}/${total}`,
		},
	];
	return { dimension_id: "test-pass", facts };
}
