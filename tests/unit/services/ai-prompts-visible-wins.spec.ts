import { describe, expect, it } from "bun:test";
import type { ProjectNoteAssociation } from "../../../src/adapters/meeting-notes/note-project-associator.js";
import type {
	AccomplishmentBullet,
	NormalizedNote,
	ProjectAccomplishment,
	ProjectTask,
} from "../../../src/models/visible-wins.js";
import {
	VISIBLE_WINS_SCHEMA,
	type VisibleWinsExtractionContext,
	buildVisibleWinsExtractionPrompt,
} from "../../../src/services/ai-prompts.js";

function makeProject(
	name: string,
	gid: string,
	priorityScore = 0,
): ProjectTask {
	return { name, gid, customFields: {}, priorityScore };
}

function makeNote(
	overrides: Partial<NormalizedNote> & { discussionItems: string[] },
): NormalizedNote {
	return {
		title: "Test Meeting",
		date: "2026-01-29",
		attendees: [],
		sourceFile: "test.md",
		...overrides,
	};
}

function makeAssociation(
	projectName: string,
	projectGid: string,
	relevantItems: string[],
	sourceNotes: string[],
): ProjectNoteAssociation {
	return { projectName, projectGid, relevantItems, sourceNotes };
}

describe("VISIBLE_WINS_SCHEMA", () => {
	it("has strict mode enabled", () => {
		expect(VISIBLE_WINS_SCHEMA.strict).toBe(true);
	});

	it("has type json_schema for OpenAI Responses API text.format", () => {
		expect(VISIBLE_WINS_SCHEMA.type).toBe("json_schema");
	});

	it("uses json_schema name visible_wins_extraction", () => {
		expect(VISIBLE_WINS_SCHEMA.name).toBe("visible_wins_extraction");
	});

	it("requires accomplishments array at root", () => {
		expect(VISIBLE_WINS_SCHEMA.schema.required).toContain("accomplishments");
		expect(VISIBLE_WINS_SCHEMA.schema.properties.accomplishments.type).toBe(
			"array",
		);
	});

	it("enforces ProjectAccomplishment structure per item", () => {
		const itemSchema =
			VISIBLE_WINS_SCHEMA.schema.properties.accomplishments.items;
		expect(itemSchema.required).toContain("projectName");
		expect(itemSchema.required).toContain("projectGid");
		expect(itemSchema.required).toContain("bullets");
		expect(itemSchema.additionalProperties).toBe(false);
	});

	it("enforces AccomplishmentBullet structure with source attribution", () => {
		const bulletSchema =
			VISIBLE_WINS_SCHEMA.schema.properties.accomplishments.items.properties
				.bullets.items;
		expect(bulletSchema.required).toContain("text");
		expect(bulletSchema.required).toContain("subBullets");
		expect(bulletSchema.required).toContain("sourceDates");
		expect(bulletSchema.required).toContain("sourceFigures");
		expect(bulletSchema.required).toContain("sourceNoteFile");
		expect(bulletSchema.additionalProperties).toBe(false);
	});

	it("disallows additional properties at all levels", () => {
		expect(VISIBLE_WINS_SCHEMA.schema.additionalProperties).toBe(false);
		expect(
			VISIBLE_WINS_SCHEMA.schema.properties.accomplishments.items
				.additionalProperties,
		).toBe(false);
	});

	it("schema fields match ProjectAccomplishment interface keys", () => {
		const schemaKeys = Object.keys(
			VISIBLE_WINS_SCHEMA.schema.properties.accomplishments.items.properties,
		).sort();
		const interfaceKeys: (keyof ProjectAccomplishment)[] = [
			"projectName",
			"projectGid",
			"bullets",
		];
		expect(schemaKeys).toEqual(interfaceKeys.sort());
	});

	it("schema bullet fields match AccomplishmentBullet interface keys", () => {
		const bulletSchemaKeys = Object.keys(
			VISIBLE_WINS_SCHEMA.schema.properties.accomplishments.items.properties
				.bullets.items.properties,
		).sort();
		const interfaceKeys: (keyof AccomplishmentBullet)[] = [
			"text",
			"subBullets",
			"sourceDates",
			"sourceFigures",
			"sourceNoteFile",
		];
		expect(bulletSchemaKeys).toEqual(interfaceKeys.sort());
	});
});

