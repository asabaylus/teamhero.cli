import type { AuthCoordinator, LoginResult } from "../cli/index.js";
import { getEnv } from "../lib/env.js";

export class AuthService implements AuthCoordinator {
	async ensureAuthenticated(): Promise<LoginResult> {
		const envToken = getEnv("GITHUB_PERSONAL_ACCESS_TOKEN")?.trim();
		if (envToken) {
			return {
				authenticated: true,
				provider: "token",
				message: "Authenticated using GITHUB_PERSONAL_ACCESS_TOKEN",
			} satisfies LoginResult;
		}

		return {
			authenticated: false,
			provider: "token",
			message:
				"Missing GITHUB_PERSONAL_ACCESS_TOKEN. Run `teamhero setup` or set the environment variable.",
		} satisfies LoginResult;
	}

	async login(): Promise<LoginResult> {
		throw new Error(
			"Login command has been removed. Set GITHUB_PERSONAL_ACCESS_TOKEN environment variable instead.",
		);
	}
}
