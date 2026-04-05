import { exec } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { consola } from "consola";
import { configDir } from "./paths.js";

// Placeholder client ID — overridable via ASANA_OAUTH_CLIENT_ID env var
const ASANA_CLIENT_ID = "PLACEHOLDER_ASANA_CLIENT_ID";
const ASANA_AUTH_URL = "https://app.asana.com/-/oauth_authorize";
const ASANA_TOKEN_URL = "https://app.asana.com/-/oauth_token";
const TOKEN_FILE = "asana-tokens.json";

const logger = consola.withTag("teamhero:asana-oauth");

export interface AsanaTokens {
	access_token: string;
	refresh_token: string;
	expires_at: number;
	token_type: string;
	client_id?: string;
	client_secret?: string;
}

export function tokenFilePath(): string {
	return join(configDir(), TOKEN_FILE);
}

function generateCodeVerifier(): string {
	return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
	return createHash("sha256").update(verifier).digest("base64url");
}

/** Check whether Asana OAuth tokens exist with a refresh_token. */
export function isAsanaAuthorized(): boolean {
	try {
		const data = readFileSync(tokenFilePath(), "utf-8");
		const tokens: AsanaTokens = JSON.parse(data);
		return Boolean(tokens.refresh_token);
	} catch {
		return false;
	}
}

/** Read saved tokens from disk. Returns null if not found. */
async function loadTokens(): Promise<AsanaTokens | null> {
	try {
		const data = await readFile(tokenFilePath(), "utf-8");
		return JSON.parse(data) as AsanaTokens;
	} catch {
		return null;
	}
}

/** Save tokens to disk with secure permissions (0o600). */
async function saveTokens(tokens: AsanaTokens): Promise<void> {
	const dir = configDir();
	await mkdir(dir, { recursive: true });
	await writeFile(tokenFilePath(), JSON.stringify(tokens, null, 2), {
		mode: 0o600,
	});
}

/** Refresh the access token using the refresh_token. */
async function refreshAccessToken(
	refreshToken: string,
	opts?: { clientId?: string; clientSecret?: string },
): Promise<AsanaTokens> {
	const clientId =
		opts?.clientId ?? process.env.ASANA_OAUTH_CLIENT_ID ?? ASANA_CLIENT_ID;
	const params: Record<string, string> = {
		client_id: clientId,
		grant_type: "refresh_token",
		refresh_token: refreshToken,
	};
	if (opts?.clientSecret) {
		params.client_secret = opts.clientSecret;
	}
	const body = new URLSearchParams(params);

	const resp = await fetch(ASANA_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: body.toString(),
	});

	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`Token refresh failed (${resp.status}): ${text}`);
	}

	const data = (await resp.json()) as {
		access_token: string;
		expires_in: number;
		token_type: string;
	};

	const tokens: AsanaTokens = {
		access_token: data.access_token,
		refresh_token: refreshToken, // Asana does not return a new refresh_token on refresh
		expires_at: Date.now() + data.expires_in * 1000,
		token_type: data.token_type,
	};
	if (opts?.clientId) tokens.client_id = opts.clientId;
	if (opts?.clientSecret) tokens.client_secret = opts.clientSecret;
	return tokens;
}

/**
 * Get a valid Asana access token, refreshing if expired.
 * Throws if no tokens are saved or refresh fails.
 */
export async function getValidAsanaToken(): Promise<string> {
	const tokens = await loadTokens();
	if (!tokens) {
		throw new Error(
			"Asana not authorized via OAuth. Run `teamhero setup` to connect Asana.",
		);
	}

	// Refresh if expired or within 5-minute buffer
	if (Date.now() >= tokens.expires_at - 5 * 60 * 1000) {
		logger.debug("Asana access token expired or near expiry, refreshing...");
		try {
			const refreshed = await refreshAccessToken(tokens.refresh_token, {
				clientId: tokens.client_id,
				clientSecret: tokens.client_secret,
			});
			await saveTokens(refreshed);
			return refreshed.access_token;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes("invalid_grant")) {
				throw new Error(
					"Asana refresh token expired (invalid_grant). " +
						"Run `teamhero setup` to re-authorize Asana.",
				);
			}
			throw err;
		}
	}

	return tokens.access_token;
}

