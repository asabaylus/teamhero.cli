import type { ScopeOptions, ScopeProvider } from "../core/types.js";
import type { PersonMetrics } from "../lib/person-metrics.js";
import {
	formatReconciliation,
	type ReconciliationReport,
} from "../lib/reconciliation.js";
import { writeWeeklyMetrics } from "../lib/spreadsheet-writer.js";

/**
 * Orchestrates the weekly tracking-spreadsheet update: scope → collect Persons →
 * reconcile → write workbook → emit. Contains NO business logic of its own — it
 * sequences a repository lister, a Person collector, and the pure helpers — so
 * the `teamhero weekly` command (and the teamhero-weekly skill) stay thin.
 *
 * It collects Persons directly rather than going through MetricsProvider.collect(),
 * which would also run the legacy per-login collection the report path needs but
 * this flow discards. See `docs/issues/08-weekly-skill-orchestration.md`.
 */

export const SANITY_CAVEAT =
	"Caveat: these per-engineer PR / commit / LoC counts are a coarse, gameable " +
	"sanity check — not a performance metric. Manage on outcomes.";

/** Reconciled Person metrics + report for a window, as fetched by the collector. */
export interface PersonCollection {
	persons: PersonMetrics[];
	reconciliation: ReconciliationReport;
}

export interface WeeklyUpdateDeps {
	/** Resolves the org's repositories to enumerate. */
	scope: Pick<ScopeProvider, "getRepositories">;
	/** Fetches reconciled per-Person metrics for the window (no legacy work). */
	collectPersons: (input: {
		org: string;
		repositories: { name: string }[];
		since: string;
		until: string;
	}) => Promise<PersonCollection>;
	/** Injectable for tests; defaults to the real exceljs writer. */
	writeWorkbook?: typeof writeWeeklyMetrics;
}

export interface WeeklyUpdateOptions {
	org: string;
	since: string;
	until: string;
	workbook?: string;
	weekIndex: number;
	monthKey: string;
	dryRun?: boolean;
	reconcileOnly?: boolean;
	scopeOptions?: Partial<ScopeOptions>;
}

export interface WeeklyUpdateResult {
	personCount: number;
	reconciliationText: string;
	caveat: string;
	/** Path of the workbook written, when a write happened. */
	workbookWritten?: string;
}

export async function runWeeklyUpdate(
	deps: WeeklyUpdateDeps,
	options: WeeklyUpdateOptions,
): Promise<WeeklyUpdateResult> {
	const scopeOptions: ScopeOptions = {
		includeBots: false,
		includeArchived: false,
		excludePrivate: false,
		...options.scopeOptions,
	};

	const repositories = await deps.scope.getRepositories(
		options.org,
		scopeOptions,
	);

	const { persons, reconciliation } = await deps.collectPersons({
		org: options.org,
		repositories,
		since: options.since,
		until: options.until,
	});

	const reconciliationText = formatReconciliation(reconciliation);

	let workbookWritten: string | undefined;
	const shouldWrite =
		!options.dryRun &&
		!options.reconcileOnly &&
		Boolean(options.workbook) &&
		persons.length > 0;
	if (shouldWrite && options.workbook) {
		const write = deps.writeWorkbook ?? writeWeeklyMetrics;
		await write(options.workbook, persons, {
			weekIndex: options.weekIndex,
			monthKey: options.monthKey,
		});
		workbookWritten = options.workbook;
	}

	return {
		personCount: persons.length,
		reconciliationText,
		caveat: SANITY_CAVEAT,
		workbookWritten,
	};
}
