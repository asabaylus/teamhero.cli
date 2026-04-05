import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getEnv } from "../../../src/lib/env.js";
import { VISIBLE_WINS_ENV_KEYS } from "../../../src/lib/visible-wins-config.js";

describe("Visible Wins env var access via getEnv()", () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("exports all 7 Visible Wins env var key constants", () => {
		expect(VISIBLE_WINS_ENV_KEYS.ASANA_PROJECT_GID).toBe("ASANA_PROJECT_GID");
		expect(VISIBLE_WINS_ENV_KEYS.ASANA_SECTION_GID).toBe("ASANA_SECTION_GID");
		expect(VISIBLE_WINS_ENV_KEYS.ASANA_SECTION_NAME).toBe("ASANA_SECTION_NAME");
		expect(VISIBLE_WINS_ENV_KEYS.ASANA_PRIORITY_FIELD).toBe(
			"ASANA_PRIORITY_FIELD",
		);
		expect(VISIBLE_WINS_ENV_KEYS.MEETING_NOTES_DIR).toBe("MEETING_NOTES_DIR");
		expect(VISIBLE_WINS_ENV_KEYS.MEETING_NOTES_PROVIDER).toBe(
			"MEETING_NOTES_PROVIDER",
		);
		expect(VISIBLE_WINS_ENV_KEYS.VISIBLE_WINS_AI_MODEL).toBe(
			"VISIBLE_WINS_AI_MODEL",
		);
	});

	it("getEnv() returns value when env var is set", () => {
		process.env.ASANA_PROJECT_GID = "test-project-gid-123";
		expect(getEnv("ASANA_PROJECT_GID")).toBe("test-project-gid-123");
	});

	it("getEnv() returns undefined for unset Visible Wins env var", () => {
		// Use a key that won't exist in process.env or .env file
		const unusedKey = "VISIBLE_WINS_TEST_NONEXISTENT_KEY";
		process.env[unusedKey] = undefined;
		expect(getEnv(unusedKey)).toBeUndefined();
	});

	it("all Visible Wins env var keys work with getEnv()", () => {
		for (const key of Object.values(VISIBLE_WINS_ENV_KEYS)) {
			process.env[key] = `test-value-${key}`;
			expect(getEnv(key)).toBe(`test-value-${key}`);
			delete process.env[key];
		}
	});

	it("getEnv() returns undefined for empty string values", () => {
		// Use a key that won't exist in the .env file so the dotenv
		// fallback doesn't mask the empty-string check
		const testKey = "VISIBLE_WINS_TEST_EMPTY_VALUE";
		process.env[testKey] = "";
		expect(getEnv(testKey)).toBeUndefined();
		delete process.env[testKey];
	});
});
