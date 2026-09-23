import { describe, expect, it } from "bun:test";
import {
	applyFieldOverride,
	resolveProjectField,
} from "../../../../src/adapters/jira/jira-field-resolver.js";
import type { JiraProjectFieldConfig } from "../../../../src/core/types.js";

const SITE = [
	{ id: "customfield_10016", name: "Story point estimate" },
	{ id: "customfield_10036", name: "Story Points" },
	{ id: "customfield_10020", name: "Sprint" },
];

function project(
	extra: Partial<JiraProjectFieldConfig> = {},
): JiraProjectFieldConfig {
	return {
		key: "PT",
		fieldId: "customfield_10016",
		jqlName: "Story point estimate",
		...extra,
	};
}

describe("resolveProjectField", () => {
	it("keeps a configured id the site actually has", () => {
		const resolution = resolveProjectField(project(), SITE);
		expect(resolution.outcome).toBe("configured");
		expect(resolution.config.fieldId).toBe("customfield_10016");
	});

	it("repairs an absent id from the configured display name", () => {
		const resolution = resolveProjectField(
			project({ fieldId: "customfield_10617" }),
			SITE,
		);
		expect(resolution.outcome).toBe("repaired");
		expect(resolution.config.fieldId).toBe("customfield_10016");
		if (resolution.outcome === "repaired") {
			expect(resolution.previousFieldId).toBe("customfield_10617");
			expect(resolution.matchedBy).toBe("jqlName");
		}
	});

	it("falls back to a well-known name when the configured name is a clause name", () => {
		// The setup wizard once wrote the JQL clause form, which is not a field name.
		const resolution = resolveProjectField(
			project({
				fieldId: "customfield_10005",
				jqlName: "Story Points[Number]",
			}),
			SITE,
		);
		expect(resolution.outcome).toBe("repaired");
		expect(resolution.config.fieldId).toBe("customfield_10016");
		if (resolution.outcome === "repaired") {
			expect(resolution.matchedBy).toBe("wellKnownName");
		}
	});

	it("matches a name whatever its case or padding", () => {
		const resolution = resolveProjectField(
			project({ fieldId: "nope", jqlName: "  story POINT estimate " }),
			SITE,
		);
		expect(resolution.config.fieldId).toBe("customfield_10016");
	});

	it("reports an unresolved field rather than guessing", () => {
		const resolution = resolveProjectField(project({ fieldId: "nope" }), [
			{ id: "customfield_10020", name: "Sprint" },
		]);
		expect(resolution.outcome).toBe("unresolved");
		expect(resolution.config.fieldId).toBe("nope");
	});
});

describe("applyFieldOverride", () => {
	it("takes a custom-field id as the id", () => {
		expect(applyFieldOverride(project(), "customfield_10036")).toEqual(
			project({ fieldId: "customfield_10036" }),
		);
	});

	it("takes any other value as a display name to resolve", () => {
		expect(applyFieldOverride(project(), "Story Points")).toEqual(
			project({ fieldId: "", jqlName: "Story Points" }),
		);
	});

	it("ignores an empty override", () => {
		expect(applyFieldOverride(project(), "   ")).toEqual(project());
	});
});