describe("buildVisibleWinsExtractionPrompt", () => {
	it("includes project names and GIDs in the prompt", () => {
		const context: VisibleWinsExtractionContext = {
			projects: [makeProject("Dashboard", "gid-1", 95)],
			associations: [
				makeAssociation(
					"Dashboard",
					"gid-1",
					["Sprint progress on Dashboard"],
					["standup.md"],
				),
			],
			notes: [makeNote({ discussionItems: ["Sprint progress on Dashboard"] })],
		};

		const prompt = buildVisibleWinsExtractionPrompt(context);

		expect(prompt).toContain("Dashboard");
		expect(prompt).toContain("gid-1");
	});

	it("includes priority scores", () => {
		const project = makeProject("API Gateway", "gid-2", 85);
		const context: VisibleWinsExtractionContext = {
			projects: [project],
			associations: [
				makeAssociation(
					"API Gateway",
					"gid-2",
					["Migration planning"],
					["note.md"],
				),
			],
			notes: [makeNote({ discussionItems: ["Migration planning"] })],
		};

		const prompt = buildVisibleWinsExtractionPrompt(context);

		expect(prompt).toContain("Priority Score: 85");
	});

	it("includes relevant discussion items from associations", () => {
		const context: VisibleWinsExtractionContext = {
			projects: [makeProject("Dashboard", "gid-1")],
			associations: [
				makeAssociation(
					"Dashboard",
					"gid-1",
					["Dashboard redesign completed", "Dashboard metrics improved 20%"],
					["standup.md"],
				),
			],
			notes: [
				makeNote({
					discussionItems: [
						"Dashboard redesign completed",
						"Dashboard metrics improved 20%",
					],
				}),
			],
		};

		const prompt = buildVisibleWinsExtractionPrompt(context);

		expect(prompt).toContain("Dashboard redesign completed");
		expect(prompt).toContain("Dashboard metrics improved 20%");
	});

	it("includes meeting note metadata", () => {
		const context: VisibleWinsExtractionContext = {
			projects: [makeProject("Dashboard", "gid-1")],
			associations: [makeAssociation("Dashboard", "gid-1", [], [])],
			notes: [
				makeNote({
					title: "Weekly Standup",
					date: "2026-01-29",
					sourceFile: "2026 01 29 standup.md",
					attendees: ["Alice", "Bob"],
					discussionItems: ["Dashboard update"],
				}),
			],
		};

		const prompt = buildVisibleWinsExtractionPrompt(context);

		expect(prompt).toContain("Weekly Standup");
		expect(prompt).toContain("2026-01-29");
		expect(prompt).toContain("2026 01 29 standup.md");
		expect(prompt).toContain("Alice, Bob");
	});

	it("instructs AI to use business-value language", () => {
		const context: VisibleWinsExtractionContext = {
			projects: [],
			associations: [],
			notes: [],
		};

		const prompt = buildVisibleWinsExtractionPrompt(context);

		expect(prompt).toContain("business value");
		expect(prompt).toContain("executive");
		expect(prompt).toContain("CTO");
	});

	it("instructs AI to include source attribution fields", () => {
		const context: VisibleWinsExtractionContext = {
			projects: [],
			associations: [],
			notes: [],
		};

		const prompt = buildVisibleWinsExtractionPrompt(context);

		expect(prompt).toContain("sourceDates");
		expect(prompt).toContain("sourceFigures");
		expect(prompt).toContain("sourceNoteFile");
	});

	it("does not include system API credentials in prompt text", () => {
		const context: VisibleWinsExtractionContext = {
			projects: [],
			associations: [],
			notes: [],
		};

		const prompt = buildVisibleWinsExtractionPrompt(context);

		// NFR5: System credentials must never appear in prompts
		expect(prompt).not.toContain("OPENAI_API_KEY");
		expect(prompt).not.toContain("ASANA_TOKEN");
		expect(prompt).not.toContain("AI_API_KEY");
		expect(prompt).not.toContain("GITHUB_TOKEN");
	});

	it("includes all projects even without associations so AI can match from notes", () => {
		const project = makeProject("Dashboard", "gid-1");
		const context: VisibleWinsExtractionContext = {
			projects: [project],
			associations: [], // No associations
			notes: [makeNote({ discussionItems: ["Dashboard redesign"] })],
		};

		const prompt = buildVisibleWinsExtractionPrompt(context);

		// Project is included so the AI can match discussion items from notes
		expect(prompt).toContain("Dashboard");
		expect(prompt).toContain("gid-1");
		expect(prompt).toContain("scan Meeting Notes below");
	});

	it("handles multiple projects and notes", () => {
		const context: VisibleWinsExtractionContext = {
			projects: [
				makeProject("Dashboard", "gid-1", 95),
				makeProject("API Gateway", "gid-2", 85),
			],
			associations: [
				makeAssociation(
					"Dashboard",
					"gid-1",
					["Dashboard progress"],
					["note1.md"],
				),
				makeAssociation(
					"API Gateway",
					"gid-2",
					["API Gateway migration"],
					["note2.md"],
				),
			],
			notes: [
				makeNote({
					sourceFile: "note1.md",
					discussionItems: ["Dashboard progress"],
				}),
				makeNote({
					sourceFile: "note2.md",
					discussionItems: ["API Gateway migration"],
				}),
			],
		};

		const prompt = buildVisibleWinsExtractionPrompt(context);

		expect(prompt).toContain("Dashboard");
		expect(prompt).toContain("API Gateway");
		expect(prompt).toContain("note1.md");
		expect(prompt).toContain("note2.md");
	});

	it("includes all projects regardless of association status", () => {
		const context: VisibleWinsExtractionContext = {
			projects: [makeProject("Orphan Project", "gid-orphan")],
			associations: [],
			notes: [makeNote({ discussionItems: ["Some work"] })],
		};

		const prompt = buildVisibleWinsExtractionPrompt(context);

		expect(prompt).toContain("Orphan Project");
		expect(prompt).toContain("gid-orphan");
	});

	it("distinguishes projects with and without pre-matched items", () => {
		const context: VisibleWinsExtractionContext = {
			projects: [makeProject("Active", "gid-1"), makeProject("Empty", "gid-2")],
			associations: [
				makeAssociation("Active", "gid-1", ["Active progress"], ["note.md"]),
				makeAssociation("Empty", "gid-2", [], []),
			],
			notes: [makeNote({ discussionItems: ["Active progress"] })],
		};

		const prompt = buildVisibleWinsExtractionPrompt(context);

		expect(prompt).toContain("Project: Active");
		expect(prompt).toContain("Pre-matched Discussion Items (1):");
		expect(prompt).toContain("Project: Empty");
		expect(prompt).toContain("Pre-matched Discussion Items: none");
	});

	it("instructs AI to use exact project names without parenthetical descriptions", () => {
		const context: VisibleWinsExtractionContext = {
			projects: [],
			associations: [],
			notes: [],
		};

		const prompt = buildVisibleWinsExtractionPrompt(context);

		expect(prompt).toContain(
			"projectName field MUST be the exact project name",
		);
	});

	it("instructs AI not to prefix bullet text with project name", () => {
		const context: VisibleWinsExtractionContext = {
			projects: [],
			associations: [],
			notes: [],
		};

		const prompt = buildVisibleWinsExtractionPrompt(context);

		expect(prompt).toContain("Do NOT prefix bullet text with the project name");
	});

	it("instructs AI not to invent facts or figures", () => {
		const context: VisibleWinsExtractionContext = {
			projects: [],
			associations: [],
			notes: [],
		};

		const prompt = buildVisibleWinsExtractionPrompt(context);

		expect(prompt).toContain("Do not invent");
	});

	it("includes reporting window dates and retrospective framing when provided", () => {
		const context: VisibleWinsExtractionContext = {
			projects: [],
			associations: [],
			notes: [],
			reportingWindow: { startDate: "2026-03-01", endDate: "2026-03-07" },
		};

		const prompt = buildVisibleWinsExtractionPrompt(context);

		expect(prompt).toContain("Reporting Period: 2026-03-01 through 2026-03-07");
		expect(prompt).toContain("RETROSPECTIVE report");
		expect(prompt).toContain("RETROSPECTIVE FRAMING");
		expect(prompt).toContain("cross-reference LATER meeting notes");
	});

	it("omits retrospective framing when reportingWindow is absent", () => {
		const context: VisibleWinsExtractionContext = {
			projects: [],
			associations: [],
			notes: [],
		};

		const prompt = buildVisibleWinsExtractionPrompt(context);

		expect(prompt).not.toContain("Reporting Period:");
		expect(prompt).not.toContain("RETROSPECTIVE FRAMING");
	});

	it("instructs AI to match by project scope, not incidental word overlap", () => {
		const context: VisibleWinsExtractionContext = {
			projects: [],
			associations: [],
			notes: [],
		};

		const prompt = buildVisibleWinsExtractionPrompt(context);

		expect(prompt).toContain("incidental word overlap");
		expect(prompt).toContain("primary subject of the discussion");
	});
});
