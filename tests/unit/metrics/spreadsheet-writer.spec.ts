import { afterAll, describe, expect, it } from "bun:test";
import { copyFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import type { PersonMetrics } from "../../../src/lib/person-metrics.js";
import { writeWeeklyMetrics } from "../../../src/lib/spreadsheet-writer.js";

const FIXTURE = "tests/fixtures/T9-Box-Prep.redacted.xlsx";

function person(login: string, over: Partial<PersonMetrics>): PersonMetrics {
	return {
		person: {
			id: login,
			displayName: login,
			logins: [login],
			emails: [],
			names: [],
			external: false,
			hasMultipleLogins: false,
		},
		prsMerged: 0,
		prsClosedUnmerged: 0,
		prsOpen: 0,
		commitsByMonth: {},
		commitsTotal: 0,
		rawLoc: 0,
		codeLoc: 0,
		...over,
	};
}

async function load(path: string) {
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.readFile(path);
	return wb.getWorksheet("Data") as ExcelJS.Worksheet;
}

const tmpPaths: string[] = [];
function freshCopy(): string {
	const path = join(
		tmpdir(),
		`t9-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`,
	);
	copyFileSync(FIXTURE, path);
	tmpPaths.push(path);
	return path;
}

describe("writeWeeklyMetrics", () => {
	const personA = person("login-1", {
		prsMerged: 5,
		prsClosedUnmerged: 2,
		prsOpen: 1,
		codeLoc: 123,
		commitsTotal: 9,
		commitsByMonth: { "2026-01": 9 },
	});
	const personB = person("login-2", {
		prsMerged: 3,
		codeLoc: 45,
		commitsTotal: 4,
		commitsByMonth: { "2026-01": 4 },
	});

	it("writes PR/codeLoc cells, recomputes totals, appends a monthly column, leaves Tickets untouched", async () => {
		const path = freshCopy();
		const before = await load(path);
		const ticketsBefore = before.getCell("N3").value; // week0 Tickets, row 3 (login-1)

		await writeWeeklyMetrics(path, [personA, personB], {
			weekIndex: 0,
			monthKey: "2026-01",
		});

		const ws = await load(path);
		// Week-0 PR (M) = total tracked PRs = 5+2+1 = 8; codeLoc (O) = 123.
		expect(ws.getCell("M3").value).toBe(8);
		expect(ws.getCell("O3").value).toBe(123);
		// Total PR (AE) equals the sum of the six weekly PR columns.
		const prSum = ["M", "P", "S", "V", "Y", "AB"].reduce((s, c) => {
			const v = ws.getCell(`${c}3`).value;
			return s + (typeof v === "number" ? v : 0);
		}, 0);
		expect(ws.getCell("AE3").value).toBe(prSum);
		// Tickets (N) untouched.
		expect(ws.getCell("N3").value).toEqual(ticketsBefore);
		// login-2 written on its own row (row 4).
		expect(ws.getCell("M4").value).toBe(3);

		// Monthly-commit column appended with header "Commits 2026-01".
		const headerRow = ws.getRow(2);
		let monthCol = -1;
		for (let c = 35; c <= ws.columnCount; c++) {
			if (
				String(headerRow.getCell(c).value ?? "").trim() === "Commits 2026-01"
			) {
				monthCol = c;
				break;
			}
		}
		expect(monthCol).toBeGreaterThan(0);
		expect(ws.getRow(3).getCell(monthCol).value).toBe(9);
	});

	it("is idempotent — re-running the same week overwrites, not duplicates", async () => {
		const path = freshCopy();
		const opts = { weekIndex: 1 as const, monthKey: "2026-02" };
		await writeWeeklyMetrics(path, [personA], opts);
		const first = (await load(path)).getCell("P3").value;
		await writeWeeklyMetrics(path, [personA], opts);
		const ws = await load(path);
		expect(ws.getCell("P3").value).toBe(first);
		expect(ws.getCell("P3").value).toBe(8);
		// Only one "Commits 2026-02" column exists.
		const headerRow = ws.getRow(2);
		let count = 0;
		for (let c = 35; c <= ws.columnCount; c++) {
			if (String(headerRow.getCell(c).value ?? "").trim() === "Commits 2026-02")
				count++;
		}
		expect(count).toBe(1);
	});

	it("does NOT overwrite LoC when a Person has no attributed commits", async () => {
		const path = freshCopy();
		const before = await load(path);
		const locBefore = before.getCell("O3").value; // wk0 LoC, row 3 (login-1)

		// No commits attributed (commitsTotal 0) but PRs present from search.
		const noCommits = person("login-1", {
			prsMerged: 4,
			prsClosedUnmerged: 0,
			prsOpen: 0,
			codeLoc: 0,
			commitsTotal: 0,
		});
		await writeWeeklyMetrics(path, [noCommits], {
			weekIndex: 0,
			monthKey: "2026-01",
		});

		const ws = await load(path);
		// PR cell IS updated (search is authoritative)...
		expect(ws.getCell("M3").value).toBe(4);
		// ...but the existing LoC cell is preserved, not zeroed.
		expect(ws.getCell("O3").value).toEqual(locBefore);
	});

	afterAll(() => {
		for (const p of tmpPaths) {
			try {
				unlinkSync(p);
			} catch {}
		}
	});
});
