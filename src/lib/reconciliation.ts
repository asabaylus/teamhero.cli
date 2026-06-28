import type { IdentityResolver } from "../core/types.js";
import type { UnmappedAuthor } from "./person-metrics.js";

/**
 * The structured reconciliation report surfaced every run so the identity map's
 * gaps stay visible. Pure: built from the resolver plus the commit-attribution
 * leftovers. See `docs/issues/06-reconciliation-report-output.md`.
 */
export interface ReconciliationReport {
	/** Commit authors that matched no Person — "map these". */
	unmappedCommitAuthors: UnmappedAuthor[];
	/** Persons owning more than one GitHub login — "clean up the duplicate". */
	duplicateAccountPersons: { personId: string; logins: string[] }[];
	/** External-collaborator emails to confirm/verify on the account. */
	unverifiedExternalEmails: { personId: string; email: string }[];
	/** Repos whose commit enumeration hit a fetch cap (counts may be partial). */
	cappedRepos: string[];
	/** Jira assignees (display name or accountId) that matched no Person. */
	unmatchedJiraAssignees: string[];
}

export interface ReconciliationInputs {
	unmappedCommits?: UnmappedAuthor[];
	cappedRepos?: string[];
	unmatchedJiraAssignees?: string[];
}

/** Assemble the reconciliation report from the resolver and collection leftovers. */
export function buildReconciliationReport(
	resolver: IdentityResolver,
	inputs: ReconciliationInputs = {},
): ReconciliationReport {
	const persons = resolver.persons();
	return {
		unmappedCommitAuthors: inputs.unmappedCommits ?? [],
		duplicateAccountPersons: persons
			.filter((person) => person.hasMultipleLogins)
			.map((person) => ({ personId: person.id, logins: person.logins })),
		unverifiedExternalEmails: persons
			.filter((person) => person.external)
			.flatMap((person) =>
				person.emails.map((email) => ({ personId: person.id, email })),
			),
		cappedRepos: inputs.cappedRepos ?? [],
		unmatchedJiraAssignees: inputs.unmatchedJiraAssignees ?? [],
	};
}

/** True when the report has nothing to act on. */
export function isReconciliationClean(report: ReconciliationReport): boolean {
	return (
		report.unmappedCommitAuthors.length === 0 &&
		report.duplicateAccountPersons.length === 0 &&
		report.unverifiedExternalEmails.length === 0 &&
		report.cappedRepos.length === 0 &&
		report.unmatchedJiraAssignees.length === 0
	);
}

/** Render a concise, human-readable reconciliation summary. */
export function formatReconciliation(report: ReconciliationReport): string {
	if (isReconciliationClean(report)) {
		return "Identity reconciliation: all contributors mapped; no gaps.";
	}
	const lines: string[] = ["Identity reconciliation:"];
	if (report.unmappedCommitAuthors.length > 0) {
		lines.push(
			`- ${report.unmappedCommitAuthors.length} unmapped commit author(s) — add to the identity map:`,
		);
		for (const a of report.unmappedCommitAuthors) {
			lines.push(`    ${a.email ?? a.name ?? "(unknown)"} (${a.count})`);
		}
	}
	if (report.duplicateAccountPersons.length > 0) {
		lines.push(
			`- ${report.duplicateAccountPersons.length} duplicate-account person(s):`,
		);
		for (const d of report.duplicateAccountPersons) {
			lines.push(`    ${d.personId}: ${d.logins.join(", ")}`);
		}
	}
	if (report.unverifiedExternalEmails.length > 0) {
		lines.push(
			`- ${report.unverifiedExternalEmails.length} external email(s) to verify:`,
		);
		for (const e of report.unverifiedExternalEmails) {
			lines.push(`    ${e.personId}: ${e.email}`);
		}
	}
	if (report.cappedRepos.length > 0) {
		lines.push(
			`- ${report.cappedRepos.length} repo(s) hit a fetch cap (counts may be partial): ${report.cappedRepos.join(", ")}`,
		);
	}
	if (report.unmatchedJiraAssignees.length > 0) {
		lines.push(
			`- ${report.unmatchedJiraAssignees.length} unmatched Jira assignee(s) — add a jira accountId to the identity map (story points dropped):`,
		);
		for (const a of report.unmatchedJiraAssignees) {
			lines.push(`    ${a}`);
		}
	}
	return lines.join("\n");
}
