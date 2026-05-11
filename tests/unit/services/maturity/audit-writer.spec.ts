import { describe, expect, it } from "bun:test";
import {
	defaultOutputPath,
	renderAuditJson,
	renderAuditMarkdown,
} from "../../../../src/services/maturity/audit-writer.js";
import { computeOverallScore } from "../../../../src/services/maturity/scoring.js";
import type {
	AssessmentArtifact,
	ItemScore,
} from "../../../../src/services/maturity/types.js";

function buildArtifact(items: ItemScore[]): AssessmentArtifact {
	const overall = computeOverallScore(items);
	const _subtotals = items.reduce<
		Record<string, { raw: number; weighted: number; max: number }>
	>((acc, _) => acc, {});
	const cats = ["A", "B", "C", "D"] as const;
	return {
		scope: { mode: "local-repo", localPath: ".", displayName: "test-org" },
		tier: "gh",
		rubricVersion: "1.0.0",
		auditDate: "2026-05-03",
		items,
		topFixes: [
			{
				itemId: 4,
				whatGoodLooksLike: "Stand up structured logs and a runbook directory.",
				whyThisOne:
					"Observability is the lowest-risk leverage in this snapshot.",
			},
		],
		strengths: ["CLAUDE.md / AGENTS.md exist and are kept current."],
		oneLineTake: "Strong foundations, observability lagging.",
		adjacentRepos: [],
		notesForReaudit: ["Re-check item 4 once dashboards land."],
		interviewAnswers: [],
		rawScore: overall.rawScore,
		rawScoreMax: overall.rawScoreMax,
		weightedScore: overall.weightedScore,
		weightedScoreMax: overall.weightedScoreMax,
		scorePercent: overall.scorePercent,
		band: overall.band.name,
		categorySubtotals: cats.map((id) => ({
			id,
			raw: 0,
			weighted: 0,
			max: 0,
		})),
	};
}

describe("renderAuditMarkdown", () => {
	it("renders the title with scope and date", () => {
		const items = Array.from({ length: 12 }, (_, i) => ({
			itemId: i + 1,
			score: 1 as const,
			whyThisScore: "ok",
		}));
		const md = renderAuditMarkdown(buildArtifact(items));
		expect(md).toContain("# Agent Maturity Assessment — test-org — 2026-05-03");
	});

	it("includes summary fields", () => {
		const items = Array.from({ length: 12 }, (_, i) => ({
			itemId: i + 1,
			score: 1 as const,
			whyThisScore: "ok",
		}));
		const md = renderAuditMarkdown(buildArtifact(items));
		expect(md).toMatch(/Raw score: 12.0 \/ 12/);
		expect(md).toContain("Weighted score: 100.0%");
		expect(md).toContain("Band: **Excellent**");
		expect(md).toContain("Evidence tier: **1: gh**");
	});

	it("marks the active band with ◉", () => {
		const items = Array.from({ length: 12 }, (_, i) => ({
			itemId: i + 1,
			score: 0.5 as const,
			whyThisScore: "partial",
		}));
		const md = renderAuditMarkdown(buildArtifact(items));
		// 6/12 raw with weights = 7.25 / 14.5 = 50% → Significant dysfunction
		// The active-band marker only appears in the maturity-scale table rows,
		// which start with "| <bandName> |" — disambiguate from the Summary line.
		const tableRow = md
			.split("\n")
			.find((l) => l.startsWith("| Significant dysfunction |"));
		expect(tableRow).toBeDefined();
		expect(tableRow).toContain("◉");
		// Other band rows must not be marked
		const healthyRow = md.split("\n").find((l) => l.startsWith("| Healthy |"));
		expect(healthyRow).toBeDefined();
		expect(healthyRow).not.toContain("◉");
	});

	it("renders all 4 category tables", () => {
		const items = Array.from({ length: 12 }, (_, i) => ({
			itemId: i + 1,
			score: 1 as const,
			whyThisScore: "ok",
		}));
		const md = renderAuditMarkdown(buildArtifact(items));
		expect(md).toContain("### A. Engineering basics");
		expect(md).toContain("### B. Knowledge & context");
		expect(md).toContain("### C. AI governance & quality");
		expect(md).toContain("### D. Hiring");
	});

	it("includes top fixes section", () => {
		const items = Array.from({ length: 12 }, (_, i) => ({
			itemId: i + 1,
			score: 1 as const,
			whyThisScore: "ok",
		}));
		const md = renderAuditMarkdown(buildArtifact(items));
		expect(md).toContain("## Top 3 fixes");
		expect(md).toContain("Observability before features");
	});

	it("falls back to a no-fixes message when topFixes is empty", () => {
		const items = Array.from({ length: 12 }, (_, i) => ({
			itemId: i + 1,
			score: 1 as const,
			whyThisScore: "ok",
		}));
		const artifact = buildArtifact(items);
		artifact.topFixes = [];
		const md = renderAuditMarkdown(artifact);
		expect(md).toContain("No fixes identified");
	});

	it("falls back to 'None' for empty adjacent repos", () => {
		const items = Array.from({ length: 12 }, (_, i) => ({
			itemId: i + 1,
			score: 1 as const,
			whyThisScore: "ok",
		}));
		const md = renderAuditMarkdown(buildArtifact(items));
		expect(md).toContain("None — all evidence within scope repo.");
	});

	it("shows n/a in the score column", () => {
		const items: ItemScore[] = Array.from({ length: 12 }, (_, i) => ({
			itemId: i + 1,
			score: 1 as const,
			whyThisScore: "ok",
		}));
		items[7] = { itemId: 8, score: "n/a", whyThisScore: "out of scope" };
		const md = renderAuditMarkdown(buildArtifact(items));
		expect(md).toMatch(
			/\| 8 \| Sanctioned, governed AI tooling \| n\/a \| out of scope \|/,
		);
	});
});

describe("renderAuditJson", () => {
	it("produces valid JSON with the same artifact structure", () => {
		const items = Array.from({ length: 12 }, (_, i) => ({
			itemId: i + 1,
			score: 1 as const,
			whyThisScore: "ok",
		}));
		const json = renderAuditJson(buildArtifact(items));
		const parsed = JSON.parse(json);
		expect(parsed.rubricVersion).toBe("1.0.0");
		expect(parsed.items).toHaveLength(12);
		expect(parsed.band).toBe("Excellent");
	});
});

describe("defaultOutputPath", () => {
	it("slugifies the display name and includes date", () => {
		expect(defaultOutputPath("Acme Corp / Backend Team", "2026-05-03")).toBe(
			"./teamhero-maturity-acme-corp-backend-team-2026-05-03.md",
		);
	});

	it("collapses leading/trailing dashes", () => {
		expect(defaultOutputPath("  --foo--  ", "2026-05-03")).toBe(
			"./teamhero-maturity-foo-2026-05-03.md",
		);
	});
});
