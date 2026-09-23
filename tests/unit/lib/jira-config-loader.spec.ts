import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	applyIssueTypeSelection,
	autoDetectStoryPointField,
	type JiraConfig,
	loadJiraConfig,
	parseIssueTypeSelection,
	parseIssueTypesEnv,
} from "../../../src/lib/jira-config-loader.js";

const tmpDirs: string[] = [];
const ORIGINAL_JIRA_CONFIG_PATH = process.env.JIRA_CONFIG_PATH;
const OVERRIDE_VARS = ["JIRA_STORY_POINT_FIELD", "JIRA_ISSUE_TYPES"] as const;
const ORIGINAL_OVERRIDES = OVERRIDE_VARS.map(
	(name) => [name, process.env[name]] as const,
);

function configFile(contents: string): string {
	const dir = mkdtempSync(join(tmpdir(), "jira-config-"));
	tmpDirs.push(dir);
	const path = join(dir, "jira-config.json");
	writeFileSync(path, contents);
	process.env.JIRA_CONFIG_PATH = path;
	return path;
}

afterEach(() => {
	if (ORIGINAL_JIRA_CONFIG_PATH === undefined) {
		delete process.env.JIRA_CONFIG_PATH;
	} else {
		process.env.JIRA_CONFIG_PATH = ORIGINAL_JIRA_CONFIG_PATH;
	}
	for (const [name, value] of ORIGINAL_OVERRIDES) {
		if (value === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = value;
		}
	}
	for (const d of tmpDirs.splice(0))
		rmSync(d, { recursive: true, force: true });
});

const ONE_PROJECT =
	'{"projects":[{"key":"PT","fieldId":"customfield_10617","jqlName":"Story point estimate"}]}';

describe("parseIssueTypesEnv", () => {
	it("leaves the file value alone when the variable is unset", () => {
		expect(parseIssueTypesEnv(undefined)).toBeUndefined();
	});

	it("reads a comma list and trims each entry", () => {
		expect(parseIssueTypesEnv("User Story, Bug ,Task")).toEqual([
			"User Story",
			"Bug",
			"Task",
		]);
	});

	it("reads an empty variable as every issue type", () => {
		expect(parseIssueTypesEnv("")).toEqual([]);
		expect(parseIssueTypesEnv(" , ")).toEqual([]);
	});
});

describe("loadJiraConfig — field and issue-type options", () => {
	it("reads storyPointField from the file", async () => {
		configFile(
			'{"projects":[{"key":"PT","fieldId":"customfield_10617","jqlName":"Story point estimate"}],"storyPointField":"customfield_10016"}',
		);
		expect((await loadJiraConfig())?.storyPointField).toBe("customfield_10016");
	});

	it("rejects a storyPointField that is not a non-empty string", async () => {
		configFile(
			'{"projects":[{"key":"PT","fieldId":"a","jqlName":"b"}],"storyPointField":"  "}',
		);
		expect(loadJiraConfig()).rejects.toThrow(/storyPointField/);
	});

	it("lets JIRA_STORY_POINT_FIELD win over the file", async () => {
		configFile(
			'{"projects":[{"key":"PT","fieldId":"a","jqlName":"b"}],"storyPointField":"customfield_10016"}',
		);
		process.env.JIRA_STORY_POINT_FIELD = "Story Points";
		expect((await loadJiraConfig())?.storyPointField).toBe("Story Points");
	});

	it("lets JIRA_ISSUE_TYPES narrow the issue types", async () => {
		configFile(ONE_PROJECT);
		process.env.JIRA_ISSUE_TYPES = "User Story,Bug";
		expect((await loadJiraConfig())?.issueTypes).toEqual(["User Story", "Bug"]);
	});

	it("lets an empty JIRA_ISSUE_TYPES widen a narrowed file", async () => {
		configFile(
			'{"projects":[{"key":"PT","fieldId":"a","jqlName":"b"}],"issueTypes":["Story"]}',
		);
		process.env.JIRA_ISSUE_TYPES = "";
		expect((await loadJiraConfig())?.issueTypes).toEqual([]);
	});
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
			jqlName: "Story Points",
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

	it("rejects a malformed creditBy instead of silently defaulting", async () => {
		configFile(
			JSON.stringify({
				projects: [{ key: "PT", fieldId: "x", jqlName: "y" }],
				creditBy: "whoever",
			}),
		);
		await expect(loadJiraConfig()).rejects.toThrow(/creditBy/);
	});

	it("rejects malformed issueTypes", async () => {
		configFile(
			JSON.stringify({
				projects: [{ key: "PT", fieldId: "x", jqlName: "y" }],
				issueTypes: "Story",
			}),
		);
		await expect(loadJiraConfig()).rejects.toThrow(/issueTypes/);
	});
});

