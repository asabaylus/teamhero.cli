import { describe, expect, it } from "bun:test";
import {
	parseConfigMd,
	renderConfigMd,
} from "../../../../src/services/maturity/audit-store.js";
import type { InterviewAnswer } from "../../../../src/services/maturity/types.js";

describe("renderConfigMd", () => {
	it("renders all 7 question headings in order", () => {
		const md = renderConfigMd([], "2026-05-03");
		const order = [
			"AI tooling (Q1)",
			"Hiring (Q2)",
			"DORA visibility (Q3)",
			"Design before code (Q4)",
			"Eval coverage (Q5)",
			"Blast-radius red-teaming (Q6)",
			"Out-of-band adjacent repos (Q7)",
		];
		const positions = order.map((heading) => md.indexOf(heading));
		expect(positions.every((p) => p >= 0)).toBe(true);
		for (let i = 1; i < positions.length; i++) {
			expect(positions[i]).toBeGreaterThan(positions[i - 1]);
		}
	});

	it("includes the last_updated date", () => {
		expect(renderConfigMd([], "2026-05-03")).toContain(
			"last_updated: 2026-05-03",
		);
	});

	it("substitutes 'unknown' for missing answers", () => {
		const md = renderConfigMd([], "2026-05-03");
		// Each section should have "unknown" beneath its heading
		expect((md.match(/unknown/g) ?? []).length).toBeGreaterThanOrEqual(7);
	});

	it("uses provided answer values when present", () => {
		const answers: InterviewAnswer[] = [
			{
				questionId: "q1",
				value: "Company-paid Claude seats with policy",
				isOption: true,
			},
		];
		const md = renderConfigMd(answers, "2026-05-03");
		expect(md).toContain("Company-paid Claude seats with policy");
	});
});

describe("parseConfigMd", () => {
	it("round-trips: render → parse returns the same answers", () => {
		const original: InterviewAnswer[] = [
			{ questionId: "q1", value: "Paid Claude", isOption: true },
			{ questionId: "q3", value: "DORA via Grafana", isOption: false },
		];
		const md = renderConfigMd(original, "2026-05-03");
		const parsed = parseConfigMd(md);
		const q1 = parsed.find((a) => a.questionId === "q1");
		const q3 = parsed.find((a) => a.questionId === "q3");
		expect(q1?.value).toBe("Paid Claude");
		expect(q3?.value).toBe("DORA via Grafana");
	});

	it("returns empty for empty input", () => {
		expect(parseConfigMd("")).toEqual([]);
	});

	it("ignores content outside the Org-level answers section", () => {
		const md = `# Header\n\n## Other section\n\nfoo\n\n## Org-level answers\n\n### AI tooling (Q1)\nbar\n\n## After\n\nbaz\n`;
		const parsed = parseConfigMd(md);
		expect(parsed).toHaveLength(1);
		expect(parsed[0]).toEqual({
			questionId: "q1",
			value: "bar",
			isOption: false,
		});
	});
});
