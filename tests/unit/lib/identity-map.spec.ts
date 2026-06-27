import { describe, expect, it } from "bun:test";
import {
	parseIdentityMap,
	parseIdentityMapYaml,
} from "../../../src/lib/identity-map.js";

describe("parseIdentityMapYaml", () => {
	it("parses a well-formed YAML map", () => {
		const map = parseIdentityMapYaml(`
- id: person-a
  name: Person A
  logins: [login-a]
  emails: [person-a@example.com]
  names: [Person A, persona-handle]
- id: person-d
  logins: [login-d]
  external: true
`);
		expect(map).toHaveLength(2);
		expect(map[0]).toEqual({
			id: "person-a",
			name: "Person A",
			logins: ["login-a"],
			emails: ["person-a@example.com"],
			names: ["Person A", "persona-handle"],
			external: false,
		});
		expect(map[1].external).toBe(true);
		expect(map[1].emails).toBeUndefined();
	});

	it("returns an empty map on a YAML parse error", () => {
		expect(parseIdentityMapYaml("::: not: valid: yaml")).toEqual([]);
	});

	it("returns an empty map for non-list YAML", () => {
		expect(parseIdentityMapYaml("id: person-a")).toEqual([]);
	});
});

describe("parseIdentityMap", () => {
	it("drops entries without a string id", () => {
		const map = parseIdentityMap([
			{ id: "person-a", logins: ["login-a"] },
			{ logins: ["orphan"] },
			{ id: "" },
			"not-an-object",
		]);
		expect(map).toHaveLength(1);
		expect(map[0].id).toBe("person-a");
	});

	it("filters non-string and empty values out of arrays", () => {
		const map = parseIdentityMap([
			{ id: "person-a", emails: ["a@example.com", "", 42, null] },
		]);
		expect(map[0].emails).toEqual(["a@example.com"]);
	});

	it("returns an empty map for a non-array input", () => {
		expect(parseIdentityMap({ id: "person-a" })).toEqual([]);
		expect(parseIdentityMap(null)).toEqual([]);
	});
});
