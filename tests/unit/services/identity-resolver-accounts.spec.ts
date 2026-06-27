import { describe, expect, it } from "bun:test";
import type { IdentityMap } from "../../../src/models/person.js";
import { createIdentityResolver } from "../../../src/services/identity-resolver.service.js";

/**
 * P1 (#31): the canonical Person carries per-system accounts (asana + jira)
 * folded across a unioned group, so the report path can be fed from one source.
 */
describe("createIdentityResolver — per-system accounts", () => {
	it("folds asana + jira accounts onto the unioned Person", () => {
		const map: IdentityMap = [
			{
				id: "jane",
				name: "Jane Doe",
				logins: ["janedoe"],
				emails: ["jane@company.com"],
				asana: { userGid: "111", email: "jane@asana.example" },
				jira: { accountId: "acct-jane" },
			},
			{
				// split entry, linked by shared email — contributes the jira accountId
				id: "jane-split",
				emails: ["jane@company.com"],
				jira: { accountId: "acct-jane-2" },
			},
		];
		const person = createIdentityResolver(map)
			.persons()
			.find((p) => p.logins.includes("janedoe"));

		expect(person?.asana).toEqual({
			userGid: "111",
			email: "jane@asana.example",
		});
		expect(person?.jiraAccountIds).toEqual(["acct-jane", "acct-jane-2"]);
	});

	it("leaves accounts undefined/empty when no entry supplies them", () => {
		const person = createIdentityResolver([
			{ id: "bob", logins: ["bob"], emails: ["bob@company.com"] },
		]).persons()[0];
		expect(person.asana).toBeUndefined();
		expect(person.jiraAccountIds ?? []).toEqual([]);
	});
});
