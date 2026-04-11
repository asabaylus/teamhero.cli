import type { AuthCoordinator, LoginResult } from "../cli/index.js";
import { getEnv } from "../lib/env.js";

export class AuthService implements AuthCoordinator {
	async ensureAuthenticated(): Promise<LoginResult> {
		const envToken = getEnv("GITHUB_PERSONAL_ACCESS_TOKEN")?.trim();
		if (envToken) {
			const method = getEnv("GITHUB_AUTH_METHOD");
			const provider =
				method === "oauth" ? "oauth" : method === "pat" ? "pat" : "token";
			const label =
				provider === "oauth"
					? "Authenticated via GitHub sign-in"
					: provider === "pat"
						? "Authenticated via Personal Access Token"
						: "Authenticated using GitHub token";
			return {
				authenticated: true,
				provider,
				message: label,
			} satisfies LoginResult;
		}

		return {
			authenticated: false,
			provider: "token",
			message:
				"Missing GitHub authentication. Run `teamhero setup` to sign in.",
		} satisfies LoginResult;
	}

	async login(): Promise<LoginResult> {
		return {
			authenticated: false,
			provider: "token",
			message: "Run `teamhero setup` to authenticate.",
		} satisfies LoginResult;
	}
}
