import { exec } from "node:child_process";
import { consola } from "consola";

const logger = consola.withTag("teamhero:github-oauth");

// Placeholder client ID — user needs to register a GitHub OAuth App
// and replace this, or set GITHUB_OAUTH_CLIENT_ID env var
const DEFAULT_CLIENT_ID = "PLACEHOLDER_GITHUB_CLIENT_ID";

interface DeviceCodeResponse {
	device_code: string;
	user_code: string;
	verification_uri: string;
	expires_in: number;
	interval: number;
}

interface TokenResponse {
	access_token: string;
	token_type: string;
	scope: string;
}

interface TokenPollResponse {
	access_token?: string;
	token_type?: string;
	scope?: string;
	error?: string;
}

function getClientId(): string {
	return process.env.GITHUB_OAUTH_CLIENT_ID || DEFAULT_CLIENT_ID;
}

export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
	const res = await fetch("https://github.com/login/device/code", {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			client_id: getClientId(),
			scope: "repo read:org",
		}),
	});
	if (!res.ok) {
		throw new Error(
			`GitHub device code request failed: ${res.status} ${res.statusText}`,
		);
	}
	return res.json() as Promise<DeviceCodeResponse>;
}

export async function pollForToken(
	deviceCode: string,
	interval: number,
	expiresIn: number,
): Promise<string> {
	const deadline = Date.now() + expiresIn * 1000;
	let pollInterval = interval * 1000; // convert to ms

	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, pollInterval));

		const res = await fetch("https://github.com/login/oauth/access_token", {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				client_id: getClientId(),
				device_code: deviceCode,
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			}),
		});

		const data = (await res.json()) as TokenPollResponse;

		if (data.access_token) {
			return data.access_token;
		}

		switch (data.error) {
			case "authorization_pending":
				// User hasn't authorized yet, keep polling
				break;
			case "slow_down":
				pollInterval += 5000; // GitHub asks us to slow down
				break;
			case "expired_token":
				throw new Error("Authorization timed out. Please try again.");
			case "access_denied":
				throw new Error("Authorization was denied by the user.");
			default:
				throw new Error(`Unexpected error during authorization: ${data.error}`);
		}
	}

	throw new Error("Authorization timed out. Please try again.");
}

export async function validateGitHubToken(token: string): Promise<string> {
	const res = await fetch("https://api.github.com/user", {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"User-Agent": "teamhero-cli",
		},
	});
	if (!res.ok) {
		throw new Error(`GitHub token validation failed: ${res.status}`);
	}
	const user = (await res.json()) as { login: string };
	return user.login;
}

/** Open a URL in the default browser (best-effort). */
function openBrowser(url: string): void {
	const cmd =
		process.platform === "darwin"
			? `open "${url}"`
			: process.platform === "win32"
				? `start "${url}"`
				: `xdg-open "${url}"`;
	exec(cmd, () => {
		/* ignore errors — fallback is manual URL copy */
	});
}

export async function authorizeGitHub(): Promise<{
	token: string;
	login: string;
}> {
	const deviceCode = await requestDeviceCode();

	// Show the user code and URL on stderr (visible to user through Go TUI)
	process.stderr.write("\n  Open this URL in your browser:\n");
	process.stderr.write(`  ${deviceCode.verification_uri}\n\n`);
	process.stderr.write(`  Then enter this code: ${deviceCode.user_code}\n\n`);
	process.stderr.write("  Waiting for authorization...\n");

	// Try to open browser automatically
	openBrowser(deviceCode.verification_uri);

	const token = await pollForToken(
		deviceCode.device_code,
		deviceCode.interval,
		deviceCode.expires_in,
	);

	const login = await validateGitHubToken(token);
	logger.success(`GitHub authorized as @${login}`);
	return { token, login };
}
