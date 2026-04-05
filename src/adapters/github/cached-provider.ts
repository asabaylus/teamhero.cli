import type { FetchOptions, RepoProvider } from "../../core/types.js";
import {
	type RepoCacheKeyOptions,
	RepoCacheStore,
} from "../cache/repo-cache.js";

export interface CachedRepoProviderOptions {
	refresh?: boolean;
}

export class CachedRepoProvider implements RepoProvider {
	constructor(
		private readonly inner: RepoProvider,
		private readonly cache: RepoCacheStore,
		private readonly options: CachedRepoProviderOptions = {},
	) {}

	async listRepositories(
		org: string,
		options: FetchOptions = {},
	): Promise<string[]> {
		// Skip caching in test mode to ensure tests use their mocked providers
		if (process.env.TEAMHERO_TEST_MODE) {
			return this.inner.listRepositories(org, options);
		}

		const cacheKey: RepoCacheKeyOptions = {
			includePrivate: options.includePrivate ?? true,
			includeArchived: options.includeArchived ?? false,
			sortBy: options.sortBy ?? "pushed",
		};

		if (!this.options.refresh) {
			const hit = await this.cache.get(org, cacheKey);
			if (hit) {
				return hit.repos;
			}
		}

		const repos = await this.inner.listRepositories(org, options);
		await this.cache.set(org, cacheKey, repos);
		return repos;
	}
}
