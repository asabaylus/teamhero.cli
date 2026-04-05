import { describe, expect, it } from "bun:test";
import {
	buildGitHubLookup,
	convertToAsanaOverrides,
	parseUserMap,
	resolveAsanaOverride,
} from "../../../src/lib/user-map.js";
import type {
	UserIdentity,
	UserMap,
} from "../../../src/models/user-identity.js";

describe("parseUserMap", () => {
	it("returns empty map for undefined input", () => {
		expect(parseUserMap(undefined)).toEqual({});
	});

	it("returns empty map for empty string", () => {
		expect(parseUserMap("")).toEqual({});
	});

	it("returns empty map for null-ish input", () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(parseUserMap(null as any)).toEqual({});
	});

	it("returns empty map for invalid JSON", () => {
		expect(parseUserMap("{not valid json")).toEqual({});
	});

	it("parses a valid user map with all fields", () => {
		const raw = JSON.stringify({
			john: {
				name: "John Doe",
				email: "john@example.com",
				github: { login: "johndoe" },
				asana: {
					email: "john@asana.com",
					name: "John A",
					userGid: "12345",
					workspaceGid: "ws-1",
				},
			},
		});

		const result = parseUserMap(raw);
		expect(result.john).toBeDefined();
		expect(result.john.name).toBe("John Doe");
		expect(result.john.email).toBe("john@example.com");
		expect(result.john.github).toEqual({ login: "johndoe" });
		expect(result.john.asana).toEqual({
			email: "john@asana.com",
			name: "John A",
			userGid: "12345",
			workspaceGid: "ws-1",
		});
	});

	it("parses multiple users", () => {
		const raw = JSON.stringify({
			alice: { name: "Alice", github: { login: "alice123" } },
			bob: { name: "Bob", github: { login: "bob456" } },
		});

		const result = parseUserMap(raw);
		expect(Object.keys(result)).toHaveLength(2);
		expect(result.alice.name).toBe("Alice");
		expect(result.bob.name).toBe("Bob");
	});

	it("skips entries that are not objects (numbers, strings, null)", () => {
		const raw = JSON.stringify({
			valid: { name: "Valid" },
			number_entry: 42,
			string_entry: "just a string",
			null_entry: null,
		});

		const result = parseUserMap(raw);
		expect(Object.keys(result)).toHaveLength(1);
		expect(result.valid).toBeDefined();
	});

	it("treats arrays as objects (typeof [] === 'object')", () => {
		// Arrays pass the typeof check — this is JS behavior the code inherits.
		// The entry will be created with undefined fields since array indices
		// are not name/email/github/asana keys.
		const raw = JSON.stringify({
			array_entry: [1, 2, 3],
		});

		const result = parseUserMap(raw);
		expect(Object.keys(result)).toHaveLength(1);
		expect(result.array_entry.name).toBeUndefined();
	});

	it("sets name to undefined when name is not a string", () => {
		const raw = JSON.stringify({
			user: { name: 123, email: "a@b.com" },
		});

		const result = parseUserMap(raw);
		expect(result.user.name).toBeUndefined();
		expect(result.user.email).toBe("a@b.com");
	});

	it("sets email to undefined when email is not a string", () => {
		const raw = JSON.stringify({
			user: { name: "Test", email: true },
		});

		const result = parseUserMap(raw);
		expect(result.user.email).toBeUndefined();
		expect(result.user.name).toBe("Test");
	});

	it("sets github to undefined when github is not an object", () => {
		const raw = JSON.stringify({
			user: { github: "not-an-object" },
		});

		const result = parseUserMap(raw);
		expect(result.user.github).toBeUndefined();
	});

	it("sets github to undefined when github.login is not a string", () => {
		const raw = JSON.stringify({
			user: { github: { login: 42 } },
		});

		const result = parseUserMap(raw);
		expect(result.user.github).toBeUndefined();
	});

	it("sets github to undefined when github is null", () => {
		const raw = JSON.stringify({
			user: { github: null },
		});

		const result = parseUserMap(raw);
		expect(result.user.github).toBeUndefined();
	});

	it("parses asana with partial fields", () => {
		const raw = JSON.stringify({
			user: { asana: { email: "user@asana.com" } },
		});

		const result = parseUserMap(raw);
		expect(result.user.asana).toEqual({
			email: "user@asana.com",
			name: undefined,
			userGid: undefined,
			workspaceGid: undefined,
		});
	});

	it("sets asana to undefined when asana is not an object", () => {
		const raw = JSON.stringify({
			user: { asana: "invalid" },
		});

		const result = parseUserMap(raw);
		expect(result.user.asana).toBeUndefined();
	});

	it("sets asana field values to undefined for non-string types", () => {
		const raw = JSON.stringify({
			user: {
				asana: {
					email: 123,
					name: false,
					userGid: null,
					workspaceGid: ["array"],
				},
			},
		});

		const result = parseUserMap(raw);
		expect(result.user.asana).toEqual({
			email: undefined,
			name: undefined,
			userGid: undefined,
			workspaceGid: undefined,
		});
	});

	it("handles user with no optional fields", () => {
		const raw = JSON.stringify({
			user: {},
		});

		const result = parseUserMap(raw);
		expect(result.user).toEqual({
			name: undefined,
			email: undefined,
			github: undefined,
			asana: undefined,
		});
	});
});

