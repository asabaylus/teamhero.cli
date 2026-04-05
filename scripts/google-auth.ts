#!/usr/bin/env bun
/**
 * Google OAuth authorization flow.
 * Invoked by the Go TUI to connect Google Drive.
 *
 * Protocol:
 *   stdin  <- optional JSON: { client_id?, client_secret?, action? }
 *   stdout -> JSON result: { "ok": true, "email": "..." } or { "ok": false, "error": "..." }
 *   exit 0 = success, exit 1 = error
 */
import { authorizeGoogle, disconnectGoogle } from "../src/lib/google-oauth.js";

interface StdinInput {
	client_id?: string;
	client_secret?: string;
	action?: string;
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

		if (input?.action === "disconnect") {
			await disconnectGoogle();
			process.stdout.write(JSON.stringify({ ok: true }));
			return;
		}

		const result = await authorizeGoogle({
			clientId: input?.client_id,
			clientSecret: input?.client_secret,
		});
		process.stdout.write(JSON.stringify({ ok: true, ...result }));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stdout.write(JSON.stringify({ ok: false, error: message }));
		process.exit(1);
	}
}

await main();
