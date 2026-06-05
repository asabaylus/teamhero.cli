import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractRiskAwareness } from "../../../../../src/services/interview/review/extractors/risk-awareness.js";
import { extractTestPass } from "../../../../../src/services/interview/review/extractors/test-pass.js";
import { extractThroughput } from "../../../../../src/services/interview/review/extractors/throughput.js";
import { extractVerification } from "../../../../../src/services/interview/review/extractors/verification.js";
import type { EvidenceEvent } from "../../../../../src/services/interview/review/types.js";

const prompt = (ts: string, text: string): EvidenceEvent => ({
	type: "prompt",
	timestamp: ts,
	source: "interview.log",
	text,
});

const cmd = (ts: string, command: string, pause?: number): EvidenceEvent => ({
	type: "command",
	timestamp: ts,
	source: "terminal.cast",
	command,
	pauseSecondsBeforeEnter: pause,
});

const commit = (ts: string, sha: string, msg: string): EvidenceEvent => ({
	type: "commit",
	timestamp: ts,
	source: "git",
	sha,
	message: msg,
	insertions: 5,
	deletions: 1,
});

describe("verification extractor", () => {
	it("counts test runs and typechecks across runners", () => {
		const events: EvidenceEvent[] = [
			cmd("2026-05-10T10:00:00Z", "bun test"),
			cmd("2026-05-10T10:01:00Z", "go test ./..."),
			cmd("2026-05-10T10:02:00Z", "tsc --noEmit"),
			cmd("2026-05-10T10:03:00Z", "git diff"),
			cmd("2026-05-10T10:04:00Z", "ls"),
		];
		const m = extractVerification(events);
		expect(m.dimension_id).toBe("verification");
		const find = (label: RegExp) => m.facts.find((f) => label.test(f.label));
		expect(find(/Total test runs/)?.value).toBe(2);
		expect(find(/typecheck/)?.value).toBe(1);
		expect(find(/Diff\/grep/)?.value).toBe(1);
	});

	it("tracks test-runs-after-prompt interleaving", () => {
		const events: EvidenceEvent[] = [
			prompt("2026-05-10T10:00:00Z", "add a test"),
			cmd("2026-05-10T10:00:30Z", "bun test"),
			prompt("2026-05-10T10:01:00Z", "now fix it"),
			cmd("2026-05-10T10:01:30Z", "bun test"),
		];
		const m = extractVerification(events);
		const interleaved = m.facts.find((f) => /after a prompt/.test(f.label));
		expect(interleaved?.value).toBe(2);
	});
});

describe("risk-awareness extractor", () => {
	it("reports zero detections on a clean session", () => {
		const m = extractRiskAwareness([
			cmd("2026-05-10T10:00:00Z", "ls"),
			cmd("2026-05-10T10:01:00Z", "bun test"),
		]);
		expect(m.facts[0].label).toMatch(/Destructive commands detected/);
		expect(m.facts[0].value).toBe(0);
	});

	it("detects rm -rf and reports the pause time", () => {
		const m = extractRiskAwareness([
			cmd("2026-05-10T10:00:00Z", "rm -rf ./build", 3.2),
		]);
		expect(m.facts).toHaveLength(1);
		expect(m.facts[0].label).toBe("rm -rf");
		expect(m.facts[0].context).toMatch(/3\.20s/);
	});

	it("detects force pushes and resets", () => {
		const m = extractRiskAwareness([
			cmd("2026-05-10T10:00:00Z", "git push origin main --force"),
			cmd("2026-05-10T10:01:00Z", "git reset --hard HEAD~3"),
		]);
		expect(m.facts).toHaveLength(2);
	});
});

describe("test-pass extractor", () => {
	it("reports passing/failing counts from the injected runner", () => {
		const m = extractTestPass("/tmp/fake", () => ({
			passed: 12,
			failed: 3,
			output: "...",
		}));
		expect(m.dimension_id).toBe("test-pass");
		expect(m.facts.find((f) => f.label === "Passing tests")?.value).toBe(12);
		expect(m.facts.find((f) => f.label === "Failing tests")?.value).toBe(3);
		expect(m.facts.find((f) => f.label === "Pass rate")?.value).toBe("12/15");
	});

	it("reports n/a when no tests ran", () => {
		const m = extractTestPass("/tmp/fake", () => ({
			passed: 0,
			failed: 0,
			output: "",
		}));
		expect(m.facts.find((f) => f.label === "Pass rate")?.value).toBe("n/a");
	});

	it("falls through to the default real runner on a directory without go.mod or package.json", () => {
		const dir = mkdtempSync(join(tmpdir(), "iv-tp-"));
		try {
			const m = extractTestPass(dir);
			expect(m.dimension_id).toBe("test-pass");
			expect(m.facts.find((f) => f.label === "Pass rate")?.value).toBe("n/a");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("throughput extractor", () => {
	it("reports elapsed, commit count, and time-to-first-test", () => {
		const events: EvidenceEvent[] = [
			cmd("2026-05-10T10:00:00Z", "ls"),
			cmd("2026-05-10T10:05:00Z", "bun test"),
			commit("2026-05-10T10:10:00Z", "abc", "first commit"),
			commit("2026-05-10T10:20:00Z", "def", "second commit"),
		];
		const m = extractThroughput(events);
		const elapsed = m.facts.find((f) => f.label === "Elapsed");
		expect(elapsed?.value).toBe("20m00s");
		const commits = m.facts.find((f) => f.label === "Total commits");
		expect(commits?.value).toBe(2);
		const ttft = m.facts.find((f) => f.label === "Time to first test run");
		expect(ttft?.value).toBe("5m00s");
	});

	it("returns 'unknown' boundaries when given empty events", () => {
		const m = extractThroughput([]);
		expect(m.facts.find((f) => f.label === "Session start")?.value).toBe(
			"unknown",
		);
	});
});
