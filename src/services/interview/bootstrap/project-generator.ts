import { homedir } from "node:os";
import {
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	validateModeAProject,
	validateModeBProject,
	type ValidationResult,
} from "./project-validator.js";
import type { RoleConfig } from "./role-config.js";

export interface GeneratedFile {
	readonly path: string; // relative to outputDir
	readonly content: string;
}

export interface GeneratedProject {
	readonly files: readonly GeneratedFile[];
}

export interface GeneratorClient {
	generate(input: {
		readonly config: RoleConfig;
		readonly attempt: number;
		readonly previousFailures?: readonly string[];
	}): Promise<GeneratedProject>;
}

export interface GenerateOptions {
	/** Source directory for the embedded interview kit (copied verbatim into outputDir). */
	readonly kitTemplateDir?: string;
	/** Maximum number of generation attempts before giving up. */
	readonly maxAttempts?: number;
}

export interface GenerateResult {
	readonly ok: boolean;
	readonly attempts: number;
	readonly failures: readonly string[];
}

// Bumped from 3 to 5 after repeated reports of first-pass LOC/deep-module
// shortfalls. gpt-5-mini frequently lands at ~200-300 LOC with one deep
// module on attempt 1, then climbs into the 400-700 window on attempts
// 2-4 once the validator's failure list (passed via previousFailures) is
// concrete. Five gives a healthy margin without runaway cost — each
// attempt is one structured Responses API call.
const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Resolves `relPath` relative to `rootAbs` and refuses paths that escape the
 * root via `..`, absolute components, drive letters, or symlinks that point
 * outside the root. The generator client returns file paths from an LLM
 * response, which is untrusted input.
 *
 * Two-stage containment: (1) string-level relative-path resolution catches
 * obvious traversal; (2) realpath check on the parent directory catches a
 * symlink planted by a previous attempt that points outside the root.
 * Without (2), an attacker who can leave `subdir -> /etc` in the output
 * tree could redirect a later write to `/etc/passwd` via `subdir/passwd`.
 */
function resolveWithinRoot(rootAbs: string, relPath: string): string {
	if (relPath.includes("\0")) {
		throw new Error(
			`Generated file path contains a null byte, refusing: ${JSON.stringify(relPath)}`,
		);
	}
	if (isAbsolute(relPath)) {
		throw new Error(
			`Generated file path is absolute, refusing: ${relPath}`,
		);
	}
	const target = resolve(rootAbs, relPath);
	const rel = relative(rootAbs, target);
	if (rel.startsWith("..") || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
		throw new Error(
			`Generated file path escapes output directory, refusing: ${relPath}`,
		);
	}

	// Walk path segments from the root toward the target; refuse if any
	// existing intermediate component is a symlink. This neutralizes a
	// `subdir -> /etc` symlink planted by a prior generation attempt.
	let cursor = rootAbs;
	const parts = rel.split(sep).filter((p) => p.length > 0);
	// Drop the final segment — it's the file name, which may not exist yet.
	for (let i = 0; i < parts.length - 1; i++) {
		cursor = join(cursor, parts[i]);
		try {
			const st = lstatSync(cursor);
			if (st.isSymbolicLink()) {
				throw new Error(
					`Generated file path traverses a symlink at ${cursor}, refusing: ${relPath}`,
				);
			}
		} catch (err) {
			// ENOENT is expected for new directories; rethrow anything else.
			if (
				err instanceof Error &&
				(err as NodeJS.ErrnoException).code !== "ENOENT"
			) {
				throw err;
			}
		}
	}

	return target;
}

function writeGenerated(outputDir: string, project: GeneratedProject): void {
	// realpath the root once so subsequent containment math is symlink-stable.
	// If outputDir itself doesn't exist yet, fall back to its resolved path —
	// clearOutputDir runs immediately before writeGenerated and creates it.
	let rootAbs = resolve(outputDir);
	try {
		rootAbs = realpathSync(rootAbs);
	} catch {
		// not yet created — resolved path is the best we can do
	}
	for (const file of project.files) {
		const target = resolveWithinRoot(rootAbs, file.path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, file.content, "utf8");
	}
}

// Known dangerous absolute paths we refuse to recursively delete even when
// they technically pass the depth and root-segment checks. Adding entries
// here is preferable to adding new heuristics — it forces an explicit
// decision for each system-relevant path.
const DANGEROUS_ROOTS: ReadonlySet<string> = new Set([
	"/",
	"/bin",
	"/boot",
	"/dev",
	"/etc",
	"/home",
	"/lib",
	"/lib32",
	"/lib64",
	"/mnt",
	"/opt",
	"/proc",
	"/root",
	"/run",
	"/sbin",
	"/srv",
	"/sys",
	"/tmp",
	"/usr",
	"/usr/local",
	"/var",
]);

