import type {
	CommandEvent,
	EvidenceEvent,
	Measurement,
} from "../types.js";

/**
 * Risk-awareness extractor.
 * Detects destructive shell commands and reports each with its
 * pause-before-Enter timing as observed in the asciinema recording.
 */

const DESTRUCTIVE_PATTERNS: ReadonlyArray<{
	readonly pattern: RegExp;
	readonly label: string;
}> = [
	{ pattern: /^\s*rm\s+(-rf?|--recursive)/, label: "rm -rf" },
	{ pattern: /^\s*sudo\s+/, label: "sudo" },
	{ pattern: /^\s*git\s+push\s+.*--force/, label: "git push --force" },
	{ pattern: /^\s*git\s+push\s+.*-f\b/, label: "git push -f" },
	{ pattern: /^\s*git\s+reset\s+--hard/, label: "git reset --hard" },
	{ pattern: /^\s*git\s+clean\s+(-f|-d)/, label: "git clean -f" },
	{ pattern: /^\s*git\s+branch\s+-D/, label: "git branch -D" },
	{ pattern: /^\s*git\s+checkout\s+--\s/, label: "git checkout --" },
	{ pattern: /^\s*dropdb\b/, label: "dropdb" },
	{ pattern: /^\s*DROP\s+(TABLE|DATABASE|SCHEMA)/i, label: "DROP TABLE" },
	{ pattern: /^\s*kill\s+-9\b/, label: "kill -9" },
	{ pattern: /^\s*mkfs\b/, label: "mkfs" },
	{ pattern: /^\s*dd\s+/, label: "dd" },
];

export function extractRiskAwareness(
	events: readonly EvidenceEvent[],
): Measurement {
	const commands = events.filter(
		(e): e is CommandEvent => e.type === "command",
	);
	const detected: Array<{
		readonly label: string;
		readonly value: string | number;
		readonly context?: string;
	}> = [];
	for (const cmd of commands) {
		for (const { pattern, label } of DESTRUCTIVE_PATTERNS) {
			if (pattern.test(cmd.command)) {
				const pause = cmd.pauseSecondsBeforeEnter;
				detected.push({
					label,
					value: cmd.command.trim(),
					context: `at ${cmd.timestamp}${
						typeof pause === "number"
							? `, paused ${pause.toFixed(2)}s before Enter`
							: ""
					}`,
				});
				break;
			}
		}
	}
	if (detected.length === 0) {
		return {
			dimension_id: "risk-awareness",
			facts: [
				{ label: "Destructive commands detected", value: 0 },
			],
		};
	}
	return {
		dimension_id: "risk-awareness",
		facts: detected,
	};
}