describe("buildGitHubLookup", () => {
	it("returns empty map for empty user map", () => {
		const lookup = buildGitHubLookup({});
		expect(lookup.size).toBe(0);
	});

	it("lowercases GitHub login keys", () => {
		const userMap: UserMap = {
			john: {
				name: "John",
				github: { login: "JohnDoe" },
			},
		};

		const lookup = buildGitHubLookup(userMap);
		expect(lookup.has("johndoe")).toBe(true);
		expect(lookup.has("JohnDoe")).toBe(false);
	});

	it("maps GitHub login to the full UserIdentity", () => {
		const identity: UserIdentity = {
			name: "Alice",
			email: "alice@example.com",
			github: { login: "alice123" },
			asana: { email: "alice@asana.com" },
		};
		const userMap: UserMap = { alice: identity };

		const lookup = buildGitHubLookup(userMap);
		const result = lookup.get("alice123");
		expect(result).toBe(identity);
	});

	it("builds lookup for multiple users", () => {
		const userMap: UserMap = {
			alice: { github: { login: "Alice" } },
			bob: { github: { login: "BOB" } },
			charlie: { github: { login: "Charlie99" } },
		};

		const lookup = buildGitHubLookup(userMap);
		expect(lookup.size).toBe(3);
		expect(lookup.has("alice")).toBe(true);
		expect(lookup.has("bob")).toBe(true);
		expect(lookup.has("charlie99")).toBe(true);
	});

	it("skips users without github login", () => {
		const userMap: UserMap = {
			with_github: { github: { login: "haslogin" } },
			no_github: { name: "No GitHub" },
			empty_github: { github: undefined },
		};

		const lookup = buildGitHubLookup(userMap);
		expect(lookup.size).toBe(1);
		expect(lookup.has("haslogin")).toBe(true);
	});
});

