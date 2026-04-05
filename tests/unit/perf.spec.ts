import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { AIService } from "../../src/services/ai.service.js";
import { MetricsService } from "../../src/services/metrics.service.js";
import { ReportService } from "../../src/services/report.service.js";
import { ScopeService } from "../../src/services/scope.service.js";

const organization = {
	id: 1,
	login: "acme",
	name: "Acme",
	nodeId: "ORGID",
};

const repositories = Array.from({ length: 25 }, (_, index) => ({
	id: index,
	name: `repo-${index}`,
	isPrivate: false,
	isArchived: false,
}));

const members = Array.from({ length: 50 }, (_, index) => ({
	id: index,
	login: `dev${index}`,
	displayName: `Developer ${index}`,
	isBot: false,
	teamSlugs: [],
}));

const metricEntries = members.map((member) => ({
	metrics: {
		memberLogin: member.login,
		commitsCount: 25,
		prsOpenedCount: 10,
		prsMergedCount: 8,
		linesAdded: 1200,
		linesDeleted: 450,
		linesAddedInProgress: 0,
		linesDeletedInProgress: 0,
		reviewsCount: 6,
		reviewCommentsCount: 12,
		approvalsCount: 4,
		changesRequestedCount: 1,
		commentedCount: 1,
		windowStart: "2025-08-20",
		windowEnd: "2025-09-19",
	},
	displayName: member.displayName,
	highlights: [
		`merged #${member.id} Feature ${member.id}`,
		`commit summary ${member.id}`,
	],
	prHighlights: [
		`repo-${member.id % 5} · PR #${member.id} Feature ${member.id}`,
	],
	commitHighlights:
		member.id % 2 === 0
			? [`repo-${member.id % 5} · commit deadbee: refactor module ${member.id}`]
			: [],
}));

beforeEach(() => {
	spyOn(ScopeService.prototype, "getOrganization").mockResolvedValue(
		organization,
	);
	spyOn(ScopeService.prototype, "getRepositories").mockResolvedValue(
		repositories,
	);
	spyOn(ScopeService.prototype, "getMembers").mockResolvedValue(members);
	spyOn(MetricsService.prototype, "collect").mockResolvedValue({
		members: metricEntries,
		warnings: [],
		errors: [],
		mergedTotal: 50,
	});
});

afterEach(() => {
	// Restore individual spies without using mock.restore() which would undo mock.module() calls
	(ScopeService.prototype.getOrganization as any).mockRestore();
	(ScopeService.prototype.getRepositories as any).mockRestore();
	(ScopeService.prototype.getMembers as any).mockRestore();
	(MetricsService.prototype.collect as any).mockRestore();
});

describe("performance smoke", () => {
	it("generates report within expected time for medium dataset", async () => {
		const ai = new AIService();
		spyOn(ai, "generateTeamHighlight").mockResolvedValue("Team highlight.");
		spyOn(ai, "generateMemberHighlights").mockImplementation(
			async (ctx: any) => {
				const map = new Map<string, string>();
				for (const m of ctx.members ?? []) {
					map.set(m.login, "Member highlight.");
				}
				return map;
			},
		);
		spyOn(ai, "generateFinalReport").mockResolvedValue("# Report\n");

		const report = new ReportService({
			scope: new ScopeService({} as any),
			metrics: new MetricsService({} as any),
			ai,
			outputDir: () => os.tmpdir(),
		});

		const start = performance.now();
		await report.generateReport({
			org: "acme",
			sections: {
				dataSources: { git: true, asana: false },
				reportSections: { visibleWins: false, individualContributions: true },
			},
			excludePrivate: false,
			includeArchived: false,
			includeBots: false,
			detailed: false,
		} as any);
		const elapsedMs = performance.now() - start;
		expect(elapsedMs).toBeLessThan(30_000);
	}, 35_000);
});
