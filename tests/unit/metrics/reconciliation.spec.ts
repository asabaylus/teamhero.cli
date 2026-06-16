import { describe, expect, it } from "bun:test";
import {
	buildReconciliationReport,
	formatReconciliation,
	isReconciliationClean,
} from "../../../src/lib/reconciliation.js";
import { createIdentityResolver } from "../../../src/services/identity-resolver.service.js";
import {
	goldenExpectedUnmapped,
	goldenIdentityMap,
} from "../../fixtures/golden/identity-reconciliation.js";

describe("buildReconciliationReport", () => {
	const resolver = createIdentityResolver(goldenIdentityMap);
	const report = buildReconciliationReport(resolver, {
		unmappedCommits: goldenExpectedUnmapped,
	});

	it("lists unmapped commit authors from the collection leftovers", () => {
		expect(report.unmappedCommitAuthors).toEqual(goldenExpectedUnmapped);
	});

	it("flags Persons with more than one login as duplicate accounts", () => {
		expect(report.duplicateAccountPersons).toContainEqual({
			personId: "person-a",
			logins: ["login-a", "login-a-legacy"],
		});
		// Single-login Persons are not flagged.
		expect(report.duplicateAccountPersons.map((d) => d.personId)).not.toContain(
			"person-c",
		);
	});

	it("lists external collaborators' emails to verify", () => {
		expect(report.unverifiedExternalEmails).toContainEqual({
			personId: "person-d",
			email: "person-d@vendor.example",
		});
	});

	it("defaults cappedRepos to empty", () => {
		expect(report.cappedRepos).toEqual([]);
	});
});

describe("isReconciliationClean / formatReconciliation", () => {
	it("reports clean when nothing to act on", () => {
		const clean = buildReconciliationReport(createIdentityResolver([]), {});
		expect(isReconciliationClean(clean)).toBe(true);
		expect(formatReconciliation(clean)).toContain("no gaps");
	});

	it("renders each category with counts", () => {
		const resolver = createIdentityResolver(goldenIdentityMap);
		const text = formatReconciliation(
			buildReconciliationReport(resolver, {
				unmappedCommits: goldenExpectedUnmapped,
			}),
		);
		expect(text).toContain("unmapped commit author");
		expect(text).toContain("person-a");
		expect(text).toContain("nobody@example.com");
		expect(text).toContain("person-d");
	});
});
