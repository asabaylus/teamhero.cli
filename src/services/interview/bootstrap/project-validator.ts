import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface ValidationResult {
	readonly ok: boolean;
	readonly failures: readonly string[];
}

export interface ModeAValidationOptions {
	/**
	 * The role's feature description. When it asks for in-memory / no-database
	 * storage, the validator rejects generated dependency manifests that pull
	 * in a database driver (the generator prompt forbids them; this is the
	 * enforcement half).
	 */
	readonly featureDescription?: string;
}

// Database driver package identifiers we refuse to see in a dependency
// manifest when the feature is explicitly in-memory. Matched
// case-insensitively against manifest text (.csproj <PackageReference>,
// package.json deps, go.mod requires, etc.). Kept to unambiguous driver
// names so a legitimately-named domain symbol ("MysqlSpoolFormatter")
// doesn't trip it — the manifests reference these as package coordinates.
const DB_DRIVER_PATTERNS: readonly RegExp[] = [
	/MongoDB\.Driver/i,
	/\bmongoose\b/i,
	/\bmongodb\b/i,
	/Microsoft\.EntityFrameworkCore/i,
	/Microsoft\.Data\.SqlClient/i,
	/System\.Data\.SqlClient/i,
	/\bNpgsql\b/i,
	/MySql\.Data/i,
	/MySqlConnector/i,
	/\bmysql2?\b/i,
	/\bpg\b/i,
	/\bsqlite3?\b/i,
	/better-sqlite3/i,
	/\bredis\b/i,
	/\bioredis\b/i,
	/go\.mongodb\.org/i,
	/lib\/pq/i,
	/jackc\/pgx/i,
];

// Dependency-manifest file names/extensions we scan for DB drivers.
function isManifestFile(name: string): boolean {
	return (
		name.endsWith(".csproj") ||
		name === "package.json" ||
		name === "go.mod" ||
		name === "requirements.txt" ||
		name === "pyproject.toml" ||
		name === "Cargo.toml" ||
		name === "pom.xml" ||
		name === "build.gradle"
	);
}

// Recursively collect files matching `predicate`, skipping noisy build
// output and VCS dirs. Bounded by the small size of generated projects.
function collectFiles(
	dir: string,
	predicate: (name: string) => boolean,
	acc: string[] = [],
): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return acc;
	}
	for (const entry of entries) {
		if (
			entry === "node_modules" ||
			entry === ".git" ||
			entry === "bin" ||
			entry === "obj"
		) {
			continue;
		}
		const full = join(dir, entry);
		let isDir = false;
		try {
			isDir = statSync(full).isDirectory();
		} catch {
			continue;
		}
		if (isDir) {
			collectFiles(full, predicate, acc);
		} else if (predicate(entry)) {
			acc.push(full);
		}
	}
	return acc;
}

function wantsInMemory(featureDescription: string | undefined): boolean {
	if (!featureDescription) return false;
	const text = featureDescription.toLowerCase();
	return text.includes("in-memory") || text.includes("no database");
}

// §3a: when the feature is in-memory, no dependency manifest may pull in a
// database driver.
function checkNoDatabasePackages(dir: string, failures: string[]): void {
	const manifests = collectFiles(dir, isManifestFile);
	for (const manifest of manifests) {
		let body: string;
		try {
			body = readFileSync(manifest, "utf8");
		} catch {
			continue;
		}
		for (const pattern of DB_DRIVER_PATTERNS) {
			if (pattern.test(body)) {
				const rel = manifest.startsWith(dir)
					? manifest.slice(dir.length).replace(/^[/\\]/, "")
					: manifest;
				failures.push(
					`Feature is in-memory but ${rel} references a database driver (matched ${pattern}). Remove the database package.`,
				);
				break; // one failure per manifest is enough signal
			}
		}
	}
}

// §3b: a command line indented with 1-3 leading spaces renders as loose
// text (or a stray implicit code block) instead of a fenced command. The
// generator must emit ```bash fences with no leading whitespace on the
// command lines.
const INDENTED_COMMAND = /^ {1,3}(dotnet|npm|npx|node|bun|yarn|pnpm|git|cd|\.\/)\b/;

function checkReadmeCodeBlockFormatting(dir: string, failures: string[]): void {
	const readmePath = join(dir, "README.md");
	if (!existsSync(readmePath)) return;
	let body: string;
	try {
		body = readFileSync(readmePath, "utf8");
	} catch {
		return;
	}
	const offenders: string[] = [];
	for (const line of body.split("\n")) {
		if (INDENTED_COMMAND.test(line)) {
			offenders.push(line.trim());
			if (offenders.length >= 3) break;
		}
	}
	if (offenders.length > 0) {
		failures.push(
			`README.md has indented command line(s) instead of fenced code blocks: ${offenders
				.map((o) => `"${o}"`)
				.join(", ")}. Use \`\`\`bash fences with no leading whitespace.`,
		);
	}
}

export function validateModeAProject(
	dir: string,
	opts: ModeAValidationOptions = {},
): ValidationResult {
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
		failures.push(
			"Missing README.md at project root (candidate-facing brief).",
		);
	}

	// §3b: README code-block formatting (runs whenever a README exists).
	checkReadmeCodeBlockFormatting(dir, failures);

	// §3a: no database drivers when the feature is explicitly in-memory.
	if (wantsInMemory(opts.featureDescription)) {
		checkNoDatabasePackages(dir, failures);
	}

	return { ok: failures.length === 0, failures };
}

// §3c: after the kit overlay is copied in, the canonical interview-kit
// files must all be present (and the shell entrypoints executable). A
// failure here means the kit copy was incomplete or the kit dir is
// broken — it is a misconfiguration, not something a generation retry
// would fix, so callers surface it rather than looping.
const REQUIRED_KIT_FILES: readonly string[] = [
	"INTERVIEW_RULES.md",
	"PRIVACY_RELEASE.md",
	"RUBRIC_OVERVIEW.md",
	"start.sh",
	"end.sh",
	"lib/privacy-gate.sh",
];

const EXECUTABLE_KIT_FILES: readonly string[] = ["start.sh", "end.sh"];

export function validateKitFiles(dir: string): ValidationResult {
	const failures: string[] = [];
	for (const rel of REQUIRED_KIT_FILES) {
		const full = join(dir, rel);
		if (!existsSync(full)) {
			failures.push(`Missing kit file after copy: ${rel}.`);
			continue;
		}
		if (EXECUTABLE_KIT_FILES.includes(rel)) {
			try {
				const mode = statSync(full).mode;
				// Any execute bit (owner/group/other) is sufficient.
				if ((mode & 0o111) === 0) {
					failures.push(`Kit file is not executable: ${rel}.`);
				}
			} catch {
				failures.push(`Could not stat kit file: ${rel}.`);
			}
		}
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
