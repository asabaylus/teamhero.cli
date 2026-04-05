import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { Discrepancy } from "../../../src/models/visible-wins.js";

import * as fsPromisesMod from "node:fs/promises";

mock.module("consola", () => ({
	consola: {
		info: mock(),
	},
}));

mock.module("node:fs/promises", () => ({
	...fsPromisesMod,
	appendFile: mock().mockResolvedValue(undefined),
	mkdir: mock().mockResolvedValue(undefined),
}));

afterAll(() => {
	mock.restore();
});

function makeDiscrepancy(overrides: Partial<Discrepancy> = {}): Discrepancy {
	return {
		projectName: "Dashboard",
		type: "date",
		aiValue: "2026-02-15",
		sourceValue: "not found in source data",
		sourceFile: "standup.md",
		bulletText: "Launched dashboard redesign on 2026-02-15",
		rationale:
			'The AI extracted the date "2026-02-15" from a bullet about "Dashboard", but this date does not appear anywhere in the meeting notes or Asana custom fields. The AI may have inferred or hallucinated this date from surrounding context.',
		...overrides,
	};
}

describe("logDiscrepancies", () => {
	it("does nothing for empty discrepancies", async () => {
		const { appendFile } = await import("node:fs/promises");
		const { consola } = await import("consola");
		const { logDiscrepancies } = await import(
			"../../../src/services/discrepancy-reviewer.js"
		);

		await logDiscrepancies([]);

		expect(appendFile).not.toHaveBeenCalled();
		expect(consola.info).not.toHaveBeenCalled();
	});

	it("writes discrepancies to log file and prints summary", async () => {
		const { appendFile } = await import("node:fs/promises");
		const { consola } = await import("consola");
		const { logDiscrepancies } = await import(
			"../../../src/services/discrepancy-reviewer.js"
		);

		const discrepancies = [
			makeDiscrepancy(),
			makeDiscrepancy({
				type: "figure",
				aiValue: "$1.2M",
				bulletText: "Reduced costs by $1.2M",
			}),
		];

		await logDiscrepancies(discrepancies);

		expect(appendFile).toHaveBeenCalledOnce();
		const logContent = (appendFile as ReturnType<typeof mock>).mock
			.calls[0][1] as string;
		expect(logContent).toContain("Found 2 factual discrepancies");
		expect(logContent).toContain("[Dashboard] date discrepancy");
		expect(logContent).toContain("[Dashboard] figure discrepancy");
		expect(logContent).toContain('AI value:    "2026-02-15"');
		expect(logContent).toContain('AI value:    "$1.2M"');
		expect(logContent).toContain("Rationale:");

		expect(consola.info).toHaveBeenCalledWith(
			expect.stringContaining("Found 2 factual discrepancies"),
		);
	});

	it("includes bullet text and rationale in log output", async () => {
		const { appendFile } = await import("node:fs/promises");
		const { logDiscrepancies } = await import(
			"../../../src/services/discrepancy-reviewer.js"
		);

		await logDiscrepancies([makeDiscrepancy()]);

		const logContent = (appendFile as ReturnType<typeof mock>).mock
			.calls[0][1] as string;
		expect(logContent).toContain("Launched dashboard redesign on 2026-02-15");
		expect(logContent).toContain("inferred or hallucinated");
	});

	it("uses singular form for single discrepancy", async () => {
		const { consola } = await import("consola");
		const { logDiscrepancies } = await import(
			"../../../src/services/discrepancy-reviewer.js"
		);

		await logDiscrepancies([makeDiscrepancy()]);

		expect(consola.info).toHaveBeenCalledWith(
			expect.stringContaining("Found 1 factual discrepancy"),
		);
	});

	it("creates log directory before writing", async () => {
		const { mkdir } = await import("node:fs/promises");
		const { logDiscrepancies } = await import(
			"../../../src/services/discrepancy-reviewer.js"
		);

		await logDiscrepancies([makeDiscrepancy()]);

		expect(mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
	});
});