describe("resolveAsanaOverride", () => {
	it("prefers asana.email over identity.email", () => {
		const identity: UserIdentity = {
			email: "shared@example.com",
			asana: { email: "asana@example.com" },
		};

		const override = resolveAsanaOverride(identity);
		expect(override.email).toBe("asana@example.com");
	});

	it("falls back to identity.email when asana.email is absent", () => {
		const identity: UserIdentity = {
			email: "shared@example.com",
			asana: {},
		};

		const override = resolveAsanaOverride(identity);
		expect(override.email).toBe("shared@example.com");
	});

	it("falls back to identity.email when asana is undefined", () => {
		const identity: UserIdentity = {
			email: "shared@example.com",
		};

		const override = resolveAsanaOverride(identity);
		expect(override.email).toBe("shared@example.com");
	});

	it("prefers asana.name over identity.name", () => {
		const identity: UserIdentity = {
			name: "Shared Name",
			asana: { name: "Asana Name" },
		};

		const override = resolveAsanaOverride(identity);
		expect(override.name).toBe("Asana Name");
	});

	it("falls back to identity.name when asana.name is absent", () => {
		const identity: UserIdentity = {
			name: "Shared Name",
			asana: {},
		};

		const override = resolveAsanaOverride(identity);
		expect(override.name).toBe("Shared Name");
	});

	it("includes userGid and workspaceGid from asana", () => {
		const identity: UserIdentity = {
			asana: { userGid: "gid-123", workspaceGid: "ws-456" },
		};

		const override = resolveAsanaOverride(identity);
		expect(override.userGid).toBe("gid-123");
		expect(override.workspaceGid).toBe("ws-456");
	});

	it("returns undefined for userGid and workspaceGid when asana is absent", () => {
		const identity: UserIdentity = {
			name: "Test",
		};

		const override = resolveAsanaOverride(identity);
		expect(override.userGid).toBeUndefined();
		expect(override.workspaceGid).toBeUndefined();
	});

	it("returns all undefined when identity has no fields", () => {
		const identity: UserIdentity = {};

		const override = resolveAsanaOverride(identity);
		expect(override.email).toBeUndefined();
		expect(override.name).toBeUndefined();
		expect(override.userGid).toBeUndefined();
		expect(override.workspaceGid).toBeUndefined();
	});
});

describe("convertToAsanaOverrides", () => {
	it("returns empty object for empty user map", () => {
		expect(convertToAsanaOverrides({})).toEqual({});
	});

	it("keys by lowercase GitHub login", () => {
		const userMap: UserMap = {
			john: {
				name: "John",
				email: "john@example.com",
				github: { login: "JohnDoe" },
			},
		};

		const overrides = convertToAsanaOverrides(userMap);
		expect(overrides).toHaveProperty("johndoe");
		expect(overrides).not.toHaveProperty("JohnDoe");
	});

	it("converts multiple users", () => {
		const userMap: UserMap = {
			alice: {
				name: "Alice",
				email: "alice@example.com",
				github: { login: "alice" },
				asana: { email: "alice@asana.com", userGid: "a1" },
			},
			bob: {
				name: "Bob",
				email: "bob@example.com",
				github: { login: "BobDev" },
			},
		};

		const overrides = convertToAsanaOverrides(userMap);
		expect(Object.keys(overrides)).toHaveLength(2);
		expect(overrides.alice.email).toBe("alice@asana.com");
		expect(overrides.alice.userGid).toBe("a1");
		expect(overrides.bobdev.email).toBe("bob@example.com");
		expect(overrides.bobdev.name).toBe("Bob");
	});

	it("skips users without github login", () => {
		const userMap: UserMap = {
			no_github: { name: "No GitHub", email: "ng@example.com" },
			has_github: {
				name: "Has GitHub",
				github: { login: "ghuser" },
			},
		};

		const overrides = convertToAsanaOverrides(userMap);
		expect(Object.keys(overrides)).toHaveLength(1);
		expect(overrides.ghuser).toBeDefined();
	});

	it("applies asana override precedence in converted entries", () => {
		const userMap: UserMap = {
			user: {
				name: "Shared Name",
				email: "shared@example.com",
				github: { login: "user1" },
				asana: { email: "asana@example.com", name: "Asana Name" },
			},
		};

		const overrides = convertToAsanaOverrides(userMap);
		expect(overrides.user1.email).toBe("asana@example.com");
		expect(overrides.user1.name).toBe("Asana Name");
	});
});
