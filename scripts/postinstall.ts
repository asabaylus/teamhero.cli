import { execFile } from "node:child_process";
import { access, chmod } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function ensureExecutable(path: string): Promise<void> {
	await chmod(path, 0o755);
}

async function hasGo(): Promise<boolean> {
	try {
		await execFileAsync("go", ["version"]);
		return true;
	} catch {
		return false;
	}
}

async function buildTuiBinary(): Promise<void> {
	if (process.env.TEAMHERO_NO_TUI) {
		console.log("TEAMHERO_NO_TUI set. Skipping TUI build.");
		return;
	}

	const tuiSrcDir = fileURLToPath(new URL("../tui/", import.meta.url));
	const binaryName = "teamhero-tui";
	const tuiBinary = join(tuiSrcDir, binaryName);

	// Check if already built
	if (await fileExists(tuiBinary)) {
		console.log(`TUI binary already present at ${tuiBinary}.`);
		return;
	}

	// Check if Go source directory exists
	const goModPath = join(tuiSrcDir, "go.mod");
	if (!(await fileExists(goModPath))) {
		console.warn(
			"TUI source directory not found (tui/go.mod missing). Skipping build.",
		);
		return;
	}

	// Check if Go is available
	if (!(await hasGo())) {
		console.warn(
			"Go is not installed. Install Go 1.24+ to build the TUI, or set TEAMHERO_TUI_PATH.",
		);
		return;
	}

	try {
		console.log("Building Go TUI binary...");
		await execFileAsync("go", ["build", "-o", tuiBinary, "."], {
			cwd: tuiSrcDir,
			timeout: 120_000,
		});
		await ensureExecutable(tuiBinary);
		console.log(`TUI binary built at ${tuiBinary}.`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`TUI build failed: ${message}`);
		console.warn("Report will fall back to legacy Gum-based TUI if available.");
	}
}

async function main(): Promise<void> {
	await buildTuiBinary();
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.warn(`Unexpected postinstall error: ${message}`);
});
