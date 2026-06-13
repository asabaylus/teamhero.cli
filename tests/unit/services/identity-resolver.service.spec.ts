import { describe, expect, it } from "bun:test";
import type { IdentityMap } from "../../../src/models/person.js";
import { createIdentityResolver } from "../../../src/services/identity-resolver.service.js";

/**
 * Slice 01 acceptance: the IdentityResolver resolves raw commit/PR identities to
 * canonical Persons via union-find, parses noreply emails, flags duplicate
 * accounts, and routes unmatched identities to review (never inventing a Person
 * from a bare name). Placeholders only — no real names/logins (redaction rule).
 */
describe("createIdentityResolver", () => {
	// Person A: two author names share one email (collapse, no ghost row).
	// Person B: two logins on one entry (duplicate-account flag).
	// Person C: one logical person split across two entries linked by a shared
	//           email, with a second (vendor) email unioned in.
	// Person D: external collaborator.
	const map: IdentityMap = [
		{
			id: "person-a",
			name: "Person A",
			logins: ["login-a"],
			emails: ["person-a@example.com"],
			names: ["Person A", "persona-handle"],
		},
		{
			id: "person-b",
			name: "Person B",
			logins: ["login-b", "login-b-legacy"],
			emails: ["person-b@example.com"],
		},
		{
			id: "person-c",
			name: "Person C",
			logins: ["login-c"],
			emails: ["person-c@example.com"],
		},
		{
			// Split entry for the same human, linked to person-c by the shared
			// example.com email, contributing a vendor email.
			id: "person-c-vendor",
			emails: ["person-c@example.com", "person-c@vendor.example"],
		},
		{
			id: "person-d",
			name: "Person D",
			logins: ["login-d"],
			emails: ["person-d@example.com"],
			external: true,
		},
	];

	const resolver = createIdentityResolver(map);

	// Case 1 — two author names on one email collapse to one Person; the bare
	// "persona-handle" name does not spawn a second Person.
	it("collapses two author names on one email into a single Person", () => {
		const byRealName = resolver.resolve({
			name: "Person A",
			email: "person-a@example.com",
		});
		const byHandle = resolver.resolve({
			name: "persona-handle",
			email: "person-a@example.com",
		});
		expect(byRealName.type).toBe("resolved");
		expect(byHandle.type).toBe("resolved");
		if (byRealName.type === "resolved" && byHandle.type === "resolved") {
			expect(byRealName.person.id).toBe("person-a");
			expect(byHandle.person.id).toBe("person-a");
		}
	});

	// Case 2 — multiple emails union onto a single Person.
	it("unions multiple emails onto one Person", () => {
		const primary = resolver.resolve({ email: "person-c@example.com" });
		const vendor = resolver.resolve({ email: "person-c@vendor.example" });
		expect(primary.type).toBe("resolved");
		expect(vendor.type).toBe("resolved");
		if (primary.type === "resolved" && vendor.type === "resolved") {
			expect(primary.person.id).toBe(vendor.person.id);
			expect(primary.person.emails).toContain("person-c@vendor.example");
		}
	});

	// Case 3 — an unverified external email still resolves via the map.
	it("resolves an unverified external email through the map", () => {
		const result = resolver.resolve({ email: "person-c@vendor.example" });
		expect(result.type).toBe("resolved");
	});

	// Case 4 — two logins map to one Person and raise the duplicate flag.
	it("maps multiple logins to one Person and flags duplicate accounts", () => {
		const active = resolver.resolve({ login: "login-b" });
		const legacy = resolver.resolve({ login: "login-b-legacy" });
		expect(active.type).toBe("resolved");
		expect(legacy.type).toBe("resolved");
		if (active.type === "resolved" && legacy.type === "resolved") {
			expect(active.person.id).toBe(legacy.person.id);
			expect(active.person.hasMultipleLogins).toBe(true);
			expect(active.person.logins).toEqual(
				expect.arrayContaining(["login-b", "login-b-legacy"]),
			);
		}
	});

	// Case 5 — <digits>+login@users.noreply.github.com parses to its login.
	it("parses a noreply email to its login and resolves", () => {
		const withDigits = resolver.resolve({
			email: "123456+login-a@users.noreply.github.com",
		});
		const withoutDigits = resolver.resolve({
			email: "login-a@users.noreply.github.com",
		});
		expect(withDigits.type).toBe("resolved");
		expect(withoutDigits.type).toBe("resolved");
		if (withDigits.type === "resolved") {
			expect(withDigits.person.id).toBe("person-a");
		}
	});

	// Case 6 — the GitHub merge-button / web-flow identity is non-authoring.
	it("classifies the GitHub merge identity as non-authoring", () => {
		const result = resolver.resolve({
			name: "GitHub",
			email: "noreply@github.com",
		});
		expect(result.type).toBe("merge-identity");
	});

	// Case 7 — an unmatched identity routes to review; a bare name never
	// instantiates a Person.
	it("routes an unmatched identity to review without creating a Person", () => {
		const bareName = resolver.resolve({ name: "Someone Unknown" });
		const unknownEmail = resolver.resolve({ email: "nobody@example.com" });
		expect(bareName.type).toBe("unmapped");
		expect(unknownEmail.type).toBe("unmapped");
		if (bareName.type === "unmapped") {
			expect(bareName.identity.name).toBe("Someone Unknown");
		}
		// The bare name must not have leaked into the known Person set.
		expect(resolver.persons().map((p) => p.id)).not.toContain(
			"Someone Unknown",
		);
	});

	// Case 8 — external-collaborator identities resolve and are flagged external.
	it("resolves external collaborators and marks them external", () => {
		const result = resolver.resolve({ login: "login-d" });
		expect(result.type).toBe("resolved");
		if (result.type === "resolved") {
			expect(result.person.external).toBe(true);
		}
	});

	it("matches logins and emails case-insensitively", () => {
		const upperLogin = resolver.resolve({ login: "LOGIN-A" });
		const upperEmail = resolver.resolve({ email: "PERSON-A@EXAMPLE.COM" });
		expect(upperLogin.type).toBe("resolved");
		expect(upperEmail.type).toBe("resolved");
	});

	it("dedupes the union so each human is one Person", () => {
		const persons = resolver.persons();
		const ids = persons.map((p) => p.id).sort();
		// person-c and person-c-vendor union into one; A, B, C, D => 4 Persons.
		expect(persons).toHaveLength(4);
		expect(ids).toEqual(["person-a", "person-b", "person-c", "person-d"]);
		const personB = persons.find((p) => p.id === "person-b");
		expect(personB?.hasMultipleLogins).toBe(true);
		const personA = persons.find((p) => p.id === "person-a");
		expect(personA?.hasMultipleLogins).toBe(false);
	});
});
