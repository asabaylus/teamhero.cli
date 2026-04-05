import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import { promisify } from "node:util";

// We mock `node:fs/promises` access and `node:child_process` execFile at the
// module level so they take effect before tui-resolver.ts is imported.
// We import the real modules before mocking and spread their exports explicitly
// to avoid require() inside the mock.module factory, which creates a circular
// reference in Bun.

import * as childProcess from "node:child_process";
import * as fsPromises from "node:fs/promises";

const mockAccess = mock<(path: string, mode?: number) => Promise<void>>();

// The promisified version that `which()` actually calls internally.
// We expose this so each test can configure it.
const mockExecFileAsync =
	mock<
		(cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
	>();

// Build a callback-style execFile that also has a custom promisify symbol
// so that `promisify(execFile)` returns our async mock.
function makeMockExecFile() {
	const fn = mock();
	(fn as any)[promisify.custom] = mockExecFileAsync;
	return fn;
}

mock.module("node:fs/promises", () => ({
	...fsPromises,
	access: (...args: Parameters<typeof fsPromises.access>) =>
		mockAccess(args[0] as string, args[1] as number | undefined),
}));

mock.module("node:child_process", () => ({
	...childProcess,
	execFile: makeMockExecFile(),
}));

// Import after mocking
const { resolveTuiBinary } = await import("../../../src/lib/tui-resolver.js");

afterAll(() => {
	mock.restore();
});

// Store the original env so we can restore it
const savedTuiPath = process.env.TEAMHERO_TUI_PATH;

describe("resolveTuiBinary", () => {
	beforeEach(() => {
		delete process.env.TEAMHERO_TUI_PATH;
		mockAccess.mockReset();
		mockExecFileAsync.mockReset();
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
