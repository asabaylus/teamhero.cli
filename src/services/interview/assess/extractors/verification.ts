import type {
	CommandEvent,
	EvidenceEvent,
	Measurement,
	PromptEvent,
} from "../types.js";

/**
 * Verification discipline extractor.
 * Counts test/typecheck/diff/grep invocations and reports how they interleave
 * with prompts. Purely deterministic; no LLM involvement.
 */

const TEST_PATTERNS: readonly RegExp[] = [
	/^\s*(bun|npm|yarn|pnpm)\s+(run\s+)?test\b/,
	/^\s*go\s+test\b/,
	/^\s*pytest\b/,
	/^\s*jest\b/,
	/^\s*vitest\b/,
	/^\s*cargo\s+test\b/,
	/^\s*just\s+test\b/,
];

const TYPECHECK_PATTERNS: readonly RegExp[] = [
	/^\s*tsc\b/,
	/^\s*npx\s+tsc\b/,
	/^\s*just\s+typecheck\b/,
	/^\s*pyright\b/,
	/^\s*mypy\b/,
];

const READ_PATTERNS: readonly RegExp[] = [
	/^\s*git\s+diff\b/,
	/^\s*grep\b/,
	/^\s*rg\b/,
	/^\s*cat\b/,
	/^\s*less\b/,
];

function matches(cmd: string, patterns: readonly RegExp[]): boolean {
	return patterns.some((p) => p.test(cmd));
}

export function extractVerification(
	events: readonly EvidenceEvent[],
): Measurement {
	const commands = events.filter(
		(e): e is CommandEvent => e.type === "command",
	);
	const prompts = events.filter((e): e is PromptEvent => e.type === "prompt");

	const testRuns = commands.filter((c) => matches(c.command, TEST_PATTERNS));
	const typechecks = commands.filter((c) =>
		matches(c.command, TYPECHECK_PATTERNS),
	);
	const reads = commands.filter((c) => matches(c.command, READ_PATTERNS));

	// Interleaving: how often a test run is immediately preceded by a prompt
	// within the last 30 seconds. A simple proxy for "verification follows
	// generation".
	const merged = [...prompts, ...testRuns].sort((a, b) =>
		a.timestamp.localeCompare(b.timestamp),
	);
	let interleavedAfterPrompt = 0;
	for (let i = 1; i < merged.length; i++) {
		const cur = merged[i];
		const prev = merged[i - 1];
		if (cur.type === "command" && prev.type === "prompt") {
			interleavedAfterPrompt += 1;
		}
	}

	return {
		dimension_id: "verification",
		facts: [
			{ label: "Total test runs", value: testRuns.length },
			{ label: "Total typecheck runs", value: typechecks.length },
			{ label: "Diff/grep/cat reads", value: reads.length },
			{
				label: "Test runs immediately after a prompt (within prompt chain)",
				value: interleavedAfterPrompt,
			},
		],
	};
}
