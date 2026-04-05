import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import * as osMod from "node:os";
import { homedir } from "node:os";
import { join } from "node:path";

// We need to mock `platform()` from node:os. Since the source calls it as a
// function import, we mock the entire module. We capture `homedir` above
// (before mocking) and list it explicitly to avoid require() inside the
// factory, which creates a circular reference in Bun.
const mockPlatform = mock(() => "linux");

mock.module("node:os", () => ({
	...osMod,
	homedir,
	platform: mockPlatform,
}));

// Import the module under test — must come after mocking
const { configDir, cacheDir } = await import("../../../src/lib/paths.js");

afterAll(() => {
	mock.restore();
});

describe("configDir", () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("uses XDG_CONFIG_HOME when set", () => {
		process.env.XDG_CONFIG_HOME = "/custom/config";
		expect(configDir()).toBe(join("/custom/config", "teamhero"));
	});

	it("uses XDG_CONFIG_HOME regardless of platform", () => {
		process.env.XDG_CONFIG_HOME = "/xdg/config";
		mockPlatform.mockReturnValue("darwin");
		expect(configDir()).toBe(join("/xdg/config", "teamhero"));
	});

	it("uses Library/Preferences on darwin when XDG not set", () => {
		delete process.env.XDG_CONFIG_HOME;
		mockPlatform.mockReturnValue("darwin");
		const home = homedir();
		expect(configDir()).toBe(join(home, "Library", "Preferences", "teamhero"));
	});

	it("uses .config on linux when XDG not set", () => {
		delete process.env.XDG_CONFIG_HOME;
		mockPlatform.mockReturnValue("linux");
		const home = homedir();
		expect(configDir()).toBe(join(home, ".config", "teamhero"));
	});

	it("uses .config on non-darwin/non-darwin platforms when XDG not set", () => {
		delete process.env.XDG_CONFIG_HOME;
		mockPlatform.mockReturnValue("win32");
		const home = homedir();
		expect(configDir()).toBe(join(home, ".config", "teamhero"));
	});
});

describe("cacheDir", () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("uses XDG_CACHE_HOME when set", () => {
		process.env.XDG_CACHE_HOME = "/custom/cache";
		expect(cacheDir()).toBe(join("/custom/cache", "teamhero"));
	});

	it("uses XDG_CACHE_HOME regardless of platform", () => {
		process.env.XDG_CACHE_HOME = "/xdg/cache";
		mockPlatform.mockReturnValue("darwin");
		expect(cacheDir()).toBe(join("/xdg/cache", "teamhero"));
	});

	it("uses Library/Caches on darwin when XDG not set", () => {
		delete process.env.XDG_CACHE_HOME;
		mockPlatform.mockReturnValue("darwin");
		const home = homedir();
		expect(cacheDir()).toBe(join(home, "Library", "Caches", "teamhero"));
	});

	it("uses .cache on linux when XDG not set", () => {
		delete process.env.XDG_CACHE_HOME;
		mockPlatform.mockReturnValue("linux");
		const home = homedir();
		expect(cacheDir()).toBe(join(home, ".cache", "teamhero"));
	});

	it("uses .cache on non-darwin platforms when XDG not set", () => {
		delete process.env.XDG_CACHE_HOME;
		mockPlatform.mockReturnValue("freebsd");
		const home = homedir();
		expect(cacheDir()).toBe(join(home, ".cache", "teamhero"));
	});
});
