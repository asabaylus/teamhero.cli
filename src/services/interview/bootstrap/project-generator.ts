import {
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
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

function writeGenerated(outputDir: string, project: GeneratedProject): void {
	for (const file of project.files) {
		const target = join(outputDir, file.path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, file.content, "utf8");
	}
}

function clearOutputDir(outputDir: string): void {
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

// Silence the unused-import in some isolations
export { relative as _relative };
