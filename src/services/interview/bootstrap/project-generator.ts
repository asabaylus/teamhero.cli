import { homedir } from "node:os";
import {
	mkdirSync,
	readdirSync,
	readFileSync,
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

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Resolves `relPath` relative to `rootAbs` and refuses paths that escape the
 * root via `..`, absolute components, or Windows drive letters. The generator
 * client returns file paths from an LLM response, which is untrusted input.
 */
function resolveWithinRoot(rootAbs: string, relPath: string): string {
	// Reject null bytes outright — they truncate paths in many syscalls and
	// have been used to bypass extension/path checks (e.g. "evil.png\0.sh").
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
	return target;
}

function writeGenerated(outputDir: string, project: GeneratedProject): void {
	const rootAbs = resolve(outputDir);
	for (const file of project.files) {
		const target = resolveWithinRoot(rootAbs, file.path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, file.content, "utf8");
	}
}

/**
 * Refuses to clear paths that are obviously dangerous to recursively delete:
 * filesystem roots, the user's home directory, or anything resolving to a
 * single path segment (one mistaken `outputDir: "/"` should not wipe a disk).
 */
function assertSafeToClear(outputDir: string): void {
	const abs = resolve(outputDir);
	const root = resolve(abs, "/");
	if (abs === root || abs === sep) {
		throw new Error(`Refusing to clear filesystem root: ${abs}`);
	}
	const home = homedir();
	if (home && abs === resolve(home)) {
		throw new Error(`Refusing to clear home directory: ${abs}`);
	}
	// Refuse a top-level path like /usr, /etc, /home — anything where the
	// path has no parent beyond the root.
	const parent = dirname(abs);
	if (parent === abs) {
		throw new Error(`Refusing to clear root-level path: ${abs}`);
	}
}

function clearOutputDir(outputDir: string): void {
	assertSafeToClear(outputDir);
	rmSync(outputDir, { recursive: true, force: true });
	mkdirSync(outputDir, { recursive: true });
}

function copyDir(src: string, dest: string): void {
	for (const entry of readdirSync(src)) {
		const s = join(src, entry);
		const d = join(dest, entry);
		const st = statSync(s);
		if (st.isDirectory()) {
			mkdirSync(d, { recursive: true });
			copyDir(s, d);
		} else {
			mkdirSync(dirname(d), { recursive: true });
			writeFileSync(d, readFileSync(s));
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
		if (options.kitTemplateDir) {
			copyDir(options.kitTemplateDir, config.outputDir);
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

