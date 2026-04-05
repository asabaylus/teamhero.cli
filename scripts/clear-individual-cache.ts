#!/usr/bin/env node
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { cacheDir } from "../src/lib/paths.js";

async function main(): Promise<void> {
	const individualsDir = join(cacheDir(), "individuals");

	try {
		await stat(individualsDir);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			console.log(`No cached individual summaries found at ${individualsDir}.`);
			return;
		}
		throw error;
	}

	await rm(individualsDir, { recursive: true, force: true });
	console.log(`Cleared individual contributor summaries at ${individualsDir}.`);
}

main().catch((error) => {
	console.error(
		`Failed to clear individual summaries cache: ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exitCode = 1;
});
