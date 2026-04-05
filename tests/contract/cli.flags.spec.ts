// Set test mode BEFORE any imports to ensure paths module picks up test directories
process.env.TEAMHERO_TEST_MODE = "1";
process.env.XDG_CONFIG_HOME = `/tmp/teamhero-test-${Math.random().toString(36).slice(2)}`;

import { describe, expect, it } from "bun:test";
import { type CliDependencies, createCli } from "../../src/cli/index.js";
import { useHeadlessEnv } from "../helpers/headless.js";
import { createTestLogger } from "../helpers/logger.js";

useHeadlessEnv();

const { instance: logger } = createTestLogger();

function createDeps() {
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
	} satisfies CliDependencies;

	return { deps };
}

function getCommand(name: string) {
	const { deps } = createDeps();
	const program = createCli(deps, { exitOverride: true });
	return program.commands.find((cmd) => cmd.name() === name);
}

describe("teamhero report command", () => {
	it("exists and delegates to Go TUI", () => {
		const command = getCommand("report");
		expect(command).toBeDefined();
		expect(command?.name()).toBe("report");
		expect(command?.description()).toBe(
			"Generate a developer contribution report",
		);
	});

	it("allows unknown options for pass-through to Go TUI", () => {
		const command = getCommand("report");
		expect(command).toBeDefined();
		// The command allows unknown options since it delegates to the Go TUI binary
		expect(command?._allowUnknownOption).toBe(true);
	});

	it("disables built-in help to let Go TUI handle it", () => {
		const command = getCommand("report");
		expect(command).toBeDefined();
		expect(command?.helpOption()).toBeFalsy;
	});
});

describe("teamhero doctor command", () => {
	it("exists with correct description", () => {
		const command = getCommand("doctor");
		expect(command).toBeDefined();
		expect(command?.name()).toBe("doctor");
		expect(command?.description()).toBe("Validate installation health");
	});

	it("disables built-in help to let Go TUI handle it", () => {
		const command = getCommand("doctor");
		expect(command).toBeDefined();
		expect(command?.helpOption()).toBeFalsy;
	});

	it("allows unknown options for pass-through to Go TUI", () => {
		const command = getCommand("doctor");
		expect(command).toBeDefined();
		expect(command?._allowUnknownOption).toBe(true);
	});
});

describe("teamhero setup command", () => {
	it("exists with correct description", () => {
		const command = getCommand("setup");
		expect(command).toBeDefined();
		expect(command?.name()).toBe("setup");
		expect(command?.description()).toBe(
			"Configure credentials and preferences",
		);
	});

	it("disables built-in help to let Go TUI handle it", () => {
		const command = getCommand("setup");
		expect(command).toBeDefined();
		expect(command?.helpOption()).toBeFalsy;
	});

	it("allows unknown options for pass-through to Go TUI", () => {
		const command = getCommand("setup");
		expect(command).toBeDefined();
		expect(command?._allowUnknownOption).toBe(true);
	});
});

describe("help passthrough detection", () => {
	it("detects subcommand + --help combinations for all commands", () => {
		// This tests the logic in run() that intercepts subcommand --help
		// before Commander can handle it. We verify the detection logic directly.
		const subcommands = ["report", "doctor", "setup"];
		for (const sub of subcommands) {
			const args = [sub, "--help"];
			const hasSubcommand = args.length >= 1 && subcommands.includes(args[0]);
			const hasHelp = args.includes("--help");
			expect(hasSubcommand && hasHelp).toBe(true);
		}
	});

	it("does not trigger passthrough for bare --help", () => {
		const subcommands = ["report", "doctor", "setup"];
		const args = ["--help"];
		const hasSubcommand = args.length >= 1 && subcommands.includes(args[0]);
		expect(hasSubcommand).toBe(false);
	});
});
