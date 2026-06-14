/**
 * Code-vs-data line-of-code filtering.
 *
 * Raw LoC counts every changed line; code LoC excludes checked-in data and
 * generated artifacts so a single week of JSON/CSV/tokenizer files can't inflate
 * a contributor to ~1.16M lines. The exclusion set lives here, in one place, so
 * it can evolve. See `docs/issues/05-code-loc-filtering.md` and ADR-0001.
 */

/**
 * Gitignore-style globs for files excluded from code LoC. A pattern without a
 * slash matches a basename anywhere; a pattern with a slash (or `**`) matches
 * against the full path.
 */
export const CODE_LOC_EXCLUDE_GLOBS: readonly string[] = [
	// Data / serialized formats
	"*.csv",
	"*.json",
	"*.txt",
	"*.ipynb",
	// Lockfiles
	"*.lock",
	"uv.lock",
	"pnpm-lock.yaml",
	// Tokenizers and binary model artifacts
	"*tokenizer*",
	"*.bin",
	"*.onnx",
	"*.pt",
	"*.safetensors",
	"*.h5",
	"*.gguf",
	"*.pb",
	"*.tflite",
	// Vendored OpenAPI / Swagger specs
	"**/openapi*.yaml",
	"**/openapi*.yml",
	"**/swagger*.yaml",
	"**/swagger*.yml",
	// EF Core generated migration designer files
	"**/migrations/*.Designer.cs",
];

/** Compile a gitignore-ish glob to an anchored RegExp (`*` = non-slash, `**` = any). */
function globToRegex(glob: string): RegExp {
	let re = "^";
	let i = 0;
	while (i < glob.length) {
		if (glob.startsWith("**/", i)) {
			re += "(?:.*/)?";
			i += 3;
		} else if (glob.startsWith("**", i)) {
			re += ".*";
			i += 2;
		} else if (glob[i] === "*") {
			re += "[^/]*";
			i += 1;
		} else {
			const c = glob[i];
			re += /[.*+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
			i += 1;
		}
	}
	return new RegExp(`${re}$`);
}

/** True when `filePath` matches `glob` (basename for slashless globs, else full path). */
export function matchesGlob(filePath: string, glob: string): boolean {
	const normalized = filePath.replace(/^\.\//, "");
	const target = glob.includes("/")
		? normalized
		: (normalized.split("/").pop() ?? normalized);
	return globToRegex(glob).test(target);
}

/** True when a file is data/generated and must be excluded from code LoC. */
export function isExcludedFromCodeLoc(filePath: string): boolean {
	return CODE_LOC_EXCLUDE_GLOBS.some((glob) => matchesGlob(filePath, glob));
}

/** A per-file line change as reported by the GitHub commit/compare file stats. */
export interface FileLineChange {
	path: string;
	additions: number;
	deletions: number;
}

/** Raw (all files) vs code (data/generated excluded) line totals. */
export interface LocSplit {
	rawAdditions: number;
	rawDeletions: number;
	codeAdditions: number;
	codeDeletions: number;
}

/**
 * Sum a set of file changes into raw and code line totals. Raw includes every
 * file; code excludes anything matched by {@link isExcludedFromCodeLoc}.
 */
export function splitLoc(files: Iterable<FileLineChange>): LocSplit {
	const split: LocSplit = {
		rawAdditions: 0,
		rawDeletions: 0,
		codeAdditions: 0,
		codeDeletions: 0,
	};
	for (const file of files) {
		split.rawAdditions += file.additions;
		split.rawDeletions += file.deletions;
		if (!isExcludedFromCodeLoc(file.path)) {
			split.codeAdditions += file.additions;
			split.codeDeletions += file.deletions;
		}
	}
	return split;
}
