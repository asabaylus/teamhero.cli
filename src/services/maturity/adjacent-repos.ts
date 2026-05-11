import { join } from "node:path";
import { findFiles, readIfExists } from "./fs-utils.js";
import type { AdjacentRepo, ScopeDescriptor } from "./types.js";

const OWNER_REPO = /([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/;

const STDLIB_OWNERS = new Set([
	"actions",
	"docker",
	"github",
	"oven-sh",
	"hashicorp", // skip the modules' own owners (we only want intra-org neighbours)
]);

/**
 * Discover external GitHub repositories referenced by the local repository.
 *
 * Scans the repository root (scope.localPath) for references via GitHub Actions `uses`, Terraform module sources, `.gitmodules` submodules, and `github.com` links in README.md; excludes known standard-library owners and de-duplicates results case-insensitively.
 *
 * @param scope - Descriptor whose `localPath` is the repository root to scan; if `localPath` is falsy the function returns an empty array
 * @returns An array of detected `AdjacentRepo` objects (`{ owner, name, reason }`), de-duplicated by `owner/name` (case-insensitive)
 */
export async function detectAdjacentRepos(
	scope: ScopeDescriptor,
): Promise<AdjacentRepo[]> {
	if (!scope.localPath) return [];
	const root = scope.localPath;
	const found = new Map<string, AdjacentRepo>();

	// 1. Workflow references
	const workflowFiles = await findFiles(root, {
		pathContains: [".github/workflows"],
		nameRegex: /\.ya?ml$/i,
		maxDepth: 4,
		limit: 100,
	});
	for (const wf of workflowFiles) {
		const content = await readIfExists(join(root, wf));
		if (!content) continue;
		for (const line of content.split(/\r?\n/)) {
			const usesMatch = /\buses:\s*([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/.exec(
				line,
			);
			if (usesMatch) {
				const m = OWNER_REPO.exec(usesMatch[1]);
				if (m && !STDLIB_OWNERS.has(m[1].toLowerCase())) {
					addRepo(found, m[1], m[2], `Workflow uses: ${m[0]}`);
				}
			}
		}
	}

	// 2. Terraform module sources
	const tfFiles = await findFiles(root, {
		pathContains: ["infra/", "terraform/"],
		nameRegex: /\.tf$/,
		maxDepth: 6,
		limit: 100,
	});
	for (const tf of tfFiles) {
		const content = await readIfExists(join(root, tf));
		if (!content) continue;
		const matches = content.matchAll(
			/source\s*=\s*"(?:git::|github\.com\/)([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/g,
		);
		for (const match of matches) {
			const m = OWNER_REPO.exec(match[1]);
			if (m) addRepo(found, m[1], m[2], "Terraform module source");
		}
	}

	// 3. Submodules
	const gitmodules = await readIfExists(join(root, ".gitmodules"));
	if (gitmodules) {
		const matches = gitmodules.matchAll(
			/url\s*=\s*(?:.*github\.com[:/])?([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/g,
		);
		for (const m of matches) {
			const owner = OWNER_REPO.exec(m[1]);
			if (owner) addRepo(found, owner[1], owner[2], "Git submodule");
		}
	}

	// 4. Generic cross-repo refs in README / docs
	const readme = await readIfExists(join(root, "README.md"));
	if (readme) {
		const matches = readme.matchAll(
			/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/g,
		);
		for (const m of matches) {
			if (!STDLIB_OWNERS.has(m[1].toLowerCase())) {
				addRepo(found, m[1], m[2], "Referenced in README.md");
			}
		}
	}

	return [...found.values()];
}

/**
 * Add an adjacent repository to the map if it is not already present.
 *
 * @param map - Map used for de-duplication, keyed by the lowercase `owner/name`
 * @param owner - Repository owner (organization or user)
 * @param name - Repository name
 * @param reason - Short human-readable reason describing why the repository was detected
 */
function addRepo(
	map: Map<string, AdjacentRepo>,
	owner: string,
	name: string,
	reason: string,
): void {
	const key = `${owner}/${name}`.toLowerCase();
	if (map.has(key)) return;
	map.set(key, { owner, name, reason });
}
