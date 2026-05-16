import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	generateProject,
	type GeneratorClient,
} from "./project-generator.js";
import {
	type RoleConfig,
	validateRoleConfig,
	writeRoleConfig,
} from "./role-config.js";

// Static index.html stub written for Mode B (greenfield) runs. The
// candidate opens this file in their browser to get a friendly
// "where do I start" landing pad even when they've chosen to write
// everything from scratch. Kept deliberately small — no styling, no
// dependencies, no framework markers — so it doesn't influence the
// candidate's tooling choices.
const MODE_B_INDEX_HTML_STUB = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Interview project — getting started</title>
  </head>
  <body>
    <h1>Interview project</h1>
    <p>
      Welcome. This is a placeholder. Open
      <a href="./BRIEF.md"><code>BRIEF.md</code></a> for what you're
      being asked to build and the acceptance criteria.
    </p>
    <p>
      Replace this file with your own work. You choose the stack and
      tooling.
    </p>
  </body>
</html>
`;

// writeModeBStub drops a minimal index.html into a Mode B output so the
// candidate has something concrete to open in a browser. No-op for
// Mode A (which already has source files) and no-op when the AI's
// own output already contains an index.html so we don't clobber it.
function writeModeBStub(config: RoleConfig): void {
	if (config.projectMode !== "B") return;
	const target = join(config.outputDir, "index.html");
	if (existsSync(target)) return;
	writeFileSync(target, MODE_B_INDEX_HTML_STUB, "utf8");
}

export interface RunBootstrapOptions {
	readonly client: GeneratorClient;
	readonly kitTemplateDir?: string;
	readonly maxAttempts?: number;
}

export interface RunBootstrapResult {
	readonly ok: boolean;
	readonly attempts: number;
	readonly failures: readonly string[];
}

export async function runBootstrap(
	config: RoleConfig,
	options: RunBootstrapOptions,
): Promise<RunBootstrapResult> {
	const configValidation = validateRoleConfig(config);
	if (!configValidation.ok) {
		return {
			ok: false,
			attempts: 0,
			failures: configValidation.failures,
		};
	}

	// Wrap so an unexpected throw inside generation / writeRoleConfig (e.g.
	// network failure, disk-full, path-guard rejection) surfaces as a
	// structured failure on RunBootstrapResult instead of an unhandled
	// rejection at the CLI boundary.
	try {
		const generation = await generateProject(config, options.client, {
			kitTemplateDir: options.kitTemplateDir,
			maxAttempts: options.maxAttempts,
		});
		if (!generation.ok) {
			return {
				ok: false,
				attempts: generation.attempts,
				failures: generation.failures,
			};
		}

		writeRoleConfig(config.outputDir, config);
		writeModeBStub(config);

		return {
			ok: true,
			attempts: generation.attempts,
			failures: [],
		};
	} catch (err) {
		return {
			ok: false,
			attempts: 0,
			failures: [err instanceof Error ? err.message : String(err)],
		};
	}
}
