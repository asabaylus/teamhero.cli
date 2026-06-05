import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ProjectMode = "A" | "B";
export type AnalysisMode = "ai-assisted" | "human-only";
// rubricMode picks the rubric the AI observer uses for post-interview
// analysis. The job description, when supplied, is treated as an
// independent input — see jdPath / jdInfluencesProject below — so it
// can supplement either rubric or be used purely for project generation.
export type RubricMode = "default" | "custom";

export interface RoleConfig {
	readonly roleSlug: string;
	readonly roleTitle: string;
	readonly stack: string;
	readonly domain: string;
	readonly featureDescription: string;
	readonly timeBoxMinutes: number;
	readonly projectMode: ProjectMode;
	readonly analysisMode: AnalysisMode;
	readonly rubricMode: RubricMode;
	readonly outputDir: string;
	readonly customPrompt?: string;
	// jdPath is the absolute or relative path to a markdown/text job
	// description. Optional in all rubric modes. When supplied, the
	// AI observer references it during post-interview analysis. When
	// jdInfluencesProject is also true, the project-generation prompt
	// reads the JD content and tailors the generated repo to match
	// the seniority and domain it implies (e.g., a junior healthtech
	// JD nudges the generator toward an EHR-flavoured feature).
	readonly jdPath?: string;
	readonly jdInfluencesProject?: boolean;
	// stackByCandidate flips Mode B's brief from "use the named stack"
	// to "candidate picks their own stack". Only meaningful when
	// projectMode === "B"; validation rejects the combination otherwise.
	readonly stackByCandidate?: boolean;
}

export interface RoleConfigValidationResult {
	readonly ok: boolean;
	readonly failures: readonly string[];
}

const CUSTOM_TIME_BOX_MIN = 15;
const CUSTOM_TIME_BOX_MAX = 240;
const STANDARD_TIME_BOXES = new Set([60, 90, 120]);

const ROLE_CONFIG_FILENAME = "role-config.json";

function requireNonEmpty(
	field: keyof RoleConfig,
	value: unknown,
	failures: string[],
): void {
	if (typeof value !== "string" || value.trim().length === 0) {
		failures.push(`${String(field)} must be a non-empty string`);
	}
}

export function validateRoleConfig(
	config: RoleConfig,
): RoleConfigValidationResult {
	const failures: string[] = [];

	requireNonEmpty("roleSlug", config.roleSlug, failures);
	requireNonEmpty("roleTitle", config.roleTitle, failures);
	requireNonEmpty("stack", config.stack, failures);
	requireNonEmpty("featureDescription", config.featureDescription, failures);
	requireNonEmpty("outputDir", config.outputDir, failures);
	// domain is required UNLESS a JD is attached. The JD describes the
	// business domain; asking the proctor to also type it out is
	// redundant and a source of friction. The OpenAI prompt and the
	// observer both fall back to the JD body when domain is empty.
	const hasJD =
		typeof config.jdPath === "string" && config.jdPath.trim().length > 0;
	if (!hasJD) {
		requireNonEmpty("domain", config.domain, failures);
	}

	const t = config.timeBoxMinutes;
	const inRange = t >= CUSTOM_TIME_BOX_MIN && t <= CUSTOM_TIME_BOX_MAX;
	if (!Number.isFinite(t) || !inRange) {
		failures.push(
			`timeBoxMinutes must be a finite number between ${CUSTOM_TIME_BOX_MIN} and ${CUSTOM_TIME_BOX_MAX} (standard values are ${[...STANDARD_TIME_BOXES].join("/")})`,
		);
	}

	if (config.projectMode !== "A" && config.projectMode !== "B") {
		failures.push("projectMode must be 'A' or 'B'");
	}
	if (config.stackByCandidate && config.projectMode !== "B") {
		failures.push(
			"stackByCandidate requires projectMode 'B' — Mode A scaffolds in a specific stack, so 'candidate picks the stack' is incoherent there.",
		);
	}
	if (
		config.analysisMode !== "ai-assisted" &&
		config.analysisMode !== "human-only"
	) {
		failures.push("analysisMode must be 'ai-assisted' or 'human-only'");
	}

	switch (config.rubricMode) {
		case "default":
			break;
		case "custom":
			if (
				typeof config.customPrompt !== "string" ||
				config.customPrompt.trim().length === 0
			) {
				failures.push(
					"rubricMode 'custom' requires a non-empty customPrompt field",
				);
			}
			break;
		default:
			failures.push(
				`rubricMode must be one of 'default', 'custom' (got ${String(config.rubricMode)})`,
			);
	}

	// jdPath is now an independent optional field — validated regardless
	// of rubric mode. When provided, the file must exist; when
	// jdInfluencesProject is set, jdPath becomes mandatory because the
	// generator has nothing to read otherwise.
	if (typeof config.jdPath === "string" && config.jdPath.trim().length > 0) {
		if (!existsSync(config.jdPath)) {
			failures.push(`jdPath does not exist on disk: ${config.jdPath}`);
		}
	}
	if (config.jdInfluencesProject) {
		if (
			typeof config.jdPath !== "string" ||
			config.jdPath.trim().length === 0
		) {
			failures.push(
				"jdInfluencesProject is true but jdPath is missing — provide a JD or unset the influence flag",
			);
		}
	}

	return { ok: failures.length === 0, failures };
}

export function writeRoleConfig(dir: string, config: RoleConfig): void {
	const result = validateRoleConfig(config);
	if (!result.ok) {
		throw new Error(`Invalid role config: ${result.failures.join("; ")}`);
	}
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, ROLE_CONFIG_FILENAME),
		`${JSON.stringify(config, null, 2)}\n`,
		"utf8",
	);
}

export function readRoleConfig(dir: string): RoleConfig | null {
	const path = join(dir, ROLE_CONFIG_FILENAME);
	if (!existsSync(path)) return null;
	const body = readFileSync(path, "utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		throw new Error(`Malformed role-config.json at ${path}: ${reason}`);
	}
	if (!parsed || typeof parsed !== "object") {
		throw new Error(
			`Malformed role-config.json at ${path}: top-level value is not an object`,
		);
	}
	const candidate = parsed as RoleConfig;
	const validation = validateRoleConfig(candidate);
	if (!validation.ok) {
		throw new Error(
			`Invalid role-config.json at ${path}: ${validation.failures.join("; ")}`,
		);
	}
	return candidate;
}
