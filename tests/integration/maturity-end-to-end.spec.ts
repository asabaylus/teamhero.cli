import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MaturityAIScorer } from "../../src/services/maturity/ai-scorer.js";
import { runHeadlessAssessment } from "../../src/services/maturity/maturity.service.js";

describe("maturity assessment end-to-end (dry-run)", () => {
	it("produces a markdown audit file in dry-run mode against this repo", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "tm-maturity-"));
		const outputPath = join(tmpDir, "audit.md");
		try {
			const scorer = new MaturityAIScorer({ dryRun: true });
			const result = await runHeadlessAssessment(
				{
					scope: {
						mode: "local-repo",
						localPath: process.cwd(),
						displayName: "self-test",
					},
					evidenceTier: "git-only", // keep deterministic for the test
					outputPath,
					outputFormat: "both",
					dryRun: true,
				},
				{ scorer },
			);
			expect(result.outputPath).toBe(outputPath);
			expect(result.jsonOutputPath).toBeDefined();

			const md = readFileSync(outputPath, "utf8");
			expect(md).toContain("# Agent Maturity Assessment");
			expect(md).toContain("## Scores");
			expect(md).toContain("### A. Engineering basics");
			expect(md).toContain("### D. Hiring");

			const json = JSON.parse(readFileSync(result.jsonOutputPath!, "utf8"));
			expect(json.items).toHaveLength(12);
			expect(json.rubricVersion).toBe("1.0.0");
			expect(json.tier).toBe("git-only");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	}, 60_000);
});
