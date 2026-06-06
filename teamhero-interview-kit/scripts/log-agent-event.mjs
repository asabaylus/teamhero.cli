#!/usr/bin/env node
// Portable hook script for interview.log (replaces the jq dependency).
//
// Usage: node scripts/log-agent-event.mjs <event-type>
//
// Reads a JSON payload from stdin (the agent hook passes its event JSON
// there), wraps it with the event type and an ISO-8601 timestamp, and
// appends one JSON line to interview.log in the current working
// directory. Parse/IO errors are swallowed so a malformed hook payload
// never interrupts the candidate's session.
//
// Node.js is already a prerequisite for the interview projects, so this
// is more portable than jq (which isn't installed by default on
// Windows/WSL or minimal Linux images).

import { appendFileSync } from "node:fs";
import { join } from "node:path";

const eventType = process.argv[2] || "unknown";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	input += chunk;
});
process.stdin.on("end", () => {
	try {
		const data = input.trim().length > 0 ? JSON.parse(input) : {};
		const entry = {
			event: eventType,
			timestamp: new Date().toISOString(),
			...data,
		};
		const logPath = join(process.cwd(), "interview.log");
		appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
	} catch {
		/* swallow parse/IO errors silently — never break the session */
	}
});
