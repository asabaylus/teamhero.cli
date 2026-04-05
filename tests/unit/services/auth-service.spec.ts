import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

import * as envMod from "../../../src/lib/env.js";

// Mock getEnv so we control what ensureAuthenticated sees
const mockGetEnv = mock<(key: string) => string | undefined>();
mock.module("../../../src/lib/env.js", () => ({
	...envMod,
	getEnv: (...args: Parameters<typeof mockGetEnv>) => mockGetEnv(...args),
}));

afterAll(() => {
	mock.restore();
});

// Import after mocking
const { AuthService } = await import("../../../src/services/auth.service.js");

describe("AuthService", () => {
	let service: InstanceType<typeof AuthService>;

	beforeEach(() => {
		service = new AuthService();
		mockGetEnv.mockReset();
	});

	describe("ensureAuthenticated", () => {
		it("returns authenticated=true when token is present", async () => {
			mockGetEnv.mockReturnValue("ghp_valid_token_123");

			const result = await service.ensureAuthenticated();
			expect(result.authenticated).toBe(true);
			expect(result.provider).toBe("token");
			expect(result.message).toContain("GITHUB_PERSONAL_ACCESS_TOKEN");
		});

		it("passes the correct env key to getEnv", async () => {
			mockGetEnv.mockReturnValue("some-token");

			await service.ensureAuthenticated();
			expect(mockGetEnv).toHaveBeenCalledWith("GITHUB_PERSONAL_ACCESS_TOKEN");
		});

		it("returns authenticated=false when token is absent (undefined)", async () => {
			mockGetEnv.mockReturnValue(undefined);

			const result = await service.ensureAuthenticated();
			expect(result.authenticated).toBe(false);
			expect(result.provider).toBe("token");
			expect(result.message).toContain("Missing GITHUB_PERSONAL_ACCESS_TOKEN");
		});

		it("returns authenticated=false when token is empty string", async () => {
			// getEnv returns "" — after .trim() it's falsy
			mockGetEnv.mockReturnValue("");

			const result = await service.ensureAuthenticated();
			expect(result.authenticated).toBe(false);
		});

		it("returns authenticated=false when token is whitespace only", async () => {
			// getEnv returns "   " — after .trim() it's ""
			mockGetEnv.mockReturnValue("   ");

			const result = await service.ensureAuthenticated();
			expect(result.authenticated).toBe(false);
		});

		it("trims whitespace from a valid token and still authenticates", async () => {
			mockGetEnv.mockReturnValue("  ghp_token_with_spaces  ");

			const result = await service.ensureAuthenticated();
			expect(result.authenticated).toBe(true);
		});
	});

	describe("login", () => {
		it("throws an error indicating login is removed", async () => {
			await expect(service.login()).rejects.toThrow(
				"Login command has been removed",
			);
		});

		it("includes guidance about setting the env var in the error", async () => {
			await expect(service.login()).rejects.toThrow(
				"GITHUB_PERSONAL_ACCESS_TOKEN",
			);
		});
	});
});
