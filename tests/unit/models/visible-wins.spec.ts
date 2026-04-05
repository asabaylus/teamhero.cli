import { describe, expect, it } from "bun:test";
import type {
	AccomplishmentBullet,
	NormalizedNote,
	ProjectAccomplishment,
	ProjectTask,
} from "../../../src/models/visible-wins.js";

describe("Visible Wins domain types", () => {
	it("ProjectTask uses domain language, not Asana-specific names", () => {
		const task: ProjectTask = {
			name: "Alpha Platform",
			gid: "1234567890",
			customFields: { "RICE Score": 95, Status: "Active" },
			priorityScore: 95,
		};
		expect(task.name).toBe("Alpha Platform");
		expect(task.gid).toBe("1234567890");
		expect(task.customFields["RICE Score"]).toBe(95);
		expect(task.priorityScore).toBe(95);
	});

	it("ProjectTask accepts priorityScore of 0 for projects without priority field", () => {
		const task: ProjectTask = {
			name: "No Priority Project",
			gid: "999",
			customFields: {},
			priorityScore: 0,
		};
		expect(task.priorityScore).toBe(0);
		expect(task.customFields).toEqual({});
	});

	it("ProjectTask.customFields supports string, number, and null values", () => {
		const task: ProjectTask = {
			name: "Mixed Fields",
			gid: "111",
			customFields: {
				Status: "Active",
				Score: 42,
				Notes: null,
			},
			priorityScore: 42,
		};
		expect(task.customFields.Status).toBe("Active");
		expect(task.customFields.Score).toBe(42);
		expect(task.customFields.Notes).toBeNull();
	});

	it("NormalizedNote uses domain language, not Google-specific names", () => {
		const note: NormalizedNote = {
			title: "Weekly Standup",
			date: "2026-01-22",
			attendees: ["Alice", "Bob", "Charlie"],
			discussionItems: [
				"Discussed Alpha launch timeline",
				"Reviewed budget impact",
			],
			sourceFile: "2026 01 22 Weekly Standup.md",
		};
		expect(note.title).toBe("Weekly Standup");
		expect(note.date).toBe("2026-01-22");
		expect(note.attendees).toHaveLength(3);
		expect(note.discussionItems).toHaveLength(2);
		expect(note.sourceFile).toBe("2026 01 22 Weekly Standup.md");
	});

	it("AccomplishmentBullet includes source attribution for validation", () => {
		const bullet: AccomplishmentBullet = {
			text: "Launched Alpha platform ahead of Jan 30 deadline",
			subBullets: ["Reduced onboarding time by 40%"],
			sourceDates: ["2026-01-30"],
			sourceFigures: ["40%"],
			sourceNoteFile: "2026 01 22 Weekly Standup.md",
		};
		expect(bullet.text).toContain("Alpha platform");
		expect(bullet.subBullets).toHaveLength(1);
		expect(bullet.sourceDates).toContain("2026-01-30");
		expect(bullet.sourceFigures).toContain("40%");
		expect(bullet.sourceNoteFile).toBe("2026 01 22 Weekly Standup.md");
	});

	it("ProjectAccomplishment groups bullets by project", () => {
		const accomplishment: ProjectAccomplishment = {
			projectName: "Alpha Platform",
			projectGid: "1234567890",
			bullets: [
				{
					text: "Shipped v2 release",
					subBullets: [],
					sourceDates: [],
					sourceFigures: [],
					sourceNoteFile: "2026 01 22 Weekly Standup.md",
				},
				{
					text: "Reduced costs by $15k/month",
					subBullets: ["Migrated to new vendor"],
					sourceDates: [],
					sourceFigures: ["$15k"],
					sourceNoteFile: "2026 01 20 Team Sync.md",
				},
			],
		};
		expect(accomplishment.projectName).toBe("Alpha Platform");
		expect(accomplishment.projectGid).toBe("1234567890");
		expect(accomplishment.bullets).toHaveLength(2);
	});

	it("ProjectAccomplishment with empty bullets represents No Change", () => {
		const noChange: ProjectAccomplishment = {
			projectName: "Quiet Project",
			projectGid: "999",
			bullets: [],
		};
		expect(noChange.bullets).toHaveLength(0);
	});
});
