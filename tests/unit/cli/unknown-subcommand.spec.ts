import { describe, expect, it, mock } from "bun:test";
import { createConsola } from "consola";
import { run } from "../../../src/cli/index.js";

function makeDeps(loggerErrorSpy: ReturnType<typeof mock>) {
	const logger = createConsola({ level: 0 });
	logger.error = loggerErrorSpy as unknown as typeof logger.error;
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
		logger,
	};
}

describe("teamhero CLI rejects unknown subcommands", () => {
	it("logs an actionable error when given an unknown subcommand", async () => {
		const errorSpy = mock(() => {});
		const deps = makeDeps(errorSpy);
		const exitSpy = mock((_code?: number) => {
			throw new Error("__exit__");
		});
		const originalExit = process.exit;
		process.exit = exitSpy as unknown as typeof process.exit;

		try {
			await run(["node", "teamhero", "definitely-not-a-command"], deps).catch(
				() => {},
			);
		} finally {
			process.exit = originalExit;
		}

		expect(exitSpy).toHaveBeenCalled();
		const calledWith = exitSpy.mock.calls[0]?.[0];
		expect(calledWith).not.toBe(0);
		expect(errorSpy).toHaveBeenCalled();
		const errorMessage = String(errorSpy.mock.calls[0]?.[0] ?? "");
		expect(errorMessage).toContain("definitely-not-a-command");
	});

	it("does not reject when no subcommand is given (top-level invocation)", async () => {
		const errorSpy = mock(() => {});
		const deps = makeDeps(errorSpy);
		const exitSpy = mock((_code?: number) => {
			throw new Error("__exit__");
		});
		const originalExit = process.exit;
		process.exit = exitSpy as unknown as typeof process.exit;

		try {
			// `teamhero --help` lets commander print top-level help and exit 0.
			// We just want to confirm the unknown-subcommand guard is not triggered.
			await run(["node", "teamhero", "--help"], deps).catch(() => {});
		} finally {
			process.exit = originalExit;
		}

		const errorCalls = errorSpy.mock.calls.map((c) => String(c[0] ?? ""));
		const unknownSubcommandError = errorCalls.find((m) =>
			m.toLowerCase().includes("unknown"),
		);
		expect(unknownSubcommandError).toBeUndefined();
	});

	it("does not reject known subcommands at the guard stage", async () => {
		const errorSpy = mock(() => {});
		const deps = makeDeps(errorSpy);
		// We don't want spawnTui to actually fire; force an exit that bypasses it.
		const exitSpy = mock((_code?: number) => {
			throw new Error("__exit__");
		});
		const originalExit = process.exit;
		process.exit = exitSpy as unknown as typeof process.exit;

		const knownSubcommands = ["report", "setup", "doctor", "interview"];

		try {
			for (const sub of knownSubcommands) {
				errorSpy.mockClear();
				await run(["node", "teamhero", sub, "--help"], deps).catch(() => {});
				const errorCalls = errorSpy.mock.calls.map((c) => String(c[0] ?? ""));
				const unknownSubcommandError = errorCalls.find((m) =>
					m.toLowerCase().includes("unknown subcommand"),
				);
				expect(unknownSubcommandError).toBeUndefined();
			}
		} finally {
			process.exit = originalExit;
		}
	});
});
