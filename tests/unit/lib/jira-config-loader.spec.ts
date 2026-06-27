import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	autoDetectStoryPointField,
	loadJiraConfig,
} from "../../../src/lib/jira-config-loader.js";

const tmpDirs: string[] = [];

function configFile(contents: string): string {
	const dir = mkdtempSync(join(tmpdir(), "jira-config-"));
	tmpDirs.push(dir);
	const path = join(dir, "jira-config.json");
	writeFileSync(path, contents);
	process.env.JIRA_CONFIG_PATH = path;
	return path;
}

afterEach(() => {
	delete process.env.JIRA_CONFIG_PATH;
	for (const d of tmpDirs.splice(0))
		rmSync(d, { recursive: true, force: true });
});

describe("autoDetectStoryPointField", () => {
	it("picks the team-managed field for simplified projects", () => {
		expect(autoDetectStoryPointField("PT", true)).toEqual({
			key: "PT",
			fieldId: "customfield_10617",
			jqlName: "Story point estimate",
		});
	});

	it("picks the company-managed field for non-simplified projects", () => {
		expect(autoDetectStoryPointField("SPVR", false)).toEqual({
			key: "SPVR",
			fieldId: "customfield_10005",
			jqlName: "Story Points[Number]",
		});
	});
});

describe("loadJiraConfig", () => {
	it("returns null when the config file is absent", async () => {
		process.env.JIRA_CONFIG_PATH = join(tmpdir(), "does-not-exist-xyz.json");
		expect(await loadJiraConfig()).toBeNull();
	});

	it("loads valid per-project field config", async () => {
		configFile(
			JSON.stringify({
				projects: [
					{
						key: "PT",
						fieldId: "customfield_10617",
						jqlName: "Story point estimate",
					},
				],
				issueTypes: ["Story", "Task"],
				creditBy: "assignee",
			}),
		);
		const config = await loadJiraConfig();
		expect(config?.projects).toHaveLength(1);
		expect(config?.projects[0].key).toBe("PT");
		expect(config?.issueTypes).toEqual(["Story", "Task"]);
		expect(config?.creditBy).toBe("assignee");
	});

	it("throws on malformed JSON", async () => {
		configFile("{ not json");
		await expect(loadJiraConfig()).rejects.toThrow(/Invalid Jira config/);
	});

	it("throws when projects array is missing", async () => {
		configFile(JSON.stringify({ issueTypes: ["Story"] }));
		await expect(loadJiraConfig()).rejects.toThrow(/missing "projects" array/);
	});

	it("throws when a project entry is missing a required field", async () => {
		configFile(JSON.stringify({ projects: [{ key: "PT", fieldId: "x" }] }));
		await expect(loadJiraConfig()).rejects.toThrow(/missing "jqlName"/);
	});
});
