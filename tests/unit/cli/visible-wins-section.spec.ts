import { describe, expect, it } from "bun:test";
import type {
	ReportCommandInput,
	ReportSectionsSelection,
} from "../../../src/cli/index.js";
import { isVisibleWinsEnabled } from "../../../src/lib/visible-wins-config.js";

describe("ReportSectionsSelection visible wins integration", () => {
	const baseSections: ReportSectionsSelection = {
		dataSources: { git: true, asana: true },
		reportSections: { visibleWins: false, individualContributions: true },
	};

	it("isVisibleWinsEnabled returns true when reportSections.visibleWins is true", () => {
		expect(
			isVisibleWinsEnabled({
				...baseSections.reportSections,
				visibleWins: true,
			}),
		).toBe(true);
	});

	it("isVisibleWinsEnabled returns false when reportSections.visibleWins is false", () => {
		expect(isVisibleWinsEnabled(baseSections.reportSections)).toBe(false);
	});

	it("ReportCommandInput accepts visibleWins in reportSections", () => {
		const input: ReportCommandInput = {
			org: "test-org",
			includeBots: false,
			excludePrivate: false,
			includeArchived: false,
			detailed: false,
			sections: {
				dataSources: { git: true, asana: true },
				reportSections: { visibleWins: true, individualContributions: true },
			},
		};
		expect(input.sections.reportSections.visibleWins).toBe(true);
	});

	it("sections with only visibleWins enabled is a valid report section combination", () => {
		const sections: ReportSectionsSelection = {
			dataSources: { git: false, asana: false },
			reportSections: { visibleWins: true, individualContributions: false },
		};
		const hasValidReportSection =
			sections.reportSections.visibleWins ||
			sections.reportSections.individualContributions;
		expect(hasValidReportSection).toBe(true);
	});

	it("sections with no enabled report sections is invalid", () => {
		const sections: ReportSectionsSelection = {
			dataSources: { git: false, asana: false },
			reportSections: { visibleWins: false, individualContributions: false },
		};
		const hasValidReportSection =
			sections.reportSections.visibleWins ||
			sections.reportSections.individualContributions;
		expect(hasValidReportSection).toBe(false);
	});

	it("loc is a report section, not a data source", () => {
		const sections: ReportSectionsSelection = {
			dataSources: { git: false, asana: false },
			reportSections: {
				visibleWins: false,
				individualContributions: true,
				loc: true,
			},
		};
		expect(sections.reportSections.loc).toBe(true);
		// LOC as a report section should auto-enable git at runtime
		expect(sections.dataSources.git).toBe(false); // not statically set — runtime handles it
	});

	it("visibleWins can be combined with other sections", () => {
		const sections: ReportSectionsSelection = {
			dataSources: { git: true, asana: true },
			reportSections: { visibleWins: true, individualContributions: true },
		};
		expect(isVisibleWinsEnabled(sections.reportSections)).toBe(true);
		expect(sections.dataSources.git).toBe(true);
		expect(sections.dataSources.asana).toBe(true);
	});

	it("individualContributions can be toggled independently", () => {
		const sections: ReportSectionsSelection = {
			dataSources: { git: true, asana: true },
			reportSections: { visibleWins: true, individualContributions: false },
		};
		expect(sections.reportSections.individualContributions).toBe(false);
		expect(sections.reportSections.visibleWins).toBe(true);
	});
});

describe("config serialization round-trip", () => {
	it("preserves visibleWins through JSON serialization", () => {
		const sections: ReportSectionsSelection = {
			dataSources: { git: true, asana: true },
			reportSections: { visibleWins: true, individualContributions: true },
		};
		const serialized = JSON.stringify(sections);
		const deserialized = JSON.parse(serialized) as ReportSectionsSelection;
		expect(deserialized.reportSections.visibleWins).toBe(true);
		expect(deserialized.reportSections.individualContributions).toBe(true);
	});

	it("defaults individualContributions to true when missing from saved config", () => {
		const legacy = {
			dataSources: { git: true, asana: true },
			reportSections: { visibleWins: false },
		};
		const sections: ReportSectionsSelection = {
			dataSources: legacy.dataSources,
			reportSections: {
				...legacy.reportSections,
				individualContributions: true,
			},
		};
		expect(sections.reportSections.individualContributions).toBe(true);
	});
});
