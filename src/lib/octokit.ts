import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";
import { Octokit } from "@octokit/rest";
import { consola } from "consola";
import { getEnv } from "./env.js";

const OctokitWithPlugins = Octokit.plugin(retry, throttling) as typeof Octokit;

export type OctokitClient = InstanceType<typeof OctokitWithPlugins>;

/**
 * How many times the throttling plugin retries a rate-limited request before
 * giving up. Primary and secondary limits share this cap. Retrying (rather than
 * skipping on the first secondary-limit hit) is what keeps the search API's
 * 30 req/min limit from silently under-counting a Person's PRs. It stays bounded
 * — `retryAfter` is server-supplied, so the worst case is a small, finite wait
 * and then a loud give-up, never an open-ended block.
 */
export const MAX_RATE_LIMIT_RETRIES = 3;

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
			_octokit: OctokitClient,
			retryCount: number,
		) => {
			if (retryCount < MAX_RATE_LIMIT_RETRIES) {
				consola.warn(
					`Primary rate limit on ${options.method} ${options.url}; retry ${retryCount + 1}/${MAX_RATE_LIMIT_RETRIES} after ${retryAfter}s.`,
				);
				return true;
			}
			consola.error(
				`Primary rate limit on ${options.method} ${options.url}; giving up after ${MAX_RATE_LIMIT_RETRIES} retries — results may be incomplete.`,
			);
			return false;
		},
		onSecondaryRateLimit: (
			retryAfter: number,
			options: { method: string; url: string },
			_octokit: OctokitClient,
			retryCount: number,
		) => {
			// Bounded retry rather than an immediate skip: the search API's secondary
			// limit otherwise silently truncates a Person's PR count (the "1 vs 7"
			// undercount). A few short waits recover the transient case; past that we
			// give up loudly so the caller (and the operator) sees the gap.
			if (retryCount < MAX_RATE_LIMIT_RETRIES) {
				consola.warn(
					`Secondary rate limit on ${options.method} ${options.url}; retry ${retryCount + 1}/${MAX_RATE_LIMIT_RETRIES} after ${retryAfter}s.`,
				);
				return true;
			}
			consola.error(
				`Secondary rate limit on ${options.method} ${options.url}; giving up after ${MAX_RATE_LIMIT_RETRIES} retries — results may be incomplete.`,
			);
			return false;
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
			"Missing GitHub authentication. Run `teamhero setup` to sign in.",
		);
	}

	return createOctokitClient({ authToken: token });
}
