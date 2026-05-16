import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditFrontmatter } from "../review/audit-writer.js";

/**
 * Cohort summary module.
 *
 * Reads the per-candidate audit.json files for a given role and produces a
 * `COHORT.md` roll-up. No score column. No ranking. Alphabetical order only.
 * Pending sign-offs are visibly indicated.
 */

export interface CandidateAuditRecord {
	readonly frontmatter: AuditFrontmatter;
	readonly summaryPath: string; // relative to the cohort dir
}

const WARNING_BANNER = `⚠ THIS COHORT REPORT IS ADVISORY. Hiring decisions are made by humans using
professional judgment. Each candidate is a person, not a score. This rubric
is one factor among many; your evaluation is the primary basis for the
hiring decision.`;

/**
 * Loads candidate audit records from a role directory.
 *
 * Expected layout: `<roleDir>/<candidate-slug>/audit.json`. Subdirectories
 * without audit.json are skipped silently.
 */
export function loadCohort(roleDir: string): readonly CandidateAuditRecord[] {
	if (!existsSync(roleDir)) return [];
	const records: CandidateAuditRecord[] = [];
	for (const entry of readdirSync(roleDir)) {
		const entryPath = join(roleDir, entry);
		if (!statSync(entryPath).isDirectory()) continue;
		const auditJson = join(entryPath, "audit.json");
		if (!existsSync(auditJson)) continue;
		try {
			const body = readFileSync(auditJson, "utf8");
			const parsed = JSON.parse(body) as unknown;
			const fm = (parsed as { frontmatter?: unknown } | null)?.frontmatter;
			if (!fm || typeof fm !== "object") continue;
			const ff = fm as Partial<AuditFrontmatter>;
			if (
				typeof ff.candidate !== "string" ||
				typeof ff.role !== "string" ||
				typeof ff.date !== "string" ||
				typeof ff.signed_off !== "boolean"
			) {
				continue;
			}
			records.push({
				frontmatter: fm as AuditFrontmatter,
				summaryPath: join(entry, "summary.md"),
			});
		} catch {
			// Skip malformed audit.json silently.
		}
	}
	return records;
}

// escapeMarkdownTableCell sanitizes field values so they don't break the
// pipe-delimited markdown table layout. A candidate name like
// "Alice | aka Bob" would otherwise insert an extra column; a name with a
// newline would terminate the row mid-record.
function escapeMarkdownTableCell(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderRow(rec: CandidateAuditRecord): string {
	const fm = rec.frontmatter;
	const interviewed = fm.session_date ?? fm.date;
	const signOff = fm.signed_off ? "✅ Reviewed" : "⏳ Pending";
	const recommendation = fm.signed_off ? (fm.recommendation ?? "") : "—";
	const audit = `[link](${rec.summaryPath})`;
	return `| ${escapeMarkdownTableCell(fm.candidate)} | ${escapeMarkdownTableCell(interviewed)} | ${signOff} | ${escapeMarkdownTableCell(recommendation)} | ${audit} |`;
}

export interface CohortSummaryOptions {
	/** "alphabetical" (default) or "chronological" (by session_date / date). */
	readonly order?: "alphabetical" | "chronological";
}

export function renderCohortSummary(
	roleSlug: string,
	records: readonly CandidateAuditRecord[],
	options: CohortSummaryOptions = {},
): string {
	const order = options.order ?? "alphabetical";
	const sorted = [...records];
	if (order === "alphabetical") {
		sorted.sort((a, b) =>
			a.frontmatter.candidate.localeCompare(b.frontmatter.candidate),
		);
	} else {
		sorted.sort((a, b) => {
			const aDate = a.frontmatter.session_date ?? a.frontmatter.date;
			const bDate = b.frontmatter.session_date ?? b.frontmatter.date;
			return aDate.localeCompare(bDate);
		});
	}

	const lines: string[] = [];
	lines.push(`> ${WARNING_BANNER.split("\n").join("\n> ")}`);
	lines.push("");
	lines.push(`# Cohort: ${roleSlug}`);
	lines.push("");
	const pending = sorted.filter((r) => !r.frontmatter.signed_off).length;
	const total = sorted.length;
	lines.push(
		`Candidates: ${total} (${pending} pending sign-off, ${total - pending} reviewed). Order: ${order}.`,
	);
	lines.push("");
	if (sorted.length === 0) {
		lines.push("_No candidates yet for this role._");
		lines.push("");
		return `${lines.join("\n")}`;
	}
	lines.push("| Candidate | Interviewed | Sign-off | Recommendation | Audit |");
	lines.push("|-----------|-------------|----------|----------------|-------|");
	for (const rec of sorted) {
		lines.push(renderRow(rec));
	}
	lines.push("");
	return `${lines.join("\n")}`;
}

export interface WriteCohortInput {
	readonly roleDir: string;
	readonly roleSlug: string;
	readonly order?: "alphabetical" | "chronological";
}

export function writeCohortSummary(input: WriteCohortInput): {
	readonly path: string;
	readonly recordCount: number;
} {
	const records = loadCohort(input.roleDir);
	const body = renderCohortSummary(input.roleSlug, records, {
		order: input.order,
	});
	const path = join(input.roleDir, "COHORT.md");
	writeFileSync(path, body, "utf8");
	return { path, recordCount: records.length };
}
