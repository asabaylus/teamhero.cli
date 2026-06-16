import { describe, expect, it, mock } from "bun:test";
import type { PersonMetrics } from "../../../src/lib/person-metrics.js";
import type { ReconciliationReport } from "../../../src/lib/reconciliation.js";
import { runWeeklyUpdate } from "../../../src/services/weekly-update.service.js";

function personMetrics(login: string): PersonMetrics {
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
		prsMerged: 3,
		prsClosedUnmerged: 1,
		prsOpen: 0,
		commitsByMonth: { "2026-01": 5 },
		commitsTotal: 5,
		rawLoc: 1000,
		codeLoc: 120,
	};
}

const emptyReconciliation: ReconciliationReport = {
	unmappedCommitAuthors: [],
	duplicateAccountPersons: [],
	unverifiedExternalEmails: [],
	cappedRepos: [],
};

function fakeScope() {
	return { getRepositories: mock(async () => [{ name: "r1" }]) } as never;
}

function fakeCollectPersons(persons: PersonMetrics[]) {
	return mock(async () => ({ persons, reconciliation: emptyReconciliation }));
}

const baseOpts = {
	org: "the-org",
	since: "2026-01-01T00:00:00Z",
	until: "2026-02-01T00:00:00Z",
	weekIndex: 0,
	monthKey: "2026-01",
};

describe("runWeeklyUpdate", () => {
	it("collects Persons directly, formats reconciliation, and writes the workbook", async () => {
		const writeWorkbook = mock(async () => {});
		const collectPersons = fakeCollectPersons([personMetrics("login-1")]);
		const result = await runWeeklyUpdate(
			{ scope: fakeScope(), collectPersons, writeWorkbook },
			{ ...baseOpts, workbook: "/tmp/wb.xlsx" },
		);

		expect(result.personCount).toBe(1);
		expect(result.reconciliationText).toContain("no gaps");
		expect(result.caveat).toContain("not a performance metric");
		expect(result.workbookWritten).toBe("/tmp/wb.xlsx");
		expect(writeWorkbook).toHaveBeenCalledWith(
			"/tmp/wb.xlsx",
			expect.any(Array),
			{
				weekIndex: 0,
				monthKey: "2026-01",
			},
		);
		// Collected Persons directly — no legacy metrics.collect() pass.
		expect(collectPersons).toHaveBeenCalledTimes(1);
	});

	it("does NOT write the workbook with --dry-run", async () => {
		const writeWorkbook = mock(async () => {});
		const result = await runWeeklyUpdate(
			{
				scope: fakeScope(),
				collectPersons: fakeCollectPersons([personMetrics("login-1")]),
				writeWorkbook,
			},
			{ ...baseOpts, workbook: "/tmp/wb.xlsx", dryRun: true },
		);
		expect(writeWorkbook).not.toHaveBeenCalled();
		expect(result.workbookWritten).toBeUndefined();
	});

	it("does NOT write the workbook with --reconcile-only", async () => {
		const writeWorkbook = mock(async () => {});
		await runWeeklyUpdate(
			{
				scope: fakeScope(),
				collectPersons: fakeCollectPersons([personMetrics("login-1")]),
				writeWorkbook,
			},
			{ ...baseOpts, workbook: "/tmp/wb.xlsx", reconcileOnly: true },
		);
		expect(writeWorkbook).not.toHaveBeenCalled();
	});

	it("skips the write when no workbook path is given", async () => {
		const writeWorkbook = mock(async () => {});
		await runWeeklyUpdate(
			{
				scope: fakeScope(),
				collectPersons: fakeCollectPersons([personMetrics("login-1")]),
				writeWorkbook,
			},
			{ ...baseOpts },
		);
		expect(writeWorkbook).not.toHaveBeenCalled();
	});
});
