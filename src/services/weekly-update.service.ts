import type {
	MetricsProvider,
	ScopeOptions,
	ScopeProvider,
} from "../core/types.js";
import { formatReconciliation } from "../lib/reconciliation.js";
import { writeWeeklyMetrics } from "../lib/spreadsheet-writer.js";

/**
 * Orchestrates the weekly tracking-spreadsheet update: scope → collect →
 * reconcile → write workbook → emit. Contains NO business logic of its own —
 * it sequences the providers and the pure helpers — so the `teamhero weekly`
 * command (and the teamhero-weekly skill) stay thin. See
 * `docs/issues/08-weekly-skill-orchestration.md`.
 */

export const SANITY_CAVEAT =
	"Caveat: these per-engineer PR / commit / LoC counts are a coarse, gameable " +
	"sanity check — not a performance metric. Manage on outcomes.";

export interface WeeklyUpdateDeps {
	scope: ScopeProvider;
	metrics: MetricsProvider;
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
	warnings: string[];
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

	const organization = await deps.scope.getOrganization(options.org);
	const [repositories, members] = await Promise.all([
		deps.scope.getRepositories(options.org, scopeOptions),
		deps.scope.getMembers(options.org, scopeOptions),
	]);

	const result = await deps.metrics.collect({
		organization,
		members,
		repositories,
		since: options.since,
		until: options.until,
	});

	const persons = result.persons ?? [];
	const reconciliationText = result.reconciliation
		? formatReconciliation(result.reconciliation)
		: "No reconciliation report produced.";

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
		warnings: result.warnings,
	};
}
