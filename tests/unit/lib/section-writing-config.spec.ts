import { describe, expect, it } from "bun:test";
import {
	resolveSectionAudience,
	resolveSectionVerbosity,
} from "../../../src/lib/section-writing-config.js";

describe("section-writing-config", () => {
	it("falls back to standard verbosity for unknown values", () => {
		process.env.TEST_VERBOSITY = "loud";
		expect(resolveSectionVerbosity("TEST_VERBOSITY")).toBe("standard");
		delete process.env.TEST_VERBOSITY;
	});

	it("returns bounded audience text", () => {
		process.env.TEST_AUDIENCE = "a".repeat(40);
		expect(resolveSectionAudience("TEST_AUDIENCE", 10)).toHaveLength(10);
		delete process.env.TEST_AUDIENCE;
	});
});
