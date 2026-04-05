import { describe, expect, it } from "bun:test";
import type { ReportMemberMetrics } from "../../../src/lib/report-renderer.js";
import { buildDeltaReport } from "../../../src/services/delta-report.service.js";

function makeMember(
	overrides: Partial<ReportMemberMetrics> & { login: string },
): ReportMemberMetrics {
	return {
		login: overrides.login,
		displayName: overrides.displayName ?? overrides.login,
		avatarUrl: "",
		commits: overrides.commits ?? 0,
		prsOpened: overrides.prsOpened ?? 0,
		prsClosed: overrides.prsClosed ?? 0,
		prsMerged: overrides.prsMerged ?? 0,
		linesAdded: overrides.linesAdded ?? 0,
		linesDeleted: overrides.linesDeleted ?? 0,
		linesAddedInProgress: 0,
		linesDeletedInProgress: 0,
		reviews: overrides.reviews ?? 0,
		aiSummary: "",
		taskTracker: { status: "skipped" as const },
		pullRequests: [],
		commitsByRepo: [],
	};
}

describe("buildDeltaReport", () => {
	it("returns null when snapshot has no memberMetrics", () => {
		const current = [makeMember({ login: "alice", prsMerged: 5, commits: 10 })];
		const result = buildDeltaReport(current, {});
		expect(result).toBeNull();
	});

	it("computes period deltas from snapshot", () => {
		const current = [
			makeMember({ login: "alice", prsMerged: 10, commits: 20 }),
		];
		const snapshot = {
			memberMetrics: [
				{
					login: "alice",
					prsMerged: 5,
					prsOpened: 3,
					commits: 15,
					linesAdded: 100,
					linesDeleted: 50,
				},
			],
		};

		const result = buildDeltaReport(current, snapshot);
		expect(result).not.toBeNull();
		expect(result!.periodDeltas.hasPreviousPeriod).toBe(true);
		expect(result!.periodDeltas.prsMerged.current).toBe(10);
		expect(result!.periodDeltas.prsMerged.previous).toBe(5);
	});

	it("classifies member velocity direction", () => {
		const current = [
			makeMember({
				login: "alice",
				displayName: "Alice",
				prsMerged: 10,
				commits: 20,
			}),
			makeMember({
				login: "bob",
				displayName: "Bob",
				prsMerged: 1,
				commits: 1,
			}),
		];
		const snapshot = {
			memberMetrics: [
				{ login: "alice", prsMerged: 5, commits: 8 },
				{ login: "bob", prsMerged: 10, commits: 15 },
			],
		};

		const result = buildDeltaReport(current, snapshot);
		expect(result).not.toBeNull();

		const aliceDelta = result!.memberDeltas.find((m) => m.login === "alice");
		expect(aliceDelta?.changeDirection).toBe("up");

		const bobDelta = result!.memberDeltas.find((m) => m.login === "bob");
		expect(bobDelta?.changeDirection).toBe("down");
	});

	it("generates a narrative string", () => {
		const current = [
			makeMember({ login: "alice", prsMerged: 10, commits: 20 }),
		];
		const snapshot = {
			memberMetrics: [{ login: "alice", prsMerged: 5, commits: 10 }],
		};

		const result = buildDeltaReport(current, snapshot);
		expect(result!.narrative).toContain("increased");
	});

	it("handles case-insensitive login matching", () => {
		const current = [
			makeMember({
				login: "Alice",
				displayName: "Alice",
				prsMerged: 5,
				commits: 10,
			}),
		];
		const snapshot = {
			memberMetrics: [{ login: "alice", prsMerged: 5, commits: 10 }],
		};

		const result = buildDeltaReport(current, snapshot);
		expect(result).not.toBeNull();
		const aliceDelta = result!.memberDeltas.find((m) => m.login === "Alice");
		expect(aliceDelta?.previousPrsMerged).toBe(5);
	});
});
