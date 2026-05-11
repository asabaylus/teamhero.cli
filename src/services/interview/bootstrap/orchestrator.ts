import {
	generateProject,
	type GeneratorClient,
} from "./project-generator.js";
import {
	type RoleConfig,
	validateRoleConfig,
	writeRoleConfig,
} from "./role-config.js";

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

	return {
		ok: true,
		attempts: generation.attempts,
		failures: [],
	};
}
