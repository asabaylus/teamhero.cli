import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ValidationResult {
	readonly ok: boolean;
	readonly failures: readonly string[];
}

export function validateModeAProject(dir: string): ValidationResult {
	const failures: string[] = [];

	// README.md is the only required file. It is the candidate-facing
	// brief — what they're building, the time-box, and how to run tests
	// they're about to write themselves.
	//
	// Notably absent (by design, not oversight):
	//   - GLOSSARY.md — would hint at domain concepts the candidate
	//     should think about. Removed.
	//   - Failing/skipped sample tests — would hint at the API surface
	//     or function names the candidate is expected to implement.
	//     Removed.
	//   - .claude/CLAUDE.md — would coach the candidate's agent about
	//     the structure of the work. Removed from the kit overlay.
	// The candidate writes their own tests, picks their own glossary,
	// and works with their agent on their own terms. That's what's
	// being evaluated.
	if (!existsSync(join(dir, "README.md"))) {
		failures.push("Missing README.md at project root (candidate-facing brief).");
	}

	return { ok: failures.length === 0, failures };
}

const MODE_B_REQUIRED_SECTIONS: readonly RegExp[] = [
	/##\s+Time-?box/i,
	/##\s+Acceptance criteria/i,
	/##\s+Deliverables/i,
];

export function validateModeBProject(dir: string): ValidationResult {
	const failures: string[] = [];
	const briefPath = join(dir, "BRIEF.md");
	if (!existsSync(briefPath)) {
		failures.push("Missing BRIEF.md at project root.");
		return { ok: false, failures };
	}
	const body = readFileSync(briefPath, "utf8").trim();
	if (body.length === 0) {
		failures.push("BRIEF.md is empty.");
		return { ok: false, failures };
	}
	for (const section of MODE_B_REQUIRED_SECTIONS) {
		if (!section.test(body)) {
			failures.push(
				`BRIEF.md is missing required section matching ${section}.`,
			);
		}
	}
	return { ok: failures.length === 0, failures };
}
