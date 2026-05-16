import { describe, expect, it, mock } from "bun:test";
import { createConsola } from "consola";
import { createCli } from "../../../src/cli/index.js";

function makeDeps() {
	return {
		auth: {
			ensureAuthenticated: mock(async () => ({
				authenticated: true,
				provider: "pat" as const,
				message: "ok",
			})),
			login: mock(async () => ({
				authenticated: true,
				provider: "pat" as const,
				message: "ok",
			})),
		},
		logger: createConsola({ level: 0 }),
	};
}

describe("teamhero interview CLI registration", () => {
	it("registers an `interview` subcommand on the program", () => {
		const program = createCli(makeDeps());
		const command = program.commands.find((c) => c.name() === "interview");
		expect(command).toBeDefined();
	});

	it("the `interview` subcommand has a non-empty description", () => {
		const program = createCli(makeDeps());
		const command = program.commands.find((c) => c.name() === "interview");
		expect(command?.description().length).toBeGreaterThan(0);
	});
});
