import { formatDateISO } from "./date-utils.js";

/**
 * Org-wide pull-request counting via the GitHub search API.
 *
 * PR authors are always real logins, so `type:pr author:<login>` org-wide is the
 * authoritative count — it fixes the per-repo pull-list undercount (a lead read
 * 22 vs an actual 26). This module is pure: the service performs the search I/O
 * and feeds the returned items here for classification and tallying.
 * See `docs/issues/03-org-search-pr-counts.md` and ADR-0001.
 */

/** A pull request from the GitHub search API, narrowed to what the count needs. */
export interface PrSearchItem {
	/** PR author login. */
	authorLogin: string;
	/** GitHub issue state. */
	state: "open" | "closed";
	/** `pull_request.merged_at` — set only when the PR was actually merged. */
	mergedAt: string | null;
	number: number;
	title: string;
	url: string;
	/** `owner/repo`, when known — used for dedup and reconciliation. */
	repo?: string;
}

/** Delivery outcome of a PR. */
export type PrClass = "merged" | "closed-unmerged" | "open";

export interface PrCounts {
	merged: number;
	closedUnmerged: number;
	open: number;
}

/** Classify a PR by delivery outcome; a merge always wins over a bare "closed". */
export function classifyPr(item: {
	state: string;
	mergedAt: string | null;
}): PrClass {
	if (item.mergedAt) return "merged";
	if (item.state === "closed") return "closed-unmerged";
	return "open";
}

/**
 * Build a GitHub search query counting a login's PRs org-wide, all states,
 * created within the window. Dates are formatted as UTC `YYYY-MM-DD`.
 *
 * `startISO`/`endISO` are the user's **intended** window. GitHub search
 * `created:START..END` is inclusive on both endpoints, so pass the real window
 * boundaries here — never `resolveEndISO()`'s +2-day buffer (a Commits-API,
 * author-date device), which would over-count PRs created after the window.
 */
export function buildPrSearchQuery(opts: {
	login: string;
	org: string;
	startISO: string;
	endISO: string;
}): string {
	const start = formatDateISO(new Date(opts.startISO));
	const end = formatDateISO(new Date(opts.endISO));
	return `type:pr author:${opts.login} org:${opts.org} created:${start}..${end}`;
}

/**
 * Tally search items into merged / closed-unmerged / open. Items are deduped by
 * url (falling back to repo#number) so a PR surfaced under more than one of a
 * Person's logins is never double counted; summing across a Person's logins is
 * therefore just concatenation followed by one tally.
 */
export function tallyPrs(items: PrSearchItem[]): PrCounts {
	const counts: PrCounts = { merged: 0, closedUnmerged: 0, open: 0 };
	const seen = new Set<string>();
	for (const item of items) {
		const key = item.url || `${item.repo ?? ""}#${item.number}`;
		if (seen.has(key)) continue;
		seen.add(key);
		switch (classifyPr(item)) {
			case "merged":
				counts.merged += 1;
				break;
			case "closed-unmerged":
				counts.closedUnmerged += 1;
				break;
			default:
				counts.open += 1;
		}
	}
	return counts;
}
