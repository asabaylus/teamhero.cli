import { describe, expect, it } from "bun:test";
import { renderVisibleWinsSection } from "../../../src/lib/report-renderer.js";
import type {
	ProjectAccomplishment,
	ProjectTask,
} from "../../../src/models/visible-wins.js";

function makeProject(overrides: Partial<ProjectTask> = {}): ProjectTask {
	return {
		name: "Dashboard",
		gid: "gid-1",
		customFields: {},
		priorityScore: 80,
		...overrides,
	};
}

function makeAccomplishment(
	overrides: Partial<ProjectAccomplishment> = {},
): ProjectAccomplishment {
	return {
		projectName: "Dashboard",
		projectGid: "gid-1",
		bullets: [
			{
				text: "Completed dashboard redesign improving load time by 40%",
				subBullets: ["Migrated to server-side rendering"],
				sourceDates: ["2026-01-28"],
				sourceFigures: ["40%"],
				sourceNoteFile: "standup.md",
			},
		],
		...overrides,
	};
}

describe("renderVisibleWinsSection", () => {
	it("renders H2 heading followed by a blank line", () => {
		const output = renderVisibleWinsSection(
			[makeAccomplishment()],
			[makeProject()],
		);
		const lines = output.split("\n");
		expect(lines[0]).toBe(
			"## **This Week's Visible Wins & Delivered Outcomes**",
		);
		expect(lines[1]).toBe("");
	});

	it("renders standard bullets with asterisk + space prefix", () => {
		const output = renderVisibleWinsSection(
			[makeAccomplishment()],
			[makeProject()],
		);
		expect(output).toContain("* Completed dashboard redesign");
	});

	it("promotes sub-bullets to flat top-level bullets", () => {
		const output = renderVisibleWinsSection(
			[makeAccomplishment()],
			[makeProject()],
		);
		expect(output).toContain("* Migrated to server-side rendering");
		// Verify no indented bullets
		const lines = output.split("\n").filter((l) => l.includes("Migrated"));
		expect(lines[0]).toBe("* Migrated to server-side rendering");
	});

	it("orders projects by priority score descending", () => {
		const accomplishments = [
			makeAccomplishment({
				projectName: "Low Priority",
				projectGid: "gid-low",
				bullets: [
					{
						text: "Low item",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "a.md",
					},
				],
			}),
			makeAccomplishment({
				projectName: "High Priority",
				projectGid: "gid-high",
				bullets: [
					{
						text: "High item",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "b.md",
					},
				],
			}),
		];
		const projects = [
			makeProject({ gid: "gid-low", name: "Low Priority", priorityScore: 20 }),
			makeProject({
				gid: "gid-high",
				name: "High Priority",
				priorityScore: 90,
			}),
		];

		const output = renderVisibleWinsSection(accomplishments, projects);
		const highIdx = output.indexOf("High Priority");
		const lowIdx = output.indexOf("Low Priority");
		expect(highIdx).toBeLessThan(lowIdx);
	});

	it("excludes projects with no bullets from output", () => {
		const output = renderVisibleWinsSection(
			[makeAccomplishment({ bullets: [] })],
			[makeProject()],
		);
		expect(output).not.toContain("Dashboard");
		expect(output).not.toContain("No Change");
	});

	it("separates workstream blocks with a blank line", () => {
		const accomplishments = [
			makeAccomplishment({ projectName: "Project A", projectGid: "a" }),
			makeAccomplishment({ projectName: "Project B", projectGid: "b" }),
		];
		const projects = [
			makeProject({ gid: "a", name: "Project A", priorityScore: 80 }),
			makeProject({ gid: "b", name: "Project B", priorityScore: 60 }),
		];

		const output = renderVisibleWinsSection(accomplishments, projects);
		const lines = output.split("\n");

		const projectBIdx = lines.indexOf("Project B");

		expect(lines[projectBIdx - 1]).toBe("");
	});

	it("handles empty accomplishments with just the heading", () => {
		const output = renderVisibleWinsSection([], []);
		expect(output).toContain(
			"## **This Week's Visible Wins & Delivered Outcomes**",
		);
		const lines = output.split("\n");
		expect(lines).toHaveLength(2);
	});

	it("merges duplicate project entries into a single heading", () => {
		const accomplishments = [
			makeAccomplishment({
				projectName: "Omni-Channel",
				projectGid: "gid-omni",
				bullets: [
					{
						text: "Daniel Brenner onboarded",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "a.md",
					},
				],
			}),
			makeAccomplishment({
				projectName: "Omni-Channel",
				projectGid: "gid-omni",
				bullets: [
					{
						text: "LOA submission requires 14 business days",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "b.md",
					},
				],
			}),
		];
		const projects = [
			makeProject({ gid: "gid-omni", name: "Omni-Channel", priorityScore: 50 }),
		];

		const output = renderVisibleWinsSection(accomplishments, projects);
		const headingCount = output
			.split("\n")
			.filter((l) => l === "Omni-Channel").length;
		expect(headingCount).toBe(1);
		expect(output).toContain("* Daniel Brenner onboarded");
		expect(output).toContain("* LOA submission requires 14 business days");
	});

	it("strips project name prefix from bullet text", () => {
		const accomplishments = [
			makeAccomplishment({
				projectName: "Omni-Channel",
				projectGid: "gid-omni",
				bullets: [
					{
						text: "Omni-Channel — Daniel Brenner onboarded",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "a.md",
					},
					{
						text: "Omni-Channel: LOA submitted",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "a.md",
					},
				],
			}),
		];
		const projects = [makeProject({ gid: "gid-omni", priorityScore: 50 })];

		const output = renderVisibleWinsSection(accomplishments, projects);
		expect(output).toContain("* Daniel Brenner onboarded");
		expect(output).toContain("* LOA submitted");
		expect(output).not.toContain("* Omni-Channel —");
		expect(output).not.toContain("* Omni-Channel:");
	});

	it("deduplicates identical bullets within a project", () => {
		const accomplishments = [
			makeAccomplishment({
				projectName: "GCCW",
				projectGid: "gid-gccw",
				bullets: [
					{
						text: "Smoke test suite complete",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "a.md",
					},
					{
						text: "Smoke test suite complete",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "b.md",
					},
				],
			}),
		];
		const projects = [makeProject({ gid: "gid-gccw", priorityScore: 70 })];

		const output = renderVisibleWinsSection(accomplishments, projects);
		const bulletLines = output
			.split("\n")
			.filter((l) => l.includes("Smoke test suite complete"));
		expect(bulletLines).toHaveLength(1);
	});

	it("flattens multi-line bullet text into separate flat bullets", () => {
		const accomplishments = [
			makeAccomplishment({
				projectName: "SMS",
				projectGid: "gid-sms",
				bullets: [
					{
						text: "SMS limited to mobile field\n   * Fallback removed for carrier safety",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "a.md",
					},
				],
			}),
		];
		const projects = [makeProject({ gid: "gid-sms", priorityScore: 60 })];

		const output = renderVisibleWinsSection(accomplishments, projects);
		expect(output).toContain("* SMS limited to mobile field");
		expect(output).toContain("* Fallback removed for carrier safety");
		// No indented bullets
		expect(output).not.toMatch(/^\s+\*/m);
	});

	it("renders all projects flat regardless of parent-child hierarchy", () => {
		const accomplishments = [
			makeAccomplishment({
				projectName: "Phase 1: Prioritize the Right Patients",
				projectGid: "gid-phase1",
				bullets: [
					{
						text: "Prioritization logic validated",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "standup.md",
					},
				],
			}),
			makeAccomplishment({
				projectName: "Phase 2: Outreach at the Right Time",
				projectGid: "gid-phase2",
				bullets: [
					{
						text: "Outreach timing refined for last 7 days",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "standup.md",
					},
				],
			}),
		];
		const projects = [
			makeProject({
				gid: "gid-parent",
				name: "Enrollment Lead Routing Recalibration",
				priorityScore: 90,
			}),
			makeProject({
				gid: "gid-phase1",
				name: "Phase 1: Prioritize the Right Patients",
				priorityScore: 70,
				parentGid: "gid-parent",
				parentName: "Enrollment Lead Routing Recalibration",
			}),
			makeProject({
				gid: "gid-phase2",
				name: "Phase 2: Outreach at the Right Time",
				priorityScore: 65,
				parentGid: "gid-parent",
				parentName: "Enrollment Lead Routing Recalibration",
			}),
		];

		const output = renderVisibleWinsSection(accomplishments, projects);

		// Parent with no accomplishments is suppressed
		expect(output).not.toContain("Enrollment Lead Routing Recalibration");
		// Children with accomplishments are rendered flat
		expect(output).toContain("Phase 1: Prioritize the Right Patients");
		expect(output).toContain("* Prioritization logic validated");
		expect(output).toContain("Phase 2: Outreach at the Right Time");
		expect(output).toContain("* Outreach timing refined for last 7 days");
		// No disclaimer about hierarchy
		expect(output).not.toContain("Related subtasks are grouped");
		// No indented bullets
		expect(output).not.toMatch(/^\s+\*/m);
	});

	it("renders parent and child projects flat with parent bullets before child", () => {
		const accomplishments = [
			makeAccomplishment({
				projectName: "Enrollment Lead Routing Recalibration",
				projectGid: "gid-parent",
				bullets: [
					{
						text: "Overall routing strategy approved",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "standup.md",
					},
				],
			}),
			makeAccomplishment({
				projectName: "Phase 1: Prioritize the Right Patients",
				projectGid: "gid-phase1",
				bullets: [
					{
						text: "Prioritization logic validated",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "standup.md",
					},
				],
			}),
		];
		const projects = [
			makeProject({
				gid: "gid-parent",
				name: "Enrollment Lead Routing Recalibration",
				priorityScore: 90,
			}),
			makeProject({
				gid: "gid-phase1",
				name: "Phase 1: Prioritize the Right Patients",
				priorityScore: 70,
				parentGid: "gid-parent",
				parentName: "Enrollment Lead Routing Recalibration",
			}),
		];

		const output = renderVisibleWinsSection(accomplishments, projects);

		expect(output).toContain("Enrollment Lead Routing Recalibration");
		expect(output).toContain("* Overall routing strategy approved");
		expect(output).toContain("Phase 1: Prioritize the Right Patients");
		expect(output).toContain("* Prioritization logic validated");
		// Parent (higher priority) appears before child
		const parentIdx = output.indexOf("Enrollment Lead Routing Recalibration");
		const phase1Idx = output.indexOf("Phase 1: Prioritize the Right Patients");
		expect(parentIdx).toBeLessThan(phase1Idx);
	});

	it("renders a task once when it is both child and parent (flat)", () => {
		const accomplishments = [
			makeAccomplishment({
				projectName: "Phase 1: Prioritize the Right Patients",
				projectGid: "gid-phase1",
				bullets: [
					{
						text: "Inserted 19,071 enrollment outreach records",
						subBullets: [],
						sourceDates: [],
						sourceFigures: ["19,071"],
						sourceNoteFile: "standup.md",
					},
				],
			}),
			makeAccomplishment({
				projectName: "Add Skills Assignments for Practice Level",
				projectGid: "gid-phase1-child",
				bullets: [
					{
						text: "Deployed practice-level skill routing assignments",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "standup.md",
					},
				],
			}),
		];
		const projects = [
			makeProject({
				gid: "gid-parent",
				name: "Enrollment Lead Routing Recalibration",
				priorityScore: 100,
			}),
			makeProject({
				gid: "gid-phase1",
				name: "Phase 1: Prioritize the Right Patients",
				priorityScore: 80,
				parentGid: "gid-parent",
				parentName: "Enrollment Lead Routing Recalibration",
			}),
			makeProject({
				gid: "gid-phase1-child",
				name: "Add Skills Assignments for Practice Level",
				priorityScore: 60,
				parentGid: "gid-phase1",
				parentName: "Phase 1: Prioritize the Right Patients",
			}),
		];

		const output = renderVisibleWinsSection(accomplishments, projects);
		const phase1HeadingCount = output
			.split("\n")
			.filter(
				(line) => line.trim() === "Phase 1: Prioritize the Right Patients",
			).length;

		expect(phase1HeadingCount).toBe(1);
		// All rendered flat — no indentation
		expect(output).toContain("Add Skills Assignments for Practice Level");
		expect(output).toContain(
			"* Deployed practice-level skill routing assignments",
		);
		expect(output).not.toMatch(/^\s+\*/m);
	});

	it("produces a flat list with no indented bullets", () => {
		const accomplishments = [
			makeAccomplishment({
				projectName: "Same Phone Voice+SMS",
				projectGid: "gid-sms",
				bullets: [
					{
						text: "Same Phone Voice+SMS — Decision: SMS limited to mobile field only",
						subBullets: ["Rachel to finalize practice-name mapping"],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "a.md",
					},
					{
						text: "Same Phone Voice+SMS — LOA list prepared for 114 practice numbers",
						subBullets: [],
						sourceDates: [],
						sourceFigures: [],
						sourceNoteFile: "a.md",
					},
				],
			}),
		];
		const projects = [makeProject({ gid: "gid-sms", priorityScore: 60 })];

		const output = renderVisibleWinsSection(accomplishments, projects);
		const lines = output.split("\n");
		const bulletLines = lines.filter((l) => /^\s*\* /.test(l));
		for (const line of bulletLines) {
			expect(line).toMatch(/^\* /);
		}
		expect(output).toContain("* Decision: SMS limited to mobile field only");
		expect(output).toContain("* LOA list prepared for 114 practice numbers");
		expect(output).toContain("* Rachel to finalize practice-name mapping");
	});
});
