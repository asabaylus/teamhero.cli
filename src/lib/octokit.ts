import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";
import { Octokit } from "@octokit/rest";
import { consola } from "consola";
import { getEnv } from "./env.js";

const OctokitWithPlugins = Octokit.plugin(retry, throttling) as typeof Octokit;

export type OctokitClient = InstanceType<typeof OctokitWithPlugins>;

export interface OctokitFactoryOptions {
	authToken?: string;
	userAgent?: string;
}

function buildUserAgent(userAgent?: string): string {
	const defaultAgent = "teamhero-cli/0.1.0";
	return userAgent ? `${defaultAgent} ${userAgent}` : defaultAgent;
}

function createThrottleOptions() {
	return {
		onRateLimit: (
			retryAfter: number,
			options: { method: string; url: string },
			octokit: OctokitClient,
			retryCount: number,
		) => {
			consola.warn(
				`Rate limit hit for ${options.method} ${options.url}. Retry ${retryCount} after ${retryAfter}s.`,
			);
			return retryCount <= 2;
		},
		onSecondaryRateLimit: (
			_retryAfter: number,
			options: { method: string; url: string },
			octokit: OctokitClient,
			retryCount: number,
		) => {
			consola.warn(
				`Secondary rate limit triggered for ${options.method} ${options.url}. Retry ${retryCount}.`,
			);
			return retryCount <= 1;
		},
	};
}

export async function createOctokitClient(
	options: OctokitFactoryOptions = {},
): Promise<OctokitClient> {
	const userAgent = buildUserAgent(options.userAgent);

	if (!options.authToken) {
		throw new Error("Missing GitHub authentication configuration.");
	}

	return new OctokitWithPlugins({
		auth: options.authToken,
		userAgent,
		request: {
			retries: 0, // Disable retries per repo policy
			timeout: 15000, // 15 seconds to reduce transient timeouts
		},
		throttle: createThrottleOptions(),
	});
}

export async function loadOctokitFromEnv(): Promise<OctokitClient> {
	const token = getEnv("GITHUB_PERSONAL_ACCESS_TOKEN");
	if (!token) {
		throw new Error(
			"Missing GITHUB_PERSONAL_ACCESS_TOKEN. Run `teamhero setup` or set the environment variable.",
		);
	}

	return createOctokitClient({ authToken: token });
}
