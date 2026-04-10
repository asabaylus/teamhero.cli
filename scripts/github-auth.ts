#!/usr/bin/env bun
/**
 * GitHub OAuth device flow authorization.
 * Invoked by the Go TUI to connect GitHub via browser-based sign-in.
 *
 * Protocol:
 *   stdin  <- optional JSON: { action?: "device_flow" | "validate" | "status" | "disconnect", token?: string }
 *   stdout -> JSON result: { "ok": true, "token": "...", "login": "..." }
 *                       or { "ok": false, "error": "..." }
 *   exit 0 = success, exit 1 = error
 */
import {
	authorizeGitHub,
	checkGitHubStatus,
	validateGitHubToken,
} from "../src/lib/github-oauth.js";

interface StdinInput {
	action?: string;
	token?: string;
}

async function readStdin(): Promise<StdinInput | null> {
	// Return null if stdin is a TTY (no piped input)
	if (process.stdin.isTTY) return null;

	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk as Buffer);
	}
	const raw = Buffer.concat(chunks).toString("utf-8").trim();
	if (!raw) return null;
	try {
		return JSON.parse(raw) as StdinInput;
	} catch {
		return null;
	}
}

async function main(): Promise<void> {
	try {
		const input = await readStdin();
		const action = input?.action || "device_flow";

		if (action === "validate") {
			const token = input?.token;
			if (!token) {
				process.stdout.write(
					JSON.stringify({ ok: false, error: "No token provided" }),
				);
				process.exit(1);
			}
			const login = await validateGitHubToken(token);
			process.stdout.write(JSON.stringify({ ok: true, login }));
			return;
		}

		if (action === "status") {
			const token = input?.token;
			if (!token) {
				process.stdout.write(
					JSON.stringify({ ok: false, error: "No token provided" }),
				);
				process.exit(1);
			}
			const status = await checkGitHubStatus(token);
			process.stdout.write(
				JSON.stringify({ ok: true, ...status }),
			);
			return;
		}

		if (action === "disconnect") {
			process.stdout.write(JSON.stringify({ ok: true }));
			return;
		}

		// Default: device flow
		const result = await authorizeGitHub();
		process.stdout.write(
			JSON.stringify({
				ok: true,
				token: result.token,
				login: result.login,
			}),
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stdout.write(JSON.stringify({ ok: false, error: message }));
		process.exit(1);
	}
}

await main();
