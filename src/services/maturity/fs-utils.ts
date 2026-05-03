import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const DEFAULT_IGNORES = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	"out",
	".next",
	".turbo",
	".cache",
	"target", // rust
	"vendor", // go vendored
	"coverage",
]);

export interface FindOptions {
	/** Maximum directory depth (default 4). */
	maxDepth?: number;
	/** Only return file names (basename) matching this regex when set. */
	nameRegex?: RegExp;
	/** Only return paths whose lowercased relative form contains one of these substrings. */
	pathContains?: string[];
	/** Maximum number of matches to return (default 200). */
	limit?: number;
}

/**
 * Walk a directory tree and return matching file paths (relative to root).
 * Skips DEFAULT_IGNORES entries and symlinks.
 */
export async function findFiles(
	root: string,
	options: FindOptions = {},
): Promise<string[]> {
	const maxDepth = options.maxDepth ?? 4;
	const limit = options.limit ?? 200;
	const matches: string[] = [];

	async function walk(dir: string, depth: number): Promise<void> {
		if (depth > maxDepth || matches.length >= limit) return;
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (matches.length >= limit) return;
			if (DEFAULT_IGNORES.has(entry.name)) continue;
			if (entry.isSymbolicLink()) continue;
			const abs = join(dir, entry.name);
			const rel = relative(root, abs);
			const lowerRel = rel.toLowerCase().replace(/\\/g, "/");
			if (entry.isDirectory()) {
				await walk(abs, depth + 1);
				continue;
			}
			if (options.nameRegex && !options.nameRegex.test(entry.name)) continue;
			if (options.pathContains) {
				const hit = options.pathContains.some((needle) =>
					lowerRel.includes(needle.toLowerCase()),
				);
				if (!hit) continue;
			}
			matches.push(rel);
		}
	}

	try {
		const s = await stat(root);
		if (!s.isDirectory()) return [];
	} catch {
		return [];
	}

	await walk(root, 0);
	return matches;
}

/** Convenience: does any file matching options exist? */
export async function anyFile(
	root: string,
	options: FindOptions = {},
): Promise<boolean> {
	const found = await findFiles(root, { ...options, limit: 1 });
	return found.length > 0;
}

/** Read a file or return null if it doesn't exist / can't be read. */
export async function readIfExists(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return null;
	}
}

/**
 * Check whether the file content matches a regex. Returns true if the file
 * exists AND contains a match.
 */
export async function fileContains(
	path: string,
	pattern: RegExp,
): Promise<boolean> {
	const content = await readIfExists(path);
	if (content === null) return false;
	return pattern.test(content);
}

/** Look for a substring across many candidate files; return first hit's path. */
export async function firstFileContaining(
	paths: string[],
	pattern: RegExp,
): Promise<string | null> {
	for (const p of paths) {
		if (await fileContains(p, pattern)) return p;
	}
	return null;
}
