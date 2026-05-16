import type {
	CommandEvent,
	CommitEvent,
	EvidenceEvent,
	Measurement,
} from "../types.js";

/**
 * Throughput extractor. Reports elapsed time, commit cadence, and
 * time-to-first-passing-test as raw timestamps and durations.
 */

const TEST_RUN = /^\s*(bun|npm|yarn|pnpm)\s+(run\s+)?test\b|^\s*go\s+test\b|^\s*pytest\b/;

function isoEpoch(ts: string): number {
	return new Date(ts).getTime();
}

function fmtDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "n/a";
	const s = Math.round(ms / 1000);
	const m = Math.floor(s / 60);
	const rem = s % 60;
	return `${m}m${rem.toString().padStart(2, "0")}s`;
}

export function extractThroughput(
	events: readonly EvidenceEvent[],
): Measurement {
	const sorted = [...events].sort((a, b) =>
		a.timestamp.localeCompare(b.timestamp),
	);
	const commits = sorted.filter(
		(e): e is CommitEvent => e.type === "commit",
	);
	const commands = sorted.filter(
		(e): e is CommandEvent => e.type === "command",
	);

	const start = sorted[0]?.timestamp ?? null;
	const end = sorted[sorted.length - 1]?.timestamp ?? null;

	const elapsedMs =
		start && end ? isoEpoch(end) - isoEpoch(start) : Number.NaN;

	const firstTestRun = commands.find((c) => TEST_RUN.test(c.command));

	const facts: Array<{
		readonly label: string;
		readonly value: string | number;
		readonly context?: string;
	}> = [
		{ label: "Session start", value: start ?? "unknown" },
		{ label: "Session end", value: end ?? "unknown" },
		{ label: "Elapsed", value: fmtDuration(elapsedMs) },
		{ label: "Total commits", value: commits.length },
	];
	if (firstTestRun && start) {
		facts.push({
			label: "Time to first test run",
			value: fmtDuration(isoEpoch(firstTestRun.timestamp) - isoEpoch(start)),
		});
	}
	if (commits.length > 1) {
		const intervals: number[] = [];
		for (let i = 1; i < commits.length; i++) {
			intervals.push(
				isoEpoch(commits[i].timestamp) - isoEpoch(commits[i - 1].timestamp),
			);
		}
		const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
		facts.push({
			label: "Average gap between commits",
			value: fmtDuration(avg),
		});
	}

	return { dimension_id: "throughput", facts };
}
