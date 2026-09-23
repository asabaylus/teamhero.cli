import { describe, expect, it } from "bun:test";
import { completedTicketsObservationStatus } from "../../../src/services/report.service.js";

describe("completedTicketsObservationStatus", () => {
	it("treats an omitted GitHub issue family as non-contributing", () => {
		expect(completedTicketsObservationStatus(true, "not-requested")).toBe(
			"reported",
		);
		expect(completedTicketsObservationStatus(true, undefined)).toBe("reported");
	});

	it("preserves actual incomplete coverage", () => {
		expect(completedTicketsObservationStatus(true, "partial")).toBe("partial");
		expect(completedTicketsObservationStatus(true, "unavailable")).toBe(
			"partial",
		);
		expect(completedTicketsObservationStatus(false, "reported")).toBe(
			"partial",
		);
	});
});
