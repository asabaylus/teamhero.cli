#!/usr/bin/env bun

// CLI entry for `teamhero interview cohort`. Spawned by the Go TUI.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { consola } from "consola";
import { writeCohortSummary } from "../src/services/interview/cohort/cohort-summary.js";

interface Flags {
	role?: string;
	roleDir?: string;
	order?: "alphabetical" | "chronological";
}

function parseFlags(argv: readonly string[]): Flags {
	const out: Flags = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--role" && i + 1 < argv.length) {
			out.role = argv[i + 1];
			i++;
		} else if (a === "--role-dir" && i + 1 < argv.length) {
			out.roleDir = argv[i + 1];
			i++;
		} else if (a === "--order" && i + 1 < argv.length) {
			const v = argv[i + 1];
			if (v === "alphabetical" || v === "chronological") out.order = v;
			i++;
		}
	}
	return out;
}

async function main() {
	const flags = parseFlags(process.argv.slice(2));
	if (!flags.role) {
		consola.error("Missing required flag: --role <slug>");
		process.exit(1);
	}
	const roleDir =
		flags.roleDir ?? join(process.cwd(), "docs", "interviews", flags.role);
	if (!existsSync(roleDir)) {
		consola.error(`Role directory does not exist: ${roleDir}`);
		process.exit(1);
	}
	const out = writeCohortSummary({
		roleDir,
		roleSlug: flags.role,
		order: flags.order,
	});
	consola.success(
		`COHORT.md written for ${out.recordCount} candidate(s): ${out.path}`,
	);
}

main().catch((err) => {
	consola.error(err);
	process.exit(1);
});
