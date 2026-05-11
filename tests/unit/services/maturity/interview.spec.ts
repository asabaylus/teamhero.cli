import { describe, expect, it } from "bun:test";
import {
	FRAMING_MESSAGE,
	getQuestion,
	INTERVIEW_QUESTIONS,
	isUnknownAnswer,
} from "../../../../src/services/maturity/interview.js";

describe("interview questions", () => {
	it("has exactly 7 questions", () => {
		expect(INTERVIEW_QUESTIONS).toHaveLength(7);
	});

	it("questions are in id order q1..q7", () => {
		const ids = INTERVIEW_QUESTIONS.map((q) => q.id);
		expect(ids).toEqual(["q1", "q2", "q3", "q4", "q5", "q6", "q7"]);
	});

	it("every question includes an 'I don't know' option", () => {
		for (const q of INTERVIEW_QUESTIONS) {
			expect(q.options.some((o) => /don't know/i.test(o))).toBe(true);
		}
	});

	it("every question allows free-text", () => {
		for (const q of INTERVIEW_QUESTIONS) {
			expect(q.allowFreeText).toBe(true);
		}
	});

	it("every question has a non-empty CONFIG.md heading", () => {
		for (const q of INTERVIEW_QUESTIONS) {
			expect(q.configHeading.length).toBeGreaterThan(0);
		}
	});

	it("framing message mentions 7 questions", () => {
		expect(FRAMING_MESSAGE).toMatch(/7/);
	});

	it("getQuestion throws for unknown id", () => {
		// @ts-expect-error
		expect(() => getQuestion("q99")).toThrow();
	});
});

describe("isUnknownAnswer", () => {
	it("matches 'I don't know'", () => {
		expect(isUnknownAnswer("I don't know")).toBe(true);
	});
	it("matches 'unknown'", () => {
		expect(isUnknownAnswer("unknown")).toBe(true);
	});
	it("matches 'n/a'", () => {
		expect(isUnknownAnswer("n/a")).toBe(true);
	});
	it("does not match a real answer", () => {
		expect(isUnknownAnswer("We use Claude paid seats with policy")).toBe(false);
	});
	it("ignores whitespace and casing", () => {
		expect(isUnknownAnswer("  Unknown  ")).toBe(true);
	});
});
