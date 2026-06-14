import ExcelJS from "exceljs";
import type { PersonMetrics } from "./person-metrics.js";

/**
 * Write reconciled per-Person metrics into the tracking workbook's "Data" sheet
 * for the operator to re-upload (direct cloud write is out of scope). Pure-ish:
 * the only side effect is reading/writing the workbook file. Tickets are never
 * touched; re-running the same week overwrites rather than duplicates.
 * See `docs/issues/07-spreadsheet-writer.md`.
 */

const DATA_START_ROW = 3;
const LOGIN_COL = 12; // column L
const FIRST_MONTH_COL = 35; // column AI — monthly commit columns go right of Notes (AH)

// One PR / Tickets / LoC triplet per week; Tickets columns are left untouched.
const PR_COLS = ["M", "P", "S", "V", "Y", "AB"] as const;
const LOC_COLS = ["O", "R", "U", "X", "AA", "AD"] as const;
const TOTAL_PR_COL = "AE";
const TOTAL_LOC_COL = "AG";

export interface WriteWeeklyOptions {
	/** Which weekly block to write (0–5). */
	weekIndex: number;
	/** Calendar month (`YYYY-MM`) whose commit count fills the monthly column. */
	monthKey: string;
	/** Where to write; defaults to overwriting `workbookPath`. */
	outPath?: string;
}

/** Total tracked PRs for the weekly column: org-wide, all states (per glossary). */
function totalPrs(p: PersonMetrics): number {
	return p.prsMerged + p.prsClosedUnmerged + p.prsOpen;
}

function numericValue(value: ExcelJS.CellValue): number {
	if (typeof value === "number") return value;
	if (value && typeof value === "object" && "result" in value) {
		const r = (value as { result?: unknown }).result;
		return typeof r === "number" ? r : 0;
	}
	return 0;
}

function sumColumns(
	row: ExcelJS.Row,
	letters: readonly string[],
	colIndex: (letter: string) => number,
): number {
	return letters.reduce(
		(sum, letter) => sum + numericValue(row.getCell(colIndex(letter)).value),
		0,
	);
}

/** Find the monthly-commit column for `monthKey`, creating its header if absent. */
function findOrCreateMonthlyColumn(
	ws: ExcelJS.Worksheet,
	monthKey: string,
): number {
	const header = `Commits ${monthKey}`;
	const headerRow = ws.getRow(2);
	// Scan a bounded window to the right of Notes (AH); columnCount is unreliable
	// after an exceljs round-trip, so never derive the bound from it.
	const SCAN_END = FIRST_MONTH_COL + 24;
	let firstEmpty = -1;
	for (let c = FIRST_MONTH_COL; c <= SCAN_END; c++) {
		const text = String(headerRow.getCell(c).value ?? "").trim();
		if (text === header) return c;
		if (text === "" && firstEmpty === -1) firstEmpty = c;
	}
	const col = firstEmpty === -1 ? FIRST_MONTH_COL : firstEmpty;
	headerRow.getCell(col).value = header;
	ws.getRow(1).getCell(col).value = header;
	return col;
}

export async function writeWeeklyMetrics(
	workbookPath: string,
	persons: PersonMetrics[],
	opts: WriteWeeklyOptions,
): Promise<void> {
	if (opts.weekIndex < 0 || opts.weekIndex >= PR_COLS.length) {
		throw new Error(`weekIndex out of range: ${opts.weekIndex}`);
	}

	const wb = new ExcelJS.Workbook();
	await wb.xlsx.readFile(workbookPath);
	const ws = wb.getWorksheet("Data");
	if (!ws) throw new Error('Workbook has no "Data" sheet');

	const colIndex = (letter: string) => ws.getColumn(letter).number;

	// Map every login in col L to its row (lowercased).
	const rowByLogin = new Map<string, number>();
	for (let r = DATA_START_ROW; r <= ws.rowCount; r++) {
		const login = String(ws.getRow(r).getCell(LOGIN_COL).value ?? "")
			.trim()
			.toLowerCase();
		if (login) rowByLogin.set(login, r);
	}

	const monthCol = findOrCreateMonthlyColumn(ws, opts.monthKey);
	const prCol = PR_COLS[opts.weekIndex];
	const locCol = LOC_COLS[opts.weekIndex];

	for (const pm of persons) {
		let rowNum: number | undefined;
		for (const login of pm.person.logins) {
			const found = rowByLogin.get(login.toLowerCase());
			if (found) {
				rowNum = found;
				break;
			}
		}
		if (!rowNum) continue; // Person not present in the sheet — leave untouched.

		const row = ws.getRow(rowNum);

		// PRs come from the org-wide search and are authoritative even at 0 — always write.
		row.getCell(colIndex(prCol)).value = totalPrs(pm);
		row.getCell(colIndex(TOTAL_PR_COL)).value = sumColumns(
			row,
			PR_COLS,
			colIndex,
		);

		// LoC and monthly commits derive from attributed commits. When NO commits
		// were attributed to this Person, we have no basis to change them — leave
		// the existing cells untouched rather than destroy good data with a 0
		// (e.g. when the identity map is incomplete or the commit fetch was capped).
		if (pm.commitsTotal > 0) {
			row.getCell(colIndex(locCol)).value = pm.codeLoc;
			row.getCell(monthCol).value = pm.commitsByMonth[opts.monthKey] ?? 0;
			row.getCell(colIndex(TOTAL_LOC_COL)).value = sumColumns(
				row,
				LOC_COLS,
				colIndex,
			);
		}
	}

	await wb.xlsx.writeFile(opts.outPath ?? workbookPath);
}
