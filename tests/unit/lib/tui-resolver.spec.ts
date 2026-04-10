import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";

// We spy on the real Node built-ins instead of using mock.module() because
// Bun's built-in module replacement can become order-dependent once another
// spec has already imported src/cli/index.js, which loads tui-resolver.ts.

import * as childProcess from "node:child_process";
import * as fsPromises from "node:fs/promises";

const mockAccess = mock<(path: string, mode?: number) => Promise<void>>();

// We keep an async mock so each test can configure the "which" result, then
// adapt it to the callback shape that node:util.promisify() expects.
const mockExecFileAsync =
	mock<
		(cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
	>();

function makeMockExecFile() {
	return mock(
		(
			command: string,
			args: string[],
			callback?: (error: Error | null, stdout: string, stderr: string) => void,
		) => {
			void mockExecFileAsync(command, args)
				.then(({ stdout, stderr }) => {
					callback?.(null, stdout, stderr);
				})
				.catch((error) => {
					callback?.(
						error instanceof Error ? error : new Error(String(error)),
						"",
						"",
					);
				});
		},
	);
}

const accessSpy = spyOn(fsPromises, "access").mockImplementation(
	(...args: Parameters<typeof fsPromises.access>) =>
		mockAccess(args[0] as string, args[1] as number | undefined),
);
const execFileSpy = spyOn(childProcess, "execFile").mockImplementation(
	makeMockExecFile() as any,
);

let loadCount = 0;

async function loadResolver() {
	return import(
		new URL(
			`../../../src/lib/tui-resolver.ts?tui-resolver-spec=${++loadCount}`,
			import.meta.url,
		).href
	);
}

let resolveTuiBinary: typeof import("../../../src/lib/tui-resolver.ts").resolveTuiBinary;

afterAll(() => {
	mock.restore();
});

// Store the original env so we can restore it
const savedTuiPath = process.env.TEAMHERO_TUI_PATH;

describe("resolveTuiBinary", () => {
	beforeEach(async () => {
		delete process.env.TEAMHERO_TUI_PATH;
		mockAccess.mockReset();
		mockExecFileAsync.mockReset();
		accessSpy.mockImplementation(
			(...args: Parameters<typeof fsPromises.access>) =>
				mockAccess(args[0] as string, args[1] as number | undefined),
		);
		execFileSpy.mockImplementation(makeMockExecFile() as any);
		({ resolveTuiBinary } = await loadResolver());
	});

	afterEach(() => {
		if (savedTuiPath !== undefined) {
			process.env.TEAMHERO_TUI_PATH = savedTuiPath;
		} else {
			delete process.env.TEAMHERO_TUI_PATH;
		}
	});

	describe("env override (TEAMHERO_TUI_PATH)", () => {
		it("returns env path when set and executable", async () => {
			process.env.TEAMHERO_TUI_PATH = "/custom/bin/tui";

			// access(X_OK) succeeds for the env path
			mockAccess.mockImplementation(async (path: string) => {
				if (path === "/custom/bin/tui") return;
				throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			});

			const result = await resolveTuiBinary();
			expect(result).toBe("/custom/bin/tui");
		});

		it("falls through when env path is set but not executable", async () => {
			process.env.TEAMHERO_TUI_PATH = "/custom/bin/not-exec";

			// access always fails (nothing executable)
			mockAccess.mockRejectedValue(
				Object.assign(new Error("EACCES"), { code: "EACCES" }),
			);

			// which also fails
			mockExecFileAsync.mockRejectedValue(new Error("not found"));

			const result = await resolveTuiBinary();
			expect(result).toBeNull();
		});

		it("falls through when env path does not exist", async () => {
			process.env.TEAMHERO_TUI_PATH = "/nonexistent/path/tui";

			// access always fails
			mockAccess.mockRejectedValue(
				Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
			);

			// which also fails
			mockExecFileAsync.mockRejectedValue(new Error("not found"));

			const result = await resolveTuiBinary();
			expect(result).toBeNull();
		});
	});

	describe("canonical build path", () => {
		it("returns canonical path when it exists and is executable", async () => {
			delete process.env.TEAMHERO_TUI_PATH;

			// Let the canonical path pass — it contains "tui/teamhero-tui"
			mockAccess.mockImplementation(async (path: string) => {
				if (path.includes("tui/teamhero-tui")) return;
				throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			});

			const result = await resolveTuiBinary();
			expect(result).not.toBeNull();
			expect(result!).toContain("tui/teamhero-tui");
		});

		it("falls through when canonical path is not executable", async () => {
			delete process.env.TEAMHERO_TUI_PATH;

			// access always fails
			mockAccess.mockRejectedValue(
				Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
			);

			// which also fails
			mockExecFileAsync.mockRejectedValue(new Error("not found"));

			const result = await resolveTuiBinary();
			expect(result).toBeNull();
		});
	});

	describe("system PATH fallback", () => {
		it("returns system binary when found via which and is executable", async () => {
			delete process.env.TEAMHERO_TUI_PATH;

			// access succeeds only for the system binary path
			mockAccess.mockImplementation(async (path: string) => {
				if (path === "/usr/local/bin/teamhero-tui") return;
				throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			});

			// which returns the system path
			mockExecFileAsync.mockResolvedValue({
				stdout: "/usr/local/bin/teamhero-tui\n",
				stderr: "",
			});

			const result = await resolveTuiBinary();
			expect(result).toBe("/usr/local/bin/teamhero-tui");
		});

		it("returns null when which finds a binary but it is not executable", async () => {
			delete process.env.TEAMHERO_TUI_PATH;

			// access always fails (nothing executable)
			mockAccess.mockRejectedValue(
				Object.assign(new Error("EACCES"), { code: "EACCES" }),
			);

			// which returns a path, but access will reject it
			mockExecFileAsync.mockResolvedValue({
				stdout: "/usr/local/bin/teamhero-tui\n",
				stderr: "",
			});

			const result = await resolveTuiBinary();
			expect(result).toBeNull();
		});

		it("returns null when which returns empty stdout", async () => {
			delete process.env.TEAMHERO_TUI_PATH;

			// access always fails
			mockAccess.mockRejectedValue(
				Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
			);

			// which returns empty string — which() should return null
			mockExecFileAsync.mockResolvedValue({
				stdout: "",
				stderr: "",
			});

			const result = await resolveTuiBinary();
			expect(result).toBeNull();
		});
	});

	describe("none found", () => {
		it("returns null when nothing is found in any location", async () => {
			delete process.env.TEAMHERO_TUI_PATH;

			// access always fails
			mockAccess.mockRejectedValue(
				Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
			);

			// which fails
			mockExecFileAsync.mockRejectedValue(new Error("not found"));

			const result = await resolveTuiBinary();
			expect(result).toBeNull();
		});
	});
});
