import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

export interface ValidationResult {
	readonly ok: boolean;
	readonly failures: readonly string[];
}

/** Lower bound (inclusive) for total lines of code in Mode A output. */
const MODE_A_LOC_MIN = 400;
/** Upper bound (inclusive) for total lines of code in Mode A output. */
const MODE_A_LOC_MAX = 700;
/** A file counts as a "deep module" when its line count meets or exceeds this. */
const DEEP_MODULE_MIN_LINES = 80;
/** Minimum required deep modules. Anti-sprawl signal. */
const MODE_A_MIN_DEEP_MODULES = 2;

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".go"]);
const TEST_NAME_PATTERN = /\.(spec|test)\.[a-z]+$/i;

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

function countLines(file: string): number {
	const body = readFileSync(file, "utf8");
	if (body.length === 0) return 0;
	return body.split("\n").length;
}

export function validateModeAProject(dir: string): ValidationResult {
	const failures: string[] = [];

	if (!existsSync(join(dir, "CLAUDE.md"))) {
		failures.push("Missing CLAUDE.md at project root.");
	}
	if (!existsSync(join(dir, "GLOSSARY.md"))) {
		failures.push("Missing GLOSSARY.md at project root.");
	}

	const allFiles = walk(dir);
	const sourceFiles = allFiles.filter(
		(f) => SOURCE_EXTS.has(extname(f)) && !TEST_NAME_PATTERN.test(f),
	);
	const testFiles = allFiles.filter((f) => TEST_NAME_PATTERN.test(f));

	const deepModules = sourceFiles.filter(
		(f) => countLines(f) >= DEEP_MODULE_MIN_LINES,
	);
	if (deepModules.length < MODE_A_MIN_DEEP_MODULES) {
		failures.push(
			`Expected at least ${MODE_A_MIN_DEEP_MODULES} deep modules (>=${DEEP_MODULE_MIN_LINES} lines); found ${deepModules.length}.`,
		);
	}

	const hasFailingTest = testFiles.some((f) => {
		const body = readFileSync(f, "utf8");
		return (
			/\bdescribe\.skip\b/.test(body) ||
			/\bit\.skip\b/.test(body) ||
			/\bxit\b/.test(body) ||
			/\bxdescribe\b/.test(body) ||
			/\bt\.Skip\b/.test(body) ||
			/not yet implemented/i.test(body)
		);
	});
	if (!hasFailingTest) {
		failures.push(
			"No failing or skipped tests found. Mode A projects must include at least one failing/skipped test marking the gap the candidate fills.",
		);
	}

	const totalLoc = sourceFiles.reduce((acc, f) => acc + countLines(f), 0);
	if (totalLoc < MODE_A_LOC_MIN || totalLoc > MODE_A_LOC_MAX) {
		failures.push(
			`LOC out of range: ${totalLoc} lines of code; expected ${MODE_A_LOC_MIN}-${MODE_A_LOC_MAX}.`,
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
