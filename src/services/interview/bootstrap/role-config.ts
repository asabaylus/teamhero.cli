import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ProjectMode = "A" | "B";
export type AnalysisMode = "ai-assisted" | "human-only";
export type RubricMode = "default" | "custom" | "default+jd";

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
	readonly jdPath?: string;
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
	requireNonEmpty("domain", config.domain, failures);
	requireNonEmpty("featureDescription", config.featureDescription, failures);
	requireNonEmpty("outputDir", config.outputDir, failures);

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
		case "default+jd":
			if (
				typeof config.jdPath !== "string" ||
				config.jdPath.trim().length === 0
			) {
				failures.push("rubricMode 'default+jd' requires a jdPath field");
			} else if (!existsSync(config.jdPath)) {
				failures.push(`jdPath does not exist on disk: ${config.jdPath}`);
			}
			break;
		default:
			failures.push(
				`rubricMode must be one of 'default', 'custom', 'default+jd' (got ${String(config.rubricMode)})`,
			);
	}

	return { ok: failures.length === 0, failures };
}

export function writeRoleConfig(dir: string, config: RoleConfig): void {
	const result = validateRoleConfig(config);
	if (!result.ok) {
		throw new Error(
			`Invalid role config: ${result.failures.join("; ")}`,
		);
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
	return JSON.parse(body) as RoleConfig;
}