/** Fetch the user name associated with an access token. */
async function fetchUserName(accessToken: string): Promise<string | null> {
	try {
		const resp = await fetch("https://app.asana.com/api/1.0/users/me", {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (!resp.ok) return null;
		const data = (await resp.json()) as { data?: { name?: string } };
		return data.data?.name ?? null;
	} catch {
		return null;
	}
}

/**
 * Run the full OAuth authorization flow:
 * 1. Start a local HTTP server on a random port
 * 2. Open the browser to Asana consent screen
 * 3. Receive the auth code callback
 * 4. Exchange code for tokens
 * 5. Save tokens to disk
 * 6. Get user name from /api/1.0/users/me
 *
 * Accepts optional client ID/secret overrides.
 */
export async function authorizeAsana(opts?: {
	clientId?: string;
	clientSecret?: string;
}): Promise<{ name?: string }> {
	const clientId =
		opts?.clientId ?? process.env.ASANA_OAUTH_CLIENT_ID ?? ASANA_CLIENT_ID;
	const clientSecret = opts?.clientSecret;
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = generateCodeChallenge(codeVerifier);

	return new Promise((resolve, reject) => {
		const server = createServer(async (req, res) => {
			try {
				const url = new URL(req.url ?? "/", "http://localhost");

				if (url.pathname !== "/callback") {
					res.writeHead(404);
					res.end("Not found");
					return;
				}

				const code = url.searchParams.get("code");
				const error = url.searchParams.get("error");

				if (error) {
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end(
						"<h1>Authorization denied</h1><p>You can close this tab.</p>",
					);
					server.close();
					reject(new Error(`Asana OAuth denied: ${error}`));
					return;
				}

				if (!code) {
					res.writeHead(400, { "Content-Type": "text/html" });
					res.end("<h1>Missing authorization code</h1>");
					server.close();
					reject(new Error("No authorization code received"));
					return;
				}

				// Exchange code for tokens
				const port = (server.address() as { port: number }).port;
				const exchangeParams: Record<string, string> = {
					client_id: clientId,
					code,
					code_verifier: codeVerifier,
					grant_type: "authorization_code",
					redirect_uri: `http://localhost:${port}/callback`,
				};
				if (clientSecret) {
					exchangeParams.client_secret = clientSecret;
				}
				const body = new URLSearchParams(exchangeParams);

				const tokenResp = await fetch(ASANA_TOKEN_URL, {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: body.toString(),
				});

				if (!tokenResp.ok) {
					const text = await tokenResp.text();
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end(
						"<h1>Token exchange failed</h1><p>Check the terminal for details.</p>",
					);
					server.close();
					reject(
						new Error(`Token exchange failed (${tokenResp.status}): ${text}`),
					);
					return;
				}

				const tokenData = (await tokenResp.json()) as {
					access_token: string;
					refresh_token: string;
					expires_in: number;
					token_type: string;
				};

				const tokens: AsanaTokens = {
					access_token: tokenData.access_token,
					refresh_token: tokenData.refresh_token,
					expires_at: Date.now() + tokenData.expires_in * 1000,
					token_type: tokenData.token_type,
				};
				if (opts?.clientId) tokens.client_id = opts.clientId;
				if (opts?.clientSecret) tokens.client_secret = opts.clientSecret;

				await saveTokens(tokens);

				// Fetch user name for confirmation
				const name = await fetchUserName(tokens.access_token);

				res.writeHead(200, { "Content-Type": "text/html" });
				res.end(
					"<h1>Asana connected!</h1><p>You can close this tab and return to the terminal.</p>",
				);
				server.close();
				logger.success("Asana OAuth authorization completed");
				resolve({ name: name ?? undefined });
			} catch (err) {
				server.close();
				reject(err);
			}
		});

		server.listen(0, "127.0.0.1", () => {
			const port = (server.address() as { port: number }).port;
			const redirectUri = `http://localhost:${port}/callback`;
			const params = new URLSearchParams({
				client_id: clientId,
				redirect_uri: redirectUri,
				response_type: "code",
				code_challenge: codeChallenge,
				code_challenge_method: "S256",
			});

			const authUrl = `${ASANA_AUTH_URL}?${params.toString()}`;

			// Always display the URL so it works in terminals that can't launch browsers
			process.stderr.write(
				`\n  Open this URL in your browser to sign in with Asana:\n\n  ${authUrl}\n\n  Waiting for sign-in...\n`,
			);

			// Try to open the browser automatically as a convenience
			const openCmd =
				process.platform === "darwin"
					? "open"
					: process.platform === "win32"
						? "start"
						: "xdg-open";

			exec(`${openCmd} '${authUrl}'`, () => {
				// Ignore errors — URL is already displayed above
			});
		});

		// Timeout after 5 minutes
		setTimeout(
			() => {
				server.close();
				reject(new Error("Authorization timed out after 5 minutes"));
			},
			5 * 60 * 1000,
		);
	});
}

/** Delete stored Asana OAuth tokens (disconnect). */
export async function disconnectAsana(): Promise<void> {
	try {
		await unlink(tokenFilePath());
		logger.info("Asana OAuth disconnected — token file removed");
	} catch (err) {
		// Ignore ENOENT (already deleted)
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	}
}

/** Get the name of the currently authenticated Asana user. */
export async function getAsanaUserName(): Promise<string | null> {
	const tokens = await loadTokens();
	if (!tokens?.access_token) return null;
	return fetchUserName(tokens.access_token);
}
