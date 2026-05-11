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
 * Recursively collect relative file paths under `root` that match the provided filters.
 *
 * Traversal stops at `options.maxDepth` (default 4) and after collecting `options.limit` matches (default 200).
 * Skips entries listed in `DEFAULT_IGNORES` and symbolic links. If `root` is not a directory or cannot be read, returns an empty array.
 *
 * @param root - The directory to scan; returned paths are relative to this root
 * @param options - Optional filters and limits:
 *   - `maxDepth` — maximum recursion depth
 *   - `nameRegex` — only include files whose basename matches this regex
 *   - `pathContains` — only include files whose lowercased relative path contains at least one of these substrings
 *   - `limit` — maximum number of matches to return
 * @returns An array of matching file paths relative to `root`
 */
export async function findFiles(
	root: string,
	options: FindOptions = {},
): Promise<string[]> {
	const maxDepth = options.maxDepth ?? 4;
	const limit = options.limit ?? 200;
	const matches: string[] = [];

	/**
	 * Recursively traverses a directory subtree and appends relative file paths that satisfy the configured filters to the surrounding `matches` collection.
	 *
	 * Traversal stops when `depth` exceeds the configured maximum, when the match `limit` is reached, or when a directory cannot be read. During iteration this function skips ignored entry names, symbolic links, non-matching file names (when `options.nameRegex` is set), and files whose lowercased relative path does not contain any of the `options.pathContains` needles.
	 *
	 * @param dir - Absolute path of the directory to walk
	 * @param depth - Current recursion depth (root call uses 0)
	 */
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

/**
 * Check whether any file matching the given options exists under `root`.
 *
 * @param root - The directory path to search from
 * @param options - Optional search filters and limits
 * @returns `true` if at least one matching file exists, `false` otherwise.
 */
export async function anyFile(
	root: string,
	options: FindOptions = {},
): Promise<boolean> {
	const found = await findFiles(root, { ...options, limit: 1 });
	return found.length > 0;
}

/**
 * Read a UTF-8 file and return its contents, or `null` if the file cannot be read.
 *
 * @returns The file contents as a UTF-8 string, or `null` if the file does not exist or is unreadable
 */
export async function readIfExists(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return null;
	}
}

/**
 * Determine whether a file's contents match a regular expression.
 *
 * @param path - Filesystem path to the file to test
 * @param pattern - Regular expression to test against the file contents
 * @returns `true` if the file exists and its contents match `pattern`, `false` otherwise
 */
export async function fileContains(
	path: string,
	pattern: RegExp,
): Promise<boolean> {
	const content = await readIfExists(path);
	if (content === null) return false;
	return pattern.test(content);
}

/**
 * Finds the first path whose file contents match a regular expression.
 *
 * @param paths - Ordered list of file paths to check
 * @param pattern - Regular expression to test against each file's contents
 * @returns The first path whose file content matches `pattern`, or `null` if none match
 */
export async function firstFileContaining(
	paths: string[],
	pattern: RegExp,
): Promise<string | null> {
	for (const p of paths) {
		if (await fileContains(p, pattern)) return p;
	}
	return null;
}
