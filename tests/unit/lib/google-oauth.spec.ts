import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as pathsMod from "../../../src/lib/paths.js";

// Mock paths.ts to use a temp directory
const mockConfigDir = mock();
mock.module("../../../src/lib/paths.js", () => ({
	...pathsMod,
	configDir: () => mockConfigDir(),
}));

afterAll(() => {
	mock.restore();
});

import {
	getValidAccessToken,
	isGoogleAuthorized,
	tokenFilePath,
} from "../../../src/lib/google-oauth.js";

let tempDir: string;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "google-oauth-test-"));
	mockConfigDir.mockReturnValue(tempDir);
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
	// Clear call counts without undoing mock.module() registrations
	mockConfigDir.mockClear();
});

describe("isGoogleAuthorized", () => {
	it("returns false when no token file exists", async () => {
		expect(await isGoogleAuthorized()).toBe(false);
	});

	it("returns true when token file has refresh_token", async () => {
		await writeFile(
			join(tempDir, "google-tokens.json"),
			JSON.stringify({
				access_token: "ya29.test",
				refresh_token: "1//test",
				expires_at: Date.now() + 3600 * 1000,
				token_type: "Bearer",
				scope: "https://www.googleapis.com/auth/drive.readonly",
			}),
		);

		expect(await isGoogleAuthorized()).toBe(true);
	});

	it("returns false when token file has no refresh_token", async () => {
		await writeFile(
			join(tempDir, "google-tokens.json"),
			JSON.stringify({
				access_token: "ya29.test",
				expires_at: Date.now() + 3600 * 1000,
			}),
		);

		expect(await isGoogleAuthorized()).toBe(false);
	});

	it("returns false when token file is invalid JSON", async () => {
		await writeFile(join(tempDir, "google-tokens.json"), "not json");

		expect(await isGoogleAuthorized()).toBe(false);
	});
});

describe("getValidAccessToken", () => {
	it("throws when no token file exists", async () => {
		await expect(getValidAccessToken()).rejects.toThrow(
			"Google Drive not authorized",
		);
	});

	it("returns access_token when not expired", async () => {
		await writeFile(
			join(tempDir, "google-tokens.json"),
			JSON.stringify({
				access_token: "ya29.valid",
				refresh_token: "1//test",
				expires_at: Date.now() + 3600 * 1000,
				token_type: "Bearer",
				scope: "https://www.googleapis.com/auth/drive.readonly",
			}),
		);

		const token = await getValidAccessToken();
		expect(token).toBe("ya29.valid");
	});

	it("attempts refresh when token is expired", async () => {
		await writeFile(
			join(tempDir, "google-tokens.json"),
			JSON.stringify({
				access_token: "ya29.expired",
				refresh_token: "1//test-refresh",
				expires_at: Date.now() - 1000, // expired
				token_type: "Bearer",
				scope: "https://www.googleapis.com/auth/drive.readonly",
			}),
		);

		// Mock fetch for the refresh request
		const mockFetch = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					access_token: "ya29.refreshed",
					expires_in: 3600,
					token_type: "Bearer",
					scope: "https://www.googleapis.com/auth/drive.readonly",
				}),
				{ status: 200 },
			),
		);

		const token = await getValidAccessToken();
		expect(token).toBe("ya29.refreshed");
		expect(mockFetch).toHaveBeenCalled();
	});
});

describe("tokenFilePath", () => {
	it("returns path under config directory", () => {
		expect(tokenFilePath()).toBe(join(tempDir, "google-tokens.json"));
	});
});
