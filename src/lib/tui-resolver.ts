import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function exists(path: string): Promise<boolean> {
	try {
		await access(path, fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

async function which(command: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("which", [command]);
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
