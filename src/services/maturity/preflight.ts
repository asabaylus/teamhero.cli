import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { getEnv } from "../../lib/env.js";
import type { EvidenceTier } from "./types.js";

/**
 * Choose the evidence-fidelity tier the system should operate at.
 *
 * Detection precedence (highest → lowest): explicit `override` (unless `"auto"`), authenticated `gh` CLI, `TEAMHERO_GITHUB_MCP="1"`, then git-only fallback.
 *
 * @param cwd - Working directory used when probing for a Git repository
 * @param override - Explicit tier to use or `"auto"` to perform detection
 * @returns The selected evidence tier: `'gh'`, `'github-mcp'`, or `'git-only'`
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

/**
 * Determines whether the given directory appears to be a Git repository by checking for a `.git` entry.
 *
 * @param cwd - Filesystem path to the directory to inspect
 * @returns `true` if a `.git` entry exists and is a file or directory, `false` otherwise
 */
async function isGitRepo(cwd: string): Promise<boolean> {
	try {
		const s = await stat(join(cwd, ".git"));
		return s.isDirectory() || s.isFile(); // worktrees use a file
	} catch {
		return false;
	}
}

/**
 * Detects whether the GitHub CLI is installed and currently authenticated.
 *
 * @returns `true` if the `gh` CLI is present and reports an authenticated session, `false` otherwise.
 */
async function ghIsAuthenticated(): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const child = spawn("gh", ["auth", "status"], {
			stdio: ["ignore", "ignore", "ignore"],
		});
		child.on("error", () => resolve(false));
		child.on("close", (code) => resolve(code === 0));
	});
}

/**
 * Provide a human-readable label for an evidence-fidelity tier.
 *
 * @param tier - The evidence tier to describe (`"gh"`, `"github-mcp"`, or `"git-only"`)
 * @returns A descriptive label for `tier` indicating its name and relative fidelity.
 */
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
