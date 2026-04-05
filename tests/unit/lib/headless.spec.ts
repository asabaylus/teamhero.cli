import { afterEach, describe, expect, it } from "bun:test";

// Direct import — the module reads process.env at call time, so we control it
// by mutating process.env before each call.
import { isHeadlessEnvironment } from "../../../src/lib/headless.js";

describe("isHeadlessEnvironment", () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	describe("TEAMHERO_HEADLESS truthy values", () => {
		it.each([
			"1",
			"true",
			"TRUE",
			"True",
			"yes",
			"Yes",
			"YES",
			"on",
			"ON",
			"On",
		])("returns true for TEAMHERO_HEADLESS=%s", (value) => {
			delete process.env.CI;
			process.env.TEAMHERO_HEADLESS = value;
			expect(isHeadlessEnvironment()).toBe(true);
		});
	});

	describe("TEAMHERO_HEADLESS falsy values", () => {
		it.each(["0", "false", "FALSE", "no", "off", "", "random", "2"])(
			"returns false for TEAMHERO_HEADLESS=%s (when CI is unset)",
			(value) => {
				delete process.env.CI;
				process.env.TEAMHERO_HEADLESS = value;
				expect(isHeadlessEnvironment()).toBe(false);
			},
		);
	});

	describe("CI env var", () => {
		it("returns true when CI=true and TEAMHERO_HEADLESS is unset", () => {
			delete process.env.TEAMHERO_HEADLESS;
			process.env.CI = "true";
			expect(isHeadlessEnvironment()).toBe(true);
		});

		it("returns true when CI=1", () => {
			delete process.env.TEAMHERO_HEADLESS;
			process.env.CI = "1";
			expect(isHeadlessEnvironment()).toBe(true);
		});

		it("returns true when CI=yes", () => {
			delete process.env.TEAMHERO_HEADLESS;
			process.env.CI = "yes";
			expect(isHeadlessEnvironment()).toBe(true);
		});

		it("returns true when CI=on", () => {
			delete process.env.TEAMHERO_HEADLESS;
			process.env.CI = "on";
			expect(isHeadlessEnvironment()).toBe(true);
		});

		it("returns false when CI=false", () => {
			delete process.env.TEAMHERO_HEADLESS;
			process.env.CI = "false";
			expect(isHeadlessEnvironment()).toBe(false);
		});

		it("returns false when CI=0", () => {
			delete process.env.TEAMHERO_HEADLESS;
			process.env.CI = "0";
			expect(isHeadlessEnvironment()).toBe(false);
		});
	});

	describe("no env vars set", () => {
		it("returns false when neither TEAMHERO_HEADLESS nor CI is set", () => {
			delete process.env.TEAMHERO_HEADLESS;
			delete process.env.CI;
			expect(isHeadlessEnvironment()).toBe(false);
		});
	});

	describe("precedence", () => {
		it("TEAMHERO_HEADLESS=1 takes precedence even when CI is falsy", () => {
			process.env.TEAMHERO_HEADLESS = "1";
			process.env.CI = "false";
			expect(isHeadlessEnvironment()).toBe(true);
		});

		it("falls through to CI when TEAMHERO_HEADLESS is unset", () => {
			delete process.env.TEAMHERO_HEADLESS;
			process.env.CI = "true";
			expect(isHeadlessEnvironment()).toBe(true);
		});

		it("TEAMHERO_HEADLESS=0 does not block CI=true", () => {
			process.env.TEAMHERO_HEADLESS = "0";
			process.env.CI = "true";
			expect(isHeadlessEnvironment()).toBe(true);
		});
	});
});
