/**
 * Serialize ReportRenderInput to a JSON-safe plain object.
 *
 * The main challenge is that DiscrepancyReport.byContributor is a Map,
 * which doesn't serialize to JSON natively. This module converts it
 * (and any other non-JSON-safe structures) to plain objects.
 */

import { serializeDiscrepancyReport } from "../services/contributor-discrepancy.service.js";
import type { ReportRenderInput } from "./report-renderer.js";

/**
 * Convert a ReportRenderInput into a JSON-serializable Record.
 * Maps are converted to Records; everything else passes through as-is.
 */
export function serializeReportRenderInput(
	input: ReportRenderInput,
): Record<string, unknown> {
	const { discrepancyReport, ...rest } = input;

	const result: Record<string, unknown> = { ...rest };

	if (discrepancyReport) {
		result.discrepancyReport = serializeDiscrepancyReport(discrepancyReport);
	}

	return result;
}
