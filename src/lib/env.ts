import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "dotenv";
import { configDir } from "./paths.js";

let cachedDotenv: Record<string, string> | null = null;

export function loadDotenv(): Record<string, string> {
	if (cachedDotenv) {
		return cachedDotenv;
	}

	cachedDotenv = {};

	// Load from ~/.config/teamhero/.env (canonical credential store, written by `teamhero setup`)
	try {
		const credPath = join(configDir(), ".env");
		const contents = readFileSync(credPath, "utf8");
		Object.assign(cachedDotenv, parse(contents));
	} catch {
		// Credential .env not found — continue
	}

	return cachedDotenv;
}

export function getEnv(key: string): string | undefined {
	const direct = process.env[key];
	if (typeof direct === "string" && direct.length > 0) {
		return direct;
	}

	const fallback = loadDotenv()[key];
	return fallback && fallback.length > 0 ? fallback : undefined;
}

/**
 * Write or update key-value pairs in the teamhero .env file.
 * Preserves existing keys not in the updates map. Drops comment lines.
 */
export function writeEnvFile(updates: Record<string, string>): void {
	const dir = configDir();
	mkdirSync(dir, { recursive: true });
	const envPath = join(dir, ".env");

	let existingLines: string[] = [];
	try {
		existingLines = readFileSync(envPath, "utf8").split("\n");
	} catch {
		// File doesn't exist yet
	}

	const written = new Set<string>();
	const outLines: string[] = [];

	for (const line of existingLines) {
		const trimmed = line.trim();
		// Drop comment lines
		if (trimmed.startsWith("#")) continue;
		if (trimmed === "") {
			outLines.push(line);
			continue;
		}
		const eqIdx = trimmed.indexOf("=");
		if (eqIdx < 0) {
			outLines.push(line);
			continue;
		}
		const key = trimmed.slice(0, eqIdx).trim();
		if (key in updates) {
			if (updates[key]) {
				outLines.push(`${key}=${updates[key]}`);
			}
			// If empty value, omit the line
			written.add(key);
		} else {
			outLines.push(line);
		}
	}

	// Append new keys
	for (const [key, value] of Object.entries(updates)) {
		if (!written.has(key) && value) {
			outLines.push(`${key}=${value}`);
		}
	}

	let content = outLines.join("\n");
	if (!content.endsWith("\n")) content += "\n";
	writeFileSync(envPath, content, { mode: 0o600 });

	// Invalidate cached dotenv so next getEnv() picks up changes
	cachedDotenv = null;
}
