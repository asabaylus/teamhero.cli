import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";

// We need to mock global fetch for these tests
const originalFetch = globalThis.fetch;

afterAll(() => {
	globalThis.fetch = originalFetch;
});

import {
	checkGitHubStatus,
	getAuthMethod,
	pollForToken,
	requestDeviceCode,
	validateGitHubToken,
} from "../../../src/lib/github-oauth.js";

beforeEach(() => {
	// Reset fetch to original before each test
	globalThis.fetch = originalFetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("requestDeviceCode", () => {
	it("returns device code response on success", async () => {
		const mockResponse = {
			device_code: "dc_test123",
			user_code: "ABCD-1234",
			verification_uri: "https://github.com/login/device",
			expires_in: 900,
			interval: 5,
		};

		globalThis.fetch = mock(
			async () =>
				new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		) as typeof fetch;

		const result = await requestDeviceCode();
		expect(result.device_code).toBe("dc_test123");
		expect(result.user_code).toBe("ABCD-1234");
		expect(result.verification_uri).toBe("https://github.com/login/device");
		expect(result.expires_in).toBe(900);
		expect(result.interval).toBe(5);
	});

	it("throws on 403 with OAuth app error", async () => {
		globalThis.fetch = mock(
			async () =>
				new Response("Forbidden", { status: 403, statusText: "Forbidden" }),
		) as typeof fetch;

		await expect(requestDeviceCode()).rejects.toThrow(
			"GitHub OAuth app is not configured correctly",
		);
	});

	it("throws on 401 with OAuth app error", async () => {
		globalThis.fetch = mock(
			async () =>
				new Response("Unauthorized", {
					status: 401,
					statusText: "Unauthorized",
				}),
		) as typeof fetch;

		await expect(requestDeviceCode()).rejects.toThrow(
			"GitHub OAuth app is not configured correctly",
		);
	});

	it("throws on 422 with device flow error", async () => {
		globalThis.fetch = mock(
			async () =>
				new Response("Unprocessable", {
					status: 422,
					statusText: "Unprocessable Entity",
				}),
		) as typeof fetch;

		await expect(requestDeviceCode()).rejects.toThrow(
			"OAuth app may not have device flow enabled",
		);
	});

	it("throws on other non-OK response with status", async () => {
		globalThis.fetch = mock(
			async () =>
				new Response("Server Error", {
					status: 500,
					statusText: "Internal Server Error",
				}),
		) as typeof fetch;

		await expect(requestDeviceCode()).rejects.toThrow(
			"GitHub device code request failed: 500 Internal Server Error",
		);
	});

	it("sends correct request body", async () => {
		let capturedBody: string | null = null;

		globalThis.fetch = mock(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				capturedBody = init?.body as string;
				return new Response(
					JSON.stringify({
						device_code: "dc_test",
						user_code: "CODE",
						verification_uri: "https://github.com/login/device",
						expires_in: 900,
						interval: 5,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			},
		) as typeof fetch;

		await requestDeviceCode();
		expect(capturedBody).not.toBeNull();
		const parsed = JSON.parse(capturedBody!);
		expect(parsed.scope).toBe("repo read:org");
	});
});

describe("pollForToken", () => {
	it("returns token after authorization_pending then success", async () => {
		let callCount = 0;

		globalThis.fetch = mock(async () => {
			callCount++;
			if (callCount <= 2) {
				return new Response(
					JSON.stringify({ error: "authorization_pending" }),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			return new Response(
				JSON.stringify({
					access_token: "gho_testtoken123",
					token_type: "bearer",
					scope: "repo,read:org",
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as typeof fetch;

		// Use very short interval (0.01s) and long expiry for fast test
		const token = await pollForToken("dc_test", 0.01, 30);
		expect(token).toBe("gho_testtoken123");
		expect(callCount).toBe(3);
	});

	it("throws on expired_token error", async () => {
		globalThis.fetch = mock(
			async () =>
				new Response(JSON.stringify({ error: "expired_token" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		) as typeof fetch;

		await expect(pollForToken("dc_test", 0.01, 30)).rejects.toThrow(
			"The sign-in code expired",
		);
	});

	it("throws on access_denied error", async () => {
		globalThis.fetch = mock(
			async () =>
				new Response(JSON.stringify({ error: "access_denied" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		) as typeof fetch;

		await expect(pollForToken("dc_test", 0.01, 30)).rejects.toThrow(
			"You denied the authorization request",
		);
	});

	it("throws on incorrect_device_code error", async () => {
		globalThis.fetch = mock(
			async () =>
				new Response(JSON.stringify({ error: "incorrect_device_code" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		) as typeof fetch;

		await expect(pollForToken("dc_test", 0.01, 30)).rejects.toThrow(
			"Device code was invalid",
		);
	});

	it("handles slow_down by increasing interval and eventually succeeds", async () => {
		let callCount = 0;
		const callTimestamps: number[] = [];

		globalThis.fetch = mock(async () => {
			callCount++;
			callTimestamps.push(Date.now());
			if (callCount === 1) {
				return new Response(JSON.stringify({ error: "slow_down" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			return new Response(
				JSON.stringify({
					access_token: "gho_slowed",
					token_type: "bearer",
					scope: "repo",
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as typeof fetch;

		// Start with 0.01s interval; after slow_down it increases by 5s.
		// Use a generous timeout since the second poll waits ~5s.
		const token = await pollForToken("dc_test", 0.01, 60);
		expect(token).toBe("gho_slowed");
		expect(callCount).toBe(2);

		// Verify the second call waited noticeably longer than the first
		// slow_down adds 5000ms; allow generous slack for timer imprecision
		const gap = callTimestamps[1] - callTimestamps[0];
		expect(gap).toBeGreaterThanOrEqual(4500);
	}, 15_000); // 15s timeout for the 5s slow_down wait

	it("throws on unknown error with fallback suggestion", async () => {
		globalThis.fetch = mock(
			async () =>
				new Response(JSON.stringify({ error: "some_unknown_error" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		) as typeof fetch;

		await expect(pollForToken("dc_test", 0.01, 30)).rejects.toThrow(
			"GitHub authorization error: some_unknown_error. If this persists, try the Personal Access Token option instead.",
		);
	});

	it("throws when deadline expires without a token", async () => {
		// Expires immediately (expiresIn=0), but interval is very short
		globalThis.fetch = mock(
			async () =>
				new Response(JSON.stringify({ error: "authorization_pending" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		) as typeof fetch;

		await expect(pollForToken("dc_test", 0.01, 0)).rejects.toThrow(
			"Authorization timed out. Please try again.",
		);
	});
});

describe("validateGitHubToken", () => {
	it("returns login on valid token", async () => {
		globalThis.fetch = mock(
			async () =>
				new Response(JSON.stringify({ login: "testuser" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		) as typeof fetch;

		const login = await validateGitHubToken("gho_valid");
		expect(login).toBe("testuser");
	});

	it("throws on invalid token (401)", async () => {
		globalThis.fetch = mock(
			async () => new Response("Unauthorized", { status: 401 }),
		) as typeof fetch;

		await expect(validateGitHubToken("gho_bad")).rejects.toThrow(
			"GitHub token validation failed: 401",
		);
	});

	it("throws on server error (500)", async () => {
		globalThis.fetch = mock(
			async () => new Response("Server Error", { status: 500 }),
		) as typeof fetch;

		await expect(validateGitHubToken("gho_bad")).rejects.toThrow(
			"GitHub token validation failed: 500",
		);
	});

	it("sends correct authorization header", async () => {
		let capturedHeaders: Headers | null = null;

		globalThis.fetch = mock(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				capturedHeaders = new Headers(init?.headers);
				return new Response(JSON.stringify({ login: "testuser" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			},
		) as typeof fetch;

		await validateGitHubToken("gho_mytoken");
		expect(capturedHeaders).not.toBeNull();
		expect(capturedHeaders!.get("Authorization")).toBe("Bearer gho_mytoken");
		expect(capturedHeaders!.get("User-Agent")).toBe("teamhero-cli");
	});
});

describe("getAuthMethod", () => {
	it("returns oauth for gho_ prefix", () => {
		expect(getAuthMethod("gho_abc123")).toBe("oauth");
	});

	it("returns pat for github_pat_ prefix", () => {
		expect(getAuthMethod("github_pat_abc123")).toBe("pat");
	});

	it("returns pat for ghp_ prefix", () => {
		expect(getAuthMethod("ghp_abc123")).toBe("pat");
	});

	it("returns unknown for unrecognized prefix", () => {
		expect(getAuthMethod("some_random_token")).toBe("unknown");
	});

	it("returns unknown for empty string", () => {
		expect(getAuthMethod("")).toBe("unknown");
	});
});

describe("checkGitHubStatus", () => {
	it("returns valid status with login and scopes", async () => {
		globalThis.fetch = mock(
			async () =>
				new Response(JSON.stringify({ login: "alice" }), {
					status: 200,
					headers: {
						"Content-Type": "application/json",
						"X-OAuth-Scopes": "repo, read:org",
					},
				}),
		) as typeof fetch;

		const result = await checkGitHubStatus("gho_testtoken");
		expect(result.valid).toBe(true);
		expect(result.login).toBe("alice");
		expect(result.method).toBe("oauth");
		expect(result.scopes).toEqual(["repo", "read:org"]);
	});

	it("returns valid status without scopes header", async () => {
		globalThis.fetch = mock(
			async () =>
				new Response(JSON.stringify({ login: "bob" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		) as typeof fetch;

		const result = await checkGitHubStatus("github_pat_abc");
		expect(result.valid).toBe(true);
		expect(result.login).toBe("bob");
		expect(result.method).toBe("pat");
		expect(result.scopes).toBeUndefined();
	});

	it("returns invalid on 401", async () => {
		globalThis.fetch = mock(
			async () => new Response("Unauthorized", { status: 401 }),
		) as typeof fetch;

		const result = await checkGitHubStatus("gho_bad");
		expect(result.valid).toBe(false);
		expect(result.method).toBe("oauth");
		expect(result.login).toBeUndefined();
	});

	it("returns invalid on network error", async () => {
		globalThis.fetch = mock(async () => {
			throw new Error("network error");
		}) as typeof fetch;

		const result = await checkGitHubStatus("gho_bad");
		expect(result.valid).toBe(false);
		expect(result.method).toBe("oauth");
	});
});
