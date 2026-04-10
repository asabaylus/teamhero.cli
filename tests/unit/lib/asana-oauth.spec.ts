import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	type AsanaTokens,
	disconnectAsana,
	getAsanaUserName,
	getValidAsanaToken,
	isAsanaAuthorized,
	tokenFilePath,
} from "../../../src/lib/asana-oauth.js";

let tempDir: string;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "asana-oauth-test-"));
	process.env.XDG_CONFIG_HOME = tempDir;
	await mkdir(join(tempDir, "teamhero"), { recursive: true });
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
	delete process.env.XDG_CONFIG_HOME;
});

describe("isAsanaAuthorized", () => {
	it("returns false when no token file exists", () => {
		expect(isAsanaAuthorized()).toBe(false);
	});

	it("returns true when token file has refresh_token", async () => {
		await writeFile(
			join(tempDir, "teamhero", "asana-tokens.json"),
			JSON.stringify({
				access_token: "at-test",
				refresh_token: "rt-test",
				expires_at: Date.now() + 3600 * 1000,
				token_type: "bearer",
			}),
		);

		expect(isAsanaAuthorized()).toBe(true);
	});

	it("returns false when token file has no refresh_token", async () => {
		await writeFile(
			join(tempDir, "teamhero", "asana-tokens.json"),
			JSON.stringify({
				access_token: "at-test",
				expires_at: Date.now() + 3600 * 1000,
			}),
		);

		expect(isAsanaAuthorized()).toBe(false);
	});

	it("returns false when token file is invalid JSON", async () => {
		await writeFile(join(tempDir, "teamhero", "asana-tokens.json"), "not json");

		expect(isAsanaAuthorized()).toBe(false);
	});
});

describe("tokenFilePath", () => {
	it("returns path under config directory", () => {
		expect(tokenFilePath()).toBe(
			join(tempDir, "teamhero", "asana-tokens.json"),
		);
	});
});

describe("getValidAsanaToken", () => {
	it("throws when no token file exists", async () => {
		await expect(getValidAsanaToken()).rejects.toThrow(
			"Asana not authorized via OAuth",
		);
	});

	it("returns access_token when not expired", async () => {
		await writeFile(
			join(tempDir, "teamhero", "asana-tokens.json"),
			JSON.stringify({
				access_token: "at-valid",
				refresh_token: "rt-test",
				expires_at: Date.now() + 3600 * 1000,
				token_type: "bearer",
			}),
		);

		const token = await getValidAsanaToken();
		expect(token).toBe("at-valid");
	});

	it("attempts refresh when token is expired", async () => {
		await writeFile(
			join(tempDir, "teamhero", "asana-tokens.json"),
			JSON.stringify({
				access_token: "at-expired",
				refresh_token: "rt-test-refresh",
				expires_at: Date.now() - 1000, // expired
				token_type: "bearer",
			}),
		);

		// Mock fetch for the refresh request
		const mockFetch = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					access_token: "at-refreshed",
					expires_in: 3600,
					token_type: "bearer",
				}),
				{ status: 200 },
			),
		);

		const token = await getValidAsanaToken();
		expect(token).toBe("at-refreshed");
		expect(mockFetch).toHaveBeenCalled();

		// Verify tokens were saved to disk
		const saved = JSON.parse(
			await readFile(join(tempDir, "teamhero", "asana-tokens.json"), "utf-8"),
		) as AsanaTokens;
		expect(saved.access_token).toBe("at-refreshed");
		expect(saved.refresh_token).toBe("rt-test-refresh");

		mockFetch.mockRestore();
	});

	it("throws on invalid_grant with helpful message", async () => {
		await writeFile(
			join(tempDir, "teamhero", "asana-tokens.json"),
			JSON.stringify({
				access_token: "at-expired",
				refresh_token: "rt-bad",
				expires_at: Date.now() - 1000,
				token_type: "bearer",
			}),
		);

		const mockFetch = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("invalid_grant", { status: 400 }),
		);

		await expect(getValidAsanaToken()).rejects.toThrow("invalid_grant");

		mockFetch.mockRestore();
	});

	it("refreshes when within 5-minute buffer of expiry", async () => {
		await writeFile(
			join(tempDir, "teamhero", "asana-tokens.json"),
			JSON.stringify({
				access_token: "at-near-expiry",
				refresh_token: "rt-test",
				expires_at: Date.now() + 2 * 60 * 1000, // 2 minutes from now (within 5-min buffer)
				token_type: "bearer",
			}),
		);

		const mockFetch = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					access_token: "at-refreshed-buffer",
					expires_in: 3600,
					token_type: "bearer",
				}),
				{ status: 200 },
			),
		);

		const token = await getValidAsanaToken();
		expect(token).toBe("at-refreshed-buffer");
		expect(mockFetch).toHaveBeenCalled();

		mockFetch.mockRestore();
	});
});

describe("disconnectAsana", () => {
	it("removes token file", async () => {
		const tokenPath = join(tempDir, "teamhero", "asana-tokens.json");
		await writeFile(tokenPath, JSON.stringify({ refresh_token: "rt" }));

		await disconnectAsana();

		await expect(readFile(tokenPath)).rejects.toThrow();
	});

	it("does not throw when file does not exist", async () => {
		await expect(disconnectAsana()).resolves.toBeUndefined();
	});
});

describe("getAsanaUserName", () => {
	it("returns null when no token file exists", async () => {
		const result = await getAsanaUserName();
		expect(result).toBeNull();
	});

	it("returns name from API when token is valid", async () => {
		await writeFile(
			join(tempDir, "teamhero", "asana-tokens.json"),
			JSON.stringify({
				access_token: "at-valid",
				refresh_token: "rt-test",
				expires_at: Date.now() + 3600 * 1000,
				token_type: "bearer",
			}),
		);

		const mockFetch = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					data: { name: "Alice Smith" },
				}),
				{ status: 200 },
			),
		);

		const name = await getAsanaUserName();
		expect(name).toBe("Alice Smith");

		mockFetch.mockRestore();
	});

	it("returns null when API call fails", async () => {
		await writeFile(
			join(tempDir, "teamhero", "asana-tokens.json"),
			JSON.stringify({
				access_token: "at-bad",
				refresh_token: "rt-test",
				expires_at: Date.now() + 3600 * 1000,
				token_type: "bearer",
			}),
		);

		const mockFetch = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("Unauthorized", { status: 401 }),
		);

		const name = await getAsanaUserName();
		expect(name).toBeNull();

		mockFetch.mockRestore();
	});
});
