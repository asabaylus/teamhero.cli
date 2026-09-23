/** One entry of Jira's `GET /rest/api/3/status` response. */
export interface JiraStatusDescriptor {
	name?: string;
	statusCategory?: { key?: string; name?: string };
}

/**
 * Status names to fall back on when the site's status list cannot be read.
 *
 * Every Jira site files its finished statuses under the `done` category, but
 * the words differ per site — this team uses four (Done, LIVE, Closed,
 * Review/Accept) and other sites use "Resolved" or "Shipped". These are only
 * the names Jira itself ships as defaults, kept so that a site whose status
 * list is unreadable still dates most of its work rather than none of it.
 */
export const WELL_KNOWN_DONE_STATUSES = ["Done", "Closed", "Resolved"] as const;

/**
 * The names of every status this site files under the Done category.
 *
 * An empty or unreadable list falls back to the well-known names, because a
 * query with no completed status in it matches nothing and would report the
 * whole team at zero without saying why.
 */
export function doneStatusNames(statuses: JiraStatusDescriptor[]): Set<string> {
	const names = new Set<string>();
	for (const status of statuses) {
		if (
			typeof status.name === "string" &&
			status.name.trim() !== "" &&
			status.statusCategory?.key === "done"
		) {
			names.add(status.name);
		}
	}
	return names.size > 0 ? names : new Set(WELL_KNOWN_DONE_STATUSES);
}
