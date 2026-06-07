import { existsSync, readFileSync } from "node:fs";
import type { PromptEvent, ToolUseEvent } from "../types.js";

/**
 * Parses the candidate's `interview.log` — JSONL with one object per line.
 * Lines have the shape emitted by the kit's .claude/settings.json hooks:
 *
 *   {"event":"user-prompt-submit","timestamp":"...","prompt":"..."}
 *   {"event":"pre-tool-use","timestamp":"...","tool_name":"...","tool_input":{...}}
 *
 * Lines that fail to parse are dropped silently — a corrupt log line should
 * not abort the entire review run.
 */

export interface InterviewLogParseResult {
	readonly prompts: readonly PromptEvent[];
	readonly toolUses: readonly ToolUseEvent[];
}

interface LogLine {
	event?: string;
	timestamp?: string;
	prompt?: string;
	tool_name?: string;
	tool_input?: unknown;
}

export function parseInterviewLog(path: string): InterviewLogParseResult {
	// Missing log is normal: candidate may have skipped Claude Code, or the
	// hooks never produced a line. Treat it as "no evidence" rather than
	// aborting the review.
	if (!existsSync(path)) {
		return { prompts: [], toolUses: [] };
	}
	let body: string;
	try {
		body = readFileSync(path, "utf8");
	} catch {
		return { prompts: [], toolUses: [] };
	}
	const lines = body.split("\n").filter((l) => l.trim().length > 0);
	const prompts: PromptEvent[] = [];
	const toolUses: ToolUseEvent[] = [];
	for (const line of lines) {
		let parsed: LogLine;
		try {
			parsed = JSON.parse(line) as LogLine;
		} catch {
			continue;
		}
		if (
			parsed.event === "user-prompt-submit" &&
			typeof parsed.timestamp === "string" &&
			typeof parsed.prompt === "string"
		) {
			prompts.push({
				type: "prompt",
				timestamp: parsed.timestamp,
				source: "interview.log",
				text: parsed.prompt,
			});
		} else if (
			parsed.event === "pre-tool-use" &&
			typeof parsed.timestamp === "string" &&
			typeof parsed.tool_name === "string"
		) {
			toolUses.push({
				type: "tool-use",
				timestamp: parsed.timestamp,
				source: "interview.log",
				tool: parsed.tool_name,
				input: parsed.tool_input,
			});
		}
	}
	return { prompts, toolUses };
}
