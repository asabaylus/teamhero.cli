import { describe, expect, it } from "bun:test";
import { mergeUserMaps, personsToUserMap } from "../../../src/lib/user-map.js";
import type { Person } from "../../../src/models/person.js";

function person(over: Partial<Person> & Pick<Person, "id">): Person {
	return {
		displayName: over.id,
		logins: [],
		emails: [],
		names: [],
		external: false,
		hasMultipleLogins: false,
		...over,
	};
}

describe("personsToUserMap", () => {
	it("maps a Person's per-system accounts into a UserIdentity", () => {
		const map = personsToUserMap([
			person({
				id: "jane",
				displayName: "Jane Doe",
				logins: ["janedoe"],
				emails: ["jane@company.com"],
				asana: { userGid: "111" },
				jiraAccountIds: ["acct-jane"],
			}),
		]);
		expect(map.jane).toEqual({
			name: "Jane Doe",
			email: "jane@company.com",
			github: { login: "janedoe" },
			asana: { userGid: "111" },
			jira: { accountId: "acct-jane" },
		});
	});

	it("omits accounts a Person doesn't have", () => {
		const map = personsToUserMap([person({ id: "bob", logins: ["bob"] })]);
		expect(map.bob.github).toEqual({ login: "bob" });
		expect(map.bob.asana).toBeUndefined();
		expect(map.bob.jira).toBeUndefined();
	});
});

describe("mergeUserMaps", () => {
	it("canonical wins on key conflict; supplemental-only entries are kept", () => {
		const canonical = { jane: { name: "Jane (canonical)" } };
		const supplemental = {
			jane: { name: "Jane (env)" },
			extra: { name: "Env Only" },
		};
		const merged = mergeUserMaps(canonical, supplemental);
		expect(merged.jane.name).toBe("Jane (canonical)");
		expect(merged.extra.name).toBe("Env Only");
	});
});

import { userMapDeprecationNotice } from "../../../src/lib/user-map.js";

describe("userMapDeprecationNotice", () => {
	it("returns a message when USER_MAP env is set", () => {
		expect(userMapDeprecationNotice('{"a":{}}')).toContain("deprecated");
	});
	it("returns undefined when USER_MAP is unset/empty", () => {
		expect(userMapDeprecationNotice(undefined)).toBeUndefined();
		expect(userMapDeprecationNotice("  ")).toBeUndefined();
	});
});

import { buildJiraLoginLookupFromPersons } from "../../../src/lib/user-map.js";

describe("buildJiraLoginLookupFromPersons", () => {
	it("maps the Jira accountId to the login (accountId only, no email fallback)", () => {
		const lookup = buildJiraLoginLookupFromPersons([
			person({
				id: "asa",
				logins: ["asabaylus"],
				emails: ["asa@company.com"],
				jiraAccountIds: ["acct-asa"],
			}),
		]);
		expect(lookup.get("acct-asa")).toBe("asabaylus");
		// no email fallback
		expect(lookup.get("asa@company.com")).toBeUndefined();
	});
});
