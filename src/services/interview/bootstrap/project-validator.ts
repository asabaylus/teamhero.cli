import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface ValidationResult {
	readonly ok: boolean;
	readonly failures: readonly string[];
}

// Test files are identified BOTH by Node-style suffixes (foo.spec.ts) AND by
// language conventions where suffix-naming doesn't apply (FooTests.cs,
// foo_test.go, test_foo.py, FooSpec.scala, etc.).
const TEST_NAME_PATTERN =
	/(?:\.(?:spec|test)\.[a-z]+$|(?:Tests?|Specs?)\.(?:cs|fs|vb|java|kt|scala)$|_test\.(?:go|py|rb)$|(?:^|[\\/])test_[^/\\]+\.py$|_spec\.rb$)/i;

function walk(dir: string, out: string[] = []): string[] {
	if (!existsSync(dir)) return out;
	for (const entry of readdirSync(dir)) {
		if (entry === "node_modules" || entry === ".git") continue;
		const full = join(dir, entry);
		// lstat (not stat) so we don't follow symlinks — an attacker-controlled
		// generator output with a cycle would otherwise hang the validator.
		const s = lstatSync(full);
		if (s.isSymbolicLink()) continue;
		if (s.isDirectory()) walk(full, out);
		else if (s.isFile()) out.push(full);
	}
	return out;
}

export function validateModeAProject(dir: string): ValidationResult {
	const failures: string[] = [];

	// README.md is the *candidate-facing* brief — written by the AI generator
	// to explain what the candidate is building, the time-box, and how to
	// run the existing tests. Agent operating guidance lives in the kit's
	// AGENTS.md / .claude/CLAUDE.md, not the AI-authored output, so the
	// model can't leak proctor instructions to the candidate through it.
	if (!existsSync(join(dir, "README.md"))) {
		failures.push("Missing README.md at project root (candidate-facing brief).");
	}
	if (!existsSync(join(dir, "GLOSSARY.md"))) {
		failures.push("Missing GLOSSARY.md at project root.");
	}

	const allFiles = walk(dir);
	const testFiles = allFiles.filter((f) => TEST_NAME_PATTERN.test(f));

	const hasFailingTest = testFiles.some((f) => {
		const body = readFileSync(f, "utf8");
		return (
			// JS/TS — bun/jest/vitest/mocha
			/\bdescribe\.skip\b/.test(body) ||
			/\bit\.skip\b/.test(body) ||
			/\bxit\b/.test(body) ||
			/\bxdescribe\b/.test(body) ||
			// Go
			/\bt\.Skip\b/.test(body) ||
			// xUnit / NUnit / MSTest (Skip attribute)
			/\[\s*Fact\s*\(\s*Skip\s*=/i.test(body) ||
			/\[\s*Theory\s*\(\s*Skip\s*=/i.test(body) ||
			/\[\s*Ignore\b/i.test(body) ||
			// JUnit 5 / JUnit 4
			/@\s*Disabled\b/.test(body) ||
			/@\s*Ignore\b/.test(body) ||
			// pytest / unittest
			/@\s*pytest\.mark\.skip\b/.test(body) ||
			/@\s*unittest\.skip\b/.test(body) ||
			// RSpec — pending / xit
			/\bpending\b/.test(body) ||
			// Rust
			/#\[\s*ignore\b/.test(body) ||
			// Universal "TODO"/"not yet implemented" sentinel for any framework
			/not yet implemented/i.test(body) ||
			/\bNotImplementedException\b/.test(body) ||
			/\braise\s+NotImplementedError\b/.test(body)
		);
	});
	if (!hasFailingTest) {
		failures.push(
			"No failing or skipped tests found. Mode A projects must include at least one failing/skipped test marking the gap the candidate fills.",
		);
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
