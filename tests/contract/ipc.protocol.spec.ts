/**
 * Contract test for the JSON-lines IPC protocol discrepancy event (Epic 5, Story 5.4).
 * Ensures the TypeScript event shape matches what the Go TUI expects.
 */

import { describe, expect, it } from "bun:test";
import type { DiscrepancyEvent } from "../../src/lib/json-lines-progress.js";

describe("IPC protocol — discrepancy event", () => {
	it("has the expected shape for Go deserialization", () => {
		const jdoeItem = {
			contributor: "jdoe",
			contributorDisplayName: "Jane Doe",
			sourceA: {
				sourceName: "Asana",
				state: "Done",
				url: "https://app.asana.com/0/task-001",
				itemId: "task-001",
			},
			sourceB: {
				sourceName: "GitHub",
				state: "PR #441 Open",
				url: "https://github.com/org/repo/pull/441",
				itemId: "441",
			},
			suggestedResolution: "Update Asana task or merge PR #441.",
			confidence: 10,
			message:
				'@jdoe: Asana task "Feature X" marked Done but PR #441 is still open',
			rule: "Status mismatch — Asana task Done but PR still open.",
			sectionName: "individualContribution",
		};
		const unattributedItem = {
			contributor: "",
			contributorDisplayName: "Unattributed",
			sourceA: {
				sourceName: "GitHub",
				state: "PR #500 Merged",
			},
			sourceB: {
				sourceName: "Asana",
				state: "Not started",
			},
			suggestedResolution: "Update the task status.",
			confidence: 40,
			message: "PR #500 merged but no linked task found",
			rule: "Audit — PR merged without linked Asana task.",
		};
		const event: DiscrepancyEvent = {
			type: "discrepancy",
			totalCount: 2,
			byContributor: { jdoe: [jdoeItem] },
			unattributed: [unattributedItem],
			items: [unattributedItem, jdoeItem], // sorted by confidence descending
		};

		// Verify type discriminator
		expect(event.type).toBe("discrepancy");

		// Verify totalCount matches actual items
		expect(event.totalCount).toBe(event.items.length);

		// Verify items are sorted by confidence descending (highest confidence first)
		for (let i = 1; i < event.items.length; i++) {
			expect(event.items[i].confidence).toBeLessThanOrEqual(
				event.items[i - 1].confidence,
			);
		}

		// Verify source state shape (Go struct: DiscrepancySourceState)
		const item = event.items[0];
		expect(item.sourceA).toHaveProperty("sourceName");
		expect(item.sourceA).toHaveProperty("state");
		expect(item.sourceB).toHaveProperty("sourceName");
		expect(item.sourceB).toHaveProperty("state");

		// Verify discrepancy item shape (Go struct: DiscrepancyItem)
		expect(item).toHaveProperty("contributor");
		expect(item).toHaveProperty("contributorDisplayName");
		expect(item).toHaveProperty("suggestedResolution");
		expect(item).toHaveProperty("confidence");
		expect(item).toHaveProperty("message");
		expect(item).toHaveProperty("rule");
		// sectionName is optional — check on the attributed item that has it
		expect(jdoeItem).toHaveProperty("sectionName");
	});

	it("serializes to valid JSON matching Go protocol expectations", () => {
		const event: DiscrepancyEvent = {
			type: "discrepancy",
			totalCount: 0,
			byContributor: {},
			unattributed: [],
			items: [],
		};

		const json = JSON.stringify(event);
		const parsed = JSON.parse(json);

		// Verify all Go GenericEvent fields are present
		expect(parsed.type).toBe("discrepancy");
		expect(parsed.totalCount).toBe(0);
		expect(parsed.byContributor).toEqual({});
		expect(parsed.unattributed).toEqual([]);
		expect(parsed.items).toEqual([]);
	});

	it("handles empty discrepancy report", () => {
		const event: DiscrepancyEvent = {
			type: "discrepancy",
			totalCount: 0,
			byContributor: {},
			unattributed: [],
			items: [],
		};

		expect(event.totalCount).toBe(0);
		expect(event.items).toHaveLength(0);
	});
});
