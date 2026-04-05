import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { mocked } from "../../helpers/mocked.js";

import * as pluginRetryMod from "@octokit/plugin-retry";
import * as pluginThrottlingMod from "@octokit/plugin-throttling";
import * as octokitRestMod from "@octokit/rest";
import * as envMod from "../../../src/lib/env.js";

mock.module("@octokit/rest", () => {
	const MockOctokit = mock().mockImplementation((config: any) => ({
		_config: config,
		rest: {},
	}));
	// plugin() returns a new "class" that, when instantiated, receives the merged config
	MockOctokit.plugin = mock().mockReturnValue(MockOctokit);
	return { ...octokitRestMod, Octokit: MockOctokit };
});

mock.module("@octokit/plugin-retry", () => ({
	...pluginRetryMod,
	retry: { id: "retry-plugin" },
}));

mock.module("@octokit/plugin-throttling", () => ({
	...pluginThrottlingMod,
	throttling: { id: "throttling-plugin" },
}));

mock.module("../../../src/lib/env.js", () => ({
	...envMod,
	getEnv: mock(() => undefined),
}));

const { createOctokitClient, loadOctokitFromEnv } = await import(
	"../../../src/lib/octokit.js"
);
const { getEnv } = await import("../../../src/lib/env.js");
const { Octokit } = await import("@octokit/rest");

afterAll(() => {
	mock.restore();
});

describe("createOctokitClient", () => {
	beforeEach(() => {
		// Clear call counts without undoing mock.module() registrations
		(Octokit as any).mockClear();
		(getEnv as any).mockClear();
	});

	it("returns an Octokit instance when authToken is provided", async () => {
		const client = await createOctokitClient({ authToken: "ghp_abc123" });
		expect(client).toBeDefined();
	});

	it("throws when authToken is not provided", async () => {
		await expect(createOctokitClient({})).rejects.toThrow(
			"Missing GitHub authentication configuration",
		);
	});

	it("throws when authToken is undefined", async () => {
		await expect(createOctokitClient({ authToken: undefined })).rejects.toThrow(
			"Missing GitHub authentication configuration",
		);
	});

	it("passes auth token to Octokit constructor", async () => {
		await createOctokitClient({ authToken: "ghp_test" });

		// Octokit.plugin is called at module load time (top-level),
		// so we verify the constructor was called with the auth token
		const calls = (Octokit as any).mock.calls;
		expect(calls.length).toBeGreaterThan(0);
		const config = calls[calls.length - 1][0];
		expect(config.auth).toBe("ghp_test");
	});

	it("includes default user agent", async () => {
		await createOctokitClient({ authToken: "ghp_test" });

		const calls = (Octokit as any).mock.calls;
		const config = calls[calls.length - 1][0];
		expect(config.userAgent).toContain("teamhero-cli");
	});

	it("appends custom user agent to default", async () => {
		await createOctokitClient({
			authToken: "ghp_test",
			userAgent: "my-custom-agent",
		});

		const calls = (Octokit as any).mock.calls;
		const config = calls[calls.length - 1][0];
		expect(config.userAgent).toContain("teamhero-cli");
		expect(config.userAgent).toContain("my-custom-agent");
	});

	it("configures throttle options", async () => {
		await createOctokitClient({ authToken: "ghp_test" });

		const calls = (Octokit as any).mock.calls;
		const config = calls[calls.length - 1][0];
		expect(config.throttle).toBeDefined();
		expect(config.throttle.onRateLimit).toBeTypeOf("function");
		expect(config.throttle.onSecondaryRateLimit).toBeTypeOf("function");
	});

	it("configures request timeout and retries", async () => {
		await createOctokitClient({ authToken: "ghp_test" });

		const calls = (Octokit as any).mock.calls;
		const config = calls[calls.length - 1][0];
		expect(config.request).toBeDefined();
		expect(config.request.retries).toBe(0);
		expect(config.request.timeout).toBe(15000);
	});

	it("onRateLimit returns true for retryCount <= 2", async () => {
		await createOctokitClient({ authToken: "ghp_test" });

		const calls = (Octokit as any).mock.calls;
		const config = calls[calls.length - 1][0];
		const { onRateLimit } = config.throttle;

		expect(onRateLimit(60, { method: "GET", url: "/repos" }, {}, 0)).toBe(true);
		expect(onRateLimit(60, { method: "GET", url: "/repos" }, {}, 2)).toBe(true);
		expect(onRateLimit(60, { method: "GET", url: "/repos" }, {}, 3)).toBe(
			false,
		);
	});

	it("onSecondaryRateLimit returns true for retryCount <= 1", async () => {
		await createOctokitClient({ authToken: "ghp_test" });

		const calls = (Octokit as any).mock.calls;
		const config = calls[calls.length - 1][0];
		const { onSecondaryRateLimit } = config.throttle;

		expect(
			onSecondaryRateLimit(60, { method: "GET", url: "/repos" }, {}, 0),
		).toBe(true);
		expect(
			onSecondaryRateLimit(60, { method: "GET", url: "/repos" }, {}, 1),
		).toBe(true);
		expect(
			onSecondaryRateLimit(60, { method: "GET", url: "/repos" }, {}, 2),
		).toBe(false);
	});
});

describe("loadOctokitFromEnv", () => {
	beforeEach(() => {
		// Clear call counts without undoing mock.module() registrations
		(Octokit as any).mockClear();
		(getEnv as any).mockClear();
	});

	it("throws when GITHUB_PERSONAL_ACCESS_TOKEN is not set", async () => {
		mocked(getEnv).mockReturnValue(undefined);

		await expect(loadOctokitFromEnv()).rejects.toThrow(
			"Missing GITHUB_PERSONAL_ACCESS_TOKEN",
		);
	});

	it("creates client with token from environment", async () => {
		mocked(getEnv).mockReturnValue("ghp_env_token");

		const client = await loadOctokitFromEnv();
		expect(client).toBeDefined();
		expect(getEnv).toHaveBeenCalledWith("GITHUB_PERSONAL_ACCESS_TOKEN");
	});
});