describe("parseIssueTypeSelection", () => {
	it("leaves the config alone when nothing was asked for", () => {
		expect(parseIssueTypeSelection(undefined)).toBeUndefined();
	});

	it("reads 'any' as every issue type, everywhere", () => {
		expect(parseIssueTypeSelection("any")).toEqual({ all: [], byProject: {} });
		expect(parseIssueTypeSelection("ALL")).toEqual({ all: [], byProject: {} });
		expect(parseIssueTypeSelection("*")).toEqual({ all: [], byProject: {} });
		expect(parseIssueTypeSelection("")).toEqual({ all: [], byProject: {} });
	});

	it("reads a bare comma list as the run-wide list", () => {
		expect(parseIssueTypeSelection("User Story, Bug")).toEqual({
			all: ["User Story", "Bug"],
			byProject: {},
		});
	});

	it("reads KEY=types entries as per-project lists", () => {
		expect(parseIssueTypeSelection("DFA=Story,Bug;SUPPORT=any")).toEqual({
			byProject: { DFA: ["Story", "Bug"], SUPPORT: [] },
		});
	});

	it("lets a bare list ride along as the default for unnamed projects", () => {
		expect(parseIssueTypeSelection("Story;DFA=Bug")).toEqual({
			all: ["Story"],
			byProject: { DFA: ["Bug"] },
		});
	});
});

describe("applyIssueTypeSelection", () => {
	const config: JiraConfig = {
		projects: [
			{
				key: "DFA",
				fieldId: "customfield_10016",
				jqlName: "Story point estimate",
			},
			{
				key: "SUPPORT",
				fieldId: "customfield_10016",
				jqlName: "Story point estimate",
				issueTypes: ["Support Request"],
			},
		],
		issueTypes: ["Story"],
	};

	it("returns the config untouched when nothing was asked for", () => {
		expect(applyIssueTypeSelection(config, undefined)).toBe(config);
	});

	it("narrows only the project it names", () => {
		const applied = applyIssueTypeSelection(
			config,
			parseIssueTypeSelection("DFA=Bug"),
		);
		expect(applied.projects[0]?.issueTypes).toEqual(["Bug"]);
		expect(applied.projects[1]?.issueTypes).toEqual(["Support Request"]);
		expect(applied.issueTypes).toEqual(["Story"]);
	});

	it("clears per-project lists so a run-wide list can widen a narrowed config", () => {
		const applied = applyIssueTypeSelection(
			config,
			parseIssueTypeSelection("any"),
		);
		expect(applied.issueTypes).toEqual([]);
		expect(applied.projects.every((p) => p.issueTypes === undefined)).toBe(
			true,
		);
	});

	it("never rewrites the config it was given", () => {
		applyIssueTypeSelection(config, parseIssueTypeSelection("DFA=Bug"));
		expect(config.projects[0]?.issueTypes).toBeUndefined();
	});
});

describe("loadJiraConfig — per-project issue types", () => {
	it("reads a per-project issueTypes list", async () => {
		configFile(
			JSON.stringify({
				projects: [
					{
						key: "PT",
						fieldId: "customfield_10016",
						jqlName: "Story point estimate",
						issueTypes: ["Bug", " Story "],
					},
				],
			}),
		);
		const config = await loadJiraConfig();
		expect(config?.projects[0]?.issueTypes).toEqual(["Bug", "Story"]);
	});

	it("reads an empty per-project list as every issue type for that project", async () => {
		configFile(
			JSON.stringify({
				projects: [
					{
						key: "PT",
						fieldId: "customfield_10016",
						jqlName: "Story point estimate",
						issueTypes: [],
					},
				],
				issueTypes: ["Story"],
			}),
		);
		const config = await loadJiraConfig();
		expect(config?.projects[0]?.issueTypes).toEqual([]);
	});

	it("rejects a malformed per-project issueTypes", async () => {
		configFile(
			JSON.stringify({
				projects: [
					{
						key: "PT",
						fieldId: "customfield_10016",
						jqlName: "Story point estimate",
						issueTypes: "Bug",
					},
				],
			}),
		);
		await expect(loadJiraConfig()).rejects.toThrow(/projects\[0\].issueTypes/);
	});
});
