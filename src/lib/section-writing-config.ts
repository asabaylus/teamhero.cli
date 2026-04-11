import { getEnv } from "./env.js";

export type SectionVerbosity = "concise" | "standard" | "detailed";

export interface SectionWritingConfig {
	verbosity: SectionVerbosity;
	audience?: string;
}

export function resolveSectionVerbosity(
	envKey: string,
	defaultValue: SectionVerbosity = "standard",
): SectionVerbosity {
	const value = (getEnv(envKey) ?? "").trim().toLowerCase();
	if (value === "concise" || value === "standard" || value === "detailed") {
		return value;
	}
	return defaultValue;
}

export function resolveSectionAudience(
	envKey: string,
	maxChars = 280,
): string | undefined {
	const raw = (getEnv(envKey) ?? "").trim();
	if (!raw) return undefined;
	return raw.slice(0, maxChars);
}
