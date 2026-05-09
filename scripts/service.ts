#!/usr/bin/env bun
/**
 * Unified entry point for the compiled teamhero-service binary.
 *
 * When called with `--script <name>`, routes to the matching auth helper.
 * When called without `--script`, runs the report service (run-report.ts).
 *
 * This file is the bun --compile target; it must dynamically import all
 * routable scripts so the bundler includes them in the output binary.
 */

const scriptIdx = process.argv.indexOf("--script");
if (scriptIdx !== -1) {
	const scriptName = process.argv[scriptIdx + 1];
	switch (scriptName) {
		case "github-auth.ts":
			await import("./github-auth.ts");
			break;
		case "asana-auth.ts":
			await import("./asana-auth.ts");
			break;
		case "google-auth.ts":
			await import("./google-auth.ts");
			break;
		default:
			process.stderr.write(`teamhero-service: unknown script: ${scriptName}\n`);
			process.exit(1);
	}
} else {
	await import("./run-report.ts");
}
