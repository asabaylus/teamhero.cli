#!/usr/bin/env bun
/**
 * Asana OAuth authorization flow.
 * Invoked by the Go TUI to connect Asana via browser-based OAuth.
 *
 * Protocol:
 *   stdin  <- optional JSON: { action?: "authorize" | "disconnect" | "status", clientId?, clientSecret? }
 *   stdout -> JSON result: { "ok": true, "name": "..." } or { "ok": false, "error": "..." }
 *   exit 0 = success, exit 1 = error
 */
import {
	authorizeAsana,
	disconnectAsana,
	getAsanaUserName,
	isAsanaAuthorized,
} from "../src/lib/asana-oauth.js";

interface StdinInput {
	action?: string;
	clientId?: string;
	clientSecret?: string;
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
		const action = input?.action ?? "authorize";

		switch (action) {
			case "disconnect": {
				await disconnectAsana();
				process.stdout.write(JSON.stringify({ ok: true }));
				return;
			}
			case "status": {
				const authorized = isAsanaAuthorized();
				const result: Record<string, unknown> = { ok: true, authorized };
				if (authorized) {
					const name = await getAsanaUserName();
					if (name) result.name = name;
				}
				process.stdout.write(JSON.stringify(result));
				return;
			}
			case "authorize":
			default: {
				const result = await authorizeAsana({
					clientId: input?.clientId,
					clientSecret: input?.clientSecret,
				});
				process.stdout.write(JSON.stringify({ ok: true, ...result }));
				return;
			}
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stdout.write(JSON.stringify({ ok: false, error: message }));
		process.exit(1);
	}
}

await main();
