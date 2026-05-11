#!/usr/bin/env bun
// CLI entry for `teamhero interview grade`. Spawned by the Go TUI.

import { consola } from "consola";
import { config as loadDotenv } from "dotenv";

loadDotenv({ override: true });

import { OpenAIObserverClient } from "../src/services/interview/assess/ai-observer.js";
import { gradeCandidate } from "../src/services/interview/assess/grade-orchestrator.js";

interface Flags {
	repo?: string;
	candidate?: string;
	transcript?: string;
	interviewerNotes?: string;
	sessionRecordingUrl?: string;
	sessionPlatform?: string;
	sessionDate?: string;
	outputDir?: string;
	localRepoPath?: string;
}

function parseFlags(argv: readonly string[]): Flags {
	const out: Flags = {};
	const map: Record<string, keyof Flags> = {
		"--repo": "repo",
		"--candidate": "candidate",
		"--transcript": "transcript",
		"--interviewer-notes": "interviewerNotes",
		"--session-recording-url": "sessionRecordingUrl",
		"--session-platform": "sessionPlatform",
		"--session-date": "sessionDate",
		"--output-dir": "outputDir",
		"--local-repo-path": "localRepoPath",
	};
	for (let i = 0; i < argv.length; i++) {
		const key = map[argv[i]];
		if (key && i + 1 < argv.length) {
			(out as Record<string, string>)[key] = argv[i + 1];
			i++;
		}
	}
	return out;
}

async function main() {
	const flags = parseFlags(process.argv.slice(2));
	if (!flags.candidate) {
		consola.error("Missing required flag: --candidate <name>");
		process.exit(1);
	}
	if (!flags.repo && !flags.localRepoPath) {
		consola.error("Need either --repo <url> or --local-repo-path <dir>");
		process.exit(1);
	}
	const result = await gradeCandidate(
		{
			repoUrl: flags.repo ?? "",
			candidateName: flags.candidate,
			transcriptPath: flags.transcript,
			interviewerNotesPath: flags.interviewerNotes,
			sessionRecordingUrl: flags.sessionRecordingUrl,
			sessionPlatform: flags.sessionPlatform,
			sessionDate: flags.sessionDate,
			outputDir: flags.outputDir,
			localRepoPath: flags.localRepoPath,
		},
		{ observer: new OpenAIObserverClient() },
	);
	if (!result.ok) {
		consola.error("Grade failed:");
		for (const f of result.failures) consola.error(`  - ${f}`);
		process.exit(1);
	}
	consola.success(`Audit written:`);
	consola.info(`  summary: ${result.outputs?.summaryPath}`);
	consola.info(`  audit:   ${result.outputs?.auditPath}`);
	consola.info(`  json:    ${result.outputs?.auditJsonPath}`);
}

main().catch((err) => {
	consola.error(err);
	process.exit(1);
});
