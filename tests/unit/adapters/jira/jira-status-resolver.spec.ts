import { describe, expect, it } from "bun:test";
import {
	doneStatusNames,
	WELL_KNOWN_DONE_STATUSES,
} from "../../../../src/adapters/jira/jira-status-resolver.js";

describe("doneStatusNames", () => {
	it("takes every status the site files under the done category", () => {
		expect(
			doneStatusNames([
				{ name: "Backlog", statusCategory: { key: "new" } },
				{ name: "Build", statusCategory: { key: "indeterminate" } },
				{ name: "LIVE", statusCategory: { key: "done" } },
				{ name: "Done", statusCategory: { key: "done" } },
				{ name: "Review/Accept", statusCategory: { key: "done" } },
			]),
		).toEqual(new Set(["LIVE", "Done", "Review/Accept"]));
	});

	it("keeps a done status whose name is nothing like 'done'", () => {
		// The name is a per-site word; only the category is portable.
		expect(
			doneStatusNames([{ name: "LIVE", statusCategory: { key: "done" } }]),
		).toEqual(new Set(["LIVE"]));
	});

	it("falls back to the well-known names when nothing is in the done category", () => {
		// A query with no completed status matches nothing, which would report the
		// whole team at zero without saying why.
		expect(
			doneStatusNames([
				{ name: "Build", statusCategory: { key: "indeterminate" } },
			]),
		).toEqual(new Set(WELL_KNOWN_DONE_STATUSES));
	});

	it("falls back on an empty list", () => {
		expect(doneStatusNames([])).toEqual(new Set(WELL_KNOWN_DONE_STATUSES));
	});

	it("skips entries with no usable name", () => {
		expect(
			doneStatusNames([
				{ statusCategory: { key: "done" } },
				{ name: "   ", statusCategory: { key: "done" } },
				{ name: "Closed", statusCategory: { key: "done" } },
			]),
		).toEqual(new Set(["Closed"]));
	});
});
