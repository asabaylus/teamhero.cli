import * as childProcess from "node:child_process";
import { constants as fsConstants } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { fileURLToPath } from "node:url";

async function exists(path: string): Promise<boolean> {
	try {
		await fsPromises.access(path, fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

async function which(command: string): Promise<string | null> {
	try {
		const stdout = await new Promise<string>((resolve, reject) => {
			childProcess.execFile("which", [command], (error, resolvedStdout) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(resolvedStdout);
			});
		});
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

/**
 * Resolve the Go TUI binary path.
 * Search order:
 *   1. TEAMHERO_TUI_PATH env override
 *   2. tui/teamhero-tui (canonical build output)
 *   3. System PATH (teamhero-tui)
 */
export async function resolveTuiBinary(): Promise<string | null> {
	const override = process.env.TEAMHERO_TUI_PATH;
	if (override && (await exists(override))) {
		return override;
	}

	// Canonical build output in tui/ directory
	const tuiBinary = fileURLToPath(
		new URL("../../tui/teamhero-tui", import.meta.url),
	);
	if (await exists(tuiBinary)) {
		return tuiBinary;
	}

	// System PATH
	const systemBinary = await which("teamhero-tui");
	if (systemBinary && (await exists(systemBinary))) {
		return systemBinary;
	}

	return null;
}
