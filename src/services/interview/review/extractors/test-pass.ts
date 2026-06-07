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

export type TestRunner = (repoDir: string) => {
	readonly passed: number;
	readonly failed: number;
	readonly output: string;
};

// Wall-clock cap on a candidate test run. Beyond this the spawn is killed
// and the extractor reports a timeout rather than hanging the entire grader
// (e.g., on a candidate's runaway watch-mode invocation or infinite loop).
const TEST_TIMEOUT_S = 300;
const TIMEOUT_BIN = "timeout";

function summarizeSpawnError(err: Error | undefined): string {
	if (!err) return "";
	const code = (err as NodeJS.ErrnoException).code;
	if (code === "ETIMEDOUT") return "Test run timed out and was killed.";
	if (code === "ENOENT") return `Test runner not found: ${err.message}`;
	return err.message;
}

// `coreutils timeout --kill-after=N M cmd args...` runs `cmd` and, if it
// hasn't finished after M seconds, sends SIGTERM to the whole process
// group, then SIGKILL after another N seconds. Node's spawnSync `timeout`
// option only signals the direct child, leaving sub-binaries (e.g. Go's
// per-package test executables) reparented to PID 1 and still running.
// Delegating to coreutils gets us proper group-kill for free.
function hasCoreutilsTimeout(): boolean {
	const probe = spawnSync(TIMEOUT_BIN, ["--version"], { encoding: "utf8" });
	return !probe.error && probe.status === 0;
}

function runWithTimeout(
	cmd: string,
	args: readonly string[],
	cwd: string,
): ReturnType<typeof spawnSync> {
	if (hasCoreutilsTimeout()) {
		return spawnSync(
			TIMEOUT_BIN,
			["--kill-after=10s", `${TEST_TIMEOUT_S}s`, cmd, ...args],
			{ cwd, encoding: "utf8" },
		);
	}
	// Fallback when coreutils `timeout` isn't on PATH (rare on Linux/macOS,
	// expected on bare Windows). Node's spawnSync timeout only kills the
	// direct child — orphaned grandchildren may persist until the grader
	// itself exits. Document the limitation rather than silently leaking.
	return spawnSync(cmd, [...args], {
		cwd,
		encoding: "utf8",
		timeout: TEST_TIMEOUT_S * 1000,
		killSignal: "SIGKILL",
	});
}

const realRunner: TestRunner = (repoDir) => {
	if (existsSync(join(repoDir, "go.mod"))) {
		const r = runWithTimeout("go", ["test", "./..."], repoDir);
		const errSummary = summarizeSpawnError(r.error);
		const timedOut = r.status === 124; // coreutils timeout exit code on hit
		const timeoutNote = timedOut
			? "\nTest run timed out and was killed (process group)."
			: "";
		const output = `${r.stdout ?? ""}\n${r.stderr ?? ""}${errSummary ? `\n${errSummary}` : ""}${timeoutNote}`;
		return {
			passed: countMatches(r.stdout ?? "", /^ok\s+/gm),
			failed: countMatches(r.stdout ?? "", /^FAIL\s+/gm),
			output,
		};
	}
	if (existsSync(join(repoDir, "package.json"))) {
		const r = runWithTimeout("bun", ["test"], repoDir);
		const errSummary = summarizeSpawnError(r.error);
		const timedOut = r.status === 124;
		const timeoutNote = timedOut
			? "\nTest run timed out and was killed (process group)."
			: "";
		const combined = `${r.stdout ?? ""}\n${r.stderr ?? ""}${errSummary ? `\n${errSummary}` : ""}${timeoutNote}`;
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
