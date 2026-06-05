import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RoleConfig } from "../bootstrap/role-config.js";
import { readRoleConfig } from "../bootstrap/role-config.js";
import { getRubricVersion } from "../shared/rubric.js";
import {
	buildObserverPrompt,
	humanOnlyObservations,
	type ObserverClient,
} from "./ai-observer.js";
import {
	type AuditFrontmatter,
	type AuditWriteOutputs,
	writeAudit,
} from "./audit-writer.js";
import { parseAsciinemaCast } from "./collectors/asciinema.js";
import { parseGitHistory } from "./collectors/git-history.js";
import { parseInterviewLog } from "./collectors/jsonl-log.js";
import { parseTranscript } from "./collectors/transcript.js";
import { extractRiskAwareness } from "./extractors/risk-awareness.js";
import { extractTestPass, type TestRunner } from "./extractors/test-pass.js";
import { extractThroughput } from "./extractors/throughput.js";
import { extractVerification } from "./extractors/verification.js";
import type { EvidenceEvent, Measurement, ReviewResult } from "./types.js";

export type Cloner = (repoUrl: string, destDir: string) => void;

const defaultCloner: Cloner = (repoUrl, destDir) => {
	// execFileSync passes args directly to the spawned process — no shell, so
	// repoUrl cannot inject shell metacharacters or break out of quoting.
	execFileSync("git", ["clone", "--depth=50", "--", repoUrl, destDir], {
		stdio: "inherit",
	});
};

export interface ReviewInput {
	readonly repoUrl: string;
	readonly transcriptPath?: string;
	readonly interviewerNotesPath?: string;
	readonly sessionRecordingUrl?: string;
	readonly sessionPlatform?: string;
	readonly sessionDate?: string;
	readonly outputDir?: string;
	readonly candidateName: string;
	/** Override the candidate-repo path instead of cloning (used by tests). */
	readonly localRepoPath?: string;
}

export interface ReviewDependencies {
	readonly observer: ObserverClient;
	readonly clone?: Cloner;
	readonly testRunner?: TestRunner;
}

export interface ReviewOutcome {
	readonly ok: boolean;
	readonly outputs?: AuditWriteOutputs;
	readonly result?: ReviewResult;
	readonly failures: readonly string[];
}

function slug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

// Compact timestamp suffix (HHMMSS UTC) appended to candidate_id so two
// reviews of the same candidate on the same day land in distinct directories
// instead of silently overwriting each other.
function timeSuffix(): string {
	return new Date().toISOString().slice(11, 19).replace(/:/g, "");
}

