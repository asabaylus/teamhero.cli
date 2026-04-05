#!/usr/bin/env bun
import { join } from "node:path";
/**
 * Discovery service for the Go TUI.
 * Fetches repos, teams, or members from GitHub and outputs JSON on stdout.
 *
 * Usage:
 *   bun run scripts/discover.ts --type repos --org acme [--include-private] [--include-archived]
 *   bun run scripts/discover.ts --type teams --org acme
 *   bun run scripts/discover.ts --type members --org acme
 */
// Load credentials from the canonical config store (~/.config/teamhero/.env),
// overriding any stale shell environment variables.
import { config as dotenvConfig } from "dotenv";
import { configDir } from "../src/lib/paths.js";

dotenvConfig({ path: join(configDir(), ".env"), override: true });

import { GitHubRepoProvider } from "../src/adapters/github/gh-provider.js";
import { loadOctokitFromEnv } from "../src/lib/octokit.js";

function getArg(name: string): string | undefined {
	const idx = process.argv.indexOf(`--${name}`);
	if (idx === -1) return undefined;
	const next = process.argv[idx + 1];
	return next && !next.startsWith("--") ? next : undefined;
}

function hasFlag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
	const queryType = getArg("type");
	const org = getArg("org");

	if (!queryType || !org) {
		process.stderr.write(
			"Usage: discover.ts --type <repos|teams|members> --org <org>\n",
		);
		process.exit(1);
	}

	const octokit = await loadOctokitFromEnv();

	switch (queryType) {
		case "repos": {
			const includePrivate = hasFlag("include-private");
			const includeArchived = hasFlag("include-archived");
			const provider = new GitHubRepoProvider(octokit, {});
			const repos = await provider.listRepositories(org, {
				includePrivate,
				includeArchived,
			});
			process.stdout.write(JSON.stringify(repos));
			break;
		}
		case "teams": {
			const teams = await octokit.paginate(octokit.rest.teams.list, {
				org,
				per_page: 100,
			});
			const result = teams
				.filter((t) => typeof t.slug === "string" && t.slug.length > 0)
				.map((t) => ({ name: t.name || t.slug!, slug: t.slug! }));
			process.stdout.write(JSON.stringify(result));
			break;
		}
		case "members": {
			const members = await octokit.paginate(octokit.rest.orgs.listMembers, {
				org,
				per_page: 100,
				role: "all",
			});
			const logins = members
				.map((m) => m.login)
				.sort((a, b) => a.localeCompare(b));
			process.stdout.write(JSON.stringify(logins));
			break;
		}
		default:
			process.stderr.write(`Unknown discovery type: ${queryType}\n`);
			process.exit(1);
	}
}

await main();
