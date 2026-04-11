/**
 * Tests for writeEnvFile in src/lib/env.ts.
 *
 * Strategy: Mock configDir() to use a temp directory, then call writeEnvFile
 * and verify the resulting .env file contents.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeEnvFile } from "../../../src/lib/env.js";

let tempDir: string;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "teamhero-env-writer-test-"));
	process.env.XDG_CONFIG_HOME = tempDir;
	await mkdir(join(tempDir, "teamhero"), { recursive: true });
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
	delete process.env.XDG_CONFIG_HOME;
});

describe("writeEnvFile", () => {
	it("creates a new .env file when none exists", async () => {
		writeEnvFile({ FOO: "bar", BAZ: "qux" });
		const content = await readFile(join(tempDir, "teamhero", ".env"), "utf8");
		expect(content).toContain("FOO=bar");
		expect(content).toContain("BAZ=qux");
		expect(content.endsWith("\n")).toBe(true);
	});

	it("updates existing keys in place", async () => {
		await writeFile(
			join(tempDir, "teamhero", ".env"),
			"FOO=old\nBAR=keep\n",
			"utf8",
		);
		writeEnvFile({ FOO: "new" });
		const content = await readFile(join(tempDir, "teamhero", ".env"), "utf8");
		expect(content).toContain("FOO=new");
		expect(content).toContain("BAR=keep");
		expect(content).not.toContain("FOO=old");
	});

	it("drops comment lines", async () => {
		await writeFile(
			join(tempDir, "teamhero", ".env"),
			"# This is a comment\nFOO=bar\n# Another comment\nBAZ=qux\n",
			"utf8",
		);
		writeEnvFile({ NEW_KEY: "value" });
		const content = await readFile(join(tempDir, "teamhero", ".env"), "utf8");
		expect(content).not.toContain("# This is a comment");
		expect(content).not.toContain("# Another comment");
		expect(content).toContain("FOO=bar");
		expect(content).toContain("BAZ=qux");
		expect(content).toContain("NEW_KEY=value");
	});

	it("preserves keys not in the updates map", async () => {
		await writeFile(
			join(tempDir, "teamhero", ".env"),
			"EXISTING=stay\nANOTHER=also_stay\n",
			"utf8",
		);
		writeEnvFile({ NEW_KEY: "added" });
		const content = await readFile(join(tempDir, "teamhero", ".env"), "utf8");
		expect(content).toContain("EXISTING=stay");
		expect(content).toContain("ANOTHER=also_stay");
		expect(content).toContain("NEW_KEY=added");
	});

	it("omits keys with empty values", async () => {
		await writeFile(
			join(tempDir, "teamhero", ".env"),
			"OLD_KEY=remove_me\n",
			"utf8",
		);
		writeEnvFile({ OLD_KEY: "", NEW_EMPTY: "" });
		const content = await readFile(join(tempDir, "teamhero", ".env"), "utf8");
		expect(content).not.toContain("OLD_KEY");
		expect(content).not.toContain("NEW_EMPTY");
	});

	it("preserves blank lines", async () => {
		await writeFile(
			join(tempDir, "teamhero", ".env"),
			"FOO=bar\n\nBAZ=qux\n",
			"utf8",
		);
		writeEnvFile({ NEW: "val" });
		const content = await readFile(join(tempDir, "teamhero", ".env"), "utf8");
		expect(content).toContain("FOO=bar");
		expect(content).toContain("BAZ=qux");
		expect(content).toContain("NEW=val");
		// Verify blank line is preserved between FOO and BAZ
		const lines = content.split("\n");
		const fooIdx = lines.findIndex((l: string) => l.startsWith("FOO="));
		const bazIdx = lines.findIndex((l: string) => l.startsWith("BAZ="));
		expect(bazIdx - fooIdx).toBe(2); // blank line in between
	});

	it("handles missing file gracefully", async () => {
		// No .env file exists yet — writeEnvFile should create it
		writeEnvFile({ BRAND_NEW: "key" });
		const content = await readFile(join(tempDir, "teamhero", ".env"), "utf8");
		expect(content).toContain("BRAND_NEW=key");
	});

	it("ensures file ends with newline", async () => {
		writeEnvFile({ ONE: "1" });
		const content = await readFile(join(tempDir, "teamhero", ".env"), "utf8");
		expect(content.endsWith("\n")).toBe(true);
	});
});
