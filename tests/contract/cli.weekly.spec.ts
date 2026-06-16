process.env.TEAMHERO_TEST_MODE = "1";
process.env.XDG_CONFIG_HOME = `/tmp/teamhero-test-${Math.random().toString(36).slice(2)}`;

import { describe, expect, it } from "bun:test";
import { type CliDependencies, createCli } from "../../src/cli/index.js";
import { useHeadlessEnv } from "../helpers/headless.js";
import { createTestLogger } from "../helpers/logger.js";

useHeadlessEnv();

const { instance: logger } = createTestLogger();

function getWeekly() {
	const deps: CliDependencies = {
		auth: {
			async ensureAuthenticated() {
				return { authenticated: true, provider: "token", message: "ok" };
			},
			async login() {
				return { authenticated: true, provider: "token", message: "ok" };
			},
		},
		logger,
	};
	const program = createCli(deps, { exitOverride: true });
	return program.commands.find((cmd) => cmd.name() === "weekly");
}

describe("teamhero weekly command", () => {
	it("is registered with a description", () => {
		const command = getWeekly();
		expect(command).toBeDefined();
		expect(command?.description()).toContain("tracking spreadsheet");
	});

	it("exposes the expected flags", () => {
		const longs = (getWeekly()?.options ?? []).map((o) => o.long);
		for (const flag of [
			"--org",
			"--since",
			"--until",
			"--workbook",
			"--week-index",
			"--month",
			"--dry-run",
			"--reconcile-only",
		]) {
			expect(longs).toContain(flag);
		}
	});

	it("marks --org/--since/--until required and --dry-run/--reconcile-only optional", () => {
		const options = getWeekly()?.options ?? [];
		const required = options
			.filter((o) => o.required || o.mandatory)
			.map((o) => o.long);
		expect(required).toEqual(
			expect.arrayContaining(["--org", "--since", "--until"]),
		);
		const dryRun = options.find((o) => o.long === "--dry-run");
		expect(dryRun?.mandatory).toBeFalsy();
	});
});
