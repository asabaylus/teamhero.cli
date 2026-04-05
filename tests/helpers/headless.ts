import { afterAll, beforeAll } from "bun:test";

export function useHeadlessEnv(): void {
	const original = process.env.TEAMHERO_HEADLESS;

	beforeAll(() => {
		process.env.TEAMHERO_HEADLESS = "1";
	});

	afterAll(() => {
		if (typeof original === "undefined") {
			delete process.env.TEAMHERO_HEADLESS;
		} else {
			process.env.TEAMHERO_HEADLESS = original;
		}
	});
}

/**
 * Isolates tests from user's saved config and cache by using test-specific directories.
 * This ensures tests run with clean defaults without affecting the user's actual data.
 *
 * IMPORTANT: This sets TEAMHERO_TEST_MODE which the CLI checks to skip loading/saving config.
 * It also sets XDG_CACHE_HOME to point to a test-specific cache directory.
 * Tests get predictable, clean defaults while user's config and cache remain untouched.
 */
export function useCleanConfig(): void {
	const originalTestMode = process.env.TEAMHERO_TEST_MODE;
	const originalCacheHome = process.env.XDG_CACHE_HOME;
	const originalAppData = process.env.APPDATA;
	const originalLocalAppData = process.env.LOCALAPPDATA;

	beforeAll(() => {
		// Signal to CLI that we're in test mode - skip loading/saving config
		process.env.TEAMHERO_TEST_MODE = "1";

		// Use test-specific cache directory to prevent cache pollution
		const testCacheDir = `/tmp/teamhero-test-cache-${Math.random().toString(36).slice(2)}`;
		process.env.XDG_CACHE_HOME = testCacheDir;
		process.env.APPDATA = testCacheDir;
		process.env.LOCALAPPDATA = testCacheDir;
	});

	afterAll(() => {
		// Restore original state
		if (typeof originalTestMode === "undefined") {
			delete process.env.TEAMHERO_TEST_MODE;
		} else {
			process.env.TEAMHERO_TEST_MODE = originalTestMode;
		}

		if (typeof originalCacheHome === "undefined") {
			delete process.env.XDG_CACHE_HOME;
		} else {
			process.env.XDG_CACHE_HOME = originalCacheHome;
		}

		if (typeof originalAppData === "undefined") {
			delete process.env.APPDATA;
		} else {
			process.env.APPDATA = originalAppData;
		}

		if (typeof originalLocalAppData === "undefined") {
			delete process.env.LOCALAPPDATA;
		} else {
			process.env.LOCALAPPDATA = originalLocalAppData;
		}
	});
}
