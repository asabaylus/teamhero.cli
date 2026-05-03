import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { getEnv } from "../../lib/env.js";
import type { EvidenceTier } from "./types.js";

/**
 * Detects which evidence-fidelity tier we can operate at.
 *
 * Order:
 *  1. `gh` CLI in PATH and authenticated → "gh"
 *  2. Hint env var TEAMHERO_GITHUB_MCP=1 (set by the Go TUI when an MCP is wired) → "github-mcp"
 *  3. Anything else → "git-only"
 */
export async function detectTier(
	cwd: string,
	override?: EvidenceTier | "auto",
): Promise<EvidenceTier> {
	if (override && override !== "auto") return override;

	if (await ghIsAuthenticated()) return "gh";

	if (getEnv("TEAMHERO_GITHUB_MCP") === "1") return "github-mcp";

	if (await isGitRepo(cwd)) return "git-only";

	return "git-only";
}

async function isGitRepo(cwd: string): Promise<boolean> {
	try {
		const s = await stat(join(cwd, ".git"));
		return s.isDirectory() || s.isFile(); // worktrees use a file
	} catch {
		return false;
	}
}

async function ghIsAuthenticated(): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const child = spawn("gh", ["auth", "status"], {
			stdio: ["ignore", "ignore", "ignore"],
		});
		child.on("error", () => resolve(false));
		child.on("close", (code) => resolve(code === 0));
	});
}

export function describeTier(tier: EvidenceTier): string {
	switch (tier) {
		case "gh":
			return "Tier 1 — gh CLI authenticated (highest fidelity)";
		case "github-mcp":
			return "Tier 2 — GitHub MCP connected";
		case "git-only":
			return "Tier 3 — git + filesystem only (limited GitHub-side evidence)";
	}
}