/**
 * Refuses to clear paths that are obviously dangerous to recursively delete:
 * filesystem roots, the user's home directory, single-segment paths
 * (`/foo`), or well-known system directories like `/tmp` and `/var` even
 * when they technically resolve fine. Subdirectories of those system
 * directories (`/tmp/my-output`) are permitted — that's where mkdtemp
 * lives and where tests stage fixtures.
 *
 * Stronger than "is this filesystem root?" because a misconfigured
 * `outputDir: "/tmp"` would previously have been accepted and would have
 * deleted every other process's tempfiles.
 */
function assertSafeToClear(outputDir: string): void {
	const abs = resolve(outputDir);
	if (abs === sep) {
		throw new Error(`Refusing to clear filesystem root: ${abs}`);
	}

	const home = homedir();
	if (home && abs === resolve(home)) {
		throw new Error(`Refusing to clear home directory: ${abs}`);
	}

	if (DANGEROUS_ROOTS.has(abs)) {
		throw new Error(
			`Refusing to clear well-known system directory: ${abs}. ` +
				`Pick an output directory inside your workspace.`,
		);
	}

	// Refuse a single-segment absolute path like `/foo` or `/anything`.
	// Real workspace paths have at least two segments after the root.
	const parts = abs.split(sep).filter((p) => p.length > 0);
	if (parts.length < 2) {
		throw new Error(
			`Refusing to clear single-segment path: ${abs}. ` +
				`Output directories must be a subdirectory, not a top-level path.`,
		);
	}
}

function clearOutputDir(outputDir: string): void {
	assertSafeToClear(outputDir);
	rmSync(outputDir, { recursive: true, force: true });
	mkdirSync(outputDir, { recursive: true });
}

/**
 * Recursively copies `src` into `dest`, substituting `{{KEY}}` tokens in
 * every file body using `vars`. The substitution is intentionally
 * minimal — single `String.replaceAll` per key, no escaping or
 * conditionals — so the kit's template grammar is "the literal text
 * that appears in the source files."
 *
 * Files that don't contain any placeholder pay only one read+write, no
 * regex compilation per file.
 */
function copyDir(
	src: string,
	dest: string,
	vars: Readonly<Record<string, string>> = {},
): void {
	const tokenKeys = Object.keys(vars);
	for (const entry of readdirSync(src)) {
		const s = join(src, entry);
		const d = join(dest, entry);
		const st = statSync(s);
		if (st.isDirectory()) {
			mkdirSync(d, { recursive: true });
			copyDir(s, d, vars);
		} else {
			mkdirSync(dirname(d), { recursive: true });
			if (tokenKeys.length === 0) {
				writeFileSync(d, readFileSync(s));
				continue;
			}
			// readFileSync as utf8 — template files (.md, .sh, .json) are text.
			// If the kit ever includes a binary asset we'll need to whitelist
			// extensions; today there are none.
			let body = readFileSync(s, "utf8");
			for (const key of tokenKeys) {
				body = body.replaceAll(`{{${key}}}`, vars[key]);
			}
			writeFileSync(d, body);
		}
	}
}

function validateOutput(
	config: RoleConfig,
	outputDir: string,
): ValidationResult {
	if (config.projectMode === "A") return validateModeAProject(outputDir);
	return validateModeBProject(outputDir);
}

export async function generateProject(
	config: RoleConfig,
	client: GeneratorClient,
	options: GenerateOptions = {},
): Promise<GenerateResult> {
	const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
	let lastFailures: readonly string[] = [];

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		clearOutputDir(config.outputDir);

		const project = await client.generate({
			config,
			attempt,
			previousFailures: lastFailures,
		});
		writeGenerated(config.outputDir, project);

		// Copy kit templates after the generated files so kit files take precedence
		// when paths overlap (intentional: kit is the canonical wiring).
		// {{TIME_BOX}} placeholders in kit text files are substituted with the
		// configured minutes — INTERVIEW_RULES.md reads this so candidates see
		// a real number instead of the literal placeholder.
		if (options.kitTemplateDir) {
			copyDir(options.kitTemplateDir, config.outputDir, {
				TIME_BOX: String(config.timeBoxMinutes),
			});
		}

		const validation = validateOutput(config, config.outputDir);
		if (validation.ok) {
			return { ok: true, attempts: attempt, failures: [] };
		}
		lastFailures = validation.failures;
	}

	return {
		ok: false,
		attempts: maxAttempts,
		failures: lastFailures,
	};
}

/**
 * Validation-only helper exposed for callers that want to re-check a previously
 * generated project (e.g., after a manual override).
 */
export function validateGenerated(config: RoleConfig): ValidationResult {
	return validateOutput(config, config.outputDir);
}

