import { describe, expect, it } from "bun:test";
import type { RoadmapEntry } from "../../../src/core/types.js";
import { renderRoadmapSection } from "../../../src/lib/report-renderer.js";

describe("renderRoadmapSection", () => {
	it("renders a markdown table with header and rows", () => {
		const items: RoadmapEntry[] = [
			{
				gid: "r1",
				displayName: "GCCW v1.x available",
				overallStatus: "at-risk",
				nextMilestone: "2wks - Start Pilot",
				keyNotes: "Testing underway in UAT",
			},
			{
				gid: "r2",
				displayName: "SOC 2 Type 1 audit",
				overallStatus: "on-track",
				nextMilestone: "TBD - Cloud Infra Call",
				keyNotes: "Review prep work",
			},
		];

		const result = renderRoadmapSection(items);
		const lines = result.split("\n");

		expect(lines[0]).toBe("## **Progress on Quarterly Roadmap (Rocks)**");
		expect(lines[1]).toBe("");
		expect(lines[2]).toContain("Initiative / Epic");
		expect(lines[3]).toContain(":----");
		expect(lines[4]).toContain("**GCCW v1.x available**");
		expect(lines[4]).toContain("2wks - Start Pilot");
		expect(lines[4]).toContain("\u{1F7E1}"); // yellow circle for at-risk
		expect(lines[5]).toContain("**SOC 2 Type 1 audit**");
		expect(lines[5]).toContain("\u{1F7E2}"); // green circle for on-track
	});

	it("uses custom title when provided", () => {
		const items: RoadmapEntry[] = [
			{
				gid: "1",
				displayName: "A",
				overallStatus: "on-track",
				nextMilestone: "",
				keyNotes: "",
			},
		];

		const result = renderRoadmapSection(items, "Strategic Initiatives");
		const lines = result.split("\n");

		expect(lines[0]).toBe("## **Strategic Initiatives**");
	});

	it("maps status to correct emoji", () => {
		const items: RoadmapEntry[] = [
			{
				gid: "1",
				displayName: "A",
				overallStatus: "on-track",
				nextMilestone: "",
				keyNotes: "",
			},
			{
				gid: "2",
				displayName: "B",
				overallStatus: "at-risk",
				nextMilestone: "",
				keyNotes: "",
			},
			{
				gid: "3",
				displayName: "C",
				overallStatus: "off-track",
				nextMilestone: "",
				keyNotes: "",
			},
			{
				gid: "4",
				displayName: "D",
				overallStatus: "unknown",
				nextMilestone: "",
				keyNotes: "",
			},
		];

		const result = renderRoadmapSection(items);

		expect(result).toContain("\u{1F7E2}"); // green
		expect(result).toContain("\u{1F7E1}"); // yellow
		expect(result).toContain("\u{1F534}"); // red
		expect(result).toContain("\u26AA"); // white
	});

	it("escapes pipe characters in display name and notes", () => {
		const items: RoadmapEntry[] = [
			{
				gid: "r1",
				displayName: "Project A | Phase 1",
				overallStatus: "on-track",
				nextMilestone: "Milestone | soon",
				keyNotes: "Note | important",
			},
		];

		const result = renderRoadmapSection(items);

		expect(result).toContain("Project A \\| Phase 1");
		expect(result).toContain("Milestone \\| soon");
		expect(result).toContain("Note \\| important");
	});
});
