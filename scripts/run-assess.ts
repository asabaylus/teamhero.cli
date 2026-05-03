#!/usr/bin/env bun
import { join } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { configDir } from "../src/lib/paths.js";

dotenvConfig({ path: join(configDir(), ".env"), override: true });

import { consola, createConsola } from "consola";
import { MaturityAIScorer } from "../src/services/maturity/ai-scorer.js";
import {
	FileSystemAuditStore,
	readAnswersJson,
} from "../src/services/maturity/audit-store.js";
import { MaturityService } from "../src/services/maturity/maturity.service.js";
import {
	StdinInterviewTransport,
	StdinLineReader,
} from "../src/services/maturity/stdin-interview.js";
import type {
	AssessCommandInput,
	InterviewAnswer,
} from "../src/services/maturity/types.js";

/**
 * Headless maturity-assessment service runner.
 *
 * Protocol:
 *   stdin  ← First JSON line: AssessCommandInput config.
 *           Subsequent lines: interview-answer events (when interactiveInterview=true).
 *   stdout → JSON-lines events:
 *             - {"type":"progress","step":"...","status":"...","message":"..."}
 *             - {"type":"interview-frame","message":"..."}
 *             - {"type":"interview-question","questionId":"q1",...}
 *             - {"type":"result","outputPath":"...","jsonOutputPath":"...","data":{...}}
 *             - {"type":"error","message":"..."}
 *   stderr → consola log output (passed through).
 *   exit 0 = success, exit 1 = error
 */

type JsonLineEmitter = (event: Record<string, unknown>) => void;

const emit: JsonLineEmitter = (event) => {
	process.stdout.write(`${JSON.stringify(event)}\n`);
};

function emitProgress(
	step: string,
	status: "active" | "complete" | "failed",
	message: string,
): void {
	emit({ type: "progress", step, status, message });
}

// readConfigLine + interview answers share a single stdin reader so the
// stdin pipe doesn't get half-consumed by an async iterator and then closed.

async function loadInterviewAnswersFromFile(
	path: string,
): Promise<InterviewAnswer[]> {
	try {
		return await readAnswersJson(path);
	} catch (err) {
		consola.warn(
			`Failed to read interview answers from ${path}: ${(err as Error).message}`,
		);
		return [];
	}
}

async function main(): Promise<void> {
	const logger = createConsola({ defaults: { tag: "maturity" } });

	const reader = new StdinLineReader();
	const configLine = await reader.nextLine();
	if (!configLine) {
		emit({ type: "error", message: "No config received on stdin" });
		process.exit(1);
	}

	let input: AssessCommandInput;
	try {
		input = JSON.parse(configLine) as AssessCommandInput;
	} catch (err) {
		emit({
			type: "error",
			message: `Failed to parse config JSON: ${(err as Error).message}`,
		});
		process.exit(1);
	}

	emitProgress("startup", "active", "Maturity assessment starting…");

	// Resolve interview transport
	let interview;
	let preloaded: InterviewAnswer[] = [];
	if (input.interactiveInterview) {
		interview = new StdinInterviewTransport(reader, emit);
	} else if (input.interviewAnswersPath) {
		preloaded = await loadInterviewAnswersFromFile(input.interviewAnswersPath);
	}

	// Audit store: only when scope has a localPath
	const auditStore = input.scope.localPath
		? new FileSystemAuditStore(input.scope.localPath)
		: undefined;

	const scorer = new MaturityAIScorer({ dryRun: input.dryRun ?? false });
	const service = new MaturityService({
		logger,
		scorer,
		...(interview ? { interview } : {}),
		...(auditStore ? { auditStore } : {}),
		onProgress: (step, message) => emitProgress(step, "active", message),
	});

	// If a pre-supplied answer file was given (and not interactive), seed by
	// monkey-patching auditStore.readPriorAnswers to return those values when
	// no CONFIG.md exists. We do it here to keep MaturityService reusable.
	if (preloaded.length > 0 && auditStore) {
		const original = auditStore.readPriorAnswers.bind(auditStore);
		auditStore.readPriorAnswers = async () => {
			const fromFile = preloaded;
			const fromConfig = await original();
			const merged = new Map(fromConfig.map((a) => [a.questionId, a] as const));
			for (const a of fromFile) merged.set(a.questionId, a);
			return [...merged.values()];
		};
	}

	try {
		const result = await service.run(input);
		emitProgress("complete", "complete", "Audit complete.");
		emit({
			type: "result",
			outputPath: result.outputPath,
			...(result.jsonOutputPath
				? { jsonOutputPath: result.jsonOutputPath }
				: {}),
			data: result.artifact as unknown as Record<string, unknown>,
		});
		process.exit(0);
	} catch (err) {
		emit({ type: "error", message: (err as Error).message });
		consola.error(err);
		process.exit(1);
	}
}

main().catch((err) => {
	emit({ type: "error", message: (err as Error).message });
	consola.error(err);
	process.exit(1);
});
