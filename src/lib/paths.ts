import { homedir, platform } from "node:os";
import { join } from "node:path";

const APP_NAME = "teamhero";

/**
 * Config directory for teamhero — matches Go's configDir() exactly.
 * Uses XDG_CONFIG_HOME if set, otherwise platform defaults.
 */
export function configDir(): string {
	const xdg = process.env.XDG_CONFIG_HOME;
	if (xdg) {
		return join(xdg, APP_NAME);
	}
	const home = homedir();
	if (platform() === "darwin") {
		return join(home, "Library", "Preferences", APP_NAME);
	}
	return join(home, ".config", APP_NAME);
}

/**
 * Cache directory for teamhero.
 * Uses XDG_CACHE_HOME if set, otherwise platform defaults.
 */
export function cacheDir(): string {
	const xdg = process.env.XDG_CACHE_HOME;
	if (xdg) {
		return join(xdg, APP_NAME);
	}
	const home = homedir();
	if (platform() === "darwin") {
		return join(home, "Library", "Caches", APP_NAME);
	}
	return join(home, ".cache", APP_NAME);
}
