import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const GATE_SCRIPT = resolve(
	import.meta.dir,
	"../../../../../teamhero-interview-kit/lib/privacy-gate.sh",
);

function runGate(filePath: string | undefined): number {
	const args = filePath === undefined ? [GATE_SCRIPT] : [GATE_SCRIPT, filePath];
	const result = spawnSync("bash", args, { encoding: "utf8" });
	return result.status ?? -1;
}

function tempFile(content: string): { path: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), "iv-priv-"));
	const path = join(dir, "PRIVACY_RELEASE.md");
	writeFileSync(path, content);
	return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("privacy gate", () => {
	it("returns 0 when the release is properly signed", () => {
		const { path, cleanup } = tempFile(
			`# Privacy Release\n\n## Signed\n\nJane Doe\n\n## Date\n\n2026-05-10\n`,
		);
		try {
			expect(runGate(path)).toBe(0);
		} finally {
			cleanup();
		}
	});

	it("returns non-zero when the file is missing entirely", () => {
		const code = runGate("/tmp/this-path-definitely-does-not-exist-xyz");
		expect(code).not.toBe(0);
	});

	it("returns non-zero when the file is empty", () => {
		const { path, cleanup } = tempFile("");
		try {
			expect(runGate(path)).not.toBe(0);
		} finally {
			cleanup();
		}
	});

	it("returns non-zero when sections contain only the placeholder text", () => {
		const { path, cleanup } = tempFile(
			`# Privacy Release\n\n## Signed\n\n(placeholder — candidate signs here)\n\n## Date\n\n(placeholder — candidate dates here)\n`,
		);
		try {
			expect(runGate(path)).not.toBe(0);
		} finally {
			cleanup();
		}
	});

	it("returns non-zero when the file has signature but no date", () => {
		const { path, cleanup } = tempFile(
			`# Privacy Release\n\n## Signed\n\nJane Doe\n\n## Date\n\n\n`,
		);
		try {
			expect(runGate(path)).not.toBe(0);
		} finally {
			cleanup();
		}
	});

	it("returns non-zero when the file has date but no signature", () => {
		const { path, cleanup } = tempFile(
			`# Privacy Release\n\n## Signed\n\n\n\n## Date\n\n2026-05-10\n`,
		);
		try {
			expect(runGate(path)).not.toBe(0);
		} finally {
			cleanup();
		}
	});

	it("returns non-zero when no path is provided", () => {
		expect(runGate(undefined)).not.toBe(0);
	});

	it("returns non-zero when sections are missing entirely", () => {
		const { path, cleanup } = tempFile(`# Privacy Release\n\nSome other text.\n`);
		try {
			expect(runGate(path)).not.toBe(0);
		} finally {
			cleanup();
		}
	});

	it("accepts when sections contain whitespace around the real value", () => {
		const { path, cleanup } = tempFile(
			`# Privacy Release\n\n## Signed\n\n   Jane Doe   \n\n## Date\n\n   2026-05-10   \n`,
		);
		try {
			expect(runGate(path)).toBe(0);
		} finally {
			cleanup();
		}
	});
});
