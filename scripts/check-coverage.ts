/**
 * Parses bun test --coverage lcov output and enforces thresholds.
 * Handles merged lcov files where the same source file appears multiple times
 * (from per-file test isolation) by deduplicating records per source file.
 * Exits non-zero if coverage falls below configured minimums.
 *
 * Non-executable line filtering: Bun's lcov instrumentation reports blank
 * lines, comment lines, lone braces, and TypeScript type annotation
 * continuations as executable lines. These are excluded from the count
 * since they cannot meaningfully be covered by tests.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Returns true if a source line is non-executable and should be excluded
 * from line coverage counts (blank lines, comments, lone braces, type
 * annotation continuations that Bun incorrectly instruments).
 */
function isNonExecutable(content: string): boolean {
	const t = content.trim();
	if (t === "") return true;
	if (t.startsWith("//") || t.startsWith("*") || t === "/**") return true;
	if (/^[{}\[\]);,]+$/.test(t)) return true;
	if (t.startsWith("|") || t.startsWith("&")) return true;
	return false;
}

const sourceLines = new Map<string, string[]>();

function getSourceLines(filePath: string): string[] {
	if (sourceLines.has(filePath)) return sourceLines.get(filePath)!;
	try {
		const content = readFileSync(filePath, "utf-8");
		const lines = content.split("\n");
		sourceLines.set(filePath, lines);
		return lines;
	} catch {
		sourceLines.set(filePath, []);
		return [];
	}
}

const THRESHOLDS = {
	lines: 85,
	functions: 85,
	branches: 80,
	statements: 85,
};

const lcovPath = join("coverage", "lcov.info");

let lcovContent: string;
try {
	lcovContent = readFileSync(lcovPath, "utf-8");
} catch {
	console.error(
		`Could not read ${lcovPath}. Run: bun test --coverage --coverage-reporter=lcov`,
	);
	process.exit(1);
}

// Parse lcov into per-source-file records, merging duplicates
interface FileData {
	lines: Map<number, number>; // line -> max hit count
	fnf: number; // total functions (take max across records)
	fnh: number; // hit functions (take max across records)
	brf: number; // total branches (take max)
	brh: number; // hit branches (take max)
}

const files = new Map<string, FileData>();
let currentFile: string | null = null;
let currentData: FileData | null = null;
let recordFnf = 0;
let recordFnh = 0;
let recordBrf = 0;
let recordBrh = 0;

function flushRecord() {
	if (!currentFile || !currentData) return;
	// Merge function/branch counts: take max per record
	currentData.fnf = Math.max(currentData.fnf, recordFnf);
	currentData.fnh = Math.max(currentData.fnh, recordFnh);
	currentData.brf = Math.max(currentData.brf, recordBrf);
	currentData.brh = Math.max(currentData.brh, recordBrh);
}

for (const line of lcovContent.split("\n")) {
	if (line.startsWith("SF:")) {
		// Flush previous record
		flushRecord();

		const sf = line.slice(3);
		currentFile = sf;
		if (!files.has(sf)) {
			files.set(sf, { lines: new Map(), fnf: 0, fnh: 0, brf: 0, brh: 0 });
		}
		currentData = files.get(sf)!;
		recordFnf = 0;
		recordFnh = 0;
		recordBrf = 0;
		recordBrh = 0;
	} else if (line.startsWith("DA:") && currentData) {
		const parts = line.slice(3).split(",");
		const lineNo = Number(parts[0]);
		const hits = Number(parts[1]);
		// Take max hits across all records for this line
		const existing = currentData.lines.get(lineNo) ?? 0;
		currentData.lines.set(lineNo, Math.max(existing, hits));
	} else if (line.startsWith("FNF:")) {
		recordFnf = Number(line.slice(4));
	} else if (line.startsWith("FNH:")) {
		recordFnh = Number(line.slice(4));
	} else if (line.startsWith("BRF:")) {
		recordBrf = Number(line.slice(4));
	} else if (line.startsWith("BRH:")) {
		recordBrh = Number(line.slice(4));
	} else if (line === "end_of_record") {
		flushRecord();
		currentFile = null;
		currentData = null;
	}
}
// Flush any trailing record
flushRecord();

// Compute totals from deduplicated data
let totalLines = 0;
let hitLines = 0;
let totalFunctions = 0;
let hitFunctions = 0;
let totalBranches = 0;
let hitBranches = 0;

for (const [filePath, data] of files) {
	const srcLines = getSourceLines(filePath);
	for (const [lineNo, hits] of data.lines) {
		const content = srcLines[lineNo - 1] ?? "";
		if (isNonExecutable(content)) continue;
		totalLines++;
		if (hits > 0) hitLines++;
	}
	totalFunctions += data.fnf;
	hitFunctions += data.fnh;
	totalBranches += data.brf;
	hitBranches += data.brh;
}

const pct = (hit: number, total: number) =>
	total === 0 ? 100 : Math.round((hit / total) * 10000) / 100;

const results = {
	lines: pct(hitLines, totalLines),
	functions: pct(hitFunctions, totalFunctions),
	branches: pct(hitBranches, totalBranches),
	statements: pct(hitLines, totalLines), // lcov treats statements as lines
};

console.log(
	`\nCoverage (${files.size} source files, deduplicated, non-executable lines excluded):`,
);
let failed = false;
for (const [metric, threshold] of Object.entries(THRESHOLDS)) {
	const actual = results[metric as keyof typeof results];
	const status = actual >= threshold ? "PASS" : "FAIL";
	console.log(`${status}: ${metric} ${actual}% (threshold: ${threshold}%)`);
	if (actual < threshold) failed = true;
}

if (failed) {
	process.exit(1);
}