function mergeEvents(
	streams: readonly (readonly EvidenceEvent[])[],
): readonly EvidenceEvent[] {
	const flat = streams.flat();
	return flat.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function copyIfExists(src: string, dest: string): void {
	if (!existsSync(src)) return;
	const s = statSync(src);
	if (s.isDirectory()) cpSync(src, dest, { recursive: true });
	else cpSync(src, dest);
}

function collectEvents(
	repoDir: string,
	input: ReviewInput,
): readonly EvidenceEvent[] {
	const streams: EvidenceEvent[][] = [];

	const cast = join(repoDir, "terminal.cast");
	if (existsSync(cast)) {
		try {
			streams.push([...parseAsciinemaCast(cast).commands]);
		} catch {
			// Skip silently — the audit will note no terminal evidence.
		}
	}

	const log = join(repoDir, "interview.log");
	if (existsSync(log)) {
		const parsed = parseInterviewLog(log);
		streams.push([...parsed.prompts]);
		streams.push([...parsed.toolUses]);
	}

	if (input.transcriptPath && existsSync(input.transcriptPath)) {
		streams.push([
			...parseTranscript(input.transcriptPath, {
				sessionStartIso: input.sessionDate
					? `${input.sessionDate}T09:00:00Z`
					: undefined,
			}),
		]);
	}

	streams.push([...parseGitHistory(repoDir)]);

	return mergeEvents(streams);
}

function computeMeasurements(
	repoDir: string,
	events: readonly EvidenceEvent[],
	deps: ReviewDependencies,
): readonly Measurement[] {
	return [
		extractVerification(events),
		extractRiskAwareness(events),
		extractTestPass(repoDir, deps.testRunner),
		extractThroughput(events),
	];
}

export async function reviewCandidate(
	input: ReviewInput,
	deps: ReviewDependencies,
): Promise<ReviewOutcome> {
	const cleanupPaths: string[] = [];
	try {
		let repoDir: string;
		if (input.localRepoPath) {
			repoDir = input.localRepoPath;
		} else {
			repoDir = mkdtempSync(join(tmpdir(), "iv-clone-"));
			cleanupPaths.push(repoDir);
			(deps.clone ?? defaultCloner)(input.repoUrl, repoDir);
		}

		const roleConfig = readRoleConfig(repoDir);
		if (!roleConfig) {
			return {
				ok: false,
				failures: [
					"Candidate repo does not contain role-config.json. Run `teamhero interview bootstrap` first to produce one.",
				],
			};
		}

		const events = collectEvents(repoDir, input);
		const measurements = computeMeasurements(repoDir, events, deps);

		const useAI = roleConfig.analysisMode === "ai-assisted";
		let observations;
		if (useAI) {
			const prompt = buildObserverPrompt({
				config: roleConfig,
				events,
				interviewerNotesPath: input.interviewerNotesPath,
				sessionRecordingUrl: input.sessionRecordingUrl,
			});
			const obs = await deps.observer.observe(prompt);
			observations = obs.observations;
		} else {
			observations = humanOnlyObservations();
		}

		const result: ReviewResult = {
			rubric_version: getRubricVersion(),
			candidate_id: `${slug(input.candidateName)}-${todayIso()}-${timeSuffix()}`,
			role_slug: roleConfig.roleSlug,
			observed_at: new Date().toISOString(),
			observations,
			measurements,
		};

		const outputDir =
			input.outputDir ??
			join(
				process.cwd(),
				"docs",
				"interviews",
				roleConfig.roleSlug,
				result.candidate_id,
			);

		const frontmatter = buildFrontmatter(input, roleConfig);
		const outputs = writeAudit({ result, frontmatter, outputDir });

		// Copy raw evidence into evidence/.
		const evidenceDir = outputs.evidenceDir;
		for (const file of [
			"PRIVACY_RELEASE.md",
			"terminal.cast",
			"interview.log",
		]) {
			copyIfExists(join(repoDir, file), join(evidenceDir, file));
		}
		if (input.transcriptPath) {
			copyIfExists(input.transcriptPath, join(evidenceDir, "transcript.txt"));
		}
		if (input.interviewerNotesPath) {
			copyIfExists(
				input.interviewerNotesPath,
				join(evidenceDir, "interviewer-notes.md"),
			);
		}

		return { ok: true, outputs, result, failures: [] };
	} catch (err) {
		return {
			ok: false,
			failures: [err instanceof Error ? err.message : String(err)],
		};
	} finally {
		for (const p of cleanupPaths) {
			rmSync(p, { recursive: true, force: true });
		}
	}
}

function buildFrontmatter(
	input: ReviewInput,
	role: RoleConfig,
): AuditFrontmatter {
	return {
		tags: ["hiring", "candidate", role.roleSlug],
		candidate: input.candidateName,
		role: role.roleSlug,
		date: todayIso(),
		rubric_version: getRubricVersion(),
		rubric_mode: role.rubricMode,
		signed_off: false,
		session_recording_url: input.sessionRecordingUrl,
		session_platform: input.sessionPlatform,
		session_date: input.sessionDate,
	};
}

// Suppress unused-export lint helper for narrow type re-export
export type { Measurement, ReviewResult };
export { readFileSync as _readFileSync };
